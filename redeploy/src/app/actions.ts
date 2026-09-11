"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db";
import {
  requireUser,
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  canEditPackages,
} from "@/lib/auth";
import { checkRateLimit, recordFailure, clearRateLimit } from "@/lib/rate-limit";
import {
  generateResetToken,
  hashResetToken,
  resetTokenExpiry,
  isResetTokenLive,
} from "@/lib/password-reset";
import { getEmailSender, passwordResetEmail } from "@/lib/email";
import { parseAgencyCsv } from "@/lib/sources/csv";
import { ingest } from "@/lib/ingest";
import { bullhornFromEnv } from "@/lib/sources/bullhorn";

/**
 * `values` echoes back what was submitted. React 19 resets an uncontrolled
 * form once its action resolves, so without this a failed sign-in would wipe
 * the email the recruiter already typed.
 */
export type ActionState = {
  error?: string;
  ok?: string;
  values?: { email?: string };
} | null;

// ------------------------------------------------------------------- auth

/** Identifies the caller for rate limiting: client IP plus the email tried. */
async function attemptKey(scope: string, email: string) {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0].trim() ?? h.get("x-real-ip") ?? "unknown";
  return `${scope}:${ip}:${email}`;
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = { email: String(formData.get("email") ?? "") };

  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("Enter a valid email address."),
      password: z.string().min(1, "Enter your password."),
    })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) return { error: parsed.error.issues[0].message, values };

  const key = await attemptKey("login", parsed.data.email);

  const verdict = checkRateLimit(key);
  if (!verdict.allowed) {
    const mins = Math.ceil(verdict.retryAfterSec / 60);
    return {
      error: `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
      values,
    };
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });

  // Same message either way, so the form can't be used to work out which
  // recruiters an agency employs.
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    const nowBlocked = recordFailure(key);
    return {
      error: nowBlocked
        ? "Too many sign-in attempts. Try again in 15 minutes."
        : "Incorrect email or password.",
      values,
    };
  }

  clearRateLimit(key);
  await createSession(user.id);
  redirect("/board");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

const NEUTRAL_RESET_MESSAGE =
  "If an account exists for that email, a reset link is on its way.";

/**
 * Always returns the same message whether or not the email is registered.
 * A different response would let anyone probe which addresses belong to an
 * agency's staff, which is exactly what the neutral sign-in error avoids.
 */
export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.") })
    .safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0].message,
      values: { email: String(formData.get("email") ?? "") },
    };
  }

  const { email } = parsed.data;
  const key = await attemptKey("reset-request", email);

  const verdict = checkRateLimit(key);
  if (!verdict.allowed) {
    // Still neutral: saying that *this address* is rate limited would itself
    // confirm the address is registered.
    return { ok: NEUTRAL_RESET_MESSAGE };
  }
  recordFailure(key); // counts the attempt itself, not a failure to authenticate

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    // Any earlier unused link stops working once a new one is requested.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const { raw, hash } = generateResetToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt: resetTokenExpiry() },
    });

    const origin = (await headers()).get("origin") ?? "";
    const resetUrl = `${origin}/reset-password/${raw}`;
    const { subject, text, html } = passwordResetEmail(resetUrl);
    await getEmailSender().send({ to: email, subject, text, html });
  }

  return { ok: NEUTRAL_RESET_MESSAGE };
}

export async function resetPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = z
    .object({
      token: z.string().min(1),
      password: z.string().min(8, "Password must be at least 8 characters."),
    })
    .safeParse({ token: formData.get("token"), password: formData.get("password") });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { token, password } = parsed.data;

  const key = await attemptKey("reset-consume", token.slice(0, 16));
  const verdict = checkRateLimit(key);
  if (!verdict.allowed) return { error: "Too many attempts. Request a new link." };

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
  });

  if (!record || !isResetTokenLive(record)) {
    recordFailure(key);
    return { error: "That reset link is invalid or has expired. Request a new one." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // A reset is also the moment to end every other signed-in session — if
    // someone else's session was the reason a reset was needed, this is what
    // actually locks them out of the agency's book of business.
    prisma.session.deleteMany({ where: { userId: record.userId } }),
  ]);

  clearRateLimit(key);
  await createSession(record.userId);
  redirect("/board");
}

// ------------------------------------------------------------ assignments
const EXT = ["NOT_ASKED", "INTERESTED", "SIGNED", "DECLINED", "NO_RESPONSE"] as const;

/** Confirms an assignment belongs to the caller's agency before touching it. */
async function ownedAssignment(agencyId: string, id: string) {
  return prisma.assignment.findFirst({ where: { id, agencyId }, select: { id: true, travelerId: true } });
}

export async function setExtensionStatus(id: string, status: (typeof EXT)[number]) {
  const user = await requireUser();
  if (!EXT.includes(status)) return;

  const owned = await ownedAssignment(user.agencyId, id);
  if (!owned) return;

  await prisma.assignment.update({ where: { id }, data: { extensionStatus: status } });
  revalidatePathsForBook();
}

export async function setNextStep(id: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const owned = await ownedAssignment(user.agencyId, id);
  if (!owned) return;

  const value = String(formData.get("nextStep") ?? "").trim().slice(0, 200);
  await prisma.assignment.update({
    where: { id },
    data: { nextStep: value || null },
  });
  revalidatePathsForBook();
}

export async function logTouchpoint(travelerId: string, formData: FormData): Promise<void> {
  const user = await requireUser();

  const owned = await prisma.traveler.findFirst({
    where: { id: travelerId, agencyId: user.agencyId },
    select: { id: true },
  });
  if (!owned) return;

  await prisma.touchpoint.create({
    data: {
      travelerId,
      userId: user.id,
      kind: String(formData.get("kind") ?? "CALL").slice(0, 20),
      note: String(formData.get("note") ?? "").trim().slice(0, 500) || null,
    },
  });
  revalidatePathsForBook();
}

export async function updatePackage(id: string, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditPackages(user.role)) {
    return { error: "Only an owner or manager can change a pay package." };
  }

  const owned = await ownedAssignment(user.agencyId, id);
  if (!owned) return { error: "Assignment not found." };

  const numeric = (key: string) => {
    const raw = String(formData.get(key) ?? "").replace(/[$,\s]/g, "");
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const fields = {
    billRate: numeric("billRate"),
    taxableRate: numeric("taxableRate"),
    housingWeekly: numeric("housingWeekly"),
    mieWeekly: numeric("mieWeekly"),
    hoursPerWeek: numeric("hoursPerWeek"),
  };

  for (const [k, v] of Object.entries(fields)) {
    if (v === null) return { error: `${k} must be a positive number.` };
  }

  await prisma.assignment.update({
    where: { id },
    data: fields as Record<string, number>,
  });
  revalidatePathsForBook();
  return { ok: "Package updated." };
}

// ---------------------------------------------------------------- imports
export async function importCsv(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditPackages(user.role)) return { error: "Only an owner or manager can import data." };

  const file = formData.get("file");
  const pasted = String(formData.get("pasted") ?? "");

  let text = pasted;
  if (file instanceof File && file.size > 0) {
    if (file.size > 5_000_000) return { error: "That file is larger than 5 MB." };
    text = await file.text();
  }
  if (!text.trim()) return { error: "Choose a CSV file or paste rows to import." };

  const payload = parseAgencyCsv(text);
  if (!payload.assignments.length && !payload.travelers.length) {
    return { error: payload.warnings[0] ?? "Nothing in that file could be read." };
  }

  const result = await ingest(user.agencyId, payload, "CSV");
  revalidatePathsForBook();

  const summary = `Imported ${result.created} new and ${result.updated} updated record${
    result.created + result.updated === 1 ? "" : "s"
  }.`;
  return {
    ok: result.warnings.length
      ? `${summary} ${result.warnings.length} row${result.warnings.length === 1 ? "" : "s"} needed attention — see below.`
      : summary,
  };
}

export async function syncBullhorn(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!canEditPackages(user.role)) return { error: "Only an owner or manager can sync." };

  const source = bullhornFromEnv();
  if (!source.isConfigured()) {
    return {
      error:
        "Bullhorn is not connected. Add BULLHORN_CLIENT_ID and BULLHORN_CLIENT_SECRET — an agency requests these from Bullhorn support for its own tenant.",
    };
  }

  const agency = await prisma.agency.findUniqueOrThrow({
    where: { id: user.agencyId },
    select: { bullhornHousingField: true, bullhornMieField: true },
  });

  try {
    const payload = await source.fetch({
      stipends: { housingField: agency.bullhornHousingField, mieField: agency.bullhornMieField },
    });
    const result = await ingest(user.agencyId, payload, "BULLHORN");
    revalidatePathsForBook();
    return { ok: `Synced ${result.created} new and ${result.updated} updated records from Bullhorn.` };
  } catch (err) {
    return { error: `Bullhorn sync failed: ${(err as Error).message}` };
  }
}

/**
 * Lists the agency's Bullhorn custom fields so the settings screen can offer
 * a dropdown of real, agency-labelled fields instead of asking someone to
 * type a raw name like "customFloat3" from memory.
 */
export async function discoverBullhornFields(): Promise<{
  error?: string;
  fields?: { name: string; label: string }[];
}> {
  const user = await requireUser();
  if (!canEditPackages(user.role)) return { error: "Only an owner or manager can do this." };

  const source = bullhornFromEnv();
  if (!source.isConfigured()) return { error: "Bullhorn is not connected." };

  try {
    return { fields: await source.discoverCustomFields() };
  } catch (err) {
    return { error: `Couldn't read Bullhorn's field list: ${(err as Error).message}` };
  }
}

const stipendMappingSchema = z.object({
  housingField: z.string().trim().max(60).optional(),
  mieField: z.string().trim().max(60).optional(),
});

export async function updateBullhornStipendMapping(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "OWNER") {
    return { error: "Only the agency owner can change the field mapping." };
  }

  const parsed = stipendMappingSchema.safeParse({
    housingField: formData.get("housingField") || undefined,
    mieField: formData.get("mieField") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.agency.update({
    where: { id: user.agencyId },
    data: {
      bullhornHousingField: parsed.data.housingField ?? null,
      bullhornMieField: parsed.data.mieField ?? null,
    },
  });

  revalidatePath("/settings");
  return { ok: "Field mapping saved. Run Sync now to pull stipends with it." };
}

function revalidatePathsForBook() {
  revalidatePath("/board");
  revalidatePath("/compliance");
  revalidatePath("/margin");
  revalidatePath("/import");
}

// ---------------------------------------------------------------- settings
const settingsSchema = z.object({
  marginFloor: z.coerce
    .number()
    .min(0, "Margin floor can't be negative.")
    .max(1, "Enter margin floor as a fraction of bill, for example 0.22 for 22%."),
  burdenRate: z.coerce
    .number()
    .min(0, "Burden rate can't be negative.")
    .max(1, "Enter burden rate as a fraction of taxable wages, for example 0.19 for 19%."),
  quietDays: z.coerce
    .number()
    .int("Enter a whole number of days.")
    .min(1, "Must be at least 1 day.")
    .max(90, "90 days is the practical ceiling — beyond that, silence stops being a useful signal."),
});

export async function updateAgencySettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "OWNER") {
    return { error: "Only the agency owner can change these settings." };
  }

  const parsed = settingsSchema.safeParse({
    marginFloor: formData.get("marginFloorPct")
      ? Number(formData.get("marginFloorPct")) / 100
      : NaN,
    burdenRate: formData.get("burdenRatePct")
      ? Number(formData.get("burdenRatePct")) / 100
      : NaN,
    quietDays: formData.get("quietDays"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await prisma.agency.update({
    where: { id: user.agencyId },
    data: parsed.data,
  });

  revalidatePath("/settings");
  revalidatePathsForBook();
  return { ok: "Settings updated." };
}

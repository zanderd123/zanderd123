"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser, createSession, destroySession, verifyPassword, canEditPackages } from "@/lib/auth";
import { parseAgencyCsv } from "@/lib/sources/csv";
import { ingest } from "@/lib/ingest";
import { bullhornFromEnv } from "@/lib/sources/bullhorn";

export type ActionState = { error?: string; ok?: string } | null;

// ------------------------------------------------------------------- auth
export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({
      email: z.string().trim().toLowerCase().email("Enter a valid email address."),
      password: z.string().min(1, "Enter your password."),
    })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "Incorrect email or password." };
  }

  await createSession(user.id);
  redirect("/board");
}

export async function logout() {
  await destroySession();
  redirect("/login");
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

  try {
    const payload = await source.fetch();
    const result = await ingest(user.agencyId, payload, "BULLHORN");
    revalidatePathsForBook();
    return { ok: `Synced ${result.created} new and ${result.updated} updated records from Bullhorn.` };
  } catch (err) {
    return { error: `Bullhorn sync failed: ${(err as Error).message}` };
  }
}

function revalidatePathsForBook() {
  revalidatePath("/board");
  revalidatePath("/compliance");
  revalidatePath("/margin");
  revalidatePath("/import");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Status } from "@prisma/client";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseJobUrl, sourceFromUrl } from "@/lib/parse-job";

export type FormState = { error?: string; ok?: boolean } | null;

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const optionalInt = z
  .string()
  .trim()
  .transform((v) => {
    if (v === "") return undefined;
    // Tolerate "$120,000" and "120k" but not free text.
    const cleaned = v.replace(/[$,\s]/g, "").replace(/k$/i, "000");
    return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN;
  })
  .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), {
    message: "Enter salaries as plain numbers, for example 120000.",
  })
  .optional();

/** Accepts only http(s) links, so a stored URL is always safe to render. */
const webUrl = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional()
  .refine(
    (v) => {
      if (!v) return true;
      try {
        return ["http:", "https:"].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    },
    { message: "Enter a full http:// or https:// link, or leave the URL blank." },
  );

const applicationSchema = z.object({
  company: z.string().trim().min(1, "Company is required.").max(160),
  title: z.string().trim().min(1, "Job title is required.").max(200),
  location: optionalString,
  workMode: z.enum(["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"]).default("UNKNOWN"),
  status: z
    .enum([
      "SAVED",
      "APPLIED",
      "SCREENING",
      "INTERVIEW",
      "OFFER",
      "ACCEPTED",
      "REJECTED",
      "WITHDRAWN",
      "GHOSTED",
    ])
    .default("SAVED"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  source: optionalString,
  url: webUrl,
  description: optionalString,
  salaryMin: optionalInt,
  salaryMax: optionalInt,
  appliedAt: optionalString,
});

function readForm(formData: FormData) {
  return applicationSchema.safeParse({
    company: formData.get("company") ?? "",
    title: formData.get("title") ?? "",
    location: formData.get("location") ?? "",
    workMode: formData.get("workMode") || "UNKNOWN",
    status: formData.get("status") || "SAVED",
    priority: formData.get("priority") || "MEDIUM",
    source: formData.get("source") ?? "",
    url: formData.get("url") ?? "",
    description: formData.get("description") ?? "",
    salaryMin: formData.get("salaryMin") ?? "",
    salaryMax: formData.get("salaryMax") ?? "",
    appliedAt: formData.get("appliedAt") ?? "",
  });
}

/** Called by the "fetch details" button on the new-application form. */
export async function lookupJobUrl(url: string) {
  await requireUser();
  if (!url?.trim()) return { warning: "Paste a job posting URL first." };
  return parseJobUrl(url.trim());
}

export async function createApplication(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readForm(formData);

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // An application marked as applied should always carry a date.
  const appliedAt = d.appliedAt
    ? new Date(d.appliedAt)
    : d.status !== "SAVED"
      ? new Date()
      : null;

  if (d.salaryMin && d.salaryMax && d.salaryMin > d.salaryMax) {
    return { error: "Minimum salary can't be greater than the maximum." };
  }

  const app = await prisma.application.create({
    data: {
      userId: user.id,
      company: d.company,
      title: d.title,
      location: d.location ?? null,
      workMode: d.workMode,
      status: d.status,
      priority: d.priority,
      source: d.source ?? (d.url ? (sourceFromUrl(d.url) ?? null) : null),
      url: d.url ?? null,
      description: d.description ?? null,
      salaryMin: d.salaryMin ?? null,
      salaryMax: d.salaryMax ?? null,
      appliedAt,
      events: { create: { to: d.status, note: "Application created" } },
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/applications");
  revalidatePath("/board");
  redirect(`/applications/${app.id}`);
}

export async function updateApplication(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readForm(formData);

  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const existing = await prisma.application.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return { error: "Application not found." };

  if (d.salaryMin && d.salaryMax && d.salaryMin > d.salaryMax) {
    return { error: "Minimum salary can't be greater than the maximum." };
  }

  const statusChanged = existing.status !== d.status;

  await prisma.application.update({
    where: { id },
    data: {
      company: d.company,
      title: d.title,
      location: d.location ?? null,
      workMode: d.workMode,
      status: d.status,
      priority: d.priority,
      source: d.source ?? null,
      url: d.url ?? null,
      description: d.description ?? null,
      salaryMin: d.salaryMin ?? null,
      salaryMax: d.salaryMax ?? null,
      appliedAt: d.appliedAt
        ? new Date(d.appliedAt)
        : d.status !== "SAVED" && !existing.appliedAt
          ? new Date()
          : existing.appliedAt,
      ...(statusChanged && {
        events: { create: { from: existing.status, to: d.status } },
      }),
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/applications");
  revalidatePath("/board");
  revalidatePath(`/applications/${id}`);
  redirect(`/applications/${id}`);
}

/** Used by the board's drag-and-drop and the quick status menu. */
export async function moveApplication(id: string, status: Status) {
  const user = await requireUser();

  const existing = await prisma.application.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing || existing.status === status) return;

  await prisma.application.update({
    where: { id },
    data: {
      status,
      // Moving off "Saved" for the first time backfills the applied date.
      ...(status !== "SAVED" && !existing.appliedAt && { appliedAt: new Date() }),
      events: { create: { from: existing.status, to: status } },
    },
  });

  revalidatePath("/dashboard");
  revalidatePath("/applications");
  revalidatePath("/board");
  revalidatePath(`/applications/${id}`);
}

export async function setArchived(id: string, archived: boolean) {
  const user = await requireUser();
  await prisma.application.updateMany({
    where: { id, userId: user.id },
    data: { archived },
  });

  revalidatePath("/applications");
  revalidatePath("/board");
  revalidatePath(`/applications/${id}`);
}

export async function deleteApplication(id: string) {
  const user = await requireUser();
  await prisma.application.deleteMany({ where: { id, userId: user.id } });

  revalidatePath("/dashboard");
  revalidatePath("/applications");
  revalidatePath("/board");
  redirect("/applications");
}

export async function addNote(applicationId: string, formData: FormData) {
  const user = await requireUser();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const owned = await prisma.application.findFirst({
    where: { id: applicationId, userId: user.id },
    select: { id: true },
  });
  if (!owned) return;

  await prisma.note.create({ data: { applicationId, body } });
  revalidatePath(`/applications/${applicationId}`);
}

export async function deleteNote(id: string) {
  const user = await requireUser();
  const note = await prisma.note.findFirst({
    where: { id, application: { userId: user.id } },
    select: { id: true, applicationId: true },
  });
  if (!note) return;

  await prisma.note.delete({ where: { id } });
  revalidatePath(`/applications/${note.applicationId}`);
}

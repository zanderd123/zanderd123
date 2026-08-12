"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { FormState } from "@/app/actions/applications";

const interviewSchema = z.object({
  applicationId: z.string().min(1, "Pick which application this is for."),
  type: z
    .enum(["PHONE_SCREEN", "TECHNICAL", "BEHAVIORAL", "ONSITE", "FINAL", "OTHER"])
    .default("PHONE_SCREEN"),
  scheduledAt: z.string().min(1, "Pick a date and time."),
  durationMins: z.coerce.number().int().min(5).max(600).default(60),
  location: z.string().trim().max(300).optional(),
  interviewers: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(10_000).optional(),
  outcome: z.enum(["PENDING", "PASSED", "FAILED", "CANCELED"]).default("PENDING"),
});

function read(formData: FormData) {
  return interviewSchema.safeParse({
    applicationId: formData.get("applicationId") ?? "",
    type: formData.get("type") || "PHONE_SCREEN",
    scheduledAt: formData.get("scheduledAt") ?? "",
    durationMins: formData.get("durationMins") || 60,
    location: formData.get("location") ?? "",
    interviewers: formData.get("interviewers") ?? "",
    notes: formData.get("notes") ?? "",
    outcome: formData.get("outcome") || "PENDING",
  });
}

export async function createInterview(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  const owned = await prisma.application.findFirst({
    where: { id: d.applicationId, userId: user.id },
    select: { id: true, status: true },
  });
  if (!owned) return { error: "Application not found." };

  const when = new Date(d.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "That date isn't valid." };

  await prisma.interview.create({
    data: {
      userId: user.id,
      applicationId: d.applicationId,
      type: d.type,
      scheduledAt: when,
      durationMins: d.durationMins,
      location: d.location || null,
      interviewers: d.interviewers || null,
      notes: d.notes || null,
      outcome: d.outcome,
    },
  });

  // Scheduling an interview implies the application has advanced.
  if (["SAVED", "APPLIED", "SCREENING"].includes(owned.status)) {
    await prisma.application.update({
      where: { id: owned.id },
      data: {
        status: "INTERVIEW",
        events: { create: { from: owned.status, to: "INTERVIEW", note: "Interview scheduled" } },
      },
    });
  }

  revalidatePath("/interviews");
  revalidatePath("/dashboard");
  revalidatePath("/board");
  revalidatePath(`/applications/${d.applicationId}`);
  return { ok: true };
}

export async function updateInterview(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  const existing = await prisma.interview.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return { error: "Interview not found." };

  const when = new Date(d.scheduledAt);
  if (Number.isNaN(when.getTime())) return { error: "That date isn't valid." };

  await prisma.interview.update({
    where: { id },
    data: {
      type: d.type,
      scheduledAt: when,
      durationMins: d.durationMins,
      location: d.location || null,
      interviewers: d.interviewers || null,
      notes: d.notes || null,
      outcome: d.outcome,
    },
  });

  revalidatePath("/interviews");
  revalidatePath("/dashboard");
  revalidatePath(`/applications/${existing.applicationId}`);
  return { ok: true };
}

export async function setInterviewOutcome(
  id: string,
  outcome: "PENDING" | "PASSED" | "FAILED" | "CANCELED",
) {
  const user = await requireUser();
  const existing = await prisma.interview.findFirst({
    where: { id, userId: user.id },
    select: { id: true, applicationId: true },
  });
  if (!existing) return;

  await prisma.interview.update({ where: { id }, data: { outcome } });

  revalidatePath("/interviews");
  revalidatePath("/dashboard");
  revalidatePath(`/applications/${existing.applicationId}`);
}

export async function deleteInterview(id: string) {
  const user = await requireUser();
  const existing = await prisma.interview.findFirst({
    where: { id, userId: user.id },
    select: { id: true, applicationId: true },
  });
  if (!existing) return;

  await prisma.interview.delete({ where: { id } });

  revalidatePath("/interviews");
  revalidatePath("/dashboard");
  revalidatePath(`/applications/${existing.applicationId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { FormState } from "@/app/actions/applications";

const reminderSchema = z.object({
  title: z.string().trim().min(1, "What do you need to do?").max(200),
  dueAt: z.string().min(1, "Pick a due date."),
  applicationId: z.string().trim().optional(),
});

export async function createReminder(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = reminderSchema.safeParse({
    title: formData.get("title") ?? "",
    dueAt: formData.get("dueAt") ?? "",
    applicationId: formData.get("applicationId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  const due = new Date(d.dueAt);
  if (Number.isNaN(due.getTime())) return { error: "That date isn't valid." };

  let applicationId: string | null = null;
  if (d.applicationId) {
    const owned = await prisma.application.findFirst({
      where: { id: d.applicationId, userId: user.id },
      select: { id: true },
    });
    applicationId = owned?.id ?? null;
  }

  await prisma.reminder.create({
    data: { userId: user.id, title: d.title, dueAt: due, applicationId },
  });

  revalidatePath("/reminders");
  revalidatePath("/dashboard");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
  return { ok: true };
}

export async function toggleReminder(id: string) {
  const user = await requireUser();
  const existing = await prisma.reminder.findFirst({
    where: { id, userId: user.id },
  });
  if (!existing) return;

  await prisma.reminder.update({
    where: { id },
    data: {
      done: !existing.done,
      completedAt: existing.done ? null : new Date(),
    },
  });

  revalidatePath("/reminders");
  revalidatePath("/dashboard");
  if (existing.applicationId) {
    revalidatePath(`/applications/${existing.applicationId}`);
  }
}

export async function deleteReminder(id: string) {
  const user = await requireUser();
  const existing = await prisma.reminder.findFirst({
    where: { id, userId: user.id },
    select: { applicationId: true },
  });

  await prisma.reminder.deleteMany({ where: { id, userId: user.id } });

  revalidatePath("/reminders");
  revalidatePath("/dashboard");
  if (existing?.applicationId) {
    revalidatePath(`/applications/${existing.applicationId}`);
  }
}

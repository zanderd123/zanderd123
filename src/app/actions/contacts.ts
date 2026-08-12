"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { FormState } from "@/app/actions/applications";

const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160),
  title: z.string().trim().max(160).optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "Enter a valid email address.",
    })
    .optional(),
  phone: z.string().trim().max(60).optional(),
  linkedin: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(10_000).optional(),
  applicationId: z.string().trim().optional(),
});

function read(formData: FormData) {
  return contactSchema.safeParse({
    name: formData.get("name") ?? "",
    title: formData.get("title") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    linkedin: formData.get("linkedin") ?? "",
    notes: formData.get("notes") ?? "",
    applicationId: formData.get("applicationId") ?? "",
  });
}

/** Confirms an application id belongs to this user before linking to it. */
async function resolveApplicationId(userId: string, id?: string) {
  if (!id) return null;
  const owned = await prisma.application.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  return owned?.id ?? null;
}

export async function createContact(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  await prisma.contact.create({
    data: {
      userId: user.id,
      name: d.name,
      title: d.title || null,
      email: d.email || null,
      phone: d.phone || null,
      linkedin: d.linkedin || null,
      notes: d.notes || null,
      applicationId: await resolveApplicationId(user.id, d.applicationId),
    },
  });

  revalidatePath("/contacts");
  if (d.applicationId) revalidatePath(`/applications/${d.applicationId}`);
  return { ok: true };
}

export async function updateContact(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = read(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const d = parsed.data;
  const existing = await prisma.contact.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!existing) return { error: "Contact not found." };

  await prisma.contact.update({
    where: { id },
    data: {
      name: d.name,
      title: d.title || null,
      email: d.email || null,
      phone: d.phone || null,
      linkedin: d.linkedin || null,
      notes: d.notes || null,
      applicationId: await resolveApplicationId(user.id, d.applicationId),
    },
  });

  revalidatePath("/contacts");
  return { ok: true };
}

export async function deleteContact(id: string) {
  const user = await requireUser();
  await prisma.contact.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/contacts");
}

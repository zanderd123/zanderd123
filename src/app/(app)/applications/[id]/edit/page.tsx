import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateApplication } from "@/app/actions/applications";
import { ApplicationForm } from "@/components/application-form";

export default async function EditApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  const application = await prisma.application.findFirst({
    where: { id, userId: user.id },
  });
  if (!application) notFound();

  const action = updateApplication.bind(null, application.id);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link
          href={`/applications/${application.id}`}
          className="muted text-sm hover:underline"
        >
          ← {application.company}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Edit application
        </h1>
      </div>

      <ApplicationForm
        action={action}
        application={application}
        submitLabel="Save changes"
      />
    </div>
  );
}

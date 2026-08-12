import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { createApplication } from "@/app/actions/applications";
import { ApplicationForm } from "@/components/application-form";

export default async function NewApplicationPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <Link href="/applications" className="muted text-sm hover:underline">
          ← Applications
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Add an application
        </h1>
      </div>

      <ApplicationForm action={createApplication} submitLabel="Save application" />
    </div>
  );
}

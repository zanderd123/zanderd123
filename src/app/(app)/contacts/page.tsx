import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EmptyState } from "@/components/ui";
import { ContactForm, DeleteContactButton } from "@/components/contact-form";
import { formatDate } from "@/lib/format";

export default async function ContactsPage() {
  const user = await requireUser();

  const [contacts, applications] = await Promise.all([
    prisma.contact.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { application: { select: { id: true, company: true } } },
    }),
    prisma.application.findMany({
      where: { userId: user.id, archived: false },
      orderBy: { company: "asc" },
      select: { id: true, company: true, title: true },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="muted mt-1 text-sm">
          Recruiters, hiring managers, and referrals — linked to the roles they belong to.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold">Add a contact</h2>
        <div className="mt-3">
          <ContactForm applications={applications} />
        </div>
      </div>

      {contacts.length === 0 ? (
        <EmptyState
          title="No contacts yet"
          body="Add the recruiter or hiring manager for a role so you know who to follow up with."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map((c) => (
            <div key={c.id} className="card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  {c.title && <p className="muted truncate text-sm">{c.title}</p>}
                </div>
                <DeleteContactButton id={c.id} name={c.name} />
              </div>

              <div className="mt-3 space-y-1 text-sm">
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="block truncate text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {c.email}
                  </a>
                )}
                {c.phone && <p className="muted">{c.phone}</p>}
                {c.linkedin && (
                  <a
                    href={
                      c.linkedin.startsWith("http") ? c.linkedin : `https://${c.linkedin}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    LinkedIn ↗
                  </a>
                )}
              </div>

              {c.application && (
                <Link
                  href={`/applications/${c.application.id}`}
                  className="chip mt-3 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                >
                  {c.application.company}
                </Link>
              )}

              {c.notes && (
                <p className="muted mt-3 whitespace-pre-wrap text-xs">{c.notes}</p>
              )}

              <p className="muted mt-3 text-xs">Added {formatDate(c.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

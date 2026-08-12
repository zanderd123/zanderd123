import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

const FEATURES = [
  {
    title: "One pipeline for every application",
    body: "Drag roles across Saved → Applied → Screening → Interview → Offer. See where everything stands in a glance instead of scrolling a spreadsheet.",
  },
  {
    title: "Interviews with the context attached",
    body: "Schedule each round against the job it belongs to, with interviewers, links, prep notes, and outcomes all in one place.",
  },
  {
    title: "Follow-ups you don't forget",
    body: "Set reminders per application. The dashboard surfaces what's overdue and which applications have gone quiet for two weeks.",
  },
  {
    title: "Paste a link, skip the typing",
    body: "Drop in a job posting URL and TrackWise pulls the company, title, location, and description where the site exposes them.",
  },
  {
    title: "Know your real numbers",
    body: "Response rate, interview rate, and offer rate computed from your own history — so you can tell whether the resume or the volume is the problem.",
  },
  {
    title: "Recruiters and referrals, tracked",
    body: "Keep contacts tied to the roles they belong to, so a warm intro is never buried in your inbox.",
  },
];

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">TrackWise</span>
        <nav className="flex items-center gap-2">
          <Link href="/login" className="btn-secondary">
            Log in
          </Link>
          <Link href="/signup" className="btn-primary">
            Get started
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-16 sm:py-24">
          <p className="mb-4 text-sm font-medium text-indigo-600 dark:text-indigo-400">
            An ATS for the person doing the applying
          </p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Companies have systems to track you. Now you have one to track them.
          </h1>
          <p className="muted mt-5 max-w-2xl text-lg">
            TrackWise keeps every application, interview, contact, and follow-up in
            one place — so a job search stops living in a spreadsheet, twelve browser
            tabs, and your memory.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary px-5 py-2.5">
              Create a free account
            </Link>
            <Link href="/login" className="btn-secondary px-5 py-2.5">
              I already have one
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-5">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="muted mt-2 text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="muted mx-auto max-w-6xl px-6 py-6 text-sm">
          TrackWise — built for job seekers.
        </div>
      </footer>
    </div>
  );
}

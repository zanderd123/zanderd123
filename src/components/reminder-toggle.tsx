"use client";

import { useTransition } from "react";

import { toggleReminder } from "@/app/actions/reminders";

export function ToggleReminder({ id, done }: { id: string; done: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={done ? "Mark as not done" : "Mark as done"}
      disabled={pending}
      onClick={() => startTransition(() => void toggleReminder(id))}
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        done
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-[var(--border)] hover:border-indigo-500"
      } ${pending ? "opacity-50" : ""}`}
    >
      {done && (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

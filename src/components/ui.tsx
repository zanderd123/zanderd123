"use client";

import { useFormStatus } from "react-dom";
import type { Status } from "@prisma/client";

import { STATUS_LABEL, STATUS_STYLE } from "@/lib/statuses";

export function SubmitButton({
  children,
  className = "btn-primary",
  pendingText,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function StatusChip({ status }: { status: Status }) {
  return (
    <span className={`chip ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-14 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="muted mt-1 max-w-sm text-sm">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Submit button that asks before firing a destructive action. */
export function ConfirmButton({
  children,
  message,
  className = "btn-danger",
}: {
  children: React.ReactNode;
  message: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

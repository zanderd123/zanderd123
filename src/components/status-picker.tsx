"use client";

import { useTransition } from "react";
import type { Status } from "@prisma/client";

import { moveApplication } from "@/app/actions/applications";
import { STATUS_ORDER, STATUS_LABEL } from "@/lib/statuses";

export function StatusPicker({ id, status }: { id: string; status: Status }) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={pending}
      aria-label="Change status"
      onChange={(e) => {
        const next = e.target.value as Status;
        startTransition(() => void moveApplication(id, next));
      }}
      className="input w-auto"
    >
      {STATUS_ORDER.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

"use client";

import { useState, useTransition } from "react";

import { setExtensionStatus, logTouchpoint } from "@/app/actions";
import { EXT_LABEL } from "@/components/bits";

const OPTIONS = ["NOT_ASKED", "INTERESTED", "SIGNED", "DECLINED", "NO_RESPONSE"] as const;

export function ExtensionPicker({ id, value }: { id: string; value: string }) {
  const [pending, start] = useTransition();

  return (
    <select
      value={value}
      disabled={pending}
      aria-label="Extension status"
      style={{ width: "auto", fontSize: 12 }}
      onChange={(e) => {
        const next = e.target.value as (typeof OPTIONS)[number];
        start(() => void setExtensionStatus(id, next));
      }}
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>
          {EXT_LABEL[o]}
        </option>
      ))}
    </select>
  );
}

export function LogContact({ travelerId }: { travelerId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      className="btn"
      disabled={pending || done}
      onClick={() => {
        const fd = new FormData();
        fd.set("kind", "CALL");
        fd.set("note", "Redeployment call");
        start(async () => {
          await logTouchpoint(travelerId, fd);
          setDone(true);
        });
      }}
    >
      {done ? "Logged" : pending ? "…" : "Log call"}
    </button>
  );
}

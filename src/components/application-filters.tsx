"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { STATUS_ORDER, STATUS_LABEL } from "@/lib/statuses";

export function ApplicationFilters() {
  const router = useRouter();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";
  const sort = params.get("sort") ?? "recent";
  const archived = params.get("archived") === "1";

  const push = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`/applications?${sp.toString()}`);
  };

  // Debounce the search box so we aren't navigating on every keystroke.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;

    const t = setTimeout(() => push({ q: q || null }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="card flex flex-wrap items-center gap-3 p-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search company, role, or location…"
        className="input min-w-52 flex-1"
        aria-label="Search applications"
      />

      <select
        value={status}
        onChange={(e) => push({ status: e.target.value || null })}
        className="input w-auto"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      <select
        value={sort}
        onChange={(e) => push({ sort: e.target.value })}
        className="input w-auto"
        aria-label="Sort applications"
      >
        <option value="recent">Recently updated</option>
        <option value="applied">Date applied</option>
        <option value="company">Company A–Z</option>
        <option value="priority">Priority</option>
      </select>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => push({ archived: e.target.checked ? "1" : null })}
          className="h-4 w-4 rounded border-[var(--border)]"
        />
        Archived
      </label>
    </div>
  );
}

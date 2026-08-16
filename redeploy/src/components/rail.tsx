"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const GROUPS: { label: string; items: { href: string; label: string; key?: string }[] }[] = [
  {
    label: "Retention",
    items: [
      { href: "/board", label: "Redeployment", key: "board" },
      { href: "/board?filter=quiet", label: "Gone quiet", key: "silent" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/compliance", label: "Compliance", key: "compliance" },
      { href: "/margin", label: "Margin" },
    ],
  },
  {
    label: "Tools",
    items: [
      { href: "/builder", label: "Package builder" },
      { href: "/import", label: "Import & sync" },
    ],
  },
];

export function Rail({
  counts,
  agencyName,
  footer,
}: {
  counts: Record<string, number>;
  agencyName: string;
  footer: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <aside className="rail">
      <div className="logo"><i>R</i>Redeploy</div>

      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="rail-lbl">{g.label}</div>
          {g.items.map((it) => {
            const [base, query] = it.href.split("?");
            const onBase = pathname === base || pathname.startsWith(base + "/");
            // A filtered entry is current only when its filter is the active one.
            const active = query
              ? onBase && params.get("filter") === new URLSearchParams(query).get("filter")
              : onBase && !params.get("filter");
            const n = it.key ? counts[it.key] : 0;
            return (
              <Link
                key={it.href}
                href={it.href}
                className="navbtn"
                aria-current={active ? "page" : undefined}
              >
                {it.label}
                {n ? <span className="ct">{n}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}

      <div className="rail-foot">
        {agencyName}
        <br />
        {footer}
      </div>
    </aside>
  );
}

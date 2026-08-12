"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/board", label: "Pipeline" },
  { href: "/applications", label: "Applications" },
  { href: "/interviews", label: "Interviews" },
  { href: "/contacts", label: "Contacts" },
  { href: "/reminders", label: "Reminders" },
];

export function NavLinks({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      className={
        mobile ? "flex gap-1 whitespace-nowrap" : "hidden items-center gap-1 md:flex"
      }
    >
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                : "text-[var(--muted)] hover:bg-black/[.04] hover:text-[var(--text)] dark:hover:bg-white/[.06]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

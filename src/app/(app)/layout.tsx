import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import { NavLinks } from "@/components/nav-links";
import { initials } from "@/lib/format";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const display = user.name?.trim() || user.email;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            TrackWise
          </Link>

          <NavLinks />

          <div className="ml-auto flex items-center gap-3">
            <Link href="/applications/new" className="btn-primary hidden sm:inline-flex">
              + Add application
            </Link>

            <div className="group relative">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-medium text-white"
                aria-label="Account menu"
              >
                {initials(display) || "U"}
              </button>

              <div className="invisible absolute right-0 top-full z-30 w-56 pt-2 opacity-0 transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <div className="card p-2 shadow-lg">
                  <div className="border-b border-[var(--border)] px-3 py-2">
                    <p className="truncate text-sm font-medium">{display}</p>
                    <p className="muted truncate text-xs">{user.email}</p>
                  </div>
                  <form action={logout}>
                    <button
                      type="submit"
                      className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                    >
                      Log out
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-2 sm:px-6 md:hidden">
          <NavLinks mobile />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

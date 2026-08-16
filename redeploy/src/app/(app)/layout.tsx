import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBook, summarise } from "@/lib/view";
import { logout } from "@/app/actions";
import { Rail } from "@/components/rail";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
  const book = await loadBook(agency);
  const s = summarise(book, agency.marginFloor);

  return (
    <div className="shell">
      <Rail
        counts={{ board: s.atRisk, silent: s.quiet, compliance: s.complianceCount }}
        agencyName={agency.name}
        footer={`${book.length} on assignment`}
      />
      <div className="main">
        <div className="topbar" style={{ justifyContent: "flex-end", gap: 12 }}>
          <span className="sub2" style={{ marginRight: "auto" }}>
            {user.name ?? user.email} · {user.role.toLowerCase()}
          </span>
          <form action={logout}>
            <button type="submit" className="btn">Sign out</button>
          </form>
        </div>
        {children}
      </div>
    </div>
  );
}

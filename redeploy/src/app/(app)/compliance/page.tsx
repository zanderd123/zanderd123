import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBook } from "@/lib/view";
import { Panel, Empty } from "@/components/bits";

export default async function CompliancePage() {
  const user = await requireUser();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
  const book = await loadBook(agency);

  const rows = book
    .filter((r) => r.expiring.length > 0)
    .sort((a, b) => a.expiring[0].days - b.expiring[0].days);

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 17, fontWeight: 650 }}>Compliance</h1>
        <p className="sub2">
          Credentials expiring within 30 days. An expired credential stops a start date, which
          turns a booked assignment into a hole in the schedule.
        </p>
      </div>

      <Panel title="Expiring soonest first">
        {rows.length === 0 ? (
          <Empty>Nothing expiring in the next 30 days.</Empty>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Traveler</th>
                  <th>Assignment ends</th>
                  <th>Credential</th>
                  <th>Expires</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) =>
                  r.expiring.map((c) => (
                    <tr key={r.id + c.name}>
                      <td>
                        <span className="who">{r.name}</span>
                        <div className="sub2">
                          {[r.specialty, r.recruiter].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="num">{r.weeksRemaining} wks</td>
                      <td>{c.name}</td>
                      <td className="num">
                        {c.days < 0 ? `${Math.abs(c.days)} days ago` : `in ${c.days} days`}
                      </td>
                      <td>
                        <span className={`pill ${c.days < 0 || c.days <= 14 ? "p-hi" : "p-md"}`}>
                          {c.days < 0 ? "Expired" : "Expiring"}
                        </span>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

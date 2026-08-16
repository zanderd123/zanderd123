import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBook } from "@/lib/view";
import { formatMoney, formatPct } from "@/lib/economics";
import { Panel, Empty } from "@/components/bits";

export default async function MarginPage() {
  const user = await requireUser();
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });
  const book = await loadBook(agency);

  const rows = book.slice().sort((a, b) => a.economics.marginPct - b.economics.marginPct);

  const byRecruiter = new Map<string, { n: number; margin: number; secured: number }>();
  for (const r of book) {
    const cur = byRecruiter.get(r.recruiter) ?? { n: 0, margin: 0, secured: 0 };
    cur.n += 1;
    cur.margin += r.economics.marginWeekly;
    if (r.risk.level === "SECURED") cur.secured += 1;
    byRecruiter.set(r.recruiter, cur);
  }

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 17, fontWeight: 650 }}>Margin</h1>
        <p className="sub2">
          Gross margin per assignment. Floor is {Math.round(agency.marginFloor * 100)}%, burden{" "}
          {Math.round(agency.burdenRate * 100)}% on taxable wages.
        </p>
      </div>

      <Panel title="Thinnest margin first">
        {rows.length === 0 ? (
          <Empty>No active assignments yet. Import your book to get started.</Empty>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Traveler</th>
                  <th>Facility</th>
                  <th>Bill / wk</th>
                  <th>Cost / wk</th>
                  <th>Margin / wk</th>
                  <th>Contract value</th>
                  <th>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = r.economics.marginPct < agency.marginFloor;
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="who">{r.name}</span>
                        <div className="sub2">{r.specialty}</div>
                      </td>
                      <td>
                        {r.facility}
                        <div className="sub2">{r.where}</div>
                      </td>
                      <td className="num">{formatMoney(r.economics.billWeekly)}</td>
                      <td className="num">{formatMoney(r.economics.costWeekly)}</td>
                      <td className="num">{formatMoney(r.economics.marginWeekly)}</td>
                      <td className="num">
                        {formatMoney(r.economics.marginWeekly * r.weeks)}
                      </td>
                      <td>
                        <span className={`pill ${low ? "p-hi" : "p-lo"}`}>
                          {formatPct(r.economics.marginPct)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {byRecruiter.size > 0 && (
        <Panel title="By recruiter">
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Recruiter</th>
                  <th>On assignment</th>
                  <th>Secured next</th>
                  <th>Margin / wk</th>
                </tr>
              </thead>
              <tbody>
                {[...byRecruiter.entries()]
                  .sort((a, b) => b[1].margin - a[1].margin)
                  .map(([name, v]) => (
                    <tr key={name}>
                      <td className="who">{name}</td>
                      <td className="num">{v.n}</td>
                      <td className="num">
                        {v.secured} of {v.n}
                      </td>
                      <td className="num">{formatMoney(v.margin)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

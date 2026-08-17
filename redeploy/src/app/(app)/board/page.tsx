import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadBook, summarise } from "@/lib/view";
import { formatMoney, formatPct } from "@/lib/economics";
import { nextAction } from "@/lib/risk";
import { Kpi, Panel, RiskPill, Empty } from "@/components/bits";
import { ExtensionPicker, LogContact } from "@/components/row-controls";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { filter } = await searchParams;
  const agency = await prisma.agency.findUniqueOrThrow({ where: { id: user.agencyId } });

  const book = await loadBook(agency);
  const s = summarise(book, agency.marginFloor);

  const quietOnly = filter === "quiet";
  const rows = (
    quietOnly
      ? book.filter((r) => r.risk.level !== "SECURED" && (r.risk.daysSinceContact ?? 999) >= agency.quietDays)
      : book
  )
    .slice()
    .sort((a, b) => b.risk.score - a.risk.score || a.endsAt.getTime() - b.endsAt.getTime());

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 17, fontWeight: 650 }}>
          {quietOnly ? "Gone quiet" : "Redeployment"}
        </h1>
        <p className="sub2">
          {quietOnly
            ? `No recruiter contact in ${agency.quietDays}+ days. Travelers keep two or three agencies precisely as a hedge against this.`
            : "Assignments ending soon, ranked by what it costs you to lose them."}
        </p>
      </div>

      <div className="kpis">
        <Kpi k="On assignment" v={s.total} d="in this book" />
        <Kpi k="Ending ≤ 45 days" v={s.ending} d={`${s.secured} with a next step`} />
        <Kpi
          k="Redeployment rate"
          v={s.ending ? formatPct(s.redeploymentRate, 0) : "—"}
          d="secured of ending"
          alert={s.ending > 0 && s.redeploymentRate < 0.5}
        />
        <Kpi
          k="Margin at risk"
          v={formatMoney(s.marginAtRisk)}
          d="13-week value of unsecured"
          alert={s.marginAtRisk > 0}
        />
        <Kpi
          k={`Below ${Math.round(agency.marginFloor * 100)}% floor`}
          v={s.belowFloor}
          d="assignments"
          alert={s.belowFloor > 0}
        />
      </div>

      <Panel
        title={quietOnly ? "Silent longest first" : "Worst first"}
        note="Risk combines time remaining, recruiter silence, the extension answer, and expiring credentials."
        action={
          quietOnly ? (
            <Link href="/board" className="btn">Show all</Link>
          ) : (
            <Link href="/board?filter=quiet" className="btn">Only gone quiet</Link>
          )
        }
      >
        {rows.length === 0 ? (
          <Empty>Nothing here — everyone is accounted for.</Empty>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Traveler</th>
                  <th>Assignment</th>
                  <th>Ends in</th>
                  <th>Last contact</th>
                  <th>Extension</th>
                  <th>Margin / wk</th>
                  <th>Risk</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const quiet = (r.risk.daysSinceContact ?? 999) >= 21;
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className="who">{r.name}</span>
                        <div className="sub2">
                          {[r.specialty, r.recruiter].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td>
                        {r.facility}
                        <div className="sub2">{r.where}</div>
                      </td>
                      <td className="num">{r.weeksRemaining} wks</td>
                      <td
                        className="num"
                        style={quiet ? { color: "var(--risk-hi)", fontWeight: 600 } : undefined}
                      >
                        {r.risk.daysSinceContact === null
                          ? "never"
                          : `${r.risk.daysSinceContact} days ago`}
                      </td>
                      <td>
                        {r.nextStep ? (
                          <span className="pill p-n">{r.nextStep}</span>
                        ) : (
                          <ExtensionPicker id={r.id} value={r.extensionStatus} />
                        )}
                      </td>
                      <td className="num">{formatMoney(r.economics.marginWeekly)}</td>
                      <td>
                        <RiskPill level={r.risk.level} />
                        <div className="sub2" style={{ maxWidth: 260, marginTop: 3 }}>
                          {nextAction(r.risk, r.extensionStatus as never)}
                        </div>
                      </td>
                      <td>
                        <LogContact travelerId={r.travelerId} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="sub2">
        Margin uses this agency&apos;s burden rate of {Math.round(agency.burdenRate * 100)}% on
        taxable wages, and a floor of {Math.round(agency.marginFloor * 100)}%. Change either in{" "}
        <Link href="/settings" style={{ color: "var(--accent)" }}>
          Settings
        </Link>
        .
      </p>
    </div>
  );
}

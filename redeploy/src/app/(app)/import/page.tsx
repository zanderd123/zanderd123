import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CSV_TEMPLATE_EXAMPLE } from "@/lib/sources/csv";
import { ImportPanel } from "@/components/import-panel";
import { Panel } from "@/components/bits";

export default async function ImportPage() {
  const user = await requireUser();

  const batches = await prisma.importBatch.findMany({
    where: { agencyId: user.agencyId },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  const bullhornConfigured = Boolean(
    process.env.BULLHORN_CLIENT_ID && process.env.BULLHORN_CLIENT_SECRET,
  );

  return (
    <div className="content">
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 17, fontWeight: 650 }}>Import &amp; sync</h1>
        <p className="sub2">
          Redeploy reads your book from whatever system you already run. Nobody should be
          re-typing assignments into a second tool.
        </p>
      </div>

      <ImportPanel template={CSV_TEMPLATE_EXAMPLE} bullhornConfigured={bullhornConfigured} />

      <Panel title="Recent imports">
        {batches.length === 0 ? (
          <div className="empty">Nothing imported yet.</div>
        ) : (
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Source</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Skipped</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="num">{b.createdAt.toLocaleString("en-US")}</td>
                    <td>{b.source}</td>
                    <td className="num">{b.created}</td>
                    <td className="num">{b.updated}</td>
                    <td className="num">{b.skipped}</td>
                    <td className="sub2" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                      {b.errors ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

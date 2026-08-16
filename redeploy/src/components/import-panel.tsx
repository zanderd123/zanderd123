"use client";

import { useActionState, useState } from "react";

import { importCsv, syncBullhorn, type ActionState } from "@/app/actions";

export function ImportPanel({
  template,
  bullhornConfigured,
}: {
  template: string;
  bullhornConfigured: boolean;
}) {
  const [csvState, csvAction, csvPending] = useActionState<ActionState, FormData>(importCsv, null);
  const [bhState, bhAction, bhPending] = useActionState<ActionState, FormData>(syncBullhorn, null);
  const [showTemplate, setShowTemplate] = useState(false);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h2>Connected systems</h2>
          <span className="note">
            What Redeploy needs — travelers, live assignments, pay packages, credentials — lives in
            your ATS, not your VMS.
          </span>
        </div>

        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <form action={bhAction} className="panel" style={{ boxShadow: "none", margin: 0 }}>
            <div style={{ padding: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p className="who">Bullhorn</p>
                <p className="sub2">
                  {bullhornConfigured
                    ? "Connected. Pulls placements, candidates, facilities, and owners."
                    : "Not connected. An agency requests OAuth credentials for its own tenant from Bullhorn support — you do not need to be a Bullhorn partner to start."}
                </p>
              </div>
              <span className={`pill ${bullhornConfigured ? "p-lo" : "p-md"}`}>
                {bullhornConfigured ? "Ready" : "Needs credentials"}
              </span>
              <button type="submit" className="btn" disabled={bhPending}>
                {bhPending ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {bhState?.error && <p className="warn bad" style={{ margin: "0 14px 14px" }}>{bhState.error}</p>}
            {bhState?.ok && <p className="warn ok" style={{ margin: "0 14px 14px" }}>{bhState.ok}</p>}
          </form>

          <div className="panel" style={{ boxShadow: "none", margin: 0 }}>
            <div style={{ padding: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p className="who">LaborEdge · Avionté · Crelate · JobDiva</p>
                <p className="sub2">
                  Each needs its own adapter. Until one exists for your system, the CSV export below
                  covers it — every one of them can produce one.
                </p>
              </div>
              <span className="pill p-md">On request</span>
            </div>
          </div>

          <div className="panel" style={{ boxShadow: "none", margin: 0 }}>
            <div style={{ padding: 14, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p className="who">VMS platforms — ShiftWise, Medefis, and others</p>
                <p className="sub2">
                  A VMS carries inbound job orders, not your live book, so Redeploy does not need one
                  to work. Order feeds are a separate integration and are negotiated per platform.
                </p>
              </div>
              <span className="pill p-n">Not required</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Import a CSV</h2>
          <span className="note">Re-importing updates existing records rather than duplicating them.</span>
          <div className="spacer" />
          <button type="button" className="btn" onClick={() => setShowTemplate((v) => !v)}>
            {showTemplate ? "Hide" : "Show"} expected format
          </button>
        </div>

        {showTemplate && (
          <pre
            style={{
              margin: 0,
              padding: 14,
              overflowX: "auto",
              fontSize: 11.5,
              lineHeight: 1.7,
              borderBottom: "1px solid var(--line)",
              color: "var(--ink-2)",
            }}
          >
            {template}
          </pre>
        )}

        <form action={csvAction} style={{ padding: 16, display: "grid", gap: 12 }}>
          <div>
            <label className="f" htmlFor="file">CSV file</label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" />
          </div>

          <div>
            <label className="f" htmlFor="pasted">…or paste rows</label>
            <textarea
              id="pasted"
              name="pasted"
              rows={5}
              style={{
                width: "100%",
                padding: "8px 10px",
                border: "1px solid var(--line)",
                borderRadius: 7,
                background: "var(--panel)",
                color: "var(--ink)",
                font: "inherit",
                fontSize: 12.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
              placeholder="traveler_name,facility,ends_on,bill_rate,taxable_rate…"
            />
          </div>

          {csvState?.error && <p className="warn bad">{csvState.error}</p>}
          {csvState?.ok && <p className="warn ok">{csvState.ok}</p>}

          <div>
            <button type="submit" className="btn btn-primary" disabled={csvPending}>
              {csvPending ? "Importing…" : "Import"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

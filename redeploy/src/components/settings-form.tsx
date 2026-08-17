"use client";

import { useActionState, useMemo, useState } from "react";

import { updateAgencySettings, type ActionState } from "@/app/actions";
import { computeEconomics, formatMoney, formatPct } from "@/lib/economics";

/**
 * Every number here changes how every assignment reads across the whole
 * agency, so the form shows the effect on one example package before it lets
 * anyone save — a margin floor typed as a whole-percent instead of a
 * fraction (22 instead of 0.22) should be obvious before it's saved, not
 * after every deal on the board looks wrong.
 */
export function SettingsForm({
  marginFloorPct,
  burdenRatePct,
  quietDays,
  canEdit,
}: {
  marginFloorPct: number;
  burdenRatePct: number;
  quietDays: number;
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateAgencySettings, null);
  const [floor, setFloor] = useState(String(marginFloorPct));
  const [burden, setBurden] = useState(String(burdenRatePct));

  const preview = useMemo(() => {
    const f = Number(floor) / 100;
    const b = Number(burden) / 100;
    if (!Number.isFinite(f) || !Number.isFinite(b)) return null;

    // A representative package: $110/hr bill, $25/hr taxable, $1,600/wk stipends.
    const e = computeEconomics(
      { billRate: 110, taxableRate: 25, housingWeekly: 1200, mieWeekly: 400, hoursPerWeek: 36 },
      { burdenRate: b },
    );
    return { ...e, clears: e.marginPct >= f, floor: f };
  }, [floor, burden]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Agency settings</h2>
        <span className="note">
          {canEdit ? "Only the owner can change these." : "Read-only — ask the owner to change these."}
        </span>
      </div>

      <form action={action} style={{ padding: 16, display: "grid", gap: 16 }}>
        {state?.error && <p className="warn bad">{state.error}</p>}
        {state?.ok && <p className="warn ok">{state.ok}</p>}

        <div className="calc-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="f" htmlFor="marginFloorPct">
              Margin floor (%)
            </label>
            <input
              id="marginFloorPct"
              name="marginFloorPct"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              disabled={!canEdit}
              inputMode="decimal"
            />
            <p className="sub2" style={{ marginTop: 5 }}>
              Below this, an assignment is flagged red everywhere it appears.
            </p>
          </div>

          <div>
            <label className="f" htmlFor="burdenRatePct">
              Burden rate (%)
            </label>
            <input
              id="burdenRatePct"
              name="burdenRatePct"
              value={burden}
              onChange={(e) => setBurden(e.target.value)}
              disabled={!canEdit}
              inputMode="decimal"
            />
            <p className="sub2" style={{ marginTop: 5 }}>
              Payroll tax, workers&apos; comp, and insurance, as a share of taxable wages.
            </p>
          </div>

          <div>
            <label className="f" htmlFor="quietDays">
              Gone-quiet threshold (days)
            </label>
            <input
              id="quietDays"
              name="quietDays"
              defaultValue={quietDays}
              disabled={!canEdit}
              inputMode="numeric"
            />
            <p className="sub2" style={{ marginTop: 5 }}>
              No recruiter contact for this long moves a traveler onto the gone-quiet list.
            </p>
          </div>
        </div>

        {preview && (
          <div
            style={{
              padding: 14,
              borderRadius: 9,
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <p className="f" style={{ marginBottom: 3 }}>
                On a $110/hr · $25/hr taxable · $1,600/wk stipend package
              </p>
              <p className="sub2">
                Margin comes to <strong className="num">{formatMoney(preview.marginWeekly)}</strong>/wk
                (<span className="num">{formatPct(preview.marginPct)}</span>) — this would show as{" "}
                <span className={`pill ${preview.clears ? "p-lo" : "p-hi"}`}>
                  {preview.clears ? "above floor" : "below floor"}
                </span>{" "}
                with these settings.
              </p>
            </div>
          </div>
        )}

        {canEdit && (
          <div>
            <button type="submit" className="btn btn-primary">
              Save settings
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

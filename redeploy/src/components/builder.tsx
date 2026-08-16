"use client";

import { useMemo, useState } from "react";

import {
  computeEconomics,
  maxTaxableForFloor,
  formatMoney,
  formatPct,
} from "@/lib/economics";

export type BuilderAssignment = {
  id: string;
  label: string;
  billRate: number;
  taxableRate: number;
  housingWeekly: number;
  mieWeekly: number;
  hoursPerWeek: number;
  weeks: number;
};

/**
 * The screen a recruiter actually uses every day. Everything recalculates as
 * they type, and the floor turns red the moment a package gives away the spread.
 */
export function Builder({
  assignments,
  burdenRate,
  marginFloor,
}: {
  assignments: BuilderAssignment[];
  burdenRate: number;
  marginFloor: number;
}) {
  const [pick, setPick] = useState(assignments[0]?.id ?? "");
  const current = assignments.find((a) => a.id === pick) ?? assignments[0];

  const [form, setForm] = useState(() => toForm(current));

  function toForm(a?: BuilderAssignment) {
    return {
      billRate: String(a?.billRate ?? 110),
      taxableRate: String(a?.taxableRate ?? 25),
      housingWeekly: String(a?.housingWeekly ?? 1200),
      mieWeekly: String(a?.mieWeekly ?? 400),
      hoursPerWeek: String(a?.hoursPerWeek ?? 36),
      weeks: String(a?.weeks ?? 13),
    };
  }

  const pkg = {
    billRate: Number(form.billRate) || 0,
    taxableRate: Number(form.taxableRate) || 0,
    housingWeekly: Number(form.housingWeekly) || 0,
    mieWeekly: Number(form.mieWeekly) || 0,
    hoursPerWeek: Number(form.hoursPerWeek) || 0,
  };
  const weeks = Math.max(1, Number(form.weeks) || 13);

  const e = useMemo(
    () => computeEconomics(pkg, { burdenRate, weeks }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form.billRate, form.taxableRate, form.housingWeekly, form.mieWeekly, form.hoursPerWeek, form.weeks, burdenRate],
  );

  const ceiling = maxTaxableForFloor(pkg, { burdenRate, marginFloor, weeks });
  const clears = e.marginPct >= marginFloor;
  const colour = clears ? "var(--risk-lo)" : "var(--risk-hi)";

  const set = (k: keyof typeof form) => (ev: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: ev.target.value }));

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Package builder</h2>
        <span className="note">
          Floor {Math.round(marginFloor * 100)}% · burden {Math.round(burdenRate * 100)}% on taxable wages
        </span>
        {assignments.length > 0 && (
          <>
            <div className="spacer" />
            <select
              value={pick}
              style={{ width: "auto" }}
              aria-label="Start from an assignment"
              onChange={(ev) => {
                setPick(ev.target.value);
                setForm(toForm(assignments.find((a) => a.id === ev.target.value)));
              }}
            >
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="calc">
        <div className="calc-in">
          <div className="calc-grid">
            <Field id="billRate" label="Bill rate $/hr" value={form.billRate} onChange={set("billRate")} />
            <Field id="hoursPerWeek" label="Hours / week" value={form.hoursPerWeek} onChange={set("hoursPerWeek")} />
            <Field id="taxableRate" label="Taxable $/hr" value={form.taxableRate} onChange={set("taxableRate")} />
            <Field id="housingWeekly" label="Housing / wk" value={form.housingWeekly} onChange={set("housingWeekly")} />
            <Field id="mieWeekly" label="M&IE / wk" value={form.mieWeekly} onChange={set("mieWeekly")} />
            <Field id="weeks" label="Contract weeks" value={form.weeks} onChange={set("weeks")} />
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <p className="sub2">
              <strong>Highest taxable rate that still clears the floor:</strong>{" "}
              <span className="num">{formatMoney(ceiling, { cents: true })}/hr</span>
              {" — "}
              {ceiling > pkg.taxableRate
                ? `${formatMoney(ceiling - pkg.taxableRate, { cents: true })}/hr of room to negotiate.`
                : "already at or past the ceiling."}
            </p>
            <p className="sub2" style={{ marginTop: 10 }}>
              Stipends are shown untaxed. Whether they legitimately stay untaxed depends on the
              traveler maintaining a tax home — a compliance question, not a maths one.
            </p>
          </div>
        </div>

        <div className="calc-out">
          <p className="f">Gross margin / week</p>
          <p className="big num" style={{ color: colour }}>
            {formatMoney(e.marginWeekly)}
          </p>
          <div className="marginbar">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, (e.marginPct / 0.45) * 100))}%`,
                background: colour,
              }}
            />
          </div>
          <p className="sub2 num">
            {formatPct(e.marginPct)} of bill · {formatMoney(e.marginWeekly * weeks)} over {weeks} weeks
          </p>

          <div style={{ marginTop: 14 }}>
            <Line k="Bill" v={formatMoney(e.billWeekly)} />
            <Line k="Taxable wages" v={`−${formatMoney(e.wages)}`} />
            <Line k="Housing" v={`−${formatMoney(pkg.housingWeekly)}`} />
            <Line k="M&IE" v={`−${formatMoney(pkg.mieWeekly)}`} />
            <Line k="Burden" v={`−${formatMoney(e.burden)}`} />
            <div className="line total">
              <span>Margin</span>
              <span className="lv num">{formatMoney(e.marginWeekly)}</span>
            </div>
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <p className="f">What the traveler sees</p>
            <Line k="Gross / week" v={formatMoney(e.travelerGrossWeekly)} />
            <Line k="Est. take-home" v={formatMoney(e.travelerTakeHomeWeekly)} />
            <Line k="Blended / hr" v={`${formatMoney(e.blendedHourly, { cents: true })}/hr`} />
          </div>

          <div className={`warn ${clears ? "ok" : "bad"}`}>
            {clears
              ? `Clears the ${Math.round(marginFloor * 100)}% floor with ${formatMoney(
                  e.marginWeekly - e.billWeekly * marginFloor,
                )}/wk of room.`
              : `Below the ${Math.round(marginFloor * 100)}% floor. Needs ${formatMoney(
                  e.billWeekly * marginFloor - e.marginWeekly,
                )}/wk more margin, or a higher bill rate.`}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label className="f" htmlFor={id}>
        {label}
      </label>
      <input id={id} value={value} onChange={onChange} inputMode="decimal" />
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="line">
      <span style={{ color: "var(--ink-3)" }}>{k}</span>
      <span className="lv num">{v}</span>
    </div>
  );
}

/**
 * Plain assertion suite for the pure logic. Run with `npm test`.
 * No framework: this is deliberately dependency-free so it runs anywhere.
 */
import assert from "node:assert/strict";

import { computeEconomics, maxTaxableForFloor, formatMoney } from "../economics";
import { assessRisk, daysUntil, nextAction } from "../risk";
import { parseCsv, parseAgencyCsv } from "../sources/csv";
import { BullhornSource } from "../sources/bullhorn";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${(err as Error).message.split("\n")[0]}`);
  }
}

const DAY = 86_400_000;
const at = (d: number) => new Date(Date.now() + d * DAY);

// ---------------------------------------------------------------- economics
test("margin is bill minus wages, burden, and stipends", () => {
  const e = computeEconomics(
    { billRate: 100, taxableRate: 25, housingWeekly: 1000, mieWeekly: 400, hoursPerWeek: 36 },
    { burdenRate: 0.2 },
  );
  assert.equal(e.billWeekly, 3600);
  assert.equal(e.wages, 900);
  assert.equal(e.burden, 180);
  assert.equal(e.stipends, 1400);
  assert.equal(e.costWeekly, 2480);
  assert.equal(e.marginWeekly, 1120);
  assert.ok(Math.abs(e.marginPct - 1120 / 3600) < 1e-9);
});

test("one-off costs are spread across the contract", () => {
  const base = { billRate: 100, taxableRate: 25, housingWeekly: 1000, mieWeekly: 400, hoursPerWeek: 36 };
  const plain = computeEconomics(base, { burdenRate: 0.2, weeks: 13 });
  const withBonus = computeEconomics(
    { ...base, completionBonus: 1300, travelReimbursement: 650 },
    { burdenRate: 0.2, weeks: 13 },
  );
  assert.equal(withBonus.amortised, 150);
  assert.equal(withBonus.marginWeekly, plain.marginWeekly - 150);
});

test("stipends are untaxed in the traveler's take-home estimate", () => {
  const e = computeEconomics(
    { billRate: 100, taxableRate: 25, housingWeekly: 1000, mieWeekly: 400, hoursPerWeek: 36 },
    { burdenRate: 0.2, taxRate: 0.25 },
  );
  assert.equal(e.travelerGrossWeekly, 2300);
  assert.equal(e.travelerTakeHomeWeekly, 900 * 0.75 + 1400);
});

test("margin can go negative and is reported as such", () => {
  const e = computeEconomics(
    { billRate: 40, taxableRate: 30, housingWeekly: 1200, mieWeekly: 400, hoursPerWeek: 36 },
    { burdenRate: 0.2 },
  );
  assert.ok(e.marginWeekly < 0);
  assert.ok(e.marginPct < 0);
  assert.equal(formatMoney(e.marginWeekly).startsWith("−$"), true);
});

test("garbage input degrades to zero rather than NaN", () => {
  const e = computeEconomics(
    { billRate: NaN, taxableRate: -5, housingWeekly: NaN, mieWeekly: 0, hoursPerWeek: 36 },
    { burdenRate: 0.2 },
  );
  assert.ok(Number.isFinite(e.marginWeekly));
  assert.ok(Number.isFinite(e.marginPct));
  assert.equal(e.wages, 0);
});

test("zero hours cannot divide by zero", () => {
  const e = computeEconomics(
    { billRate: 100, taxableRate: 25, housingWeekly: 0, mieWeekly: 0, hoursPerWeek: 0 },
    { burdenRate: 0.2 },
  );
  assert.equal(e.blendedHourly, 0);
  assert.equal(e.marginPct, 0);
});

test("maxTaxableForFloor lands exactly on the floor", () => {
  const pkg = { billRate: 110, taxableRate: 0, housingWeekly: 1200, mieWeekly: 400, hoursPerWeek: 36 };
  const rate = maxTaxableForFloor(pkg, { burdenRate: 0.19, marginFloor: 0.25 });
  const e = computeEconomics({ ...pkg, taxableRate: rate }, { burdenRate: 0.19 });
  assert.ok(Math.abs(e.marginPct - 0.25) < 1e-9, `got ${e.marginPct}`);
});

test("maxTaxableForFloor never returns a negative rate", () => {
  const rate = maxTaxableForFloor(
    { billRate: 30, taxableRate: 0, housingWeekly: 1500, mieWeekly: 500, hoursPerWeek: 36 },
    { burdenRate: 0.19, marginFloor: 0.25 },
  );
  assert.equal(rate, 0);
});

// --------------------------------------------------------------------- risk
test("a signed extension is secured regardless of other signals", () => {
  const r = assessRisk({
    endsAt: at(3),
    lastContactAt: at(-90),
    extensionStatus: "SIGNED",
    hasNextStep: false,
    soonestCredentialDays: -5,
  });
  assert.equal(r.level, "SECURED");
  assert.equal(r.score, 0);
});

test("ending soon with long silence and a declined extension is at risk", () => {
  const r = assessRisk({
    endsAt: at(10),
    lastContactAt: at(-30),
    extensionStatus: "DECLINED",
    hasNextStep: false,
    soonestCredentialDays: null,
  });
  assert.equal(r.level, "AT_RISK");
  assert.ok(r.score >= 5);
  assert.ok(r.reasons.some((x) => /No contact in 30 days/.test(x)));
});

test("a distant assignment with recent contact is stable", () => {
  const r = assessRisk({
    endsAt: at(70),
    lastContactAt: at(-2),
    extensionStatus: "INTERESTED",
    hasNextStep: false,
    soonestCredentialDays: null,
  });
  assert.equal(r.level, "STABLE");
});

test("never having logged contact counts against the traveler", () => {
  const r = assessRisk({
    endsAt: at(40),
    lastContactAt: null,
    extensionStatus: "NOT_ASKED",
    hasNextStep: false,
    soonestCredentialDays: null,
  });
  assert.ok(r.reasons.some((x) => /No contact ever/.test(x)));
  assert.equal(r.daysSinceContact, null);
});

test("an expired credential is surfaced as a reason", () => {
  const r = assessRisk({
    endsAt: at(20),
    lastContactAt: at(-3),
    extensionStatus: "INTERESTED",
    hasNextStep: false,
    soonestCredentialDays: -2,
  });
  assert.ok(r.reasons.some((x) => /already expired/.test(x)));
});

test("nextAction prioritises silence over everything else", () => {
  const r = assessRisk({
    endsAt: at(10),
    lastContactAt: at(-30),
    extensionStatus: "DECLINED",
    hasNextStep: false,
    soonestCredentialDays: null,
  });
  assert.match(nextAction(r, "DECLINED"), /Call today/);
});

test("daysUntil is stable across a fixed reference point", () => {
  const now = Date.UTC(2026, 7, 16, 12);
  assert.equal(daysUntil(new Date(Date.UTC(2026, 7, 26, 12)), now), 10);
  assert.equal(daysUntil(new Date(Date.UTC(2026, 7, 6, 12)), now), -10);
});

// ---------------------------------------------------------------------- csv
test("csv parser handles quotes, embedded commas, and escapes", () => {
  const rows = parseCsv('a,b,c\n"x,1","he said ""hi""",z\n');
  assert.deepEqual(rows[0], ["a", "b", "c"]);
  assert.deepEqual(rows[1], ["x,1", 'he said "hi"', "z"]);
});

test("csv parser tolerates CRLF and a BOM", () => {
  const rows = parseCsv("﻿a,b\r\n1,2\r\n");
  assert.deepEqual(rows[0], ["a", "b"]);
  assert.deepEqual(rows[1], ["1", "2"]);
});

test("agency csv maps a full row into traveler and assignment", () => {
  const csv = [
    "traveler_id,traveler_name,specialty,facility,city,state,starts_on,ends_on,hours_per_week,bill_rate,taxable_rate,housing_weekly,mie_weekly,extension_status,last_contact_on,credentials",
    'T1,Marisa Ortega,ICU,St. Vincent,Portland,OR,2026-05-18,2026-08-28,36,"$112",24,"1,250",420,DECLINED,2026-07-28,"OR RN:2027-04-12|BLS:2026-09-20"',
  ].join("\n");

  const out = parseAgencyCsv(csv);
  assert.equal(out.warnings.length, 0);
  assert.equal(out.travelers.length, 1);
  assert.equal(out.assignments.length, 1);

  const t = out.travelers[0];
  assert.equal(t.name, "Marisa Ortega");
  assert.equal(t.specialty, "ICU");
  assert.equal(t.credentials?.length, 2);
  assert.equal(t.credentials?.[0].name, "OR RN");

  const a = out.assignments[0];
  assert.equal(a.billRate, 112, "currency symbols and commas should be stripped");
  assert.equal(a.housingWeekly, 1250);
  assert.equal(a.extensionStatus, "DECLINED");
  assert.equal(a.endsAt.getFullYear(), 2026);
  assert.equal(a.endsAt.getMonth(), 7);
  assert.equal(a.endsAt.getDate(), 28, "date must not drift across a timezone boundary");
});

test("agency csv reports missing required columns instead of guessing", () => {
  const out = parseAgencyCsv("traveler_name,facility\nA,B");
  assert.equal(out.assignments.length, 0);
  assert.match(out.warnings[0], /Missing required column/);
});

test("agency csv skips bad rows but keeps the good ones", () => {
  const csv = [
    "traveler_name,facility,ends_on,bill_rate,taxable_rate",
    "Good One,Mercy,2026-10-01,120,26",
    "Bad One,Mercy,not-a-date,120,26",
    "Bad Two,Mercy,2026-10-01,abc,26",
  ].join("\n");
  const out = parseAgencyCsv(csv);
  assert.equal(out.assignments.length, 1);
  assert.equal(out.assignments[0].travelerExternalId.includes("good one"), true);
  assert.equal(out.warnings.length, 2);
});

test("repeated travelers across rows are de-duplicated", () => {
  const csv = [
    "traveler_id,traveler_name,facility,ends_on,bill_rate,taxable_rate",
    "T1,Repeat Person,Mercy,2026-10-01,120,26",
    "T1,Repeat Person,Banner,2027-01-15,118,25",
  ].join("\n");
  const out = parseAgencyCsv(csv);
  assert.equal(out.travelers.length, 1);
  assert.equal(out.assignments.length, 2);
});

// ----------------------------------------------------------------- bullhorn
test("bullhorn placements normalise into travelers and assignments", () => {
  const src = new BullhornSource({ clientId: "x", clientSecret: "y" });
  const out = src.normalise([
    {
      id: 991,
      status: "Approved",
      dateBegin: Date.UTC(2026, 4, 18),
      dateEnd: Date.UTC(2026, 7, 28),
      payRate: 24,
      clientBillRate: 112,
      hoursPerWeek: 36,
      candidate: { id: 55, firstName: "Marisa", lastName: "Ortega", email: "m@x.com", occupation: "ICU RN" },
      jobOrder: { id: 7, clientCorporation: { name: "St. Vincent" }, address: { city: "Portland", state: "OR" } },
      owner: { email: "dana@agency.com" },
    },
  ]);

  assert.equal(out.travelers.length, 1);
  assert.equal(out.travelers[0].externalId, "bh:candidate:55");
  assert.equal(out.travelers[0].recruiterEmail, "dana@agency.com");
  assert.equal(out.assignments[0].externalId, "bh:placement:991");
  assert.equal(out.assignments[0].facilityName, "St. Vincent");
  assert.equal(out.assignments[0].status, "ACTIVE");
  assert.ok(out.warnings.some((w) => /custom fields/.test(w)), "should warn that stipends need mapping");
});

test("bullhorn placements without a candidate or end date are skipped, not crashed on", () => {
  const src = new BullhornSource({ clientId: "x", clientSecret: "y" });
  const out = src.normalise([
    { id: 1 },
    { id: 2, candidate: { id: 9, firstName: "No", lastName: "Enddate" } },
  ]);
  assert.equal(out.assignments.length, 0);
  assert.equal(out.travelers.length, 1);
  assert.equal(out.warnings.length >= 2, true);
});

test("an unconfigured bullhorn source reports itself as unconfigured", () => {
  assert.equal(new BullhornSource({ clientId: "", clientSecret: "" }).isConfigured(), false);
  assert.equal(new BullhornSource({ clientId: "a", clientSecret: "b" }).isConfigured(), true);
});

// --------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}

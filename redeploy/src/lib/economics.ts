/**
 * Pay-package arithmetic. Pure functions, no I/O — this is the part of the
 * product that has to be right, so it is kept separate and unit tested.
 *
 * A travel assignment is billed to the facility at an hourly rate and paid to
 * the traveler as a split of taxable hourly wages plus untaxed weekly stipends
 * for housing and meals/incidentals. The agency's margin is what is left after
 * wages, stipends, and employer burden on the taxable portion.
 */

export type Package = {
  billRate: number;
  taxableRate: number;
  housingWeekly: number;
  mieWeekly: number;
  hoursPerWeek: number;
  travelReimbursement?: number;
  completionBonus?: number;
};

export type Economics = {
  billWeekly: number;
  wages: number;
  burden: number;
  stipends: number;
  amortised: number;
  costWeekly: number;
  marginWeekly: number;
  marginPct: number;
  /** What the traveler sees. */
  travelerGrossWeekly: number;
  travelerTakeHomeWeekly: number;
  blendedHourly: number;
};

/** Illustrative blended tax rate, used only for the traveler's take-home estimate. */
export const DEFAULT_TAX_RATE = 0.24;

const n = (v: unknown, fallback = 0) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
};

export function computeEconomics(
  pkg: Package,
  opts: { burdenRate: number; weeks?: number; taxRate?: number },
): Economics {
  const hours = Math.max(0, n(pkg.hoursPerWeek, 36));
  const bill = Math.max(0, n(pkg.billRate));
  const taxable = Math.max(0, n(pkg.taxableRate));
  const housing = Math.max(0, n(pkg.housingWeekly));
  const mie = Math.max(0, n(pkg.mieWeekly));
  const weeks = Math.max(1, n(opts.weeks, 13));
  const burdenRate = Math.max(0, n(opts.burdenRate, 0.19));
  const taxRate = Math.min(0.9, Math.max(0, n(opts.taxRate, DEFAULT_TAX_RATE)));

  const billWeekly = bill * hours;
  const wages = taxable * hours;
  const burden = wages * burdenRate;
  const stipends = housing + mie;

  // One-off costs are spread across the contract so weekly margin is comparable.
  const amortised =
    (Math.max(0, n(pkg.travelReimbursement)) + Math.max(0, n(pkg.completionBonus))) / weeks;

  const costWeekly = wages + burden + stipends + amortised;
  const marginWeekly = billWeekly - costWeekly;
  const marginPct = billWeekly > 0 ? marginWeekly / billWeekly : 0;

  const travelerGrossWeekly = wages + stipends;
  const travelerTakeHomeWeekly = wages * (1 - taxRate) + stipends;

  return {
    billWeekly,
    wages,
    burden,
    stipends,
    amortised,
    costWeekly,
    marginWeekly,
    marginPct,
    travelerGrossWeekly,
    travelerTakeHomeWeekly,
    blendedHourly: hours > 0 ? travelerGrossWeekly / hours : 0,
  };
}

/** Total gross margin across a whole contract. */
export function contractValue(e: Economics, weeks: number) {
  return e.marginWeekly * Math.max(0, weeks);
}

/**
 * Highest taxable rate that still clears the agency's margin floor, holding
 * stipends fixed. This is what a recruiter actually wants to know when a
 * traveler pushes back on an offer.
 */
export function maxTaxableForFloor(
  pkg: Package,
  opts: { burdenRate: number; marginFloor: number; weeks?: number },
): number {
  const hours = Math.max(0, n(pkg.hoursPerWeek, 36));
  if (hours === 0) return 0;

  const billWeekly = Math.max(0, n(pkg.billRate)) * hours;
  const stipends = Math.max(0, n(pkg.housingWeekly)) + Math.max(0, n(pkg.mieWeekly));
  const weeks = Math.max(1, n(opts.weeks, 13));
  const amortised =
    (Math.max(0, n(pkg.travelReimbursement)) + Math.max(0, n(pkg.completionBonus))) / weeks;

  // bill - (wages*(1+burden) + stipends + amortised) = floor * bill
  const room = billWeekly * (1 - opts.marginFloor) - stipends - amortised;
  const maxWages = room / (1 + Math.max(0, n(opts.burdenRate, 0.19)));
  return Math.max(0, maxWages / hours);
}

export function formatMoney(value: number, opts: { cents?: boolean } = {}) {
  const rounded = opts.cents ? value : Math.round(value);
  const sign = rounded < 0 ? "−" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })}`;
}

export function formatPct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

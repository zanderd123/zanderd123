import type { SourcePayload, SourceAssignment, SourceTraveler } from "./types";

/**
 * CSV import — the universal fallback.
 *
 * Small agencies run on Bullhorn, LaborEdge, Avionté, Crelate, JobDiva, or a
 * spreadsheet. Every one of them can export a CSV, so this adapter is what
 * makes the product usable on day one without an integration project.
 *
 * Expected header (order does not matter, unknown columns are ignored):
 *   traveler_id, traveler_name, specialty, email, phone, recruiter_email,
 *   assignment_id, facility, city, state, starts_on, ends_on, hours_per_week,
 *   bill_rate, taxable_rate, housing_weekly, mie_weekly, travel_reimbursement,
 *   completion_bonus, status, extension_status, next_step, last_contact_on,
 *   credentials
 *
 * `credentials` is a pipe-separated list of "Name:YYYY-MM-DD".
 */

/** RFC 4180-ish parser: handles quoted fields, embedded commas, and "" escapes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

function parseDate(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  // Accept YYYY-MM-DD and MM/DD/YYYY; anchor to midday so a timezone shift
  // can never move the date across a day boundary.
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 12);
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]), 12);
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "").replace(/k$/i, "000");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

const EXT = new Set(["NOT_ASKED", "INTERESTED", "SIGNED", "DECLINED", "NO_RESPONSE"]);
const STATUS = new Set(["PENDING", "ACTIVE", "ENDED", "CANCELLED"]);

export function parseAgencyCsv(text: string): SourcePayload {
  const rows = parseCsv(text);
  const warnings: string[] = [];

  if (rows.length < 2) {
    return { travelers: [], assignments: [], warnings: ["The file has no data rows."] };
  }

  const header = rows[0].map(norm);
  const col = (name: string) => header.indexOf(name);
  const get = (row: string[], name: string) => {
    const i = col(name);
    return i === -1 ? "" : (row[i] ?? "").trim();
  };

  for (const required of ["traveler_name", "facility", "ends_on", "bill_rate", "taxable_rate"]) {
    if (col(required) === -1) {
      return {
        travelers: [],
        assignments: [],
        warnings: [`Missing required column "${required}".`],
      };
    }
  }

  const travelers = new Map<string, SourceTraveler>();
  const assignments: SourceAssignment[] = [];

  rows.slice(1).forEach((row, idx) => {
    const line = idx + 2;
    const name = get(row, "traveler_name");
    if (!name) {
      warnings.push(`Line ${line}: no traveler name, skipped.`);
      return;
    }

    const travelerExternalId = get(row, "traveler_id") || `name:${name.toLowerCase()}`;

    if (!travelers.has(travelerExternalId)) {
      const credentials = get(row, "credentials")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => {
          const at = c.lastIndexOf(":");
          const cname = at === -1 ? c : c.slice(0, at).trim();
          const date = at === -1 ? null : parseDate(c.slice(at + 1));
          return { name: cname, expiresAt: date };
        });

      travelers.set(travelerExternalId, {
        externalId: travelerExternalId,
        name,
        specialty: get(row, "specialty") || null,
        email: get(row, "email") || null,
        phone: get(row, "phone") || null,
        recruiterEmail: get(row, "recruiter_email") || null,
        credentials,
      });
    }

    const endsAt = parseDate(get(row, "ends_on"));
    if (!endsAt) {
      warnings.push(`Line ${line}: could not read ends_on, assignment skipped.`);
      return;
    }
    const startsAt = parseDate(get(row, "starts_on")) ?? new Date(endsAt.getTime() - 91 * 86_400_000);

    const bill = parseNumber(get(row, "bill_rate"));
    const taxable = parseNumber(get(row, "taxable_rate"));
    if (bill === null || taxable === null) {
      warnings.push(`Line ${line}: bill_rate or taxable_rate is not a number, assignment skipped.`);
      return;
    }

    const facility = get(row, "facility");
    if (!facility) {
      warnings.push(`Line ${line}: no facility, assignment skipped.`);
      return;
    }

    const rawStatus = get(row, "status").toUpperCase().replace(/\s+/g, "_");
    const rawExt = get(row, "extension_status").toUpperCase().replace(/\s+/g, "_");

    assignments.push({
      externalId: get(row, "assignment_id") || `${travelerExternalId}:${facility}:${endsAt.toISOString().slice(0, 10)}`,
      travelerExternalId,
      facilityName: facility,
      city: get(row, "city") || null,
      state: get(row, "state") || null,
      startsAt,
      endsAt,
      hoursPerWeek: parseNumber(get(row, "hours_per_week")) ?? 36,
      billRate: bill,
      taxableRate: taxable,
      housingWeekly: parseNumber(get(row, "housing_weekly")) ?? 0,
      mieWeekly: parseNumber(get(row, "mie_weekly")) ?? 0,
      travelReimbursement: parseNumber(get(row, "travel_reimbursement")) ?? 0,
      completionBonus: parseNumber(get(row, "completion_bonus")) ?? 0,
      status: STATUS.has(rawStatus) ? (rawStatus as SourceAssignment["status"]) : "ACTIVE",
      extensionStatus: EXT.has(rawExt) ? (rawExt as SourceAssignment["extensionStatus"]) : "NOT_ASKED",
      nextStep: get(row, "next_step") || null,
      lastContactAt: parseDate(get(row, "last_contact_on")),
    });
  });

  return { travelers: [...travelers.values()], assignments, warnings };
}

export const CSV_TEMPLATE_HEADER = [
  "traveler_id","traveler_name","specialty","email","phone","recruiter_email",
  "assignment_id","facility","city","state","starts_on","ends_on","hours_per_week",
  "bill_rate","taxable_rate","housing_weekly","mie_weekly","travel_reimbursement",
  "completion_bonus","status","extension_status","next_step","last_contact_on","credentials",
].join(",");

export const CSV_TEMPLATE_EXAMPLE = [
  CSV_TEMPLATE_HEADER,
  `T-1001,Marisa Ortega,ICU,marisa@example.com,5035550142,dana@northstar.example,A-4471,St. Vincent Medical Center,Portland,OR,2026-05-18,2026-08-28,36,112,24,1250,420,600,1500,ACTIVE,DECLINED,,2026-07-28,"OR RN License:2027-04-12|BLS:2026-09-20|ACLS:2026-08-25"`,
].join("\n");

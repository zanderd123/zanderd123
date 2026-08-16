import type { DataSource, SourcePayload, SourceAssignment, SourceTraveler } from "./types";

/**
 * Bullhorn adapter.
 *
 * Access model, which is the important part commercially: an agency that uses
 * Bullhorn can request OAuth credentials for its own tenant by raising a ticket
 * with Bullhorn support. That means a customer can authorise this app without
 * us being a Bullhorn partner first — so the first few agencies can be onboarded
 * with credentials they obtain themselves. Listing on the Bullhorn Marketplace
 * (which is what gets you distribution and partner keys) is a later step and
 * carries a validation fee.
 *
 * Auth is OAuth 2.0: authorize -> access token -> REST login -> BhRestToken,
 * which is then sent with every call against the tenant's own REST URL.
 *
 * Rate limits to respect: 50 concurrent sessions, 1,500 calls/minute, and
 * 100,000 calls/month on a standard agreement. That budget is why this pulls
 * placements in pages with a field mask rather than walking entities one by one.
 */

export type BullhornConfig = {
  clientId: string;
  clientSecret: string;
  /** Per-tenant, discovered at login and then cached. */
  restUrl?: string;
  restToken?: string;
  username?: string;
  password?: string;
  /** Overridable so tests can point at a local fixture server. */
  authBase?: string;
  restLoginBase?: string;
};

type BullhornPlacement = {
  id: number;
  candidate?: {
    id: number;
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
    occupation?: string;
  };
  jobOrder?: {
    id: number;
    clientCorporation?: { name?: string };
    address?: { city?: string; state?: string };
  };
  owner?: { email?: string };
  dateBegin?: number;
  dateEnd?: number;
  payRate?: number;
  clientBillRate?: number;
  status?: string;
  hoursPerWeek?: number;
};

const FIELDS = [
  "id",
  "status",
  "dateBegin",
  "dateEnd",
  "payRate",
  "clientBillRate",
  "hoursPerWeek",
  "candidate(id,firstName,lastName,email,mobile,occupation)",
  "jobOrder(id,clientCorporation(name),address(city,state))",
  "owner(email)",
].join(",");

const ACTIVE_STATUSES = new Set(["approved", "offer accepted", "placed", "active"]);

function mapStatus(raw?: string): SourceAssignment["status"] {
  const s = (raw ?? "").toLowerCase();
  if (ACTIVE_STATUSES.has(s)) return "ACTIVE";
  if (s.includes("cancel")) return "CANCELLED";
  if (s.includes("complet") || s.includes("ended")) return "ENDED";
  return "PENDING";
}

export class BullhornSource implements DataSource {
  readonly key = "BULLHORN";
  readonly label = "Bullhorn";

  constructor(private config: BullhornConfig) {}

  isConfigured() {
    return Boolean(this.config.clientId && this.config.clientSecret);
  }

  /**
   * Exchanges credentials for a BhRestToken and the tenant's REST URL.
   * Split out so a caller can cache the session — Bullhorn counts concurrent
   * sessions against the agency's limit.
   */
  async login(): Promise<{ restUrl: string; restToken: string }> {
    if (this.config.restUrl && this.config.restToken) {
      return { restUrl: this.config.restUrl, restToken: this.config.restToken };
    }
    if (!this.isConfigured()) throw new Error("Bullhorn credentials are not configured.");

    const authBase = this.config.authBase ?? "https://auth.bullhornstaffing.com/oauth";
    const restBase = this.config.restLoginBase ?? "https://rest.bullhornstaffing.com/rest-services";

    const tokenRes = await fetch(`${authBase}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        username: this.config.username ?? "",
        password: this.config.password ?? "",
      }),
    });
    if (!tokenRes.ok) throw new Error(`Bullhorn auth failed (${tokenRes.status}).`);
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("Bullhorn auth returned no access token.");

    const loginRes = await fetch(
      `${restBase}/login?version=*&access_token=${encodeURIComponent(token.access_token)}`,
    );
    if (!loginRes.ok) throw new Error(`Bullhorn REST login failed (${loginRes.status}).`);
    const login = (await loginRes.json()) as { BhRestToken?: string; restUrl?: string };
    if (!login.BhRestToken || !login.restUrl) throw new Error("Bullhorn login returned no session.");

    this.config.restToken = login.BhRestToken;
    this.config.restUrl = login.restUrl;
    return { restUrl: login.restUrl, restToken: login.BhRestToken };
  }

  /** Pulls current placements, paging until exhausted or the cap is reached. */
  async fetch(maxRecords = 500): Promise<SourcePayload> {
    const { restUrl, restToken } = await this.login();
    const warnings: string[] = [];
    const placements: BullhornPlacement[] = [];

    const pageSize = 100;
    for (let start = 0; start < maxRecords; start += pageSize) {
      const url =
        `${restUrl}query/Placement?BhRestToken=${encodeURIComponent(restToken)}` +
        `&fields=${encodeURIComponent(FIELDS)}` +
        `&where=${encodeURIComponent("status<>'Archive'")}` +
        `&count=${pageSize}&start=${start}&orderBy=-dateEnd`;

      const res = await fetch(url);
      if (!res.ok) {
        warnings.push(`Bullhorn returned ${res.status} while reading placements.`);
        break;
      }
      const body = (await res.json()) as { data?: BullhornPlacement[] };
      const batch = body.data ?? [];
      placements.push(...batch);
      if (batch.length < pageSize) break;
    }

    return this.normalise(placements, warnings);
  }

  /** Exposed separately so it can be tested against recorded payloads. */
  normalise(placements: BullhornPlacement[], warnings: string[] = []): SourcePayload {
    const travelers = new Map<string, SourceTraveler>();
    const assignments: SourceAssignment[] = [];

    for (const p of placements) {
      const c = p.candidate;
      if (!c?.id) {
        warnings.push(`Placement ${p.id} has no candidate, skipped.`);
        continue;
      }
      const travelerExternalId = `bh:candidate:${c.id}`;
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      if (!name) {
        warnings.push(`Candidate ${c.id} has no name, skipped.`);
        continue;
      }

      if (!travelers.has(travelerExternalId)) {
        travelers.set(travelerExternalId, {
          externalId: travelerExternalId,
          name,
          specialty: c.occupation ?? null,
          email: c.email ?? null,
          phone: c.mobile ?? null,
          recruiterEmail: p.owner?.email ?? null,
          // Bullhorn keeps certifications on separate entities; pulling them is
          // a second call per candidate, so it is deliberately left out of the
          // bulk sync and fetched on demand.
          credentials: [],
        });
      }

      if (!p.dateEnd) {
        warnings.push(`Placement ${p.id} has no end date, skipped.`);
        continue;
      }

      const bill = Number(p.clientBillRate ?? 0);
      const pay = Number(p.payRate ?? 0);
      if (!bill || !pay) {
        warnings.push(`Placement ${p.id} is missing a bill or pay rate.`);
      }

      assignments.push({
        externalId: `bh:placement:${p.id}`,
        travelerExternalId,
        facilityName: p.jobOrder?.clientCorporation?.name ?? "Unknown facility",
        city: p.jobOrder?.address?.city ?? null,
        state: p.jobOrder?.address?.state ?? null,
        startsAt: new Date(p.dateBegin ?? p.dateEnd),
        endsAt: new Date(p.dateEnd),
        hoursPerWeek: Number(p.hoursPerWeek ?? 36),
        billRate: bill,
        // Bullhorn's payRate is the taxable hourly figure. Stipends live in
        // custom fields that vary per agency, so they are mapped during setup
        // rather than assumed here.
        taxableRate: pay,
        housingWeekly: 0,
        mieWeekly: 0,
        status: mapStatus(p.status),
        extensionStatus: "NOT_ASKED",
        nextStep: null,
        lastContactAt: null,
      });
    }

    if (assignments.some((a) => a.housingWeekly === 0 && a.mieWeekly === 0)) {
      warnings.push(
        "Stipends came through as zero. Bullhorn stores these in agency-specific custom fields — map them in Settings so margin is accurate.",
      );
    }

    return { travelers: [...travelers.values()], assignments, warnings };
  }
}

export function bullhornFromEnv(): BullhornSource {
  return new BullhornSource({
    clientId: process.env.BULLHORN_CLIENT_ID ?? "",
    clientSecret: process.env.BULLHORN_CLIENT_SECRET ?? "",
    username: process.env.BULLHORN_USERNAME,
    password: process.env.BULLHORN_PASSWORD,
  });
}

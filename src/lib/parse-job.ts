import "server-only";

export type ParsedJob = {
  company?: string;
  title?: string;
  location?: string;
  description?: string;
  source?: string;
  workMode?: "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
  salaryMin?: number;
  salaryMax?: number;
  /** Set when we could reach the page but learned nothing useful. */
  warning?: string;
};

/** Human-readable board name from a hostname. */
export function sourceFromUrl(rawUrl: string): string | undefined {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, "");
    const known: Record<string, string> = {
      "boards.greenhouse.io": "Greenhouse",
      "job-boards.greenhouse.io": "Greenhouse",
      "jobs.lever.co": "Lever",
      "jobs.ashbyhq.com": "Ashby",
      "linkedin.com": "LinkedIn",
      "indeed.com": "Indeed",
      "glassdoor.com": "Glassdoor",
      "wellfound.com": "Wellfound",
      "angel.co": "Wellfound",
      "dice.com": "Dice",
      "monster.com": "Monster",
      "ziprecruiter.com": "ZipRecruiter",
      "weworkremotely.com": "We Work Remotely",
      "remotive.com": "Remotive",
      "myworkdayjobs.com": "Workday",
    };
    if (known[host]) return known[host];
    for (const [k, v] of Object.entries(known)) {
      if (host.endsWith(k)) return v;
    }
    return host;
  } catch {
    return undefined;
  }
}

/** Company slug embedded in well-known ATS URL shapes. */
function companyFromUrlShape(rawUrl: string): string | undefined {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);

    // boards.greenhouse.io/acme/jobs/123  |  jobs.lever.co/acme/uuid
    if (
      host.endsWith("greenhouse.io") ||
      host.endsWith("lever.co") ||
      host.endsWith("ashbyhq.com")
    ) {
      if (parts[0]) return titleCase(parts[0].replace(/[-_]/g, " "));
    }
    // acme.myworkdayjobs.com/...
    if (host.endsWith("myworkdayjobs.com")) {
      const sub = host.split(".")[0];
      if (sub && sub !== "www") return titleCase(sub.replace(/[-_]/g, " "));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function titleCase(s: string) {
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;|&#39;/g, "'");
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

function metaContent(html: string, ...names: string[]) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const m = html.match(re) ?? html.match(alt);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return undefined;
}

/** Pulls schema.org JobPosting out of JSON-LD blocks, if present. */
function jsonLdJobPosting(html: string): Record<string, unknown> | undefined {
  const blocks = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const candidates = Array.isArray(parsed)
        ? parsed
        : parsed["@graph"] && Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];

      for (const c of candidates) {
        const type = c?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("JobPosting")) return c;
      }
    } catch {
      // Malformed JSON-LD is common; just move on.
    }
  }
  return undefined;
}

function inferWorkMode(text: string): ParsedJob["workMode"] {
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return "HYBRID";
  if (/\b(fully remote|remote[- ]first|100% remote|work from home|remote)\b/.test(t))
    return "REMOTE";
  if (/\b(on[- ]?site|in[- ]office|in person)\b/.test(t)) return "ONSITE";
  return "UNKNOWN";
}

function parseSalary(job: Record<string, any>) {
  const bs = job?.baseSalary;
  const value = bs?.value ?? bs;
  const min = Number(value?.minValue ?? value?.value);
  const max = Number(value?.maxValue);
  const out: { salaryMin?: number; salaryMax?: number } = {};
  if (Number.isFinite(min) && min > 0) out.salaryMin = Math.round(min);
  if (Number.isFinite(max) && max > 0) out.salaryMax = Math.round(max);
  return out;
}

const BROWSER_HEADERS = {
  // Many boards return a stub page to non-browser agents.
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchText(
  url: string,
  accept: string,
): Promise<{ ok: true; body: string } | { ok: false; status?: number }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { ...BROWSER_HEADERS, Accept: accept },
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: (await res.text()).slice(0, 1_500_000) };
  } catch {
    return { ok: false };
  }
}

type AtsRef =
  | { kind: "greenhouse"; slug: string; id: string }
  | { kind: "lever"; slug: string; id: string }
  | { kind: "ashby"; slug: string; id: string }
  | { kind: "workday"; origin: string; tenant: string; site: string; path: string };

/** Recognises the ATS platforms that publish a structured public API. */
function matchAts(url: URL): AtsRef | null {
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  // boards.greenhouse.io/acme/jobs/123 | job-boards.greenhouse.io/acme/jobs/123
  if (host.endsWith("greenhouse.io")) {
    const jobsAt = parts.indexOf("jobs");
    if (jobsAt > 0 && parts[jobsAt + 1]) {
      const id = parts[jobsAt + 1].split(/[^0-9]/)[0];
      if (id) return { kind: "greenhouse", slug: parts[0], id };
    }
    // Some links carry the id as ?gh_jid=123
    const jid = url.searchParams.get("gh_jid");
    if (parts[0] && jid) return { kind: "greenhouse", slug: parts[0], id: jid };
  }

  // jobs.lever.co/acme/<uuid>
  if (host.endsWith("lever.co") && parts[0] && parts[1]) {
    return { kind: "lever", slug: parts[0], id: parts[1] };
  }

  // jobs.ashbyhq.com/acme/<uuid>[/application]
  if (host.endsWith("ashbyhq.com") && parts[0] && parts[1]) {
    return { kind: "ashby", slug: parts[0], id: parts[1] };
  }

  // acme.wd1.myworkdayjobs.com/en-US/<site>/details/<slug>
  // acme.wd5.myworkdayjobs.com/en-US/<site>/job/<location>/<slug>
  if (host.endsWith("myworkdayjobs.com")) {
    const tenant = host.split(".")[0];
    const rest = parts.slice();

    // An optional locale segment sits in front of the site name.
    if (rest[0] && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(rest[0])) rest.shift();

    const site = rest.shift();
    const marker = rest.findIndex((p) => p === "job" || p === "details");
    const tail = marker === -1 ? rest : rest.slice(marker + 1);

    if (tenant && site && tail.length) {
      return { kind: "workday", origin: url.origin, tenant, site, path: tail.join("/") };
    }
  }

  return null;
}

/**
 * Greenhouse publishes every board over a public JSON API, which is far more
 * reliable than scraping the React-rendered page.
 */
async function fromGreenhouse(slug: string, id: string): Promise<ParsedJob | null> {
  const res = await fetchText(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`,
    "application/json",
  );
  if (!res.ok) return null;

  let job: Record<string, any>;
  try {
    job = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!job || typeof job.title !== "string") return null;

  const out: ParsedJob = { source: "Greenhouse", title: job.title.trim() };

  const location = job.location?.name ?? job.offices?.[0]?.name;
  if (typeof location === "string" && location.trim()) out.location = location.trim();

  // `content` is HTML, entity-encoded a second time by the API.
  if (typeof job.content === "string" && job.content) {
    out.description = htmlToText(decodeEntities(job.content)).slice(0, 20_000);
  }

  // The board endpoint carries the properly spelled company name
  // ("rocketlab" -> "Rocket Lab"), which the URL slug can't give us.
  const board = await fetchText(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`,
    "application/json",
  );
  if (board.ok) {
    try {
      const name = JSON.parse(board.body)?.name;
      if (typeof name === "string" && name.trim()) out.company = name.trim();
    } catch {
      // Fall through to the slug-derived name.
    }
  }

  out.workMode = inferWorkMode(
    `${out.location ?? ""} ${(out.description ?? "").slice(0, 4000)}`,
  );
  return out;
}

/** Lever exposes the same kind of public posting API. */
async function fromLever(slug: string, id: string): Promise<ParsedJob | null> {
  const res = await fetchText(
    `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
    "application/json",
  );
  if (!res.ok) return null;

  let job: Record<string, any>;
  try {
    job = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!job || typeof job.text !== "string") return null;

  const out: ParsedJob = { source: "Lever", title: job.text.trim() };

  const loc = job.categories?.location;
  if (typeof loc === "string" && loc.trim()) out.location = loc.trim();

  const body = [
    job.description ?? "",
    ...(Array.isArray(job.lists)
      ? job.lists.map((l: any) => `${l?.text ?? ""}\n${l?.content ?? ""}`)
      : []),
    job.additional ?? "",
  ].join("\n");
  if (body.trim()) out.description = htmlToText(body).slice(0, 20_000);

  const commitment = job.categories?.commitment;
  out.workMode = inferWorkMode(
    `${out.location ?? ""} ${typeof commitment === "string" ? commitment : ""} ${(out.description ?? "").slice(0, 4000)}`,
  );
  return out;
}

/**
 * Ashby serves each board as JSON. There's no per-job endpoint, so we pull the
 * board and pick out the posting the URL points at.
 */
async function fromAshby(slug: string, id: string): Promise<ParsedJob | null> {
  const res = await fetchText(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`,
    "application/json",
  );
  if (!res.ok) return null;

  let board: Record<string, any>;
  try {
    board = JSON.parse(res.body);
  } catch {
    return null;
  }

  const jobs: any[] = Array.isArray(board?.jobs) ? board.jobs : [];
  const job = jobs.find((j) => j?.id === id) ?? jobs.find((j) => String(j?.jobUrl ?? "").includes(id));
  if (!job || typeof job.title !== "string") return null;

  const out: ParsedJob = { source: "Ashby", title: job.title.trim() };

  const orgName = board?.organizationName ?? board?.name;
  if (typeof orgName === "string" && orgName.trim()) out.company = orgName.trim();

  const locations = [job.location, ...(Array.isArray(job.secondaryLocations) ? job.secondaryLocations : [])]
    .map((l) => (typeof l === "string" ? l : l?.location))
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0);
  if (locations.length) out.location = [...new Set(locations.map((l) => l.trim()))].join(", ");

  if (typeof job.descriptionHtml === "string" && job.descriptionHtml) {
    out.description = htmlToText(job.descriptionHtml).slice(0, 20_000);
  } else if (typeof job.descriptionPlain === "string") {
    out.description = job.descriptionPlain.slice(0, 20_000);
  }

  // Compensation arrives as summary components; take the salary band if present.
  const components: any[] = Array.isArray(job.compensation?.summaryComponents)
    ? job.compensation.summaryComponents
    : [];
  const salaryBand = components.find((c) => /salary/i.test(String(c?.compensationType ?? "")));
  if (salaryBand) {
    const min = Number(salaryBand.minValue);
    const max = Number(salaryBand.maxValue);
    if (Number.isFinite(min) && min > 0) out.salaryMin = Math.round(min);
    if (Number.isFinite(max) && max > 0) out.salaryMax = Math.round(max);
  }

  out.workMode =
    job.isRemote === true
      ? "REMOTE"
      : inferWorkMode(`${out.location ?? ""} ${(out.description ?? "").slice(0, 4000)}`);

  return out;
}

/**
 * Workday tenants serve their careers site from a JSON endpoint (CXS) behind
 * the same host as the posting, which avoids scraping the single-page app.
 */
async function fromWorkday(ref: {
  origin: string;
  tenant: string;
  site: string;
  path: string;
}): Promise<ParsedJob | null> {
  const res = await fetchText(
    `${ref.origin}/wday/cxs/${encodeURIComponent(ref.tenant)}/${encodeURIComponent(ref.site)}/job/${ref.path}`,
    "application/json",
  );
  if (!res.ok) return null;

  let data: Record<string, any>;
  try {
    data = JSON.parse(res.body);
  } catch {
    return null;
  }

  const info = data?.jobPostingInfo ?? data;
  if (!info || typeof info.title !== "string") return null;

  const out: ParsedJob = { source: "Workday", title: info.title.trim() };

  const locations = [info.location, ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : [])]
    .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    .map((l) => l.trim());
  if (locations.length) out.location = [...new Set(locations)].join(", ");

  if (typeof info.jobDescription === "string" && info.jobDescription) {
    out.description = htmlToText(info.jobDescription).slice(0, 20_000);
  }

  const remote = String(info.remoteType ?? "");
  out.workMode = /remote/i.test(remote)
    ? "REMOTE"
    : /hybrid|flex/i.test(remote)
      ? "HYBRID"
      : inferWorkMode(`${out.location ?? ""} ${remote} ${(out.description ?? "").slice(0, 4000)}`);

  return out;
}

/**
 * Best-effort read of a job posting URL. Never throws — on any failure the
 * caller still gets whatever could be derived from the URL itself, so the
 * form degrades to plain manual entry.
 *
 * Order of preference: the board's own public API (most reliable), then
 * schema.org JSON-LD embedded in the page, then OpenGraph/<title> guessing.
 */
export async function parseJobUrl(rawUrl: string): Promise<ParsedJob> {
  const fallback: ParsedJob = {
    source: sourceFromUrl(rawUrl),
    company: companyFromUrlShape(rawUrl),
  };

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { ...fallback, warning: "Only http and https links are supported." };
    }
  } catch {
    return { warning: "That doesn't look like a valid URL." };
  }

  // Prefer the board's own API when we recognise the platform.
  const ats = matchAts(url);
  if (ats) {
    const viaApi =
      ats.kind === "greenhouse"
        ? await fromGreenhouse(ats.slug, ats.id)
        : ats.kind === "lever"
          ? await fromLever(ats.slug, ats.id)
          : ats.kind === "ashby"
            ? await fromAshby(ats.slug, ats.id)
            : await fromWorkday(ats);

    if (viaApi) {
      // Keep the slug-derived company only if the API didn't name one.
      return { ...fallback, ...viaApi, company: viaApi.company ?? fallback.company };
    }
  }

  const page = await fetchText(url.toString(), "text/html,application/xhtml+xml");
  if (!page.ok) {
    return {
      ...fallback,
      warning: page.status
        ? `The site returned ${page.status} — it's blocking automated requests. Copy the title and description in by hand.`
        : "Couldn't reach that page. Copy the title and description in by hand.",
    };
  }
  const html = page.body;

  const out: ParsedJob = { ...fallback };
  const job = jsonLdJobPosting(html);

  if (job) {
    const j = job as Record<string, any>;
    if (typeof j.title === "string") out.title = decodeEntities(j.title).trim();

    const org = j.hiringOrganization;
    const orgName = typeof org === "string" ? org : org?.name;
    if (typeof orgName === "string" && orgName.trim()) {
      out.company = decodeEntities(orgName).trim();
    }

    const loc = Array.isArray(j.jobLocation) ? j.jobLocation[0] : j.jobLocation;
    const addr = loc?.address ?? loc;
    const locality = addr?.addressLocality;
    const region = addr?.addressRegion;
    const country = addr?.addressCountry?.name ?? addr?.addressCountry;
    const locParts = [locality, region, typeof country === "string" ? country : null]
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .map((p) => p.trim());
    if (locParts.length) out.location = [...new Set(locParts)].join(", ");

    if (typeof j.description === "string") {
      out.description = htmlToText(j.description).slice(0, 20_000);
    }
    Object.assign(out, parseSalary(j));

    const remoteFlag =
      j.jobLocationType === "TELECOMMUTE" ||
      /telecommute/i.test(String(j.jobLocationType ?? ""));
    if (remoteFlag) out.workMode = "REMOTE";
  }

  // Fall back to OpenGraph / <title> for anything JSON-LD didn't provide.
  if (!out.title) {
    const ogTitle =
      metaContent(html, "og:title", "twitter:title") ??
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];

    if (ogTitle) {
      const clean = decodeEntities(ogTitle).replace(/\s+/g, " ").trim();
      // Titles are usually "Role at Company" or "Role - Company | Board".
      const atMatch = clean.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|·–-].*)?$/i);
      const dashMatch = clean.match(/^(.+?)\s*[|–-]\s*(.+?)(?:\s*[|–-].*)?$/);

      if (atMatch) {
        out.title = atMatch[1].trim();
        out.company ??= atMatch[2].trim();
      } else if (dashMatch) {
        out.title = dashMatch[1].trim();
        out.company ??= dashMatch[2].trim();
      } else {
        out.title = clean.slice(0, 140);
      }
    }
  }

  if (!out.company) {
    out.company = metaContent(html, "og:site_name");
  }

  if (!out.description) {
    const desc = metaContent(html, "og:description", "description");
    if (desc) out.description = desc;
  }

  if (!out.workMode || out.workMode === "UNKNOWN") {
    out.workMode = inferWorkMode(
      `${out.title ?? ""} ${out.location ?? ""} ${(out.description ?? "").slice(0, 4000)}`,
    );
  }

  const gotSomething = out.title || out.company || out.description;
  if (!gotSomething) {
    out.warning =
      "Reached the page but couldn't identify the job details. Fill them in manually.";
  }

  return out;
}

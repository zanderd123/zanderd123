import "server-only";

import { lookup } from "dns/promises";
import net from "net";

/**
 * Guarded outbound fetch for user-supplied URLs.
 *
 * The job-posting importer fetches whatever link a user pastes, which without
 * a guard is a server-side request forgery hole: a user could point it at
 * cloud metadata (169.254.169.254), an internal admin panel, or a database
 * port and read the response back through the form. Every hostname is
 * resolved and checked against the private ranges before we connect, and
 * redirects are followed manually so each hop gets the same check.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** True for loopback, private, link-local, CGNAT, multicast and reserved space. */
export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);

  if (version === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true;
    }
    const [a, b] = parts;

    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const addr = address.toLowerCase().split("%")[0];

    if (addr === "::" || addr === "::1") return true;

    // IPv4-mapped (::ffff:127.0.0.1) must be judged on the embedded address.
    const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);

    const head = addr.split(":")[0];
    const lead = parseInt(head || "0", 16);
    if ((lead & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((lead & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if (head.startsWith("ff")) return true; // multicast
    return false;
  }

  // Not an IP literal — caller resolves it first.
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error("blocked host");
  }

  // An IP literal needs no resolution.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("blocked address");
    return;
  }

  const results = await lookup(host, { all: true, verbatim: true });
  if (results.length === 0) throw new Error("unresolved host");
  // Any private answer disqualifies the host, so DNS rebinding can't slip
  // one public and one private record past us.
  if (results.some((r) => isBlockedAddress(r.address))) {
    throw new Error("resolves to a private address");
  }
}

export type SafeFetchResult =
  | { ok: true; body: string }
  | { ok: false; status?: number; blocked?: boolean };

/**
 * Fetches a user-supplied URL, refusing anything that resolves inside the
 * network. Never throws.
 */
export async function safeFetchText(
  rawUrl: string,
  accept: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const maxRedirects = opts.maxRedirects ?? 3;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, blocked: true };
  }

  const started = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!["http:", "https:"].includes(url.protocol)) return { ok: false, blocked: true };

    try {
      await assertPublicHost(url.hostname);
    } catch {
      return { ok: false, blocked: true };
    }

    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return { ok: false };

    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);

      res = await fetch(url.toString(), {
        signal: controller.signal,
        // Followed by hand so every hop is re-checked.
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          Accept: accept,
        },
      }).finally(() => clearTimeout(timer));
    } catch {
      return { ok: false };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, status: res.status };
      try {
        url = new URL(location, url);
      } catch {
        return { ok: false, blocked: true };
      }
      continue;
    }

    if (!res.ok) return { ok: false, status: res.status };

    const body = await res.text().catch(() => null);
    if (body === null) return { ok: false };
    return { ok: true, body: body.slice(0, maxBytes) };
  }

  return { ok: false };
}

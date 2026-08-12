export function formatDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3 days ago", "in 2 weeks", "today". */
export function relativeDays(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(new Date())) / 86_400_000);

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) {
    const n = Math.abs(days);
    if (n < 30) return `${n} days ago`;
    if (n < 365) return `${Math.round(n / 30)} mo ago`;
    return `${Math.round(n / 365)} yr ago`;
  }
  if (days < 30) return `in ${days} days`;
  if (days < 365) return `in ${Math.round(days / 30)} mo`;
  return `in ${Math.round(days / 365)} yr`;
}

/** Whole days between a past date and now. */
export function daysSince(d: Date | string | null | undefined) {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export function formatSalary(
  min?: number | null,
  max?: number | null,
  currency?: string | null,
) {
  if (!min && !max) return null;
  const sym = currency === "USD" || !currency ? "$" : `${currency} `;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  if (min && max) return `${sym}${k(min)}–${k(max)}`;
  return `${sym}${k((min ?? max)!)}${min ? "+" : ""}`;
}

/** Formats a Date for a datetime-local input value. */
export function toDateTimeLocal(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Formats a Date for a date input value. */
export function toDateInput(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

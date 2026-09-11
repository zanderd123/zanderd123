"""Daily entrypoint:  python3 -m jobfeed.run

Reads sources.toml, fetches every enabled board, folds the results into the
store and prints a summary of what changed.

One company failing never stops the run — each board is isolated, and a
failure is recorded as "we could not look" rather than "there are no jobs".
"""

from __future__ import annotations

import sys
import time
import tomllib
from datetime import datetime, timezone
from pathlib import Path

from . import ashby, greenhouse, store
from .lifecycle import RunSummary, is_suspect, reconcile

CONFIG = Path(__file__).resolve().parent.parent / "sources.toml"

# Space out requests so we are a well-behaved client. These APIs publish no
# hard rate limit, which is not an invitation to hammer them.
DELAY_BETWEEN_BOARDS = 1.0

ADAPTERS = {"greenhouse": greenhouse, "ashby": ashby}


def load_sources() -> list[dict]:
    if not CONFIG.exists():
        sys.exit(f"Could not find {CONFIG.name}. It should sit next to this folder.")
    with CONFIG.open("rb") as handle:
        config = tomllib.load(handle)
    return [s for s in config.get("source", []) if s.get("enabled", True)]


def main() -> int:
    sources = load_sources()
    if not sources:
        sys.exit("No enabled companies in sources.toml — nothing to do.")

    now = datetime.now(timezone.utc)
    conn = store.connect()
    run_id = store.start_run(conn, now.isoformat())

    print(f"Run {run_id} — {now:%Y-%m-%d %H:%M UTC} — {len(sources)} companies\n")

    summaries: list[RunSummary] = []
    failures = 0

    for index, source in enumerate(sources):
        company = source.get("company") or source.get("token", "?")
        ats = source.get("ats", "greenhouse")
        token = source.get("token")

        adapter = ADAPTERS.get(ats)
        if adapter is None or not token:
            print(f"  ✗ {company}: unsupported ats '{ats}' or missing token")
            store.record_source_run(conn, run_id, company, "failed", error="bad config")
            summaries.append(RunSummary(company, "failed", error="bad config"))
            failures += 1
            continue

        try:
            postings = adapter.fetch(token, region=source.get("region", "us"))
        except adapter.FetchError as exc:
            # Guard 1: a failed fetch records nothing. Every posting for this
            # company keeps its current state and its absence counter untouched.
            print(f"  ✗ {company}: {exc}")
            store.record_source_run(conn, run_id, company, "failed", error=str(exc))
            summaries.append(RunSummary(company, "failed", error=str(exc)))
            failures += 1
            continue

        suspect = is_suspect(conn, company, len(postings))
        summary = reconcile(conn, run_id, company, postings, now, suspect=suspect)
        store.record_source_run(
            conn, run_id, company,
            "suspect" if suspect else "ok",
            job_count=len(postings),
        )
        summaries.append(summary)

        flag = "  ⚠" if suspect else "  ✓"
        changes = []
        for label, value in (
            ("new", summary.new), ("edited", summary.edited),
            ("likely down", summary.likely_down), ("closed", summary.closed),
            ("reposted", summary.reposted),
        ):
            if value:
                changes.append(f"{value} {label}")
        detail = f" — {', '.join(changes)}" if changes else ""
        note = f"  [{summary.note}]" if summary.note else ""
        print(f"{flag} {company}: {len(postings)} open{detail}{note}")

        if index < len(sources) - 1:
            time.sleep(DELAY_BETWEEN_BOARDS)

    store.finish_run(conn, run_id, datetime.now(timezone.utc).isoformat())

    total = {
        "new": sum(s.new for s in summaries),
        "edited": sum(s.edited for s in summaries),
        "likely down": sum(s.likely_down for s in summaries),
        "closed": sum(s.closed for s in summaries),
        "reposted": sum(s.reposted for s in summaries),
    }
    tracked = conn.execute(
        "SELECT COUNT(*) FROM postings WHERE state = 'open'"
    ).fetchone()[0]

    changed = " · ".join(f"{v} {k}" for k, v in total.items() if v)
    print(f"\n{'─' * 56}")
    print(f"Tracking {tracked} open postings across {len(sources) - failures} boards")
    print(f"  {changed}" if changed else "  no changes today")
    if failures:
        print(f"  {failures} board(s) unreachable — states left untouched")

    conn.close()
    # Exit non-zero only if everything failed; a single flaky board should
    # not turn the whole scheduled run red.
    return 1 if failures == len(sources) else 0


if __name__ == "__main__":
    raise SystemExit(main())

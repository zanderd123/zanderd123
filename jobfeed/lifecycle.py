"""Posting lifecycle engine.

Implements the state machine agreed in the plan:

    open ──edited──▶ open
     │
     └─absent 2 good runs─▶ likely_down ──absent 14 days─▶ closed
                                 │                            │
                                 └────fingerprint returns─────┘
                                              ▼
                                          reposted

The five guards exist because a posting vanishing from a board does *not*
mean the job closed. It can mean a cancelled requisition, a repost under a
fresh ID, or our own scraper having a bad morning. Emailing someone "the job
you applied for is closed" when it was actually our timeout destroys exactly
the trust this product sells, so the bias is always toward saying nothing.
"""

from __future__ import annotations

import hashlib
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

from .common import Posting
from .store import add_event, recent_good_counts

# Consecutive successful runs a posting must be absent from before we will
# say anything. One run is noise; two is a pattern.
MISSED_RUNS_BEFORE_LIKELY_DOWN = 2

# How long a posting stays "likely down" before we call it closed. Kept
# generous because reposts frequently land inside two weeks.
DAYS_BEFORE_CONFIRMED_CLOSED = 14

# A board reporting fewer than this fraction of its recent median is treated
# as a broken fetch rather than a mass closure.
SUSPECT_DROP_RATIO = 0.6

# How far back to look for a matching fingerprint when deciding whether a
# newly appeared posting is actually a repost.
REPOST_LOOKBACK_DAYS = 120

_PUNCT = re.compile(r"[^a-z0-9 ]+")
_SPACE = re.compile(r"\s+")
_NOISE = re.compile(
    r"\b(remote|hybrid|onsite|on site|full time|part time|contract|us|usa)\b"
)


def normalise(text: str) -> str:
    text = (text or "").lower()
    text = _PUNCT.sub(" ", text)
    text = _NOISE.sub(" ", text)
    return _SPACE.sub(" ", text).strip()


def fingerprint(company: str, title: str, location: str) -> str:
    """Identity that survives a repost.

    Deliberately keyed on what a human would recognise as "the same job"
    rather than the requisition ID, because reposting under a fresh ID is
    routine and ID matching reads that as a closure plus an unrelated
    opening — losing the single most valuable signal we have.

    Only the first location segment is used, so "Hawthorne, CA; Remote"
    and "Hawthorne, CA" still match.
    """
    primary_location = location.split(";")[0].split("/")[0]
    return f"{normalise(company)}|{normalise(title)}|{normalise(primary_location)}"


def content_hash(posting: Posting) -> str:
    """Detect material edits to a posting.

    Title, location and body only — deliberately not `updated_at`, which
    vendors bump for changes invisible to an applicant and would otherwise
    generate constant noise.
    """
    payload = f"{posting.title}|{posting.location}|{posting.content}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


@dataclass
class RunSummary:
    company: str
    status: str
    fetched: int = 0
    new: int = 0
    edited: int = 0
    likely_down: int = 0
    closed: int = 0
    reposted: int = 0
    error: str | None = None
    note: str | None = None


def _parse(timestamp: str) -> datetime:
    return datetime.fromisoformat(timestamp)


def is_suspect(conn: sqlite3.Connection, company: str, count: int) -> bool:
    """Guard 3 — circuit-break on an implausible drop.

    Boards do not lose half their postings overnight. Scrapers do.
    """
    history = recent_good_counts(conn, company)
    if len(history) < 3:
        return False  # not enough history to judge; let it through
    baseline = median(history)
    if baseline == 0:
        return False
    return count < baseline * SUSPECT_DROP_RATIO


def reconcile(
    conn: sqlite3.Connection,
    run_id: int,
    company: str,
    postings: list[Posting],
    now: datetime,
    suspect: bool = False,
) -> RunSummary:
    """Fold one company's fetch into the store, emitting lifecycle events."""
    summary = RunSummary(company=company, status="suspect" if suspect else "ok")
    summary.fetched = len(postings)
    stamp = now.isoformat()

    existing = {
        row["key"]: row
        for row in conn.execute(
            "SELECT * FROM postings WHERE company = ?", (company,)
        ).fetchall()
    }
    seen_keys: set[str] = set()

    for posting in postings:
        key = f"{company}::{posting.job_id}"
        seen_keys.add(key)
        digest = content_hash(posting)
        print_ = fingerprint(company, posting.title, posting.location)
        departments = ", ".join(d for d in posting.departments if d)

        conn.execute(
            "INSERT OR REPLACE INTO observations (run_id, key, seen_at) VALUES (?, ?, ?)",
            (run_id, key, stamp),
        )

        row = existing.get(key)

        if row is None:
            # Never seen this posting ID. Before calling it new, check whether
            # it is a known posting coming back under a fresh ID (Guard 4).
            revived = conn.execute(
                "SELECT key, title, closed_at, state FROM postings "
                "WHERE fingerprint = ? AND state IN ('likely_down', 'closed') "
                "AND last_seen >= ? ORDER BY last_seen DESC LIMIT 1",
                (print_, (now - timedelta(days=REPOST_LOOKBACK_DAYS)).isoformat()),
            ).fetchone()

            conn.execute(
                "INSERT INTO postings (key, company, job_id, title, location, url, "
                "departments, fingerprint, content_hash, first_published, first_seen, "
                "last_seen, state, missed_runs) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0)",
                (
                    key, company, posting.job_id, posting.title, posting.location,
                    posting.url, departments, print_, digest, posting.first_published,
                    stamp, stamp,
                ),
            )

            if revived:
                # The high-value signal: they didn't fill it, and it's open again.
                gone_since = revived["closed_at"] or "recently"
                add_event(
                    conn, run_id, key, "reposted",
                    f"Reposted after coming down {gone_since[:10]}", stamp,
                )
                # Retire the old record so it can't fire a closure later.
                conn.execute(
                    "UPDATE postings SET state = 'closed' WHERE key = ?",
                    (revived["key"],),
                )
                summary.reposted += 1
            else:
                add_event(conn, run_id, key, "new", posting.location, stamp)
                summary.new += 1
            continue

        # Known posting, seen again — reset the absence counter (Guard 2).
        conn.execute(
            "UPDATE postings SET last_seen = ?, missed_runs = 0, state = 'open', "
            "title = ?, location = ?, url = ?, departments = ?, fingerprint = ? "
            "WHERE key = ?",
            (stamp, posting.title, posting.location, posting.url,
             departments, print_, key),
        )

        if row["state"] in ("likely_down", "closed"):
            # Same ID came back — we were wrong, or it was pulled and restored.
            add_event(conn, run_id, key, "reposted", "Back up under the same listing", stamp)
            conn.execute("UPDATE postings SET closed_at = NULL WHERE key = ?", (key,))
            summary.reposted += 1
        elif row["content_hash"] and row["content_hash"] != digest:
            change = "Title changed" if row["title"] != posting.title else "Posting updated"
            if row["location"] != posting.location:
                change = f"Location changed: {row['location']} → {posting.location}"
            add_event(conn, run_id, key, "edited", change, stamp)
            summary.edited += 1

        conn.execute(
            "UPDATE postings SET content_hash = ? WHERE key = ?", (digest, key)
        )

    # ── Absences ─────────────────────────────────────────────────────────
    # Guard 3: a suspect run tells us nothing about what is missing, so we
    # record what we saw and stop here rather than inferring closures.
    if suspect:
        summary.note = "counts dropped sharply — closures suppressed this run"
        conn.commit()
        return summary

    for key, row in existing.items():
        if key in seen_keys or row["state"] == "closed":
            continue

        missed = int(row["missed_runs"]) + 1
        conn.execute("UPDATE postings SET missed_runs = ? WHERE key = ?", (missed, key))

        if row["state"] == "open" and missed >= MISSED_RUNS_BEFORE_LIKELY_DOWN:
            conn.execute(
                "UPDATE postings SET state = 'likely_down', closed_at = ? WHERE key = ?",
                (stamp, key),
            )
            add_event(
                conn, run_id, key, "likely_down",
                f"Not on the board for {missed} consecutive checks", stamp,
            )
            summary.likely_down += 1

        elif row["state"] == "likely_down":
            down_since = _parse(row["closed_at"] or row["last_seen"])
            if now - down_since >= timedelta(days=DAYS_BEFORE_CONFIRMED_CLOSED):
                conn.execute(
                    "UPDATE postings SET state = 'closed' WHERE key = ?", (key,)
                )
                add_event(
                    conn, run_id, key, "closed",
                    f"Gone {DAYS_BEFORE_CONFIRMED_CLOSED}+ days with no repost", stamp,
                )
                summary.closed += 1

    conn.commit()
    return summary


def days_open(conn: sqlite3.Connection, company: str | None = None) -> list[sqlite3.Row]:
    """Time-to-close per company, in days.

    Uses the ATS's own `first_published` when we have it and falls back to
    when we first saw the posting — which means these numbers are honest
    from day one rather than needing months of history.
    """
    where = "WHERE state IN ('likely_down', 'closed')"
    params: tuple = ()
    if company:
        where += " AND company = ?"
        params = (company,)
    return conn.execute(
        f"""
        SELECT company,
               COUNT(*) AS closed_postings,
               ROUND(AVG(julianday(COALESCE(closed_at, last_seen))
                       - julianday(COALESCE(first_published, first_seen))), 1) AS avg_days_open
        FROM postings {where}
        GROUP BY company ORDER BY avg_days_open DESC
        """,
        params,
    ).fetchall()

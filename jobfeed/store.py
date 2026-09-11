"""SQLite storage.

The design rule from the plan: never store "current jobs". Store an
append-only log of what we observed on each run, and derive everything else
from it. That single decision is what makes the closure alerts, the
time-to-close analytics and the repost detection all possible from one table.

SQLite is deliberate. It's a single file with no server to run, no
credentials to rotate and no monthly bill, and it comfortably handles years
of daily snapshots at this scale.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "jobs.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT
);

-- Per-company outcome for each run. Crucially records *failures*, so the
-- lifecycle engine can tell "no jobs" apart from "we couldn't look".
CREATE TABLE IF NOT EXISTS source_runs (
    run_id    INTEGER NOT NULL,
    company   TEXT NOT NULL,
    status    TEXT NOT NULL,          -- ok | failed | suspect
    job_count INTEGER,
    error     TEXT,
    PRIMARY KEY (run_id, company)
);

-- One row per posting we have ever seen, carrying its current state.
CREATE TABLE IF NOT EXISTS postings (
    key             TEXT PRIMARY KEY,   -- company::job_id
    company         TEXT NOT NULL,
    job_id          TEXT NOT NULL,
    title           TEXT,
    location        TEXT,
    url             TEXT,
    departments     TEXT,
    fingerprint     TEXT NOT NULL,      -- company|title|location, normalised
    content_hash    TEXT,
    first_published TEXT,               -- from the ATS, when available
    first_seen      TEXT NOT NULL,
    last_seen       TEXT NOT NULL,
    state           TEXT NOT NULL,      -- open | likely_down | closed
    missed_runs     INTEGER NOT NULL DEFAULT 0,
    closed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_postings_fingerprint ON postings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_postings_company_state ON postings(company, state);

-- The append-only log. One row per posting per run in which we saw it.
CREATE TABLE IF NOT EXISTS observations (
    run_id   INTEGER NOT NULL,
    key      TEXT NOT NULL,
    seen_at  TEXT NOT NULL,
    PRIMARY KEY (run_id, key)
);

-- Things worth telling a subscriber about.
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     INTEGER NOT NULL,
    key        TEXT NOT NULL,
    type       TEXT NOT NULL,      -- new | edited | likely_down | closed | reposted
    detail     TEXT,
    created_at TEXT NOT NULL,
    sent       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_unsent ON events(sent, type);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    target = path or DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def start_run(conn: sqlite3.Connection, now: str) -> int:
    cursor = conn.execute("INSERT INTO runs (started_at) VALUES (?)", (now,))
    conn.commit()
    return int(cursor.lastrowid)


def finish_run(conn: sqlite3.Connection, run_id: int, now: str) -> None:
    conn.execute("UPDATE runs SET finished_at = ? WHERE id = ?", (now, run_id))
    conn.commit()


def record_source_run(
    conn: sqlite3.Connection,
    run_id: int,
    company: str,
    status: str,
    job_count: int | None = None,
    error: str | None = None,
) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO source_runs (run_id, company, status, job_count, error) "
        "VALUES (?, ?, ?, ?, ?)",
        (run_id, company, status, job_count, error),
    )
    conn.commit()


def recent_good_counts(conn: sqlite3.Connection, company: str, limit: int = 7) -> list[int]:
    """Job counts from this company's last N successful runs.

    Feeds the circuit breaker: a board that suddenly reports far fewer jobs
    than its recent norm is far more likely to be a broken fetch than a mass
    closure, and we refuse to emit closures from such a run.
    """
    rows = conn.execute(
        "SELECT job_count FROM source_runs "
        "WHERE company = ? AND status = 'ok' AND job_count IS NOT NULL "
        "ORDER BY run_id DESC LIMIT ?",
        (company, limit),
    ).fetchall()
    return [int(row["job_count"]) for row in rows]


def add_event(
    conn: sqlite3.Connection, run_id: int, key: str, type_: str, detail: str, now: str
) -> None:
    conn.execute(
        "INSERT INTO events (run_id, key, type, detail, created_at) VALUES (?, ?, ?, ?, ?)",
        (run_id, key, type_, detail, now),
    )


def events_for_run(conn: sqlite3.Connection, run_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT e.*, p.company, p.title, p.location, p.url "
        "FROM events e LEFT JOIN postings p ON p.key = e.key "
        "WHERE e.run_id = ? ORDER BY e.type, p.company, p.title",
        (run_id,),
    ).fetchall()

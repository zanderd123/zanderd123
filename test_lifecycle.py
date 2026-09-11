"""Lifecycle tests:  python3 test_lifecycle.py

Exercises the state machine against synthetic boards, with no network. These
cover the failure modes that would actually damage the product — a false
"your job closed" email is worse than no email at all, so most of these
tests are about *not* firing.
"""

from __future__ import annotations

import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from jobfeed import store
from jobfeed.common import Posting
from jobfeed.lifecycle import days_open, fingerprint, is_suspect, reconcile

DAY = timedelta(days=1)
START = datetime(2026, 8, 1, 6, 0, tzinfo=timezone.utc)

passed = failed = 0


def check(label: str, actual, expected) -> None:
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ {label}\n      expected {expected!r}, got {actual!r}")


def job(job_id: str, title: str, location: str = "Hawthorne, CA", content: str = "x") -> Posting:
    return Posting(
        job_id=job_id, title=title, location=location,
        url=f"https://example.com/{job_id}", content=content,
    )


def fresh():
    tmp = Path(tempfile.mkdtemp()) / "test.db"
    return store.connect(tmp)


def run(conn, day: int, postings, company="Acme Space", suspect=False):
    now = START + day * DAY
    run_id = store.start_run(conn, now.isoformat())
    summary = reconcile(conn, run_id, company, postings, now, suspect=suspect)
    store.record_source_run(
        conn, run_id, company, "suspect" if suspect else "ok", job_count=len(postings)
    )
    return summary


def state_of(conn, key):
    row = conn.execute("SELECT state FROM postings WHERE key = ?", (key,)).fetchone()
    return row["state"] if row else None


print("\nNew postings")
conn = fresh()
s = run(conn, 0, [job("1", "Propulsion Engineer"), job("2", "Avionics Tech")])
check("both reported new", s.new, 2)
s = run(conn, 1, [job("1", "Propulsion Engineer"), job("2", "Avionics Tech")])
check("unchanged postings are silent on day 2", (s.new, s.edited), (0, 0))

print("\nAbsence requires confirmation (Guard 2)")
conn = fresh()
run(conn, 0, [job("1", "Propulsion Engineer"), job("2", "Avionics Tech")])
s = run(conn, 1, [job("1", "Propulsion Engineer")])
check("one miss stays quiet", s.likely_down, 0)
check("state still open after one miss", state_of(conn, "Acme Space::2"), "open")
s = run(conn, 2, [job("1", "Propulsion Engineer")])
check("second consecutive miss fires", s.likely_down, 1)
check("state is likely_down", state_of(conn, "Acme Space::2"), "likely_down")

print("\nConfirmed closure after the grace window")
run(conn, 3, [job("1", "Propulsion Engineer")])
check("still likely_down one day later", state_of(conn, "Acme Space::2"), "likely_down")
run(conn, 13, [job("1", "Propulsion Engineer")])
check("still likely_down at day 13 of 14", state_of(conn, "Acme Space::2"), "likely_down")
run(conn, 17, [job("1", "Propulsion Engineer")])
check("closed once past the window", state_of(conn, "Acme Space::2"), "closed")

print("\nRepost under a fresh requisition ID (Guard 4)")
conn = fresh()
run(conn, 0, [job("100", "Guidance Engineer")])
run(conn, 1, [])
s = run(conn, 2, [])
check("marked likely_down", s.likely_down, 1)
s = run(conn, 5, [job("999", "Guidance Engineer")])
check("same role, new ID → reposted not new", (s.reposted, s.new), (1, 0))

print("\nRepost tolerates cosmetic differences")
conn = fresh()
run(conn, 0, [job("100", "Senior Propulsion Engineer", "Hawthorne, CA")])
run(conn, 1, [])
run(conn, 2, [])
s = run(conn, 4, [job("777", "Senior Propulsion Engineer  (Remote)", "Hawthorne, CA; Remote")])
check("matches despite Remote suffix", s.reposted, 1)

print("\nSame ID returning is also a repost")
conn = fresh()
run(conn, 0, [job("55", "Structures Engineer")])
run(conn, 1, [])
run(conn, 2, [])
check("went down", state_of(conn, "Acme Space::55"), "likely_down")
s = run(conn, 3, [job("55", "Structures Engineer")])
check("same ID back → reposted", s.reposted, 1)
check("state restored to open", state_of(conn, "Acme Space::55"), "open")

print("\nEdits")
conn = fresh()
run(conn, 0, [job("1", "Test Engineer", "Hawthorne, CA", "Original body")])
s = run(conn, 1, [job("1", "Test Engineer", "Hawthorne, CA", "Rewritten body")])
check("body change is an edit", s.edited, 1)
s = run(conn, 2, [job("1", "Test Engineer", "McGregor, TX", "Rewritten body")])
check("location change is an edit", s.edited, 1)
row = conn.execute("SELECT detail FROM events WHERE type='edited' ORDER BY id DESC").fetchone()
check("edit names the location change", "McGregor" in row["detail"], True)

print("\nCircuit breaker (Guard 3)")
conn = fresh()
many = [job(str(i), f"Engineer {i}") for i in range(40)]
for day in range(5):
    run(conn, day, many)
check("40 jobs is not suspect", is_suspect(conn, "Acme Space", 40), False)
check("38 is a normal fluctuation", is_suspect(conn, "Acme Space", 38), False)
check("5 of 40 is suspect", is_suspect(conn, "Acme Space", 5), True)

s = run(conn, 5, many[:3], suspect=True)
check("suspect run emits no closures", s.likely_down, 0)
check("survivors stay open", state_of(conn, "Acme Space::0"), "open")
check("absent postings untouched", state_of(conn, "Acme Space::39"), "open")
check("run is flagged", s.note is not None, True)

print("\nA failed fetch is not an empty board (Guard 1)")
conn = fresh()
run(conn, 0, [job("1", "Flight Software Engineer")])
# run.py skips reconcile() entirely on FetchError, so nothing advances.
check("posting still open after a skipped day", state_of(conn, "Acme Space::1"), "open")
row = conn.execute("SELECT missed_runs FROM postings WHERE key='Acme Space::1'").fetchone()
check("absence counter untouched", row["missed_runs"], 0)

print("\nFingerprints")
check(
    "punctuation and case ignored",
    fingerprint("Acme", "Sr. Engineer, Propulsion", "Hawthorne, CA")
    == fingerprint("acme", "sr engineer propulsion", "hawthorne ca"),
    True,
)
check(
    "different roles stay distinct",
    fingerprint("Acme", "Propulsion Engineer", "Hawthorne, CA")
    != fingerprint("Acme", "Avionics Engineer", "Hawthorne, CA"),
    True,
)

print("\nTime-to-close analytics")
conn = fresh()
run(conn, 0, [job("1", "Payload Engineer")])
run(conn, 30, [])
run(conn, 31, [])
rows = days_open(conn, "Acme Space")
check("one closed posting recorded", rows[0]["closed_postings"], 1)
check("about 31 days open", 29 <= rows[0]["avg_days_open"] <= 32, True)

print(f"\n{'─' * 56}")
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)

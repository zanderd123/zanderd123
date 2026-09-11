"""Adapter tests:  python3 test_adapters.py

Feeds each adapter a recorded-shape response and checks it normalises into
the same `Posting` regardless of vendor. No network — these run anywhere,
including in CI before the real scan.

The awkward cases matter more than the happy path. Vendors change field
shapes without notice, and a crash in an adapter takes a whole board offline
for the day.
"""

from __future__ import annotations

from jobfeed import ashby, common, greenhouse

passed = failed = 0


def check(label: str, actual, expected) -> None:
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ {label}\n      expected {expected!r}, got {actual!r}")


def with_response(module, payload):
    """Run module.fetch against a canned payload instead of the network.

    Patches both the module's own binding and common's, because the adapters
    do `from .common import get_json` and therefore hold their own reference.
    """
    original = common.get_json
    module_original = getattr(module, "get_json", None)
    common.get_json = lambda url: payload
    if module_original is not None:
        module.get_json = lambda url: payload
    try:
        return module.fetch("token")
    finally:
        common.get_json = original
        if module_original is not None:
            module.get_json = module_original


# ── Ashby ────────────────────────────────────────────────────────────────
print("\nAshby")

ashby_payload = {
    "apiVersion": "1",
    "jobs": [
        {
            "id": "abc-123",
            "title": "Orbit Operations Engineer",
            "location": "Hawthorne, CA",
            "secondaryLocations": [{"location": "Denver, CO"}],
            "department": "Engineering",
            "team": "Flight Operations",
            "isListed": True,
            "publishedAt": "2026-04-30T16:21:55.393+00:00",
            "updatedAt": "2026-08-01T10:00:00.000+00:00",
            "jobUrl": "https://jobs.ashbyhq.com/reflect-orbital/abc-123",
            "descriptionHtml": "<p>Fly satellites.</p>",
            "compensation": {"compensationTierSummary": "$150K – $200K"},
        },
        {
            # Unlisted postings are in the feed but not public.
            "id": "hidden-1",
            "title": "Confidential Role",
            "location": "Remote",
            "isListed": False,
        },
        {
            # Minimal record — everything optional is missing.
            "id": "bare-1",
            "title": "Intern",
        },
    ],
}

jobs = with_response(ashby, ashby_payload)
check("unlisted postings excluded", len(jobs), 2)

job = jobs[0]
check("id captured", job.job_id, "abc-123")
check("title captured", job.title, "Orbit Operations Engineer")
check("secondary locations kept", job.location, "Hawthorne, CA; Denver, CO")
check("publishedAt maps to first_published", job.first_published, "2026-04-30T16:21:55.393+00:00")
check("department and team both kept", job.departments, ["Engineering", "Flight Operations"])
check("jobUrl used", job.url, "https://jobs.ashbyhq.com/reflect-orbital/abc-123")
check("compensation extracted", job.compensation, "$150K – $200K")
check("description captured", job.content, "<p>Fly satellites.</p>")

bare = jobs[1]
check("missing fields don't crash", bare.job_id, "bare-1")
check("absent location is empty", bare.location, "")
check("absent compensation is None", bare.compensation, None)

# Ashby has changed location shapes before; be liberal about it.
jobs = with_response(ashby, {"jobs": [
    {"id": "1", "title": "A", "location": {"name": "Austin, TX"}},
    {"id": "2", "title": "B", "secondaryLocations": ["Remote"]},
]})
check("object-shaped location handled", jobs[0].location, "Austin, TX")
check("string-shaped secondary handled", jobs[1].location, "Remote")

jobs = with_response(ashby, {"jobs": [
    {"id": "1", "title": "A", "location": "NYC", "secondaryLocations": [{"location": "NYC"}]},
]})
check("duplicate location not repeated", jobs[0].location, "NYC")

try:
    with_response(ashby, {"error": "nope"})
except common.FetchError:
    check("missing jobs key raises FetchError", True, True)
else:
    check("missing jobs key raises FetchError", False, True)

# ── Greenhouse ───────────────────────────────────────────────────────────
print("\nGreenhouse")

greenhouse_payload = {
    "jobs": [
        {
            "id": 4641142003,
            "title": "Astrodynamics Engineer",
            "location": {"name": "El Segundo, CA"},
            "absolute_url": "https://job-boards.greenhouse.io/vardaspace/jobs/4641142003",
            "updated_at": "2026-08-01T12:00:00-04:00",
            "first_published": "2026-06-15T09:00:00-04:00",
            "requisition_id": "REQ-88",
            "departments": [{"name": "GNC"}],
            "offices": [{"name": "El Segundo"}],
            "content": "<p>Design trajectories.</p>",
        },
        {"id": 999, "title": "Bare Role"},
        {"title": "No ID — must be skipped"},
    ]
}

jobs = with_response(greenhouse, greenhouse_payload)
check("postings without an id are skipped", len(jobs), 2)

job = jobs[0]
check("integer id becomes a string", job.job_id, "4641142003")
check("nested location unwrapped", job.location, "El Segundo, CA")
check("first_published captured", job.first_published, "2026-06-15T09:00:00-04:00")
check("requisition id captured", job.requisition_id, "REQ-88")
check("departments unwrapped", job.departments, ["GNC"])
check("offices unwrapped", job.offices, ["El Segundo"])
check("absolute_url used", job.url, "https://job-boards.greenhouse.io/vardaspace/jobs/4641142003")

check("bare record survives", jobs[1].location, "")

# ── Cross-vendor ─────────────────────────────────────────────────────────
print("\nBoth adapters produce the same shape")

a = with_response(ashby, {"jobs": [{"id": "x", "title": "Engineer", "location": "Denver, CO"}]})[0]
g = with_response(greenhouse, {"jobs": [{"id": 1, "title": "Engineer",
                                         "location": {"name": "Denver, CO"}}]})[0]
check("same type", type(a), type(g))
check("same title", a.title, g.title)
check("same location", a.location, g.location)
check("both expose FetchError", ashby.FetchError is greenhouse.FetchError, True)

# A company migrating between ATS platforms must not read as a mass closure
# followed by a mass reopening, so the fingerprints have to agree.
from jobfeed.lifecycle import fingerprint
check(
    "same role fingerprints identically across vendors",
    fingerprint("Acme", a.title, a.location) == fingerprint("Acme", g.title, g.location),
    True,
)

print("\ntext_of tolerates junk")
check("None", common.text_of(None), "")
check("plain string", common.text_of(" Austin "), "Austin")
check("name key", common.text_of({"name": "Austin"}), "Austin")
check("location key", common.text_of({"location": "Austin"}), "Austin")
check("unknown shape", common.text_of(42), "")

print(f"\n{'─' * 56}")
print(f"{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)

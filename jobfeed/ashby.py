"""Ashby job board adapter.

Like Greenhouse, Ashby publishes a free public endpoint with no auth:

    GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true

Two things Ashby gives us that Greenhouse's list endpoint does not:

  * `publishedAt` on every posting, so time-open is accurate from day one
    without waiting for our own history to build.
  * Salary ranges inline when `includeCompensation=true`, which Greenhouse
    only exposes via a per-job follow-up call.

Ashby tokens are usually hyphenated (`reflect-orbital`) where Greenhouse
tokens are usually squashed (`vardaspace`).
"""

from __future__ import annotations

from .common import FetchError, Posting, get_json, text_of

BASE = "https://api.ashbyhq.com/posting-api/job-board"

__all__ = ["FetchError", "fetch"]


def _locations(job: dict) -> str:
    """Primary location plus any secondaries, as one display string.

    Ashby splits these across `location` and `secondaryLocations`, and a role
    open in three cities matters to someone filtering by location — so we
    keep them all rather than dropping to the primary.
    """
    parts = [text_of(job.get("location"))]
    for secondary in job.get("secondaryLocations") or []:
        # Observed as [{"location": "Denver, CO"}], but tolerate bare strings.
        text = text_of(secondary)
        if text and text not in parts:
            parts.append(text)
    return "; ".join(p for p in parts if p)


def _compensation(job: dict) -> str | None:
    comp = job.get("compensation")
    if not isinstance(comp, dict):
        return None
    for key in ("compensationTierSummary", "scrapeableCompensationSalarySummary"):
        value = comp.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def fetch(token: str, region: str = "us") -> list[Posting]:
    """Return every listed posting on an Ashby board.

    `region` is accepted for interface parity with the Greenhouse adapter and
    ignored — Ashby serves every board from one host.
    """
    payload = get_json(f"{BASE}/{token}?includeCompensation=true")

    jobs = payload.get("jobs")
    if jobs is None:
        raise FetchError("response had no 'jobs' key")

    postings = []
    for job in jobs:
        job_id = job.get("id")
        if job_id is None:
            continue  # nothing stable to key on; skip rather than invent one

        # Ashby keeps unlisted postings in the feed. They are not public, so
        # treating them as open roles would mean emailing people about jobs
        # they cannot see or apply to.
        if job.get("isListed") is False:
            continue

        department = text_of(job.get("department"))
        team = text_of(job.get("team"))

        postings.append(
            Posting(
                job_id=str(job_id),
                title=(job.get("title") or "").strip(),
                location=_locations(job),
                url=job.get("jobUrl") or job.get("applyUrl") or "",
                updated_at=job.get("updatedAt"),
                first_published=job.get("publishedAt"),
                departments=[d for d in (department, team) if d],
                content=job.get("descriptionHtml") or job.get("descriptionPlain") or "",
                compensation=_compensation(job),
            )
        )
    return postings

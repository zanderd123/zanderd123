"""Greenhouse Job Board API adapter.

The Job Board API is public and needs no authentication or API key:

    GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true

`content=true` returns the full description, departments and offices in the
same call, so one request per company gets everything the digest needs.

Companies on Greenhouse's European instance use a different host; set
`region = "eu"` on the source to reach it.
"""

from __future__ import annotations

from .common import FetchError, Posting, get_json, text_of

US_HOST = "https://boards-api.greenhouse.io"
EU_HOST = "https://boards-api.eu.greenhouse.io"

__all__ = ["FetchError", "fetch", "fetch_detail"]


def _host(region: str) -> str:
    return EU_HOST if region == "eu" else US_HOST


def fetch(token: str, region: str = "us") -> list[Posting]:
    """Return every published posting on a Greenhouse board.

    Raises FetchError if the board could not be read. Returns an empty list
    only when the board genuinely has no open roles.
    """
    payload = get_json(f"{_host(region)}/v1/boards/{token}/jobs?content=true")

    jobs = payload.get("jobs")
    if jobs is None:
        raise FetchError("response had no 'jobs' key")

    postings = []
    for job in jobs:
        job_id = job.get("id")
        if job_id is None:
            continue  # nothing stable to key on; skip rather than guess
        postings.append(
            Posting(
                job_id=str(job_id),
                title=(job.get("title") or "").strip(),
                location=text_of(job.get("location")),
                url=job.get("absolute_url") or "",
                updated_at=job.get("updated_at"),
                first_published=job.get("first_published"),
                requisition_id=job.get("requisition_id"),
                departments=[
                    text_of(d) for d in job.get("departments") or [] if text_of(d)
                ],
                offices=[text_of(o) for o in job.get("offices") or [] if text_of(o)],
                content=job.get("content") or "",
            )
        )
    return postings


def fetch_detail(token: str, job_id: str, region: str = "us") -> dict:
    """Fetch one posting's detail record.

    Worth calling sparingly for postings we care about: the single-job
    endpoint exposes `first_published` and, with pay_transparency=true,
    salary ranges — neither of which the list endpoint reliably includes.
    """
    return get_json(
        f"{_host(region)}/v1/boards/{token}/jobs/{job_id}?pay_transparency=true"
    )

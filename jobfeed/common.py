"""Shared pieces every ATS adapter uses.

Each adapter's job is to turn one vendor's JSON into a list of `Posting`.
Everything downstream — the lifecycle engine, the store, the digest — only
ever sees `Posting`, so adding an ATS never touches anything but a new module
and one line in run.py.
"""

from __future__ import annotations

import gzip
import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field

# Identify ourselves honestly and give boards a way to reach us. Politeness
# here is also self-interest: an anonymous hammering client gets blocked.
USER_AGENT = "SpaceJobsDigest/0.1 (+daily job alerts; contact: hello@example.com)"

TIMEOUT = 30


class FetchError(Exception):
    """Raised when a board could not be read.

    This must never be swallowed into an empty job list. An empty list means
    "this company has no open roles"; a FetchError means "we don't know". The
    lifecycle engine treats those two things completely differently, and
    conflating them is what produces false "your job closed" emails.
    """


@dataclass
class Posting:
    """One job posting, normalised away from any vendor's field names."""

    job_id: str
    title: str
    location: str
    url: str
    updated_at: str | None = None
    first_published: str | None = None
    requisition_id: str | None = None
    departments: list[str] = field(default_factory=list)
    offices: list[str] = field(default_factory=list)
    content: str = ""
    compensation: str | None = None


def get_json(url: str) -> dict:
    """GET a URL and parse JSON, raising FetchError on any failure."""
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            if response.status != 200:
                raise FetchError(f"HTTP {response.status}")
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
    except urllib.error.HTTPError as exc:
        # 404 almost always means a wrong board token, which is the single
        # most common setup mistake, so say so rather than just the code.
        hint = " (check the token in sources.toml)" if exc.code == 404 else ""
        raise FetchError(f"HTTP {exc.code}{hint}") from exc
    except urllib.error.URLError as exc:
        raise FetchError(f"network error: {exc.reason}") from exc
    except TimeoutError as exc:
        raise FetchError("timed out") from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise FetchError("board returned something that wasn't JSON") from exc


def text_of(value) -> str:
    """Pull a display string out of a field that might be text or an object.

    Vendors are inconsistent about whether a location is `"Denver, CO"` or
    `{"name": "Denver, CO"}` or `{"location": ...}`, and they change it
    without notice. Being liberal here costs nothing and prevents a schema
    tweak from taking a board offline.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ("name", "location", "locationName", "title", "label"):
            if isinstance(value.get(key), str):
                return value[key].strip()
    return ""

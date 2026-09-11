"""Token checker:  python3 -m jobfeed.check

Tests every company in sources.toml (including disabled ones) and tells you
which board tokens are real. Run this after adding companies — it is the
fastest way to find a typo'd token, and it touches no data.
"""

from __future__ import annotations

import time
import tomllib

from . import ashby, greenhouse
from .run import CONFIG

ADAPTERS = {"greenhouse": greenhouse, "ashby": ashby}


def main() -> int:
    with CONFIG.open("rb") as handle:
        sources = tomllib.load(handle).get("source", [])

    if not sources:
        print("No companies listed in sources.toml.")
        return 0

    working, bad_token, unreachable = [], [], []
    print(f"Checking {len(sources)} board tokens…\n")

    for source in sources:
        company = source.get("company") or source.get("token", "?")
        token = source.get("token", "")
        adapter = ADAPTERS.get(source.get("ats", "greenhouse"))
        state = "" if source.get("enabled", True) else "  (currently off)"

        if adapter is None or not token:
            print(f"  ✗  {company}: missing token or unsupported ats")
            bad_token.append(company)
            continue

        try:
            postings = adapter.fetch(token, region=source.get("region", "us"))
        except adapter.FetchError as exc:
            # Distinguish "this token is wrong" from "we never reached the
            # board at all". Telling someone to fix a token when their network
            # is down sends them chasing the wrong problem.
            message = str(exc)
            if "network error" in message or "timed out" in message:
                unreachable.append(company)
            else:
                bad_token.append(company)
            print(f"  ✗  {company}  [{token}]: {message}")
        else:
            print(f"  ✓  {company}  [{token}]: {len(postings)} open roles{state}")
            working.append(company)
        time.sleep(0.5)

    print(f"\n{'─' * 56}")
    print(f"{len(working)} working · {len(bad_token)} bad token · {len(unreachable)} unreachable")

    if unreachable and not working:
        print("\nNothing was reachable, so this says nothing about your tokens.")
        print("Every request failed before it got to the job board — check your")
        print("internet connection, VPN, or corporate proxy and run this again.")
    elif unreachable:
        print(f"\n{len(unreachable)} board(s) could not be reached. That is usually a")
        print("temporary network problem rather than a bad token — try again later.")

    if bad_token:
        print("\nFor each bad token: open the company's careers page, click any job,")
        print("and read the token out of the URL. Then fix it in sources.toml.")
        print("If the company simply isn't on that ATS, delete the entry.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

# Space Jobs — daily board scanner

Watches space-industry career pages every morning, records what changed, and
builds the history behind the closed-job and repost alerts.

Supports **Greenhouse** and **Ashby** boards — both free public APIs, no key
and no login.

You do not need to write code to run this. There is **one file you edit**
(`sources.toml`, the company list) and **two commands you type**.

---

## What it does each morning

1. Reads the company list in `sources.toml`.
2. Fetches every board through the company's ATS API.
3. Compares today against yesterday and records what changed.
4. Prints a summary of new, edited, closed and reposted roles.

Every posting it has ever seen is kept in `data/jobs.db`, with the date it
first appeared and the date it came down. **That history is the product** —
it's what nobody launching later can go back and recreate.

---

## The two commands

Check that your company list works — run this after adding a company:

```
python3 -m jobfeed.check
```

```
Checking 19 board tokens…

  ✓  SpaceX  [spacex]: 312 open roles
  ✓  Varda Space Industries  [vardaspace]: 18 open roles
  ✓  Reflect Orbital  [reflect-orbital]: 7 open roles
  ✗  Firefly Aerospace  [fireflyaerospace]: HTTP 404 (check the token in sources.toml)

────────────────────────────────────────────────────────
18 working · 1 bad token · 0 unreachable
```

Do the daily scan:

```
python3 -m jobfeed.run
```

```
Run 42 — 2026-09-11 11:00 UTC — 11 companies

  ✓ SpaceX: 312 open — 4 new, 1 likely down
  ✓ Varda Space Industries: 18 open — 1 reposted
  ✗ Stoke Space: timed out

────────────────────────────────────────────────────────
Tracking 604 open postings across 10 boards
  4 new · 1 likely down · 1 reposted
  1 board(s) unreachable — states left untouched
```

---

## Adding a company

Open `sources.toml` and copy an existing block:

```toml
[[source]]
company = "Firefly Aerospace"
ats = "greenhouse"
token = "fireflyaerospace"
```

**Finding the token.** Open the company's careers page and click any job. If
the address bar shows `job-boards.greenhouse.io/vardaspace/jobs/4641142003`,
the token is `vardaspace`.

**Checking it before you commit.** Paste this into a browser, swapping in the
token. A wall of text means it works; an error page means the token is wrong:

```
https://boards-api.greenhouse.io/v1/boards/vardaspace/jobs
```

**Ashby works the same way** — set `ats = "ashby"`. Ashby tokens usually have
hyphens (`reflect-orbital`) where Greenhouse squashes words together
(`vardaspace`). Check one like this:

```
https://api.ashbyhq.com/posting-api/job-board/reflect-orbital
```

Or just run `python3 -m jobfeed.check`, which tests every token at once.

If a careers page URL says `lever` or `myworkdayjobs`, that company needs an
adapter that doesn't exist yet — leave a note and it can be added.

---

## Reading the output

| Marker | Meaning |
|---|---|
| `✓` | Board read successfully |
| `⚠` | Read, but the job count dropped sharply — closures suppressed for safety |
| `✗` | Could not read the board. **Nothing was changed for that company.** |

A `✗` is not an emergency. Boards have outages, and the scanner is built so
that a failed read never looks like a closure. If the same company fails for
several days running, its token has probably changed.

---

## What counts as an event

| Event | When it fires | Email? |
|---|---|---|
| `new` | A posting appears for the first time | Yes — the daily digest |
| `edited` | Title, location or description changed | Only if material |
| `likely_down` | Gone from the board for 2 consecutive good scans | Yes — worded as uncertain |
| `closed` | Gone 14+ days with no repost | No — feeds the analytics |
| `reposted` | The same role is back, under any listing ID | **Yes — highest value** |

The wording matters on `likely_down`. The scanner knows a posting came down;
it cannot know the job was filled. Emails say *"this came down on Tuesday and
we're still watching for a repost"* — which is both true and more useful.

---

## Why a posting vanishing isn't the same as a job closing

Four things cause a posting to disappear, and only one is "they hired
someone": a cancelled requisition, a repost under a fresh ID, a board outage,
or an actual close. Emailing *"the job you applied for is closed"* when it was
really a timeout destroys the trust the whole product depends on.

So five rules are built in:

1. **A failed fetch records nothing.** Only a successful read counts as
   evidence. Timeouts leave every posting exactly as it was.
2. **Two consecutive misses** before anything is said. One is noise.
3. **Sharp drops are treated as broken.** If a board reports under 60% of its
   recent typical count, closures are suppressed for that run. Boards don't
   lose half their postings overnight; scrapers do.
4. **Roles are matched by name, not ID.** Reposting under a new requisition
   ID is routine, and ID-matching would read it as a close plus an unrelated
   opening — losing the best signal there is.
5. **Only observations are claimed**, never conclusions.

### Known limitation: a board that legitimately empties

Rule 3 has a blind spot. If a company genuinely closes every open role, its
board drops to zero and *stays* there — so every subsequent scan looks
"suspect", and closures are suppressed indefinitely. Subscribers never learn
those roles came down, which is exactly the case the product exists to serve.

It needs the circuit breaker to give up after a few consecutive suspect runs
with a consistently low count, and accept the new number as real. Not yet
implemented; the safe failure (saying nothing) was preferred to the unsafe one
(false closures) until the threshold is chosen deliberately.

---

## Running it automatically

`.github/workflows/daily.yml` runs the scan every morning at 11:00 UTC, free,
whether or not your computer is on. It runs the tests first, saves the
database back to the repository, and emails you if anything fails.

You can also trigger it by hand: **Actions → Daily job scan → Run workflow**.

---

## Files

| File | What it is |
|---|---|
| `sources.toml` | **The company list — the only file you edit** |
| `data/jobs.db` | Every posting ever seen, and when |
| `jobfeed/common.py` | Shared HTTP and the `Posting` shape |
| `jobfeed/greenhouse.py` | Talks to Greenhouse's API |
| `jobfeed/ashby.py` | Talks to Ashby's API |
| `jobfeed/store.py` | Database structure |
| `jobfeed/lifecycle.py` | Decides new / edited / down / reposted |
| `jobfeed/run.py` | The daily scan |
| `jobfeed/check.py` | Token checker |
| `test_lifecycle.py` | 31 state-machine tests |
| `test_adapters.py` | 35 adapter tests |

No installation and no dependencies — Python 3.11 or newer is all it needs.

---

## A note on being a good citizen

The scanner identifies itself, waits a second between boards, and reads only
public data through the APIs these vendors publish for that purpose. Digests
link to postings rather than reproducing them. Please keep it that way — it
is both the right thing and the reason this stays low-risk.

The contact address in `jobfeed/common.py` is currently a placeholder.
Change it to a real inbox before running this at any scale.

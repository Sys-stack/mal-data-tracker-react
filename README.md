# FAL Tracker

A tracker + simulator for **MyAnimeList's Fantasy Anime League**: hourly growth
stats from the MAL API, tunable log-curve growth predictions with a live
chart, drafting, and a season planner that simulates real FAL scoring
(Watching/Completed points, Score/Dropped/Favorites weeks, Aces with the
members cap, swaps, wildcards).

Rules referenced: [fal.myanimelist.net/rules](https://fal.myanimelist.net) —
if MAL changes point values or thresholds for a new season, update the
constants in `MAaCS/scoring.py` and `ACE_THRESHOLD` in `.env`.

## Stack

- **Frontend**: React (Vite), React Router, Recharts, Tailwind. A single-page
  app — navigating between Dashboard/Browse/Predictor/Teams/Planner never
  reloads the page, and the Predictor's chart re-renders **instantly** as you
  drag its sliders (pure client-side math, no server round trip).
- **Backend**: Flask, but JSON API only now — no server-rendered pages. Its
  only other job is serving the built React app.
- **Storage**: SQLite (`fal_local.db`) is the fast request-time cache. A
  complete copy of its catalog, predictions, teams, and planner data is
  atomically mirrored to Supabase/Postgres after every write and restored on
  a fresh instance. Growth snapshots also live in Supabase/Postgres.

## Running it

**You do not need Node.js to just run the app** — the React build is already
compiled into `static_dist/` in this zip.

1. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```
2. Copy `.env.example` to `.env` and fill in your MAL client ID and Supabase/Postgres connection info. `DATABASE_URL` (the standard web-host variable) or the existing `DB_*` variables both work.
3. Run:
   ```
   python app.py
   ```
   Visit `http://127.0.0.1:5000` — Flask serves the React app and the API from the same port, so there's nothing else to start.

### Editing the frontend

If you change anything in `frontend/src/`, you need Node.js to rebuild:
```
cd frontend
npm install
npm run build      # outputs to ../static_dist, which Flask serves
```
For active development with hot-reload instead, run the Vite dev server
(`npm run dev`, port 5173) alongside `python app.py` (port 5000) in another
terminal — `vite.config.js` already proxies `/api` to Flask, so both talk to
the same backend.

## Pages

- **Dashboard** (`/`) — tracked shows with their latest hourly snapshot, genres, status, rank, and popularity.
- **Browse** (`/browse`) — pull a season's full TV lineup from MAL (cover art included) and toggle hourly tracking per show.
- **Anime dashboard** (`/anime/:id`) — a full profile for one show: cover art, genres, episodes, source, rating, broadcast time, MAL's created/updated dates, synopsis, which team(s) drafted it, and a growth chart (including rank/popularity) with metric toggles and a date-range slider.
- **Predictor** (`/predictor`) — NotebookLM-style three-pane layout: pick any catalog show from **Sources** on the left, shape its log curve with two sliders (each pairable with a direct number input) in the **workspace** — chart updates live, no lag — see its status in the **Studio** panel on the right, and **Set** to lock it in.
- **Team Draft** (`/teams`) — draft a 5-active/3-bench roster via a searchable picker, and overlay every roster show's *set* prediction curves to compare before you commit.
- **Planner** (`/planner/:teamId`) — schedule swaps, one Ace per anime, and your one-time wildcard by week.
- **Simulator** (`/planner/:teamId/simulate`) — run the season: summary cards, a running-total chart, a per-anime season statistics table, and an expandable week-by-week point rundown.

## The prediction model

`value = baseline + a · ln(1 + b · week)`

- **baseline** — the show's current value (week 0 anchor)
- **a** (scale slider) — how much the metric grows overall
- **b** (rate slider) — how quickly growth front-loads vs. stretches out

The same formula is implemented twice on purpose: once in `MAaCS/predictor.py`
(Python, used for auto-fit and by the Planner's simulation) and once in
`frontend/src/lib/curve.js` (JS, used to redraw the chart on every slider
tick without a network call). Auto-fit does a small grid search over `b`
with a closed-form least-squares solve for `(a, baseline)` at each candidate
— numpy only, no scipy needed.

**Set** vs. unset: moving sliders alone doesn't affect anything else. Only a
**Set** prediction is used by the Team Draft comparison chart and the
Planner's weekly scoring — so you can experiment freely before committing to
a number with real (simulated) consequences.

## FAL rules actually simulated

| Component | Rule |
|---|---|
| Watching/Completed | 0.5 pts/member every week; +0.25 pts/member extra on weeks 2,4,6,8,10,12 |
| Score | weeks 3,7,10,13: `17,500 × (score − 6.00)`, doubled (35,000) on week 13 |
| Dropped | weeks 4,8,11,13: `−4 × dropped` users, doubled (−8) on week 13 |
| Favorites | weeks 5,9,12,13: `15 × favorites`, doubled (30) on week 13 |
| Ace | +75,000 if the show's predicted Watching+Completed stays under the members **cap** *and* it's your top scorer that week; otherwise −5,000 |
| Swaps | 4 free per season; the Extra Swap wildcard grants a 5th |
| Wildcards | one-time, from week 10: Booster (+10,000), Extra Swap (−5,000, +1 swap), Bomber Up/Down (−5,000 self, −20,000 to a chosen team) |

**Not simulated:** Episode Discussion points — that component is scored from
MAL forum post counts, which this app has no data source for. Left out
rather than faked, and called out on the Planner page. These constants live
in `MAaCS/scoring.py` and are served to the frontend via `GET /api/config`
so they're defined in exactly one place.

## Hourly sync via GitHub Action

`.github/workflows/hourly_sync.yaml` runs `scripts/run_sync.py` on a
`0 * * * *` cron, plus a manual `workflow_dispatch` trigger. Add these to
your repo settings:

- **Secrets:** `MAL_CLIENT_ID`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `SUPABASE_URL`, `SUPABASE_KEY`
- **Variables:** `TRACK_SEASON`, `TRACK_YEAR`, `TRACK_IDS`

The Action restores the Supabase backup before syncing, so changes made in
the hosted app — including "Track hourly" toggles — are available to the
next runner. `TRACK_IDS` remains useful for the very first run, before a
backup exists.

### Durable hosting and configuration

Use the same variable names in a local `.env`, GitHub Secrets, or your web
service's environment-variable settings. Credentials should be Secrets on
GitHub; the workflow also accepts repository Variables if that is how the
repository is configured. `DATABASE_URL` / `SUPABASE_DB_URL` / `POSTGRES_URL`
is accepted, as are the individual `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, and `DB_NAME` values. The application restores `fal_local.db`
from Supabase at startup when its local cache is empty, uploads after every
successful local write, and makes one last best-effort upload during a
graceful shutdown. An abrupt host kill is still safe because writes have
already been mirrored.

## What changed since the last version

- **Weekly rundown + per-anime statistics, on their own Simulator page.** The season simulator is no longer buried at the bottom of the Planner — it's now `/planner/:teamId/simulate`, with an expandable per-week breakdown (each active show's Watching/Score/Dropped/Favorites points, not just a team total) and a per-anime season statistics table (total points, weeks active, component totals, Ace outcomes).
- **Fixed unrealistically small predictor ranges.** Member-style metrics (watching, completed, members, favorites, ...) now default to sliders that comfortably reach six figures, matching how large a popular show's numbers can actually get — previously they capped out in the low thousands. This is also why simulated totals could swing negative before: a "score" prediction with no history defaulted to a baseline of 0, which is nonsensical for a 0-10 scale and produced large, wrong negative Score-week penalties. Score predictions now default near a realistic 6-7 range.
- **Slider values can now also be typed directly** — every slider in the Predictor has a paired number input; typing a value outside the current range expands the slider to fit rather than clamping silently.
- **Searchable draft picker.** Drafting used to mean scrolling one long `<select>`; the Team Draft page now has a search box + thumbnail list with one-click "→ Active" / "→ Bench" buttons, and the whole page got a layout pass (clearer sections, roster counts, collapsible draft/compare panels).
- **Richer MAL data, end to end.** Genres, status, episode count, source, rating, broadcast day/time, MAL's own created/updated timestamps, synopsis, rank, and popularity are now fetched, stored, and surfaced — as chips on the Dashboard, and in full on each show's page.
- **Every tracked anime now has a full profile page** (`/anime/:id`): cover art, all the metadata above, latest rank/popularity/score/members, which team(s) it's drafted to, and the growth chart (now with rank and popularity as togglable series too).
# mal-data-tracker-react

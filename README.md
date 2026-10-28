# LoMeta

LoMeta is a Pokémon TCG metagame comparison site focused on the 2027 season. Its home page shows the overall top 25 decks and selectable matchups; `/trends` compares Regional and Special Event trends; `/japan` shows Japan City League placements; `/rankings` lists every ranked deck from those major events. `/overall` redirects to the home page. The previous `pokemon-analyze` application was consulted only for source discovery.

## Git branch for every machine

`master` is the GitHub default branch and the source used for the Raspberry Pi deployment. Use `git switch master` and `git pull --ff-only origin master` in existing checkouts; new clones select it automatically. The old `main` branch is retained for existing checkouts, but new work should go to `master`. The Pi checks GitHub `master` every two minutes with `deploy/lometa-auto-deploy.timer` and rebuilds the Compose services when it finds a new commit. It requires a clean Pi checkout, checks the local HTTP response, and restores the prior commit and containers if the release fails. The failed commit is skipped until `master` changes again. Logs are available with `journalctl -u lometa-auto-deploy.service`.

```bash
cd /home/ealtenho/lometa
git pull --ff-only origin master
sudo docker compose up -d --build
```

## Japan City League (local only)

The Japan City League pipeline is separate from all existing Regional and international calculations. Its SQLite tables use the `jp_` prefix. The `/japan` page reads local SQLite on the Next.js/Pi path. The Sites-style local preview uses a generated snapshot from that same database because its worker cannot open native SQLite. Neither path adds Japan results to the Regional dashboards.

The live HTML adapter reads the public [City League listing](https://www.limitlesstcg.com/tournaments/jp) and its event pages with bounded pagination, pacing, and retries. The importer preserves source IDs, Japanese player/shop values, Pokémon icon identifiers, unknown archetypes, and decklist links. It tracks classification and decklist coverage separately, records source revisions, and refuses to overwrite an event with fewer placements unless the caller explicitly allows it. A decklist link is not counted as parsed card content.

The local database defaults to `.data/japan.sqlite`; set `JP_DB_PATH` to another writable file path when needed. Migrations under `drizzle/` are applied when the importer opens the database. The database file is ignored by Git. The Docker deployment stores it in the shared `japan-data` volume so the web and scheduler containers use the same persistent database.

```bash
pnpm japan:test
pnpm japan:import-fixture test/fixtures/japan/index.html test/fixtures/japan/event.html 5062
pnpm japan:sync --pages 1 --max-events 10
pnpm japan:sync:scheduler -- --once
```

The Pi sync scans up to ten listing pages and imports at most 100 due events per daily run. Requests are paced, and already checked events are revisited according to the refresh policy. The generated `lib/japan/preview-overview.json` is a preview snapshot, not the Pi database. The [Play Limitless API](https://docs.limitlesstcg.com/developer) documents a different tournament platform and is not used as a City League feed.

The Japan blade ranks archetypes by placement points across imported standings: 1st = 8, 2nd = 6, 3rd–4th = 4, 5th–8th = 2, and 9th–16th = 1. It shows first-place and Top 8 counts plus share of classified Top 8 appearances. These are not match win rates or conversion rates because the full entrant field is unknown. Each archetype's external deck link is its most recent available first-place list; a newer lower placement adds points but does not replace that link. Individual imported events are not displayed on the page.

The Japan page defaults to the last 30 calendar days in the `America/New_York` time zone, inclusive of today. Visitors can select 7 days, 30 days, 90 days, all imported dates, or a custom start and end date. The event sample, placement scores, Top 8 share, leader, and latest first-place decklist links are all recomputed within the selected period. The preview snapshot stores the minimal event and classified-placement rows needed for this filtering; the Pi path reads the same rows directly from SQLite.

### Automated Japan updates

Limitless does not send Play Limitless webhooks for main-site Japan City League results, so the Pi deployment uses a dedicated `japan-sync` container instead. It runs once at startup and then every day at 11:00 AM `America/New_York`, following daylight-saving changes. The existing refresh policy selectively revisits recent or incomplete events, ingestion runs and source revisions remain recorded in SQLite, and failures are visible in `docker compose logs japan-sync`.

The schedule is configurable in the untracked `.env` file:

```dotenv
JP_SYNC_TIME_ZONE=America/New_York
JP_SYNC_HOUR=11
JP_SYNC_MINUTE=0
JP_SYNC_PAGES=10
JP_SYNC_MAX_EVENTS=100
```

Keep the defaults for normal operation. To run an immediate manual refresh on the Pi, use `docker compose run --rm japan-sync node scripts/japan-sync-scheduler.mjs --once`.

### Automated major-event updates

The `season-sync` Pi container checks the Limitless Labs listing every six hours, including at startup. It looks only for 2027-season Regional Championships and Special Events. After an event's listed end date, it checks that the Labs deck and Day 2 conversion pages contain usable rows before adding the event to `/data/season-events.json`. Recent events are checked again for the first week; the web app reads current Labs figures with a 30-minute cache in memory and on the shared data volume. An incomplete event, failed fetch, or malformed listing does not replace the existing catalog. The catalog shares the persistent Docker volume with Japan data, while the original five events remain a fallback for a fresh installation and local preview.

```bash
docker compose logs --tail=100 season-sync
docker compose run --rm season-sync node scripts/season-sync-scheduler.mjs --once
```

Set `SEASON_SYNC_INTERVAL_HOURS` in the untracked `.env` to change the listing-check interval (1–168 hours). The season boundary is currently September 2026 through August 2027; advancing it for the next season remains a code change. The job also tries to link a new Labs event to the main Limitless tournament page by type, city, country, nearby date, and a verified Labs standings link. If the main-site event has not appeared or cannot be matched uniquely, its metagame, rankings, matchups, and trends still appear; card-average comparisons show an unavailable message until a later sync finds the link. The Play Limitless `tournament:ended` webhook is for its separate tournament platform and is not used for Labs discovery. On the Pi, parsed season and matchup results are stored in `/data/season-cache` so a container restart can serve the last good results immediately. Entries refresh after 30 minutes and are kept for at most 24 hours if Limitless is unavailable.

## 2027 season views

The initial season set contains Baltimore, Brisbane, Frankfurt, Recife, and Louisville. The trends view selects the latest three events by default and compares the first and last selected events. Both endpoint sliders can be moved to compare specific events; selecting the same event on both endpoints shows its metadata instead. Geography filters cover all events, US, Europe, South America, Oceania, and other locations.

Share trends use percentage point changes in player share. One slider selects the top 5 to top 35 decks by full-season share (top 15 by default) for both share and win-rate trend lists. Win rate trends use percentage point changes in Labs' tie-adjusted win rate, requiring at least 20 recorded matches at both events. Generic `Other`/`Unknown` classifications are excluded from those trend lists. The card-construction dropdown independently offers the top 40 named meta decks in the selected geography. It shows the five largest increases and decreases in average copies per published decklist for a selected archetype across the two endpoint Regionals. It requires at least 5 published lists at each event and a change of at least 0.10 copies per list; exact set/number printings are compared.

The overall view ranks decks by total player count across the selected geography. Share, win rate, and Day 2 conversion are recomputed from summed counts rather than averaging event percentages. The main table shows the top 25 decks with favorable–neutral–unfavorable matchup counts against the selected top 10, 15, 20, or 25 opposing decks (top 25 by default). A smaller Full matchup button opens the opponent table for the same selection, with W–L–T records, win rates, and result categories. The five most-played matchups appear first, with See more for the rest. Category and opposing-deck dropdowns select the matchup to inspect. A matchup is favorable at 55% or above, unfavorable at 45% or below, and neutral between those cutoffs. Mirror matches are omitted. The full ranking page uses the same geographic filters and adds deck-name search.

## Connected sources

| Source | Integration | Intended use |
| --- | --- | --- |
| Play Limitless | Supported JSON API at `https://play.limitlesstcg.com/api` | Online tournaments, details, standings/decklists, and pairings |
| Limitless main site | Server-side HTML adapter for `/decks` | Overall metagame points and share |
| Limitless Labs | Server-side HTML adapter | Major-event discovery and future standings, conversion, and matchup analysis |
| Limitless main-site tournament Cards pages | Server-side HTML adapter | Published archetype-level average card counts for Regional-to-Regional comparisons |

The HTML integrations are deliberately isolated in `lib/limitless/overall-meta.ts` and `lib/limitless/labs.ts`. If those public pages change, their parsers can be updated without changing the rest of the application.

## Local API routes

- `GET /api/sources/health`
- `GET /api/tournaments?game=PTCG&format=STANDARD&limit=50&page=1`
- `GET /api/tournaments/:id/details`
- `GET /api/tournaments/:id/standings`
- `GET /api/tournaments/:id/pairings`
- `GET /api/meta/overall?time=1months&variants=split&limit=50`
- `GET /api/labs/events`
- `GET /api/season/matchups?deck=dragapult-ex&geography=all&opponents=25` (`opponents` accepts 10, 15, 20, or 25; defaults to 25)
- `GET /api/season/cards?from=0074&to=0076&deck=dragapult-ex`

All upstream calls happen on the server. This avoids browser CORS limitations and keeps an optional API key out of client code.

## Optional API key

Most Play Limitless tournament endpoints do not require a key. Copy `.env.example` to `.env.local` and set `LIMITLESS_API_KEY` only if access to a protected endpoint, such as deck-classification rules, is approved.

## Development

```bash
pnpm install
pnpm dev
```

The current `pnpm build` script creates the Sites preview build. The Raspberry Pi deployment uses a standard Next.js standalone build instead.

## Raspberry Pi Docker deployment

The Docker path is designed for a 64-bit Raspberry Pi OS (arm64). It builds a standalone Node.js server from the same app source; it does not require ChatGPT Sites or a Cloudflare worker at runtime.

Copy this project directory to the Pi, then run:

```bash
docker compose up -d --build
docker compose logs -f lometa
```

The Compose example binds port 3000 to `127.0.0.1` on the Pi, so a reverse proxy on that host can reach `http://127.0.0.1:3000` without exposing the app directly to the network. To allow direct LAN access instead, change the port mapping in `compose.yaml` to `"3000:3000"`, then visit `http://<pi-address>:3000`. Do not expose that port directly to the public internet without your intended access controls and TLS proxy.

An API key is optional. If needed, place `LIMITLESS_API_KEY=...` in an untracked `.env` next to `compose.yaml` on the Pi; Docker Compose will pass it to the container. Both containers need outbound HTTPS access to Limitless for live data. The `japan-sync` service starts immediately and refreshes the shared database daily by default.

The Raspberry Pi runs the production Docker deployment. The deployment timer handles new commits pushed to GitHub `master`; `docker compose up -d --build` remains available for a manual rebuild on the Pi.

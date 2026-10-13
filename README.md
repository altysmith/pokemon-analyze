# LoMeta

LoMeta is a Pokémon TCG metagame comparison site focused on the 2027 season. Its home page compares Regional trends; `/overall` shows the top 15 decks and selectable matchups inside the main table; `/rankings` lists every ranked deck. The previous `pokemon-analyze` application was consulted only for source discovery.

## 2027 season views

The current season set contains Baltimore, Brisbane, Frankfurt, Recife, and Louisville. The trends view selects the latest three Regionals by default and compares the first and last selected events. Both endpoint sliders can be moved to compare specific Regionals. Geography filters cover all events, US, Europe, South America, and Oceania.

Share trends use percentage point changes in player share. One slider sets the number of rows shown in all four trend lists—share rising/falling and win-rate improving/declining—from top 5 to top 35, defaulting to top 15. Win rate trends use percentage point changes in Labs' tie-adjusted win rate, requiring at least 20 recorded matches at both events. Generic `Other`/`Unknown` classifications are excluded from those trend lists.

The overall view ranks decks by total player count across the selected geography. Share, win rate, and Day 2 conversion are recomputed from summed counts rather than averaging event percentages. Opening a row fetches its combined matchups against the other top 15 decks and displays an opponent table with W–L–T records, win rates, and result categories. The five most-played matchups appear first, with See more for the rest. Category and opposing-deck dropdowns select the matchup to inspect. A matchup is favorable at 55% or above, unfavorable at 45% or below, and neutral between those cutoffs. Mirror matches are omitted. The full ranking page uses the same geographic filters and adds deck-name search.

## Connected sources

| Source | Integration | Intended use |
| --- | --- | --- |
| Play Limitless | Supported JSON API at `https://play.limitlesstcg.com/api` | Online tournaments, details, standings/decklists, and pairings |
| Limitless main site | Server-side HTML adapter for `/decks` | Overall metagame points and share |
| Limitless Labs | Server-side HTML adapter | Major-event discovery and future standings, conversion, and matchup analysis |

The HTML integrations are deliberately isolated in `lib/limitless/overall-meta.ts` and `lib/limitless/labs.ts`. If those public pages change, their parsers can be updated without changing the rest of the application.

## Local API routes

- `GET /api/sources/health`
- `GET /api/tournaments?game=PTCG&format=STANDARD&limit=50&page=1`
- `GET /api/tournaments/:id/details`
- `GET /api/tournaments/:id/standings`
- `GET /api/tournaments/:id/pairings`
- `GET /api/meta/overall?time=1months&variants=split&limit=50`
- `GET /api/labs/events`
- `GET /api/season/matchups?deck=dragapult-ex&geography=all`

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

An API key is optional. If needed, place `LIMITLESS_API_KEY=...` in an untracked `.env` next to `compose.yaml` on the Pi; Docker Compose will pass it to the container. The app still needs outbound HTTPS access to Limitless for its live data.

To update after copying new source to the Pi, run `docker compose up -d --build` again. This Docker route has not yet been run on the Pi hardware; test it there before relying on it as the production host.

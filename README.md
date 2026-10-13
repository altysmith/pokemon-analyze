# LoMeta

LoMeta is a Pokémon TCG metagame comparison site focused on the 2027 season. Its home page compares Regional trends; `/overall` shows the top 15 decks and their matchup profiles. The previous `pokemon-analyze` application was consulted only for source discovery.

## 2027 season views

The current season set contains Baltimore, Brisbane, Frankfurt, Recife, and Louisville. The trends view selects the latest three Regionals by default and compares the first and last selected events. Both endpoint sliders can be moved to compare specific Regionals. Geography filters cover all events, US, Europe, South America, and Oceania.

Share trends use percentage point changes in player share. Win rate trends use percentage point changes in Labs' tie-adjusted win rate, requiring at least 20 recorded matches at both events. The top ten increases and decreases are shown separately. Generic `Other`/`Unknown` classifications are excluded from those trend lists.

The overall view ranks decks by total player count across the selected geography. Share, win rate, and Day 2 conversion are recomputed from summed counts rather than averaging event percentages. Selecting a deck fetches its combined matchups against the other top 15 decks. A matchup is favorable at 55% or above, unfavorable at 45% or below, and neutral between those cutoffs. Mirror matches are omitted.

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

The production build is created with `pnpm build` or the Sites build helper.

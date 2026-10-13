# LoMeta

LoMeta is a new Pokémon TCG metagame comparison site. This repository begins with the data-source layer and a small connection dashboard; it intentionally does not reproduce the previous `pokemon-analyze` application.

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

All upstream calls happen on the server. This avoids browser CORS limitations and keeps an optional API key out of client code.

## Optional API key

Most Play Limitless tournament endpoints do not require a key. Copy `.env.example` to `.env.local` and set `LIMITLESS_API_KEY` only if access to a protected endpoint, such as deck-classification rules, is approved.

## Development

```bash
pnpm install
pnpm dev
```

The production build is created with `pnpm build` or the Sites build helper.

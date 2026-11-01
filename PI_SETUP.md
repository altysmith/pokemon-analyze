# Raspberry Pi deployment handoff

This repository is ready to deploy LoMeta and its automated Japan City League and major-event sync jobs on a 64-bit Raspberry Pi with Docker Compose.

Japan City League results do **not** use the Play Limitless webhook system. They are published on the main Limitless site, so the deployment includes a `japan-sync` service that polls the City League listing at a bounded rate. A future Play Limitless integration can add a separate `tournament:ended` webhook for individual online tournaments.

## What the deployment runs

- `lometa`: the Next.js web application, bound to `127.0.0.1:3000` by default.
- `japan-sync`: runs once when it starts and then daily at 11:00 AM Eastern.
- `season-sync`: checks the Labs listing at startup and every six hours, then validates newly completed Regionals and Special Events before adding them to the shared season catalog.
- `/home/ealtenho/LoMeta.altylab.com/data`: the shared host directory containing the SQLite database, season event catalog, and cache.

The importer is idempotent, records source revisions, limits each scheduled run to 100 due events, and selectively revisits recent or incomplete events.

## Instructions for the Codex instance on the Pi

1. Confirm the Pi is running a 64-bit OS and that Docker Engine with the Compose plugin is installed:

   ```bash
   uname -m
   docker --version
   docker compose version
   ```

   `uname -m` should normally report `aarch64` or `arm64`.

2. Create the LoMeta folder and clone the repository into its `app` directory:

   ```bash
   mkdir -p /home/ealtenho/LoMeta.altylab.com/{app,data,backups,state,archive}
   git clone https://github.com/altysmith/pokemon-analyze.git /home/ealtenho/LoMeta.altylab.com/app
   cd /home/ealtenho/LoMeta.altylab.com/app
   git checkout master
   ```

3. Ensure the shared data directory is writable by the Pi account, then create the local environment file:

   ```bash
   mkdir -p /home/ealtenho/LoMeta.altylab.com/data
   cp .env.example .env
   ```

   The defaults are suitable for the first deployment. `LIMITLESS_API_KEY` may remain empty. Do not commit `.env`.

4. Build and start the services:

   ```bash
   docker compose up -d --build
   ```

5. Verify the application and importer:

   ```bash
   docker compose ps
   docker compose logs --tail=100 lometa
   docker compose logs --tail=100 japan-sync
   docker compose logs --tail=100 season-sync
   curl --fail http://127.0.0.1:3000/japan >/dev/null
   ```

   The sync log should show a start time, JSON totals, and a completion time. The first run can take several minutes because requests are deliberately paced.

6. If an immediate one-time refresh is needed:

   ```bash
   docker compose run --rm japan-sync node scripts/japan-sync-scheduler.mjs --once
   docker compose run --rm season-sync node scripts/season-sync-scheduler.mjs --once
   ```

7. Keep port 3000 private unless direct LAN access is intentional. The checked-in configuration binds only to loopback so a reverse proxy on the Pi can publish the site with TLS. If direct LAN access is required, change the mapping in `compose.yaml` from `127.0.0.1:3000:3000` to `3000:3000` and apply appropriate firewall controls.

## Configuration

The untracked `.env` file can override these defaults:

```dotenv
LIMITLESS_API_KEY=
JP_SYNC_TIME_ZONE=America/New_York
JP_SYNC_HOUR=11
JP_SYNC_MINUTE=0
JP_SYNC_PAGES=10
JP_SYNC_MAX_EVENTS=100
SEASON_SYNC_INTERVAL_HOURS=6
```

- `JP_SYNC_TIME_ZONE`: IANA time-zone name; the default follows Eastern daylight-saving changes.
- `JP_SYNC_HOUR`: local hour from 0 through 23.
- `JP_SYNC_MINUTE`: local minute from 0 through 59.
- `JP_SYNC_PAGES`: listing pages checked per run, from 1 through 10.
- `JP_SYNC_MAX_EVENTS`: maximum due event pages imported per run, from 1 through 100.
- `SEASON_SYNC_INTERVAL_HOURS`: Labs listing check interval, from 1 through 168 hours. New events are checked after their listed end date.

The defaults are intentionally conservative. Do not increase the polling frequency aggressively; the source is a public website rather than a City League API.

## Persistence and backups

The database, `/data/season-events.json` catalog, and season cache are stored in `/home/ealtenho/LoMeta.altylab.com/data` and survive container rebuilds. Before data maintenance, stop the services and back up that directory:

```bash
docker compose stop lometa japan-sync season-sync
tar czf "/home/ealtenho/LoMeta.altylab.com/backups/data-$(date -u +%Y%m%dT%H%M%SZ).tgz" \
  -C /home/ealtenho/LoMeta.altylab.com/data .
docker compose start lometa japan-sync season-sync
```

The old `lometa_japan-data` Docker volume is retained as a rollback copy during the move. Routine deployments use the host data directory above.

## Updating

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 japan-sync
docker compose logs --tail=100 season-sync
```

Do not delete the `japan-data` volume during routine updates.

## Troubleshooting

- `japan-sync` failures: inspect `docker compose logs japan-sync`. Confirm outbound HTTPS and DNS access to `www.limitlesstcg.com`.
- `season-sync` failures: inspect `docker compose logs season-sync`. Confirm outbound HTTPS and DNS access to `labs.limitlesstcg.com` and `www.limitlesstcg.com`.
- Empty Japan page: confirm both services mount `/home/ealtenho/LoMeta.altylab.com/data` at `/data` and use `JP_DB_PATH=/data/japan.sqlite`.
- Permission errors under `/data`: inspect the host directory and container user before changing ownership; do not replace or delete the data directory.
- Build failures for `better-sqlite3`: confirm the Pi OS is 64-bit and Docker has enough memory and disk space. The build stage includes the compiler toolchain needed for a native build.
- Reverse-proxy errors: first confirm `curl http://127.0.0.1:3000/japan` works locally on the Pi.

## Future Play Limitless webhook

Do not point a Play Limitless webhook at the Japan importer. When individual online tournament ingestion is added, create a separate authenticated POST endpoint, validate the shared webhook secret, accept `tournament:ended`, and then fetch the tournament's details, standings, and pairings from the Play Limitless API. Keep a reconciliation poll in addition to that webhook.

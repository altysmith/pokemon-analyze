# Raspberry Pi deployment handoff

This repository is ready to deploy LoMeta and its automated Japan City League importer on a 64-bit Raspberry Pi with Docker Compose.

Japan City League results do **not** use the Play Limitless webhook system. They are published on the main Limitless site, so the deployment includes a `japan-sync` service that polls the City League listing at a bounded rate. A future Play Limitless integration can add a separate `tournament:ended` webhook for individual online tournaments.

## What the deployment runs

- `lometa`: the Next.js web application, bound to `127.0.0.1:3000` by default.
- `japan-sync`: runs once when it starts and every 24 hours afterward.
- `japan-data`: a named Docker volume containing the shared SQLite database.

The importer is idempotent, records source revisions, limits each default run to 10 due events, and selectively revisits recent or incomplete events.

## Instructions for the Codex instance on the Pi

1. Confirm the Pi is running a 64-bit OS and that Docker Engine with the Compose plugin is installed:

   ```bash
   uname -m
   docker --version
   docker compose version
   ```

   `uname -m` should normally report `aarch64` or `arm64`.

2. Clone and enter the repository:

   ```bash
   git clone https://github.com/altysmith/pokemon-analyze.git
   cd pokemon-analyze
   git checkout master
   ```

3. Create the local environment file:

   ```bash
   cp .env.example .env
   ```

   The defaults are suitable for the first deployment. `LIMITLESS_API_KEY` may remain empty. Do not commit `.env`.

4. Build and start both services:

   ```bash
   docker compose up -d --build
   ```

5. Verify the application and importer:

   ```bash
   docker compose ps
   docker compose logs --tail=100 lometa
   docker compose logs --tail=100 japan-sync
   curl --fail http://127.0.0.1:3000/japan >/dev/null
   ```

   The sync log should show a start time, JSON totals, and a completion time. The first run can take several minutes because requests are deliberately paced.

6. If an immediate one-time refresh is needed:

   ```bash
   docker compose run --rm japan-sync node scripts/japan-sync-scheduler.mjs --once
   ```

7. Keep port 3000 private unless direct LAN access is intentional. The checked-in configuration binds only to loopback so a reverse proxy on the Pi can publish the site with TLS. If direct LAN access is required, change the mapping in `compose.yaml` from `127.0.0.1:3000:3000` to `3000:3000` and apply appropriate firewall controls.

## Configuration

The untracked `.env` file can override these defaults:

```dotenv
LIMITLESS_API_KEY=
JP_SYNC_INTERVAL_HOURS=24
JP_SYNC_PAGES=1
JP_SYNC_MAX_EVENTS=10
```

- `JP_SYNC_INTERVAL_HOURS`: integer from 1 through 168.
- `JP_SYNC_PAGES`: listing pages checked per run, from 1 through 10.
- `JP_SYNC_MAX_EVENTS`: maximum due event pages imported per run, from 1 through 100.

The defaults are intentionally conservative. Do not reduce the interval aggressively; the source is a public website rather than a City League API.

## Persistence and backups

The database is stored in the `japan-data` Docker volume and survives container rebuilds. Before destructive Docker maintenance, identify and back up the exact volume rather than using broad prune commands:

```bash
docker volume ls
docker compose stop lometa japan-sync
docker run --rm -v pokemon-analyze_japan-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/japan-data-backup.tgz -C /data .
docker compose start lometa japan-sync
```

The actual Compose volume prefix may differ if the checkout directory or Compose project name differs. Confirm it with `docker volume ls` before running the backup command.

## Updating

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 japan-sync
```

Do not delete the `japan-data` volume during routine updates.

## Troubleshooting

- `japan-sync` failures: inspect `docker compose logs japan-sync`. Confirm outbound HTTPS and DNS access to `www.limitlesstcg.com`.
- Empty Japan page: confirm both services mount the same `japan-data` volume and use `JP_DB_PATH=/data/japan.sqlite`.
- Permission errors under `/data`: inspect the mounted volume and container user before changing ownership; do not replace or delete the volume.
- Build failures for `better-sqlite3`: confirm the Pi OS is 64-bit and Docker has enough memory and disk space. The build stage includes the compiler toolchain needed for a native build.
- Reverse-proxy errors: first confirm `curl http://127.0.0.1:3000/japan` works locally on the Pi.

## Future Play Limitless webhook

Do not point a Play Limitless webhook at the Japan importer. When individual online tournament ingestion is added, create a separate authenticated POST endpoint, validate the shared webhook secret, accept `tournament:ended`, and then fetch the tournament's details, standings, and pairings from the Play Limitless API. Keep a reconciliation poll in addition to that webhook.

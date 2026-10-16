FROM node:25-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec next build

FROM dependencies AS japan-sync

COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    JP_DB_PATH=/data/japan.sqlite
USER node
CMD ["node", "scripts/japan-sync-scheduler.mjs"]

FROM dependencies AS season-sync

COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    SEASON_CATALOG_PATH=/data/season-events.json
USER node
CMD ["node", "scripts/season-sync-scheduler.mjs"]

FROM node:25-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
CMD ["node", "server.js"]

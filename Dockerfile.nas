FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG APP_VERSION=1.2.1
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_HELIOS_WEB=1 \
    DESKTOP_BUILD=1 \
    NODE_OPTIONS=--max-old-space-size=3072
RUN pnpm build && cp .next/standalone/server.js ./server.js \
    && rm -rf .next/standalone .next/cache
RUN pnpm prune --prod

FROM node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HELIOS_WEB=1 \
    HELIOS_DATA_DIR=/data/db \
    HELIOS_MEDIA_DIR=/data/media \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/server.js ./server.js
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
# Maintenance tooling. scripts/backfill-thumbs.mjs walks the media directory and
# fills the thumbnail cache for files that predate write-time prewarming; it
# imports the app's own modules, so lib/ ships alongside it. Run it with:
#   docker exec -w /app heliosgen node scripts/backfill-thumbs.mjs
# Nothing here is served — it needs shell access, which is already privileged,
# and adds no network surface.
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/scripts/backfill-thumbs.mjs ./scripts/backfill-thumbs.mjs
# Re-encodes stored images to lossless WebP in place (lib/assetCompress.ts), with
# a backup dir and --rollback. Same deal as the thumb backfill: shell-only.
COPY --from=build --chown=node:node /app/scripts/compress-assets.mjs ./scripts/compress-assets.mjs
# Vision classification over the whole library (lib/assetVision.ts). Needs a MiMo
# key; without one it prints what to do and exits rather than half-running.
COPY --from=build --chown=node:node /app/scripts/classify-assets.mjs ./scripts/classify-assets.mjs
COPY --from=build --chown=node:node /app/scripts/_ts-alias-hooks.mjs ./scripts/_ts-alias-hooks.mjs
# The build stage removes .next/cache, but compose bind-mounts the thumbnail
# cache at /app/.next/cache/images. Docker then creates the parent as root, so
# the node user can't write siblings (Next's fetch-cache) and logs EACCES.
RUN mkdir -p /app/.next/cache && chown node:node /app/.next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/workflows').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

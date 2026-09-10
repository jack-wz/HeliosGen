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
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/workflows').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

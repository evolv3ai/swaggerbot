# swagger.bot: one container running the Nitro server, with Litestream
# replicating the Index to Backblaze B2 (ADR 0002, docs/deploy.md).

FROM node:24-slim AS build
WORKDIR /app
# better-sqlite3 compiles from source when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
ARG LITESTREAM_VERSION=0.5.17
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
       amd64) arch=x86_64 ;; \
       arm64) arch=arm64 ;; \
       *) echo "unsupported architecture: ${TARGETARCH:-$(dpkg --print-architecture)}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${arch}.tar.gz" \
     | tar -xz -C /usr/local/bin litestream \
  && apt-get purge -y curl && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN useradd --system --uid 10001 --home-dir /app swaggerbot \
  && mkdir -p /app/data \
  && chown swaggerbot:swaggerbot /app/data
COPY --from=build /app/.output ./.output
COPY drizzle ./drizzle
COPY docker/entrypoint.sh docker/litestream.yml ./docker/

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/swaggerbot.db
VOLUME /app/data
USER swaggerbot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]

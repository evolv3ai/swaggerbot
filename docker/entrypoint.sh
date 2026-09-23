#!/bin/sh
# Starts swagger.bot. With LITESTREAM_BUCKET set, it first restores the Index
# from its replica when the volume has none, then runs the app under
# Litestream, which replicates the Index and exits when the app does.
set -eu

config=/app/docker/litestream.yml

if [ -z "${LITESTREAM_BUCKET:-}" ]; then
  echo "LITESTREAM_BUCKET is not set: Index replication is off."
  exec node .output/server/index.mjs
fi

export LITESTREAM_PATH="${LITESTREAM_PATH:-swaggerbot}"

litestream restore -config "$config" -if-db-not-exists -if-replica-exists "$DATABASE_PATH"
exec litestream replicate -config "$config" -exec "node .output/server/index.mjs"

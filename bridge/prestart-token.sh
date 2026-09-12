#!/bin/sh
# Ensure seek-token exists as a 0600 file before compose up.
# fnOS restarts can recreate the bind-mount source as a root-owned empty
# directory; compose then mounts the directory and the bridge exits with
# "Seek token file not found". Restore from local backup instead.
set -e
TOKEN_PATH=/home/wyai/heliosgen/secrets/seek-token
BACKUP_PATH=/home/wyai/heliosgen/.seek-token.bak
if [ -d "$TOKEN_PATH" ]; then
  echo "[prestart] removing stale directory $TOKEN_PATH" >&2
  docker run --rm -v /home/wyai/heliosgen/secrets:/secrets busybox:latest rmdir /secrets/seek-token
fi
if [ ! -s "$TOKEN_PATH" ]; then
  if [ -s "$BACKUP_PATH" ]; then
    echo "[prestart] restoring token from backup" >&2
    docker run --rm -v /home/wyai/heliosgen/secrets:/secrets -v /home/wyai/heliosgen:/backup:ro busybox:latest sh -c "cp /backup/.seek-token.bak /secrets/seek-token && chmod 600 /secrets/seek-token"
  else
    echo "[prestart] ERROR: no token and no backup at $BACKUP_PATH" >&2
    exit 1
  fi
fi
echo "[prestart] token file OK" >&2

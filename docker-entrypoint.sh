#!/bin/sh
set -eu
# Railway mounts the volume after the image is built, so fix its owner at startup.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data
  exec gosu node "$@"
fi
exec "$@"

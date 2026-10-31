#!/bin/sh
# Explicit Railway entrypoint — always ends in a long-running Node HTTP server.
set -eu
echo "[railway-start] pwd=$(pwd) node=$(command -v node) PORT=${PORT:-unset}"
echo "[railway-start] starting node server.js"
exec node server.js

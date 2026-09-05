#!/bin/bash
#
# End-to-end test of a built x86_64 addon package in a Debian container
# (ROADMAP task 6). Replays the OpenCCU installation path (fresh install,
# update) and exercises the broker: pub/sub with the bundled clients,
# websockets, TLS with a CCU-style server.pem, the password-file plugin
# with reload, the migration of a 1.5.8 conf.d layout, the self-update
# worker and the uninstall.
#
#   test/e2e.sh [dist-dir]      default: ./dist (needs docker)
#

set -o pipefail

BUILD_DIR=`cd ${0%/*}/.. && pwd -P`
DIST=${1:-$BUILD_DIR/dist}
DIST=`cd "$DIST" && pwd -P` || { echo "error: $DIST not found" >&2; exit 1; }

ls "$DIST"/mosquitto-x86_64-*.tar.gz >/dev/null 2>&1 || {
    echo "error: no mosquitto-x86_64-*.tar.gz in $DIST (run ./build_addon.sh x86_64 first)" >&2
    exit 1
}

command -v docker >/dev/null 2>&1 || { echo "error: docker is required" >&2; exit 1; }

exec docker run --rm --platform linux/amd64 \
    -v "$DIST:/dist:ro" \
    -v "$BUILD_DIR/test/e2e-inner.sh:/e2e-inner.sh:ro" \
    debian:bookworm-slim bash /e2e-inner.sh

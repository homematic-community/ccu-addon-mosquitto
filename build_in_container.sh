#!/bin/sh
#
# Runs inside an Alpine container (one per target architecture, started by
# build_addon.sh): builds Mosquitto from the official source tarball with a
# minimal feature set and stages everything the addon needs in /out/stage:
#
#   usr/sbin/mosquitto, usr/bin/mosquitto_{sub,pub,ctrl,passwd},
#   usr/lib/libmosquitto.so*, usr/lib/mosquitto_*.so (plugins),
#   lib/ld-musl-*.so.1, lib/libc.musl-*.so.1, usr/lib/libssl.so*,
#   usr/lib/libcrypto.so*, usr/lib/libcjson.so*
#
# plus /out/packages.json with name/version/license/url of the runtime
# packages (from apk's installed db) for the licenses page.
#
#   sh build_in_container.sh <mosquitto version> <host uid:gid>
#
# Why a source build instead of Alpine's mosquitto package: Alpine builds
# with the HTTP API (libmicrohttpd -> gnutls, nettle, gmp, p11-kit, ...),
# sqlite persistence, libwebsockets and editline, which more than doubles
# the package for features the addon does not use. Building here also makes
# a release possible on the day of a Mosquitto release, independent of the
# distribution's packaging.

set -e

VERSION=$1
OWNER=$2
STAGE=/out/stage
SRC=/build

[ -n "$VERSION" ] || { echo "usage: build_in_container.sh <version> [uid:gid]" >&2; exit 1; }

echo "### alpine `cat /etc/alpine-release` `uname -m`: building mosquitto $VERSION"

apk add --no-cache build-base linux-headers openssl-dev cjson-dev curl >/dev/null

mkdir -p $SRC $STAGE
cd $SRC
URL=https://mosquitto.org/files/source/mosquitto-$VERSION.tar.gz
echo "### download $URL"
if ! curl -fsSL --max-time 300 -o mosquitto.tar.gz $URL; then
    URL=https://github.com/eclipse-mosquitto/mosquitto/archive/refs/tags/v$VERSION.tar.gz
    echo "### not on mosquitto.org, trying $URL"
    curl -fsSL --max-time 300 -o mosquitto.tar.gz $URL
fi
tar -xzf mosquitto.tar.gz
cd mosquitto-$VERSION

# Feature set. Websockets are the built-in implementation (2.1+, no
# libwebsockets). Everything that would pull a library the CCU does not
# need is off; the plugins the addon ships (password-file, acl-file,
# dynamic-security) are built by default.
MAKE_OPTS="
    WITH_TLS=yes
    WITH_TLS_PSK=yes
    WITH_WEBSOCKETS=yes
    WITH_BRIDGE=yes
    WITH_PERSISTENCE=yes
    WITH_CONTROL=yes
    WITH_UNIX_SOCKETS=yes
    WITH_THREADING=yes
    WITH_EPOLL=yes
    WITH_SYS_TREE=yes
    WITH_MEMORY_TRACKING=no
    WITH_SRV=no
    WITH_ADNS=no
    WITH_SOCKS=no
    WITH_SYSTEMD=no
    WITH_DOCS=no
    WITH_HTTP_API=no
    WITH_SQLITE=no
    WITH_EDITLINE=no
    WITH_JEMALLOC=no
    WITH_XTREPORT=no
    WITH_STATIC_LIBRARIES=no
    WITH_SHARED_LIBRARIES=yes
    WITH_STRIP=no
    prefix=/usr
"

echo "### make"
# shellcheck disable=SC2086
make -j`nproc` $MAKE_OPTS >/build/make.log 2>&1 || { tail -50 /build/make.log; exit 1; }
echo "### make install"
# per directory: the top-level install target also wants the sqlite plugin,
# which WITH_SQLITE=no did not build
for d in libcommon lib apps client src plugins/password-file plugins/acl-file plugins/dynamic-security; do
    # shellcheck disable=SC2086
    make -C $d $MAKE_OPTS install DESTDIR=$STAGE >>/build/install.log 2>&1 || { tail -50 /build/install.log; exit 1; }
done
# WITH_STRIP=yes would use GNU install's --strip-program, which busybox
# install does not have - strip afterwards instead
find $STAGE/usr/sbin $STAGE/usr/bin $STAGE/usr/lib -type f | while read -r f; do
    strip "$f" 2>/dev/null || true
done

# the shared libraries the binaries need, from the packages of this Alpine release
mkdir -p $STAGE/lib $STAGE/usr/lib
cp -a /lib/ld-musl-*.so.1 /lib/libc.musl-*.so.1 $STAGE/lib/
cp -a /usr/lib/libssl.so* /usr/lib/libcrypto.so* /usr/lib/libcjson.so* $STAGE/usr/lib/

ls -la $STAGE/usr/sbin $STAGE/usr/bin $STAGE/usr/lib $STAGE/lib

# package metadata for the licenses page (apk's installed database has
# P/V/L/U records like the APKINDEX)
awk -v want=" musl libssl3 libcrypto3 cjson " '
    BEGIN { RS = ""; FS = "\n"; printf "[" ; n = 0 }
    {
        name = ""; ver = ""; lic = ""; url = ""
        for (i = 1; i <= NF; i++) {
            if ($i ~ /^P:/) name = substr($i, 3)
            if ($i ~ /^V:/) ver = substr($i, 3)
            if ($i ~ /^L:/) lic = substr($i, 3)
            if ($i ~ /^U:/) url = substr($i, 3)
        }
        if (index(want, " " name " ") > 0) {
            if (n++) printf ","
            printf "\n  {\"name\":\"%s\",\"version\":\"%s\",\"license\":\"%s\",\"url\":\"%s\"}", name, ver, lic, url
        }
    }
    END { printf "\n]\n" }
' /lib/apk/db/installed > /out/packages.json

echo "alpine=`cat /etc/alpine-release`" > /out/build.env

if [ -n "$OWNER" ]; then
    chown -R "$OWNER" /out
fi
echo "### done"

#!/bin/bash
#
# Builds the ccu-addon-mosquitto package for one architecture:
#
#   ./build_addon.sh <armv7l|aarch64|x86_64>
#
# Mosquitto is compiled from the official source tarball inside an Alpine
# container of the target architecture (build_in_container.sh, docker with
# qemu/binfmt for the ARM targets) with a minimal feature set, linked
# against Alpine's musl, OpenSSL 3 and cJSON. Those shared libraries and the
# musl loader are copied into the addon and the ELF interpreter and RPATH of
# every binary are rewritten to point inside the addon prefix, so the runtime
# is self-contained: the CCU's own libc (glibc 2.27 on the original CCU3
# firmware, a current glibc on OpenCCU) is irrelevant. (Same approach as
# RedMatic's Node.js runtime.)
#
# Requires: docker (with binfmt for linux/arm/v7 and linux/arm64), node,
# tar and patchelf.

set -o pipefail

ARCH=${1:-armv7l}

BUILD_DIR=`cd ${0%/*} && pwd -P`

# VERSION_ADDON=2.1.2+99 ./build_addon.sh x86_64 builds a test package with
# another version than package.json (e.g. one the self-update can update to)
VERSION_ADDON=${VERSION_ADDON:-`node -p "require('$BUILD_DIR/package.json').version"`}
# the Mosquitto version is everything before the "+<addon build>" suffix
MOSQUITTO_VERSION=${VERSION_ADDON%%+*}

PREFIX=/usr/local/addons/mosquitto
# the Alpine release whose musl/OpenSSL/cJSON ship with the addon
ALPINE_TAG=${ALPINE_TAG:-3.22}

echo ""
echo "Build ccu-addon-mosquitto $VERSION_ADDON ($ARCH)"
echo ""

case $ARCH in
  armv7l)  PLATFORM=linux/arm/v7 ;;
  aarch64) PLATFORM=linux/arm64 ;;
  x86_64)  PLATFORM=linux/amd64 ;;
  *)
    echo "usage: $0 <armv7l|aarch64|x86_64>" >&2
    exit 1
    ;;
esac

for tool in docker node tar patchelf; do
    command -v $tool >/dev/null 2>&1 || { echo "error: $tool is required" >&2; exit 1; }
done

ADDON_FILES=$BUILD_DIR/addon_files
ADDON_TMP=$BUILD_DIR/addon_tmp
ADDON=$ADDON_TMP/mosquitto
VERSION_FILE=$ADDON/versions
OUT=$ADDON_TMP/out

mkdir -p $BUILD_DIR/dist
mkdir $ADDON_TMP 2> /dev/null || rm -rf $ADDON_TMP/* $ADDON_TMP/.[!.]* 2>/dev/null
mkdir -p $OUT

# --- compile mosquitto in the container ---------------------------------------------

echo "building mosquitto $MOSQUITTO_VERSION in alpine:$ALPINE_TAG ($PLATFORM) ..."
docker run --rm --platform $PLATFORM \
    -v "$OUT:/out" \
    -v "$BUILD_DIR/build_in_container.sh:/build.sh:ro" \
    alpine:$ALPINE_TAG sh /build.sh $MOSQUITTO_VERSION "`id -u`:`id -g`" || exit 1

SRCROOT=$OUT/stage
PACKAGES_JSON=$OUT/packages.json
[ -f $SRCROOT/usr/sbin/mosquitto ] || { echo "error: the container build produced no usr/sbin/mosquitto" >&2; exit 1; }

# --- assemble the addon tree ----------------------------------------------------

mkdir -p $ADDON/bin $ADDON/lib

# copy one shared library (following symlinks) from $SRCROOT into $ADDON/lib
copy_lib() {
    local name="$1" dir real base
    [ -e "$ADDON/lib/$name" ] && return 0
    for dir in "$SRCROOT/lib" "$SRCROOT/usr/lib"; do
        [ -e "$dir/$name" ] || continue
        real=`readlink -f "$dir/$name"`
        base=`basename "$real"`
        cp -a "$real" "$ADDON/lib/$base"
        [ "$base" == "$name" ] || ln -sfn "$base" "$ADDON/lib/$name"
        return 0
    done
    echo "error: shared library $name not found in the staging root" >&2
    return 1
}

# copy the transitive DT_NEEDED closure of the given ELF files into $ADDON/lib
copy_closure() {
    local queue="$*" current needed
    while [ -n "$queue" ]; do
        current=${queue%% *}
        queue=${queue#"$current"}
        queue=${queue# }
        for needed in `patchelf --print-needed "$current" 2>/dev/null`; do
            if [ ! -e "$ADDON/lib/$needed" ]; then
                copy_lib "$needed" || return 1
                queue="$queue `readlink -f $ADDON/lib/$needed`"
            fi
        done
    done
}

# the broker, the client tools and the plugins we ship
BINARIES="mosquitto mosquitto_sub mosquitto_pub mosquitto_ctrl mosquitto_passwd"
PLUGINS="mosquitto_password_file.so mosquitto_acl_file.so mosquitto_dynamic_security.so"

cp -a $SRCROOT/usr/sbin/mosquitto $ADDON/bin/mosquitto
for b in $BINARIES; do
    [ "$b" == "mosquitto" ] && continue
    [ -f $SRCROOT/usr/bin/$b ] || { echo "error: usr/bin/$b missing in the build output" >&2; exit 1; }
    cp -a $SRCROOT/usr/bin/$b $ADDON/bin/$b
done
for p in $PLUGINS; do
    [ -f $SRCROOT/usr/lib/$p ] || { echo "error: usr/lib/$p missing in the build output" >&2; exit 1; }
    cp -a $SRCROOT/usr/lib/$p $ADDON/lib/$p
done

ELFS=""
for b in $BINARIES; do ELFS="$ELFS $ADDON/bin/$b"; done
for p in $PLUGINS; do ELFS="$ELFS $ADDON/lib/$p"; done

copy_closure $ELFS || exit 1

# the ELF interpreter itself (musl's loader), which is not a DT_NEEDED entry
LOADER=`patchelf --print-interpreter $ADDON/bin/mosquitto`
[ -e $ADDON/lib/`basename $LOADER` ] || cp -a $SRCROOT$LOADER $ADDON/lib/`basename $LOADER`

# Point everything inside the addon: absolute prefix path first (the
# installed location), $ORIGIN as well so the tree also works elsewhere
# (the e2e container, a build check). musl resolves a library's own
# dependencies through the RPATH of the whole needed_by chain up to the
# executable, so patching the executables and the dlopen'ed plugins is enough.
for b in $BINARIES; do
    patchelf --set-interpreter $PREFIX/lib/`basename $LOADER` \
        --set-rpath "$PREFIX/lib:\$ORIGIN/../lib" $ADDON/bin/$b || exit 1
done
for p in $PLUGINS; do
    patchelf --set-rpath "$PREFIX/lib:\$ORIGIN" $ADDON/lib/$p || exit 1
done

echo "copying addon files ..."
cp -r $ADDON_FILES/* $ADDON_TMP/
# the scripts must be executable no matter how the checkout was made
chmod 755 $ADDON/bin/* $ADDON/www/*.cgi $ADDON_TMP/update_script

# update_script registers the WebUI button through ./update_addon
cd $ADDON_TMP
ln -s mosquitto/bin/update_addon ./
cd $BUILD_DIR

echo "creating licenses page ..."
node -e '
    const fs = require("fs");
    const [file, version] = process.argv.slice(1);
    const pkgs = JSON.parse(fs.readFileSync(file, "utf8"));
    pkgs.unshift({ name: "mosquitto", version, license: "EPL-2.0 OR EDL-1.0", url: "https://mosquitto.org/" });
    fs.writeFileSync(file, JSON.stringify(pkgs, null, 2) + "\n");
' $PACKAGES_JSON $MOSQUITTO_VERSION || exit 1
node $BUILD_DIR/build_licenses.js $PACKAGES_JSON $VERSION_ADDON > $ADDON/www/licenses.html || exit 1

echo "creating version file ..."
. $OUT/build.env
cat > $VERSION_FILE <<EOL
export VERSION_ADDON=$VERSION_ADDON
export MOSQUITTO_VERSION=$MOSQUITTO_VERSION
export ADDON_ARCH=$ARCH
export ALPINE_VERSION=$alpine
EOL
node -p "require('$PACKAGES_JSON').filter(p => p.name !== 'mosquitto').map(p => 'export PKG_' + p.name.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '=' + p.version).join('\n')" >> $VERSION_FILE
rm -rf $OUT

# --- self-check ----------------------------------------------------------------
# Every library the patched binaries ask for must be part of the tree, and
# the interpreter must point inside the prefix.
check_elf() {
    local f="$1" needed
    for needed in `patchelf --print-needed "$f"`; do
        [ -e "$ADDON/lib/$needed" ] || { echo "MISSING: $needed (for $f)" >&2; return 1; }
    done
    case `patchelf --print-interpreter "$f" 2>/dev/null` in
        $PREFIX/*|"") ;;
        *) echo "error: interpreter of $f points outside $PREFIX" >&2; return 1 ;;
    esac
}
for f in $ELFS; do
    check_elf $f || exit 1
done
for f in $ADDON/lib/*.so*; do
    [ -L "$f" ] && continue
    check_elf $f || exit 1
done
echo "interpreter: `patchelf --print-interpreter $ADDON/bin/mosquitto`"
echo "rpath:       `patchelf --print-rpath $ADDON/bin/mosquitto`"
echo "libraries:   `ls $ADDON/lib | tr '\n' ' '`"
echo "size:        `du -sh $ADDON | cut -f1`"
cat $VERSION_FILE

# --- package -------------------------------------------------------------------

# Every package is named after its architecture (`uname -m`), which is what
# the openccu-lite addon catalogue resolves (mosquitto-<arch>-<version>.tar.gz,
# docs/catalog-format.md). armv7l is additionally published under the name it
# has had since the 1.5.8 releases, mosquitto-<version>.tar.gz - the same bytes
# under two names: the catalogue's universal fallback, the link in every forum
# post, and what an installed addon older than 2.1.2+2 asks its self-update for.
ADDON_FILE=mosquitto-$ARCH-$VERSION_ADDON.tar.gz
if [ "$ARCH" == "armv7l" ]; then
    LEGACY_FILE=mosquitto-$VERSION_ADDON.tar.gz
else
    LEGACY_FILE=
fi

echo "compressing addon package $ADDON_FILE ..."
cd $ADDON_TMP
tar --owner=root --group=root -czf $BUILD_DIR/dist/$ADDON_FILE * || exit 1
cd $BUILD_DIR/dist
# bare file name in the checksum file, so `sha256sum -c` works anywhere
sha256sum $ADDON_FILE > $ADDON_FILE.sha256
if [ -n "$LEGACY_FILE" ]; then
    cp -f $ADDON_FILE $LEGACY_FILE || exit 1
    sha256sum $LEGACY_FILE > $LEGACY_FILE.sha256
fi
cd $BUILD_DIR

ls -la dist/$ADDON_FILE dist/$ADDON_FILE.sha256
[ -n "$LEGACY_FILE" ] && ls -la dist/$LEGACY_FILE dist/$LEGACY_FILE.sha256
echo "done."

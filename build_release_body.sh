#!/bin/bash
#
# Writes RELEASE_BODY.md for the GitHub release: download links per
# architecture, the automatic-release summary (if any), the hand-written
# release notes, the changes since the last tag and the bundled component
# versions (from the last built package's versions file in addon_tmp/).
#

BUILD_DIR=`cd ${0%/*} && pwd -P`
ADDON_TMP=$BUILD_DIR/addon_tmp
REPO=homematic-community/ccu-addon-mosquitto

VERSION_ADDON=`node -p "require('$BUILD_DIR/package.json').version"`
# "+" in a URL path must be encoded, GitHub does the same for its links
VERSION_URL=${VERSION_ADDON//+/%2B}

MODIFIED=`git diff-index --quiet HEAD || echo "(modified)"`

echo "creating RELEASE_BODY.md"

link() {
    # link <file>: badge + download link for one asset
    local file=$1 file_url=${1//+/%2B}
    echo "  [![Downloads $file](https://img.shields.io/github/downloads/$REPO/$VERSION_URL/$file_url.svg)](https://github.com/$REPO/releases/download/$VERSION_URL/$file_url)"
}

cat >RELEASE_BODY.md <<EOL
### Downloads

#### CCU3 (Firmware ab 3.61.5), piVCCU3 und OpenCCU Varianten _rpi2_, _tinkerboard_ und _oci_arm_ (armv7l)
`link mosquitto-armv7l-$VERSION_ADDON.tar.gz`
`link mosquitto-$VERSION_ADDON.tar.gz`
EOL

if [ -f $BUILD_DIR/dist/mosquitto-aarch64-$VERSION_ADDON.tar.gz ]; then
cat >>RELEASE_BODY.md <<EOL
#### OpenCCU Varianten _rpi3_, _rpi4_, _rpi5_ und _oci_arm64_ (aarch64)
`link mosquitto-aarch64-$VERSION_ADDON.tar.gz`
EOL
fi

if [ -f $BUILD_DIR/dist/mosquitto-x86_64-$VERSION_ADDON.tar.gz ]; then
cat >>RELEASE_BODY.md <<EOL
#### OpenCCU Varianten _ova_, _intelnuc_ und _oci_amd64_ (x86_64)
`link mosquitto-x86_64-$VERSION_ADDON.tar.gz`
EOL
fi

cat >>RELEASE_BODY.md <<EOL

Das Paket wird über die CCU (Einstellungen > Systemsteuerung > Zusatzsoftware) installiert; ein bereits
installiertes Addon aktualisiert sich auch selbst über die Schaltfläche in der Mosquitto-Konfiguration.
Zu jedem Paket gehört eine \`.sha256\`-Datei mit der Prüfsumme. Die beiden armv7l-Dateien sind
dieselbe Datei unter zwei Namen (mit Architektur wie bei den anderen beiden, und der gewohnte ohne).
EOL

# automatic releases: what triggered this one (written by update_versions.js --apply)
if [ -f $BUILD_DIR/RELEASE_SUMMARY.md ]; then
    echo "" >>RELEASE_BODY.md
    cat $BUILD_DIR/RELEASE_SUMMARY.md >>RELEASE_BODY.md
fi

# hand-written notes for the release (breaking changes, requirements)
if [ -f $BUILD_DIR/docs/RELEASE_NOTES.md ]; then
    echo "" >>RELEASE_BODY.md
    cat $BUILD_DIR/docs/RELEASE_NOTES.md >>RELEASE_BODY.md
fi

cat >>RELEASE_BODY.md <<EOL


### Changes

EOL

LAST_TAG=`git describe --tags --abbrev=0 2>/dev/null`
if [ -n "$LAST_TAG" ]; then
    git log $LAST_TAG..HEAD --pretty=format:'* %h @%an %s' \
        | grep -v "Merge remote-tracking branch" \
        | grep -vi "automatic release" \
        | sed -e 's/Sebastian Raff/hobbyquaker/g' \
        >>RELEASE_BODY.md
fi

cat >>RELEASE_BODY.md <<EOL


### Versions

Component | Version
--------- | -------
EOL

VERSIONS_FILE=`ls $ADDON_TMP/mosquitto/versions 2>/dev/null | head -1`
if [ -n "$VERSIONS_FILE" ]; then
    . $VERSIONS_FILE
    cat >>RELEASE_BODY.md <<EOL
[Mosquitto](https://mosquitto.org/) | $MOSQUITTO_VERSION
[Alpine Linux](https://alpinelinux.org/) (musl, OpenSSL, cJSON) | $ALPINE_VERSION
[OpenSSL](https://www.openssl.org/) | ${PKG_LIBCRYPTO3%%-r*}
[cJSON](https://github.com/DaveGamble/cJSON) | ${PKG_CJSON%%-r*}
[musl](https://musl.libc.org/) | ${PKG_MUSL%%-r*}
EOL
else
    echo "Mosquitto | ${VERSION_ADDON%%+*}" >>RELEASE_BODY.md
fi

cat >>RELEASE_BODY.md <<EOL


### Build
EOL

if [ $GITHUB_RUN_ID ]; then
    echo -e "[GitHub Action $GITHUB_WORKFLOW #$GITHUB_RUN_NUMBER](https://github.com/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID)" >> RELEASE_BODY.md
else
    echo -e "\n\nCustom build `git rev-parse --abbrev-ref HEAD` `git rev-parse HEAD` $MODIFIED `date '+%Y-%m-%d %H:%M:%S'`" >> RELEASE_BODY.md
fi

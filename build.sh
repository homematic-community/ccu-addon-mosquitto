#!/bin/bash

BUILD_DIR=`cd ${0%/*} && pwd -P`

ADDON_FILES=$BUILD_DIR/addon_files
ADDON_TMP=$BUILD_DIR/addon_tmp

rm -rf $ADDON_TMP
mkdir $ADDON_TMP

echo "copying files to tmp dir..."
cp -r $ADDON_FILES/* $ADDON_TMP/
cp VERSION $ADDON_TMP/mosquitto/

cd $BUILD_DIR

ADDON_FILE=mosquitto-$(cat VERSION).tar.gz
echo "compressing addon package $ADDON_FILE ..."

mkdir $BUILD_DIR/dist 2> /dev/null
cd $ADDON_TMP
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [[ -f /usr/local/bin/gtar ]]; then
        gtar --exclude=.DS_Store --owner=root --group=root -czf $BUILD_DIR/dist/$ADDON_FILE *
    else
        tar --exclude=.DS_Store -czf $BUILD_DIR/dist/$ADDON_FILE *
    fi
else
    tar --owner=root --group=root -czf $BUILD_DIR/dist/$ADDON_FILE *
fi
cd $BUILD_DIR
rm -r $ADDON_TMP

echo "done."

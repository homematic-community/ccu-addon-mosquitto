#!/bin/bash

BUILD_DIR=`cd ${0%/*} && pwd -P`

ADDON_FILES=$BUILD_DIR/addon_files
ADDON_TMP=$BUILD_DIR/addon_tmp

mkdir $ADDON_TMP 2> /dev/null || rm -r $ADDON_TMP/*

echo "copying files to tmp dir..."
cp -r $ADDON_FILES/* $ADDON_TMP/

cd $BUILD_DIR


ADDON_FILE=mosquitto-1.4.15+0.tar.gz
echo "compressing addon package $ADDON_FILE ..."

mkdir $BUILD_DIR/dist 2> /dev/null
cd $ADDON_TMP
tar --exclude=.DS_Store -czf $BUILD_DIR/dist/$ADDON_FILE *
cd $BUILD_DIR

echo "done."

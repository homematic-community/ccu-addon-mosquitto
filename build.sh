#!/bin/bash
#
# Builds the addon packages for all three architectures into dist/ and the
# release body.

BUILD_DIR=`cd ${0%/*} && pwd -P`
cd $BUILD_DIR

for arch in armv7l aarch64 x86_64; do
    ./build_addon.sh $arch || exit 1
done

./build_release_body.sh || exit 1

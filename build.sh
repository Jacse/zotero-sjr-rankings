#!/bin/sh
version=$npm_package_version
mkdir -p build
rm -f build/zotero-sjr-rank-${version}.xpi
zip -r build/zotero-sjr-rank-${version}.xpi manifest.json bootstrap.js chrome

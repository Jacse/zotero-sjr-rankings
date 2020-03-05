#!/bin/sh
version=$npm_package_version
mkdir -p build
zip -r build/zotero-sjr-rank-${version}.xpi chrome/* chrome.manifest install.rdf

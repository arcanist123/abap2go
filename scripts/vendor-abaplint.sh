#!/bin/sh
# Rebuilds vendor/abaplint-core-<version>.tgz from the abap2go branch of the abaplint fork
# (https://github.com/arcanist123/abaplint, branch abap2go: upstream main plus the fixes abap2go needs).
# usage: scripts/vendor-abaplint.sh <abaplint checkout>   then: npm install
set -e
repo=$(cd "$1" && pwd)
vendor=$(cd "$(dirname "$0")/../vendor" && pwd)
git -C "$repo" checkout abap2go
cd "$repo/packages/core"
npm install
npm run compile
npx api-extractor run --local
rm -f "$vendor"/abaplint-core-*.tgz
npm pack --pack-destination "$vendor"
git -C "$repo" checkout -- scripts/schema.json scripts/schema.ts 2>/dev/null || true

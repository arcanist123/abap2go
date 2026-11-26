#!/bin/sh
# Regenerates patches/@abaplint+core+<version>.patch: the abaplint release abap2go depends on, plus every
# abaplint PR by the abap2go author that the release does not contain yet (open PRs, and merged PRs that are
# not released), plus the waiting branches of the fork listed in patches/abaplint-branches.txt (fixes not
# opened upstream yet, see docs/abaplint_roadmap.md). Each one is merged into a scratch worktree of the
# abaplint checkout, so the checkout itself is left alone. When both lists come out empty, delete the patch and
# the postinstall hook.
#
# usage: scripts/abaplint-patch.sh <abaplint checkout> [<version>]
#   <version> defaults to the @abaplint/core version in package.json; to move to a newer release,
#   set it in package.json first (exact version), run npm install, then run this script.
# needs: git, gh, node, npm
set -e
author=arcanist123
root=$(cd "$(dirname "$0")/.." && pwd)
repo=$(cd "$1" && pwd)
version=${2:-$(cd "$root" && node -p "require('./package.json').dependencies['@abaplint/core']")}
work=$(mktemp -d)
trap 'git -C "$repo" worktree remove --force "$work/abl" 2>/dev/null; rm -rf "$work"' EXIT

upstream=https://github.com/abaplint/abaplint.git
git -C "$repo" fetch -q "$upstream" --tags
git -C "$repo" worktree add -q --detach "$work/abl" "v$version"
cd "$work/abl/packages/core"
npm install --no-audit --no-fund -s >/dev/null

build() { rm -rf build && npm run compile -s >/dev/null && npx api-extractor run --local >/dev/null && cp -r build "$work/$1"; }
build pristine

prs=$(gh pr list -R abaplint/abaplint --author "$author" --state all --limit 500 \
  --json number,state,mergeCommit -q '.[] | select(.state != "CLOSED") | "\(.number) \(.mergeCommit.oid // "-")"' |
  while read -r n c; do
    if [ "$c" = "-" ] || ! git merge-base --is-ancestor "$c" "v$version" 2>/dev/null; then echo "$n"; fi
  done | sort -n)
echo "PRs not in $version: $(echo $prs)"
for n in $prs; do
  git fetch -q "$upstream" "pull/$n/head:abap2go-pr$n"
  git -c user.name=abap2go -c user.email=abap2go@invalid merge -q --no-edit "abap2go-pr$n" ||
    { echo "PR $n does not merge cleanly onto $version"; exit 1; }
  git branch -q -D "abap2go-pr$n"
done
branches=$(grep -v '^#' "$root/patches/abaplint-branches.txt" 2>/dev/null | tr -d '\r' | grep . || true)
echo "waiting branches: $(echo $branches)"
for b in $branches; do
  git fetch -q "https://github.com/$author/abaplint.git" "$b:abap2go-branch"
  git -c user.name=abap2go -c user.email=abap2go@invalid merge -q --no-edit abap2go-branch ||
    { echo "branch $b does not merge cleanly onto $version and the PRs"; exit 1; }
  git branch -q -D abap2go-branch
done
[ -z "$prs$branches" ] || npx mocha --reporter dot >/dev/null || { echo "abaplint tests fail with the PRs and branches merged"; exit 1; }
build patched

cd "$root"
rm -rf node_modules/@abaplint/core && npm install --no-audit --no-fund --ignore-scripts -s
rm -f patches/@abaplint+core+*.patch
if [ -z "$prs$branches" ]; then echo "nothing to patch: remove the postinstall hook and patch-package"; exit 0; fi
# copy only the published files the PRs and branches change, so a local build's other differences stay out of the patch
(cd "$work/patched" && find src -name '*.js'; echo abaplint.d.ts) | while read -r f; do
  if ! cmp -s "$work/pristine/$f" "$work/patched/$f"; then
    mkdir -p "$(dirname "node_modules/@abaplint/core/build/$f")"
    cp "$work/patched/$f" "node_modules/@abaplint/core/build/$f"
  fi
done
npx patch-package @abaplint/core
{ [ -z "$prs" ] || echo "$prs" | sed 's/^/abaplint#/'; } > patches/abaplint-prs.txt

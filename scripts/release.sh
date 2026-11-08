#!/bin/sh
# Makes a GitHub release by hand: checks, tests, builds the Chrome zip, scans it, then tags and
# uploads it once you answer y. Nothing runs on GitHub's side.
#   sh scripts/release.sh 0.9.1              (or: pnpm release 0.9.1)
#   sh scripts/release.sh 0.9.1 --dry-run    stops before anything is committed, tagged or pushed
# The version is three numbers and can't be lower than package.json's (Chrome refuses a lower one).
# A new number is written to package.json and committed as "Release v0.9.1". 0.x = pre-release.
set -eu
cd "$(dirname "$0")/.."

fail() { echo "release: $*" >&2; exit 1; }
V="${1:-}"
DRY=""
if [ "${2:-}" = "--dry-run" ]; then DRY=1; fi
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "usage: sh scripts/release.sh <version, e.g. 0.9.1> [--dry-run]"
CUR="$(node -p "require('./package.json').version")"
[ "$(printf '%s\n%s\n' "$CUR" "$V" | sort -V | tail -n1)" = "$V" ] || fail "$V is lower than package.json's $CUR"
PRE=""
case "$V" in 0.*) PRE=1 ;; esac

echo "1/4 checks"
[ "$(git branch --show-current)" = main ] || fail "switch to main first"
[ -z "$(git status --porcelain)" ] || fail "commit or stash your changes first"
git fetch -q origin
git merge-base --is-ancestor origin/main HEAD || fail "main is behind GitHub; pull first"
if git rev-parse -q --verify "refs/tags/v$V" >/dev/null; then fail "tag v$V already exists"; fi
[ -z "$(git ls-remote --tags origin "v$V")" ] || fail "tag v$V already exists on GitHub"
gh auth status >/dev/null 2>&1 || fail "gh isn't signed in (gh auth login)"
pnpm -s compile
pnpm -s test --reporter=dot

if [ "$V" != "$CUR" ]; then
  npm pkg set version="$V"
  if [ -n "$DRY" ]; then trap 'git checkout -q -- package.json' EXIT; fi
fi

echo "2/4 build"
OUT=.output-release
B="$OUT/chrome-mv3"
ZIP="$OUT/speak-and-edit-$V-chrome.zip"
# A separate folder, so the copy Chrome has loaded from .output isn't touched. Never a smoke build,
# and always the public edition (README › Editions), whatever is set in this shell.
env -u SCRIBE_SMOKE -u SCRIBE_FULL -u SCRIBE_SCREENS -u SCRIBE_STORE SCRIBE_OUT="$OUT" pnpm -s exec wxt zip >/dev/null
[ -f "$ZIP" ] || fail "no $ZIP after the build"

echo "3/4 scan the build for things that must not ship"
[ ! -e "$B/smoke.html" ] || fail "the smoke page is in the build"
if find "$B" -name '*.map' | grep -q .; then fail "source maps are in the build"; fi
SMOKE_ID="$(sed -n 's/^WXT_SMOKE_OVERLEAF_PROJECT=//p' .env 2>/dev/null | tr -d "\"' ")"
# Home-folder paths, email addresses, the smoke server, OpenAI/Anthropic and Google API keys,
# and the Overleaf test project. The Google client ID in the manifest is public by design.
for p in '/Users/' '@gmail\.com' '127\.0\.0\.1:8792' '(^|[^A-Za-z])sk-[A-Za-z0-9_-]{30}' 'AIza[0-9A-Za-z_-]{35}' ${SMOKE_ID:+"$SMOKE_ID"}; do
  if grep -rEq -- "$p" "$B"; then fail "found $p in $B"; fi
done
# The public edition: Google and ChatGPT only, nothing optional, and no Obsidian or Overleaf code.
node -e 'const m = require(require("path").resolve(process.argv[1], "manifest.json"));
const p = [...(m.host_permissions || []), ...(m.optional_host_permissions || [])].join(" ");
if (/localhost|127\.0\.0\.1|ollama|overleaf|openrouter|anthropic|groq|generativelanguage/.test(p)) { console.error(p); process.exit(1); }' "$B" \
  || fail "the build asks for full-edition permissions (README › Editions)"
for p in 'review-panel-add-comment-editor' 'showDirectoryPicker'; do
  if grep -rq -- "$p" "$B"; then fail "full-edition code ($p) is in the build"; fi
done

PREV="$(git describe --tags --abbrev=0 2>/dev/null || true)"
NOTES="$OUT/notes-v$V.md"
{
  echo "## Changes"
  echo
  git log --no-merges --pretty='- %s' "${PREV:+$PREV..}HEAD"
  echo
  echo "## Install"
  echo
  echo "1. Download \`speak-and-edit-$V-chrome.zip\` below and unzip it."
  echo "2. In Chrome, open \`chrome://extensions\`, turn on Developer mode, click Load unpacked and pick the unzipped folder."
  echo "3. Click the toolbar icon to open the side panel, sign in to Google in Outputs, and pick ChatGPT or the built-in model in AI model."
  echo
  echo "This is the public edition: Google Meet to Google Docs, Sheets and Slides. Obsidian, Overleaf, Ollama and API keys are in the full edition, built from source (README › Editions)."
} > "$NOTES"

echo "4/4 ready: $ZIP ($(du -h "$ZIP" | cut -f1 | tr -d ' '))"
echo "    release notes: $NOTES (edit them now if you want, before answering)"
if [ -n "$DRY" ]; then
  echo "dry run: nothing was committed, tagged or pushed"
  exit 0
fi
printf 'Publish v%s on GitHub%s? [y/N] ' "$V" "${PRE:+ as a pre-release}"
read -r ok
[ "$ok" = y ] || [ "$ok" = Y ] || fail "stopped; nothing was tagged or pushed"

if [ "$V" != "$CUR" ]; then git commit -q -m "Release v$V" -- package.json; fi
git tag -a "v$V" -m "v$V"
git push -q origin HEAD:main "refs/tags/v$V" || fail "push failed; the tag v$V exists only here. Fix it, then: git push origin main v$V"
gh release create "v$V" "$ZIP" --title "v$V" --notes-file "$NOTES" --verify-tag ${PRE:+--prerelease}

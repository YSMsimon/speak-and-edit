#!/bin/sh
# Builds Scribe with the smoke page, then asks the loaded smoke build to reload itself and run the
# end-to-end smoke test with the given AI provider (default: ollama). Results land in .smoke/smoke.log.
#   sh scripts/smoke-run.sh [ollama|chatgpt|chrome]
# Needs the smoke server running (node scripts/smoke-server.mjs) and a smoke build loaded once by hand.
set -e
cd "$(dirname "$0")/.."
PROVIDER="${1:-ollama}"
BUILT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
mkdir -p .smoke
SCRIBE_SMOKE=1 SCRIBE_BUILT="$BUILT" pnpm exec wxt build >/dev/null
: > .smoke/smoke.log
printf '{"build":"%s","run":"%s","nonce":"%s"}\n' "$BUILT" "$PROVIDER" "$BUILT" > .smoke/state.json
echo "built $BUILT; Scribe reloads within 30 s and runs the smoke test with $PROVIDER"

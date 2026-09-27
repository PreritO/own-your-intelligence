#!/usr/bin/env bash
# Seed an ISOLATED, project-local GBrain from fixtures/seed-brain/.
# Never touches the user's personal brain: GBRAIN_HOME points gbrain's config dir at
# <repo>/.gbrain (gitignored), and any DATABASE_URL override is dropped.
#
#   bash fixtures/seed-gbrain.sh          # init (once) + import + typed links
#   bash fixtures/seed-gbrain.sh --fresh  # wipe <repo>/.gbrain first
#
# Use the same env for every later gbrain call against this brain:
#   GBRAIN_HOME="$PWD" gbrain list -n 100
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GBRAIN_HOME="$ROOT"
unset DATABASE_URL GBRAIN_DATABASE_URL || true

case "$ROOT/.gbrain" in "$HOME/.gbrain") echo "refusing: would use the personal brain" >&2; exit 1 ;; esac
[ "${1:-}" = "--fresh" ] && rm -rf "$ROOT/.gbrain"

if [ ! -f "$ROOT/.gbrain/config.json" ]; then
  gbrain init --pglite --non-interactive --no-embedding
fi
# Links come from our typed "## Links" sections, not gbrain's prose heuristics.
gbrain config set auto_link false --force >/dev/null 2>&1

gbrain import "$ROOT/fixtures/seed-brain" --no-embed

# Typed edges: every "- kind: [[slug]]" line under "## Links" becomes an add_link with link_type=kind.
# (Import already stores these as untyped markdown links, link_type ""; the CLI `link --type` flag is
# silently ignored in v0.42, so we go through the raw tool call.)
cd "$ROOT/fixtures/seed-brain"
find . -name '*.md' | sort | while read -r f; do
  from="${f#./}"; from="${from%.md}"
  sed -n '/^## Links$/,$p' "$f" | sed -nE 's/^- ([a-z_]+): \[\[([^]|]+).*$/\1 \2/p' | while read -r kind to; do
    gbrain call add_link "{\"from\":\"$from\",\"to\":\"$to\",\"link_type\":\"$kind\"}" >/dev/null
  done
done
gbrain stats | head -5
echo "seeded isolated brain at $ROOT/.gbrain"

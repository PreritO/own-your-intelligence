#!/usr/bin/env bash
# Spawn the Agent Palace swarm: one Superset workspace + Claude agent per workspace.
# Usage: agents/launch.sh [workspace ...]   (default: all seven)
# Needs: superset auth login; SUPERSET_PROJECT set (superset projects list).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SUPERSET_PROJECT:?set SUPERSET_PROJECT to the project id from 'superset projects list'}"
BASE="${BASE_BRANCH:-main}"
WS=("$@"); [ ${#WS[@]} -eq 0 ] && WS=(seed export scene ufo-ext qm-fork presence training)
for w in "${WS[@]}"; do
  echo "→ $w"
  superset ws create --local --project "$SUPERSET_PROJECT" --name "$w" \
    --branch "ws/$w" --base-branch "$BASE" \
    --agent claude --prompt "$(cat "agents/prompts/$w.md")"
done

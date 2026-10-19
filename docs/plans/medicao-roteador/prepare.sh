#!/usr/bin/env bash
# Prepara os snapshots do estado anterior a cada commit, o gabarito e os índices.
# Uso: PROJECT=<projeto> WORK=/tmp/medicao bash prepare.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$(cd "$HERE/../../../vscode-extension" && pwd)"
: "${PROJECT:?defina PROJECT}" "${WORK:?defina WORK}"
mkdir -p "$WORK"
for commit in $(node -p "Object.keys(require('$HERE/missions.json')).join(' ')"); do
  for kind in pre nocard; do
    rm -rf "$WORK/$kind-$commit" && mkdir -p "$WORK/$kind-$commit"
    git -C "$PROJECT" archive "$commit^" | tar -x -C "$WORK/$kind-$commit"
  done
  # Só a taxonomia: as notas contextuais atuais descrevem o estado posterior ao commit.
  mkdir -p "$WORK/pre-$commit/graphify-out"
  cp "$PROJECT/graphify-out/classification.json" "$WORK/pre-$commit/graphify-out/"
  git -C "$PROJECT" diff --name-only "$commit^" "$commit" > "$WORK/gold-$commit.txt"
  EXT="$EXT" node "$HERE/build-index.js" "$WORK/pre-$commit"
done

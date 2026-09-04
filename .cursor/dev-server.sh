#!/usr/bin/env bash
# Cloud Agent terminal: the Nimbalyst Electron dev server.
# Runs electron-vite dev against the headless X server started by start.sh.
# The Vite renderer dev server is served on http://localhost:5273.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$NVM_DIR/versions/node/$(nvm version 24)/bin:$PATH"
export DISPLAY=:99

cd "$REPO_ROOT/packages/electron"
exec npm run dev

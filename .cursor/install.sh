#!/usr/bin/env bash
# Cloud Agent install phase for Nimbalyst.
# Idempotent: prepares the Node 24 toolchain, headless-Electron system libraries,
# npm dependencies, and the workspace builds that `electron-vite dev` and the
# typecheck/test gate need. Safe to run repeatedly.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- Node 24 / npm 11 --------------------------------------------------------
# package.json requires node>=24 & npm>=11 and .npmrc sets engine-strict, so the
# repo's own node is mandatory. The exec-daemon prepends its bundled node to
# PATH, so force nvm's Node 24 to the front for every node/npm call below.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 24 >/dev/null
export PATH="$NVM_DIR/versions/node/$(nvm version 24)/bin:$PATH"
echo "[install] node $(node --version), npm $(npm --version)"

# --- Headless Electron/Chromium system libraries -----------------------------
# Only run apt when a representative library is missing (fast no-op once the base
# snapshot already carries them). Ubuntu 24.04 uses the t64 package variants.
if ! dpkg -s libgtk-3-0t64 >/dev/null 2>&1; then
  echo "[install] installing headless Electron system libraries"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb x11-utils dbus \
    libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 \
    libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2t64 libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
    libatspi2.0-0t64 libgtk-3-0t64
else
  echo "[install] headless Electron system libraries already present"
fi

# --- npm dependencies --------------------------------------------------------
npm ci

# --- Workspace builds required by the dev server & typecheck -----------------
# @nimbalyst/runtime and the workspace deps (tracker-core, extension-sdk) are
# consumed as built packages by electron-vite dev.
npm run build:workspace-deps
npm run build --workspace=@nimbalyst/runtime -- --logLevel warn

echo "[install] done"

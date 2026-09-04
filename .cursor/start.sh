#!/usr/bin/env bash
# Cloud Agent start phase for Nimbalyst.
# Brings up a headless X server (display :99) so the Electron GUI and Playwright
# E2E tests can run. Idempotent and returns promptly.
set -euo pipefail

export DISPLAY=:99

if xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "[start] Xvfb already running on :99"
  exit 0
fi

rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &

for _ in $(seq 1 40); do
  if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "[start] Xvfb ready on :99"
    exit 0
  fi
  sleep 0.25
done

echo "[start] ERROR: Xvfb failed to become ready on :99" >&2
cat /tmp/xvfb.log >&2 || true
exit 1

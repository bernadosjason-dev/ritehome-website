#!/bin/bash
set -euo pipefail

# Only runs in Claude Code on the web — a fresh remote container every
# session, so nothing installed last time is still here this time.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# This repo has no package.json / build step — the one recurring
# dependency across sessions is the Wrangler CLI, needed to deploy
# cloudflare-worker/ (Hannah's backend). Installing it every session
# start means nobody has to remember to do it, or hit a missing-command
# error mid-task.
if ! command -v wrangler >/dev/null 2>&1; then
  npm install -g wrangler
fi

# Deploying still needs Cloudflare auth. This hook can't set that up —
# CLOUDFLARE_API_TOKEN has to come from this environment's own
# persistent secrets (set once in the environment's settings, not in
# this repo). Just leave a clear, non-fatal note if it's missing so a
# session doesn't discover this halfway through `wrangler deploy`.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "NOTE: wrangler is installed, but CLOUDFLARE_API_TOKEN is not set in this environment — 'wrangler deploy' will ask for an interactive login instead of just working. Add it under this environment's persistent secrets to fix that for good." >&2
fi

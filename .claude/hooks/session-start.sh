#!/bin/bash
# Installiert in Cloud-Sessions (claude.ai/code) automatisch die Abhängigkeiten,
# damit jeder Agent sofort `npm run check` ausführen kann.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund

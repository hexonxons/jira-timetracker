#!/usr/bin/env bash
# Builds what is missing and starts the app on http://127.0.0.1:8765
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x backend/.venv/bin/python ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -e backend
fi
if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src -newer frontend/dist/index.html -print -quit)" ]; then
  (cd frontend && { [ -d node_modules ] || npm ci; } && npm run build)
fi
exec backend/.venv/bin/python -m jtt "$@"

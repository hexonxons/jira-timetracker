#!/usr/bin/env bash
# Builds what is missing and starts the app on http://127.0.0.1:8765 (Linux, macOS).
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo "ERROR: $*" >&2; exit 1; }

PYTHON=${PYTHON:-python3}
command -v "$PYTHON" >/dev/null || fail "python3 not found. Install Python 3.10+ (see docs/INSTALL.md)."
"$PYTHON" -c 'import sys; sys.exit(sys.version_info < (3, 10))' || fail "Python 3.10+ is required, found $("$PYTHON" --version)."

if [ ! -x backend/.venv/bin/python ]; then
  "$PYTHON" -m venv backend/.venv || fail "Cannot create a virtualenv. On Ubuntu: sudo apt install python3-venv"
  backend/.venv/bin/python -m pip install -q --upgrade pip
  backend/.venv/bin/python -m pip install -q -e backend
fi

if [ ! -f frontend/dist/index.html ] || [ -n "$(find frontend/src -newer frontend/dist/index.html -print | head -n 1)" ]; then
  command -v node >/dev/null || fail "Node.js not found. Install Node.js 22.12+ (see docs/INSTALL.md)."
  node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' \
    || fail "Node.js 22.12+ is required, found $(node --version)."
  (cd frontend && { [ -d node_modules ] || npm ci; } && npm run build)
fi

exec backend/.venv/bin/python -m jtt "$@"

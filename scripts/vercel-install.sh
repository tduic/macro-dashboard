#!/usr/bin/env bash
# Install step for the static public build (Vercel's installCommand).
# Creates a throwaway venv for the snapshot exporter and installs the
# frontend's locked deps. Safe to run locally too.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=""
for cand in python3.13 python3.12 python3.14 python3; do
  if command -v "$cand" >/dev/null 2>&1 &&
     "$cand" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
    PY="$cand"
    break
  fi
done
if [ -z "$PY" ]; then
  echo "error: need Python 3.11+ on PATH for backend/snapshot.py" >&2
  exit 1
fi
echo ">> using $("$PY" --version)"

"$PY" -m venv .venv-build
.venv-build/bin/python -m pip install --quiet --upgrade pip
.venv-build/bin/python -m pip install --quiet -r backend/requirements.txt
npm ci --prefix frontend

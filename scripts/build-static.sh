#!/usr/bin/env bash
# Build step for the static public build (Vercel's buildCommand).
#   1. backend/snapshot.py calls every API route in-process and writes the
#      responses to frontend/public/snapshot/ (fails the build if the
#      upstream fetches came back nearly empty, so a bad run never replaces
#      a good deployment).
#   2. vite builds the frontend in snapshot mode into frontend/dist/.
# FRED_API_KEY is read from the environment if set (Vercel project env var);
# without it the FRED panels are left out. Nothing secret is written to disk.
set -euo pipefail
cd "$(dirname "$0")/.."

PY="${PYTHON:-.venv-build/bin/python}"
"$PY" backend/snapshot.py
npm run build:static --prefix frontend

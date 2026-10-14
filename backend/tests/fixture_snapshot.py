"""Render a complete static snapshot from the offline fakes (no network).

    cd backend && python -m tests.fixture_snapshot            # -> frontend/public/snapshot/
    cd backend && python -m tests.fixture_snapshot --out DIR

Runs the real snapshot pipeline (backend/snapshot.py) with every upstream
swapped for tests/fakes.py, and stamps meta.json with source="fixture" so the
frontend labels it as test data. CI uses this to build and smoke the static
frontend; it is never what gets deployed (Vercel runs snapshot.py live).
"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timezone
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import cache  # noqa: E402
import snapshot  # noqa: E402
from tests.fakes import fake_upstreams  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Write a fixture snapshot from offline fakes.")
    p.add_argument("--out", type=Path, default=snapshot.DEFAULT_OUT)
    p.add_argument("--end", type=date.fromisoformat, default=None,
                   help="last observation date for the fake series (default: today, UTC)")
    args = p.parse_args(argv)

    now = datetime.now(timezone.utc)
    end = args.end or now.date()
    cache.clear_all()
    with fake_upstreams(end=end, now=now):
        snapshot.run(args.out, min_indicators=1, source="fixture", now=now)
    cache.clear_all()
    return 0


if __name__ == "__main__":
    sys.exit(main())

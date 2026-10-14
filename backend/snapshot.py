"""Write a static snapshot of every API response the frontend reads.

The public build has no server: this script calls the FastAPI route handlers
in-process (via TestClient, so the exact production code paths and response
shapes are used) and writes each response to a JSON file. The frontend's
snapshot mode (VITE_DATA_MODE=snapshot) reads those files instead of /api/*.

    python backend/snapshot.py                      # -> frontend/public/snapshot/
    python backend/snapshot.py --out /tmp/snap      # elsewhere

Files written (paths relative to --out):

    meta.json                      generatedAt, source, fredEnabled, categories,
                                   which history files exist, events window
    indicators.json                GET /api/indicators
    news.json                      GET /api/news
    calendar.json                  GET /api/calendar
    curves-ust.json                GET /api/curves/ust
    events.json                    GET /api/events over one wide window; the
                                   frontend filters it to each requested range
    history/<ID>/<RANGE>.json      GET /api/indicators/<ID>/history?range=<RANGE>
                                   for every indicator x every range, so chart
                                   clicks and the compare overlay work offline

FRED_API_KEY is read from the environment (or backend/.env locally) exactly as
the live app does; without it the FRED-backed panels are simply absent.

Exit status is non-zero when fewer than --min-indicators cards came back, so a
build whose upstream fetches all failed is rejected instead of publishing an
empty dashboard (on Vercel the previous deployment stays live).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

BACKEND_ROOT = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_ROOT.parent
DEFAULT_OUT = REPO_ROOT / "frontend" / "public" / "snapshot"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# One snapshot run walks every indicator x range; keep each upstream series
# cached for the whole run. Must be set before the data modules are imported.
os.environ.setdefault("MACRO_CACHE_MIN_TTL", "3600")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

log = logging.getLogger("snapshot")

SNAPSHOT_FORMAT = 1
RANGES: tuple[str, ...] = ("1W", "1M", "3M", "6M", "YTD", "1Y", "5Y")

# Events window: back far enough to cover the 5Y chart range, forward far
# enough for the release strip (+60d from the viewer's today) to keep working
# for a while after the build.
EVENTS_LOOKBACK_DAYS = 5 * 366 + 14
EVENTS_LOOKAHEAD_DAYS = 180

# Indicator ids become path segments; refuse anything that isn't a plain token.
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


class SnapshotError(RuntimeError):
    pass


def _get(client: TestClient, url: str) -> dict:
    r = client.get(url)
    if r.status_code != 200:
        raise SnapshotError(f"GET {url} -> {r.status_code}: {r.text[:200]}")
    return r.json()


def build_snapshot(
    client: TestClient,
    *,
    now: Optional[datetime] = None,
    source: str = "live",
) -> dict[str, Any]:
    """Call every route the frontend reads; return {relative_path: payload}."""
    now = now or datetime.now(timezone.utc)
    files: dict[str, Any] = {}

    indicators = _get(client, "/api/indicators")
    files["indicators.json"] = indicators
    files["news.json"] = _get(client, "/api/news")
    files["calendar.json"] = _get(client, "/api/calendar")
    files["curves-ust.json"] = _get(client, "/api/curves/ust")

    history_index: dict[str, list[str]] = {}
    for ind in indicators.get("indicators", []):
        ind_id = str(ind.get("id", ""))
        if not _SAFE_ID.match(ind_id):
            log.warning("skipping history for unsafe indicator id %r", ind_id)
            continue
        for rng in RANGES:
            r = client.get(f"/api/indicators/{ind_id}/history", params={"range": rng})
            if r.status_code != 200:
                log.warning("history %s %s -> %s; omitted", ind_id, rng, r.status_code)
                continue
            files[f"history/{ind_id}/{rng}.json"] = r.json()
            history_index.setdefault(ind_id, []).append(rng)

    # Monthly releases anchor their 5Y range to the last print (weeks before
    # today), so start the window at whichever is older.
    today = now.date()
    oldest = [
        body["points"][0]["date"]
        for path, body in files.items()
        if path.startswith("history/") and body.get("points")
    ]
    ev_from = min([(today - timedelta(days=EVENTS_LOOKBACK_DAYS)).isoformat(), *oldest])
    ev_to = (today + timedelta(days=EVENTS_LOOKAHEAD_DAYS)).isoformat()
    files["events.json"] = _get(client, f"/api/events?from={ev_from}&to={ev_to}")

    meta = _get(client, "/api/meta")
    generated_at = now.isoformat()
    files["meta.json"] = {
        "format": SNAPSHOT_FORMAT,
        "generatedAt": generated_at,
        # "live" = fetched from the real upstreams at build time;
        # "fixture" = produced from the offline test fakes (never deployed).
        "source": source,
        "fredEnabled": meta["fredEnabled"],
        "categories": meta["categories"],
        "lastRefreshed": generated_at,
        "indicatorCount": indicators.get("count", 0),
        "newsCount": files["news.json"].get("count", 0),
        "ranges": list(RANGES),
        "history": history_index,
        "eventsWindow": {"from": ev_from, "to": ev_to},
    }
    return files


def write_snapshot(files: dict[str, Any], out_dir: Path) -> int:
    """Replace out_dir with the snapshot files. Returns total bytes written."""
    out_dir = Path(out_dir)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    total = 0
    for rel, payload in sorted(files.items()):
        path = out_dir / rel
        # belt and braces: never write outside out_dir
        if out_dir.resolve() not in path.resolve().parents:
            raise SnapshotError(f"refusing to write outside {out_dir}: {rel}")
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
        path.write_text(text, encoding="utf-8")
        total += len(text)
    return total


def run(out_dir: Path, *, min_indicators: int = 1, source: str = "live",
        now: Optional[datetime] = None) -> dict[str, Any]:
    """Build + write a snapshot. Raises SnapshotError if it's too thin to publish."""
    # TestClient logs every in-process request at INFO; that's ~400 lines of noise.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    # One TestClient context = one event-loop portal for all ~400 requests.
    with TestClient(main.app) as client:
        files = build_snapshot(client, now=now, source=source)
    count = files["meta.json"]["indicatorCount"]
    if count < min_indicators:
        raise SnapshotError(
            f"only {count} indicators came back (need >= {min_indicators}); "
            "upstream fetches probably failed, not publishing this snapshot"
        )
    size = write_snapshot(files, out_dir)
    meta = files["meta.json"]
    log.info(
        "wrote %d files (%.1f MB) to %s: %d indicators, %d news items, fred=%s",
        len(files), size / 1e6, out_dir, count, meta["newsCount"], meta["fredEnabled"],
    )
    return files


def main_cli(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"output dir (default {DEFAULT_OUT})")
    p.add_argument("--min-indicators", type=int, default=10,
                   help="fail if fewer indicator cards than this came back (default 10)")
    args = p.parse_args(argv)
    try:
        run(args.out, min_indicators=args.min_indicators)
    except SnapshotError as exc:
        log.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main_cli())


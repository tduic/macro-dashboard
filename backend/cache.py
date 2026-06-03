"""Tiny TTL cache helper.

Wraps cachetools.TTLCache instances keyed by a logical "bucket" so that
different data domains can have different time-to-live values:

    market data  -> ~60s
    FRED series  -> ~6h
    news         -> ~10min

Usage:
    from cache import cached

    @cached("market", ttl=60)
    def fetch_quote(ticker: str):
        ...

The decorator keys on the function name + args, so different arguments are
cached independently. Thread-safe enough for uvicorn's default worker model
(a lock guards each bucket).
"""
from __future__ import annotations

import functools
import threading
from typing import Any, Callable

from cachetools import TTLCache
from cachetools.keys import hashkey

# One TTLCache per bucket, created lazily.
_caches: dict[str, TTLCache] = {}
_locks: dict[str, threading.Lock] = {}
_global_lock = threading.Lock()

# Sensible TTL defaults per bucket (seconds). Callers can override.
DEFAULT_TTLS = {
    "market": 60,
    "fred": 6 * 60 * 60,
    "news": 10 * 60,
    "calendar": 6 * 60 * 60,
}


def _get_bucket(name: str, ttl: int, maxsize: int = 512) -> tuple[TTLCache, threading.Lock]:
    with _global_lock:
        if name not in _caches:
            _caches[name] = TTLCache(maxsize=maxsize, ttl=ttl)
            _locks[name] = threading.Lock()
        return _caches[name], _locks[name]


def cached(bucket: str, ttl: int | None = None, maxsize: int = 512) -> Callable:
    """Decorator: cache a function's return value in the named bucket."""
    resolved_ttl = ttl if ttl is not None else DEFAULT_TTLS.get(bucket, 60)

    def decorator(func: Callable) -> Callable:
        cache, lock = _get_bucket(bucket, resolved_ttl, maxsize)

        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            key = hashkey(func.__name__, *args, **kwargs)
            with lock:
                if key in cache:
                    return cache[key]
            # Compute outside the lock so slow upstream calls don't block
            # other keys in the same bucket.
            result = func(*args, **kwargs)
            with lock:
                cache[key] = result
            return result

        # expose a way to clear this function's bucket (used by manual refresh)
        wrapper.cache_clear = lambda: _clear_bucket(bucket)  # type: ignore[attr-defined]
        return wrapper

    return decorator


def _clear_bucket(bucket: str) -> None:
    with _global_lock:
        if bucket in _caches:
            with _locks[bucket]:
                _caches[bucket].clear()


def clear_all() -> None:
    """Drop every cache bucket (used by the manual /api/refresh endpoint)."""
    with _global_lock:
        for name, c in _caches.items():
            with _locks[name]:
                c.clear()

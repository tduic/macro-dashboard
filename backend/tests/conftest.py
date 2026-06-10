"""Make the backend package root importable (data/, cache.py live there)."""
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import pytest  # noqa: E402

import cache  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_caches():
    """Several data-layer functions are @cached; never leak state across tests."""
    cache.clear_all()
    yield
    cache.clear_all()


class FakeResponse:
    """Minimal stand-in for requests.Response (json + raise_for_status)."""

    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


@pytest.fixture
def fake_response():
    return FakeResponse

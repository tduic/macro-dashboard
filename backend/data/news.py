"""RSS news aggregation.

Edit FEEDS to add/remove sources. Each item is tagged with a `category`
derived from its source. Dead/404 feeds are skipped with a logged warning —
one broken feed never breaks the endpoint.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from time import mktime
from typing import Optional

import feedparser

from cache import cached

log = logging.getLogger("news")

# Simple, editable feed list. (url, source label, category)
FEEDS: list[tuple[str, str, str]] = [
    ("https://www.cnbc.com/id/100003114/device/rss/rss.html", "CNBC", "Markets"),
    ("https://www.cnbc.com/id/20910258/device/rss/rss.html", "CNBC Economy", "Economy"),
    ("http://feeds.marketwatch.com/marketwatch/topstories/", "MarketWatch", "Markets"),
    ("https://www.federalreserve.gov/feeds/press_all.xml", "Federal Reserve", "Fed"),
    ("https://finance.yahoo.com/news/rssindex", "Yahoo Finance", "Markets"),
]

# A browser-ish UA helps with feeds that reject the default urllib agent.
_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) macro-dashboard/1.0"


# World-topic classification — each item gets zero or more tags based on
# substrings found in its headline (case-insensitive). Edit to tune.
# Keys define the topic name shown as a tab in the UI.
TOPIC_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Fed": (
        "fed ", "fed's", "fed-", "fomc", "powell", "rate cut", "rate hike",
        "interest rate", "central bank", "hawkish", "dovish", "fed chair",
    ),
    "Markets": (
        "s&p", "sp 500", "nasdaq", "dow ", "dow jones", "russell", "stocks",
        "equit", "bond", "treasur", "yield", "vix", "etf", "rally", "selloff",
        "sell-off", "all-time high", "record high", "nikkei", "ftse",
    ),
    "Economy": (
        "cpi", "inflation", "gdp", "payroll", "nonfarm", "jobs report",
        "unemployment", "jobless claims", "retail sales", "ppi", "pce",
        "consumer spending", "recession", "consumer confidence", "ism",
        "housing starts", "durable goods",
    ),
    "Energy": (
        "oil", "crude", "opec", "gasoline", "natural gas", "lng", "energy",
        "barrel", "wti", "brent",
    ),
    "Crypto": (
        "bitcoin", "ethereum", "btc", "ether ", "crypto", "blockchain",
        "stablecoin", "coinbase",
    ),
    "Tech": (
        "apple", "microsoft", "google", "alphabet", "nvidia", "amd", "tesla",
        "meta", "amazon", " ai ", " ai,", " ai.", "ai-", "artificial intel",
        "semiconductor", "chip ", "openai", "anthropic",
    ),
    "China": (
        "china", "beijing", "yuan", "shanghai", "xi jinping", "ccp", "chinese",
        "hong kong",
    ),
    "Geopolitics": (
        "russia", "ukraine", "israel", "gaza", "iran", "north korea",
        "sanction", "tariff", "trade war", "putin", "nato", "houthi",
        "venezuela", "middle east",
    ),
    "Earnings": (
        "earnings", "revenue", "guidance", "beat estimate", "miss estimate",
        "quarterly results", "q1 ", "q2 ", "q3 ", "q4 ",
    ),
}


def _classify_topics(title: str) -> list[str]:
    """Return the list of TOPIC_KEYWORDS keys whose patterns hit in the title."""
    t = f" {title.lower()} "  # pad so word-boundary-ish patterns work
    return [topic for topic, kws in TOPIC_KEYWORDS.items() if any(kw in t for kw in kws)]


def _parse_published(entry) -> Optional[str]:
    for attr in ("published_parsed", "updated_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                return datetime.fromtimestamp(mktime(t), tz=timezone.utc).isoformat()
            except Exception:  # noqa: BLE001
                continue
    return None


@cached("news", ttl=10 * 60)
def get_news(limit: int = 80) -> list[dict]:
    """Aggregate, dedupe and reverse-chron sort all feeds."""
    items: list[dict] = []
    for url, source, category in FEEDS:
        try:
            parsed = feedparser.parse(url, agent=_UA)
            if getattr(parsed, "bozo", 0) and not parsed.entries:
                log.warning("feed parse issue (no entries) for %s: %s", source, getattr(parsed, "bozo_exception", ""))
                continue
            for e in parsed.entries:
                title = (getattr(e, "title", "") or "").strip()
                link = (getattr(e, "link", "") or "").strip()
                if not title or not link:
                    continue
                items.append({
                    "title": title,
                    "source": source,
                    "url": link,
                    "publishedAt": _parse_published(e),
                    "category": category,
                    "topics": _classify_topics(title),
                })
        except Exception as exc:  # noqa: BLE001
            log.warning("feed failed for %s (%s): %s", source, url, exc)
            continue

    # de-dupe by normalized title and by url
    seen_titles: set[str] = set()
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for it in items:
        tkey = it["title"].lower()
        if tkey in seen_titles or it["url"] in seen_urls:
            continue
        seen_titles.add(tkey)
        seen_urls.add(it["url"])
        deduped.append(it)

    # reverse-chron; undated items sink to the bottom
    deduped.sort(key=lambda x: x["publishedAt"] or "", reverse=True)
    return deduped[:limit]

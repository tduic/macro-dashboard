"""Offline tests for data/news.py — topic classification, dedupe, ordering,
and dead-feed resilience. feedparser.parse is monkeypatched; no network.
"""
from types import SimpleNamespace
from time import gmtime

import pytest

from data import news


# ---- topic classification ---------------------------------------------------
@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Powell hints at rate cut after FOMC meeting", ["Fed"]),
        ("Beijing unveils stimulus as yuan slides", ["China"]),
        ("Treasury yields climb as stocks rally", ["Markets"]),
        ("Oil prices jump after OPEC output cut", ["Energy"]),
        ("Bitcoin tops $100k as crypto surges", ["Crypto"]),
        ("Nvidia earnings beat estimates on AI demand", ["Tech", "Earnings"]),
        ("Russia sanctions tighten amid Ukraine war", ["Geopolitics"]),
        ("CPI inflation cools; unemployment steady", ["Economy"]),
        ("Llamas escape petting zoo", []),
    ],
)
def test_classify_topics(title, expected):
    assert news._classify_topics(title) == expected


def test_classify_topics_is_case_insensitive_and_multi_tag():
    topics = news._classify_topics("FED CHAIR POWELL: S&P AT RECORD HIGH AS CHINA TARIFF LOOMS")
    assert set(topics) == {"Fed", "Markets", "China", "Geopolitics"}


# ---- feed plumbing -----------------------------------------------------------
def make_entry(title, link, published=None):
    e = SimpleNamespace(title=title, link=link)
    if published is not None:
        e.published_parsed = gmtime(published)  # epoch seconds -> struct_time
    return e


def make_parsed(entries, bozo=0, bozo_exception=None):
    return SimpleNamespace(entries=entries, bozo=bozo, bozo_exception=bozo_exception)


def patch_feeds(monkeypatch, feed_map, feeds):
    """feed_map: url -> parsed-feed object (or Exception to raise)."""
    monkeypatch.setattr(news, "FEEDS", feeds)

    def fake_parse(url, agent=None):
        result = feed_map[url]
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(news.feedparser, "parse", fake_parse)


def test_get_news_dedupes_by_title_and_url(monkeypatch):
    t = 1_750_000_000
    feed_a = make_parsed([
        make_entry("Stocks rally on Fed hopes", "https://a.example/1", t + 300),
        make_entry("Unique A story", "https://a.example/2", t + 200),
    ])
    feed_b = make_parsed([
        # same title, different URL -> dropped
        make_entry("STOCKS RALLY ON FED HOPES".title(), "https://b.example/1", t + 100),
        # different title, same URL as an A item -> dropped
        make_entry("Totally different headline", "https://a.example/2", t + 50),
        make_entry("Unique B story", "https://b.example/2", t),
    ])
    patch_feeds(monkeypatch, {"u-a": feed_a, "u-b": feed_b},
                [("u-a", "SrcA", "Markets"), ("u-b", "SrcB", "Economy")])

    items = news.get_news()
    titles = [i["title"] for i in items]
    assert titles == ["Stocks rally on Fed hopes", "Unique A story", "Unique B story"]


def test_get_news_reverse_chron_with_undated_items_last(monkeypatch):
    t = 1_750_000_000
    feed = make_parsed([
        make_entry("oldest", "https://x/1", t - 1000),
        make_entry("undated", "https://x/2"),  # no published_parsed
        make_entry("newest", "https://x/3", t + 1000),
        make_entry("middle", "https://x/4", t),
    ])
    patch_feeds(monkeypatch, {"u": feed}, [("u", "Src", "Markets")])

    items = news.get_news()
    assert [i["title"] for i in items] == ["newest", "middle", "oldest", "undated"]
    assert items[-1]["publishedAt"] is None
    assert items[0]["publishedAt"].endswith("+00:00")


def test_get_news_item_shape_and_source_category_tagging(monkeypatch):
    feed = make_parsed([make_entry("Powell speech moves stocks", "https://x/1", 1_750_000_000)])
    patch_feeds(monkeypatch, {"u": feed}, [("u", "Federal Reserve", "Fed")])

    (item,) = news.get_news()
    assert item["source"] == "Federal Reserve"
    assert item["category"] == "Fed"
    assert set(item) == {"title", "source", "url", "publishedAt", "category", "topics"}
    assert set(item["topics"]) == {"Fed", "Markets"}


def test_dead_feeds_dont_break_the_endpoint(monkeypatch):
    good = make_parsed([make_entry("survivor headline", "https://ok/1", 1_750_000_000)])
    feeds = [
        ("u-raise", "Raises", "Markets"),
        ("u-bozo", "Bozo", "Markets"),
        ("u-garbage", "Garbage", "Markets"),
        ("u-good", "Good", "Markets"),
    ]
    feed_map = {
        "u-raise": RuntimeError("connection reset"),
        # bozo with no entries -> skipped with a warning
        "u-bozo": make_parsed([], bozo=1, bozo_exception=ValueError("not xml")),
        # garbage entries missing title/link -> individually skipped
        "u-garbage": make_parsed([
            SimpleNamespace(),                              # neither title nor link
            make_entry("", "https://g/1"),                  # empty title
            make_entry("no link", ""),                      # empty link
            make_entry("   ", "https://g/2"),               # whitespace title
        ]),
        "u-good": good,
    }
    patch_feeds(monkeypatch, feed_map, feeds)

    items = news.get_news()  # must not raise
    assert [i["title"] for i in items] == ["survivor headline"]


def test_get_news_respects_limit(monkeypatch):
    t = 1_750_000_000
    feed = make_parsed([make_entry(f"story {n}", f"https://x/{n}", t + n) for n in range(10)])
    patch_feeds(monkeypatch, {"u": feed}, [("u", "Src", "Markets")])
    assert len(news.get_news(limit=4)) == 4


def test_bozo_feed_with_entries_is_still_used(monkeypatch):
    # feedparser often sets bozo=1 for minor XML issues while still parsing
    # entries; those must not be discarded.
    feed = make_parsed(
        [make_entry("imperfect but usable", "https://x/1", 1_750_000_000)],
        bozo=1, bozo_exception=ValueError("encoding mismatch"),
    )
    patch_feeds(monkeypatch, {"u": feed}, [("u", "Src", "Markets")])
    assert [i["title"] for i in news.get_news()] == ["imperfect but usable"]

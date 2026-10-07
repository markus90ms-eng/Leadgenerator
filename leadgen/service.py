"""Geschäftslogik zwischen Datenquellen, Scoring und Datenbank."""

from . import news, overpass
from .categories import CATEGORIES
from .scoring import score

SEARCH_CACHE_SECONDS = 24 * 3600
NEW_CACHE_SECONDS = 6 * 3600
NEWS_CACHE_SECONDS = 3 * 3600


def _finish(store, ags, leads):
    known = store.known_categories(ags)
    for lead in leads:
        lead["score"], lead["score_reasons"] = score(lead)
    fresh = set(store.upsert(leads))
    store.annotate(leads)
    for lead in leads:
        # "Neu seit letztem Scan" nur, wenn die Branche im Kreis schon einmal gescannt wurde
        lead["fresh"] = lead["category"] in known and lead["id"] in fresh
    leads.sort(key=lambda l: (-l["fresh"], -l["score"], l["name"].lower()))
    return leads


def _validate(category_ids):
    cats = [c for c in category_ids if c in CATEGORIES] or list(CATEGORIES)
    return sorted(cats)


def search_companies(store, ags, category_ids, refresh=False, new_months=12):
    leads = []
    since = overpass.iso_months_ago(new_months)
    for cid in _validate(category_ids):
        key = f"search:{ags}:{cid}"
        cached = None if refresh else store.cache_get(key, SEARCH_CACHE_SECONDS)
        if cached is None:
            cached = overpass.search(ags, [cid])
            store.cache_set(key, cached)
        leads.extend(cached)
    new_ids = {l["id"]: l["new_reason"] for l in overpass.detect_new(leads, since)}
    for lead in leads:
        lead["new_reason"] = new_ids.get(lead["id"], "")
    return _finish(store, ags, leads)


def find_new(store, ags, category_ids, months=6, refresh=False):
    cats = _validate(category_ids)
    since = overpass.iso_months_ago(months)
    key = f"new:{ags}:{months}:{','.join(cats)}"
    leads = None if refresh else store.cache_get(key, NEW_CACHE_SECONDS)
    if leads is None:
        leads = overpass.detect_new(overpass.search(ags, cats, newer_than=since), since)
        store.cache_set(key, leads)
    return _finish(store, ags, leads)


def news_radar(store, ags, topics=None, days=30, refresh=False):
    topics = [t for t in (topics or []) if t in news.TOPICS] or list(news.TOPICS)
    key = f"news:{ags}:{days}:{','.join(sorted(topics))}"
    items = None if refresh else store.cache_get(key, NEWS_CACHE_SECONDS)
    if items is None:
        items = news.search_news(ags, topics, days)
        store.cache_set(key, items)
    return items

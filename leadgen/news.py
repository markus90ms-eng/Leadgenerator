"""News-Radar: findet Meldungen zu Neueröffnungen, Gründungen und Start-ups
in den Orten eines Kreises (über den öffentlichen Google-News-RSS-Feed)."""

import email.utils
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

from .regions import get_kreis

USER_AGENT = "Mozilla/5.0 (Leadgenerator-BW)"

TOPICS = {
    "eroeffnung": '("Neueröffnung" OR "neu eröffnet" OR "eröffnet" OR "Eröffnung")',
    "gruendung": '("Gründung" OR "gegründet" OR "Gründer" OR "Gründerin")',
    "startup": '("Startup" OR "Start-up" OR "Jungunternehmen" OR "Finanzierungsrunde")',
    "expansion": '("neuer Standort" OR "Neubau" OR "zieht um" OR "expandiert" OR "Filiale")',
}
TOPIC_LABELS = {
    "eroeffnung": "Neueröffnung",
    "gruendung": "Gründung",
    "startup": "Start-up",
    "expansion": "Expansion / neuer Standort",
}


def feed_url(query, days):
    q = f"{query} when:{days}d"
    return "https://news.google.com/rss/search?" + urllib.parse.urlencode(
        {"q": q, "hl": "de", "gl": "DE", "ceid": "DE:de"}
    )


def parse_feed(xml_bytes, topic, ort):
    items = []
    root = ET.fromstring(xml_bytes)
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        source = (item.findtext("source") or "").strip()
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        pub = item.findtext("pubDate") or ""
        try:
            published = email.utils.parsedate_to_datetime(pub).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            published = ""
        items.append({
            "title": title,
            "link": (item.findtext("link") or "").strip(),
            "source": source,
            "published": published,
            "topic": TOPIC_LABELS[topic],
            "ort": ort,
        })
    return items


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def search_news(ags, topics=None, days=30, fetch=_fetch):
    kreis = get_kreis(ags)
    topics = topics or list(TOPICS)
    jobs = [(topic, ort) for topic in topics for ort in kreis["orte"]]

    def run(job):
        topic, ort = job
        try:
            return parse_feed(fetch(feed_url(f'{TOPICS[topic]} "{ort}"', days)), topic, ort)
        except Exception:
            return []

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = [item for batch in pool.map(run, jobs) for item in batch]

    # Dubletten (gleicher Titel aus mehreren Abfragen) entfernen
    unique = {}
    for item in results:
        key = re.sub(r"\W+", "", item["title"].lower())
        unique.setdefault(key, item)
    return sorted(unique.values(), key=lambda i: i["published"], reverse=True)

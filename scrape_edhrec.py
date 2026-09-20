#!/usr/bin/env python3
"""Scrape EDHREC commander pages into a local gzip cache.

Two documents per commander:
  pages/commanders/<slug>.json    - card inclusion counts + synergy scores
  pages/average-decks/<slug>.json - the average 100-card list

Polite by construction: global rate limit, small worker pool, exponential backoff,
and a disk cache so re-runs cost nothing. Resumable - just run it again.
"""
import gzip, json, os, queue, random, sys, threading, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "edhrec")
SITEMAP = "https://edhrec.com/sitemaps/commanders.xml"
TAG_SITEMAP = "https://edhrec.com/sitemaps/tags.xml"
BASE = "https://json.edhrec.com/pages"
UA = "mtg-budget-research/0.1 (personal deckbuilding research; contact ndschonegg@gmail.com)"

RATE = float(os.environ.get("EDHREC_RATE", "4.0"))      # requests/second, global
WORKERS = int(os.environ.get("EDHREC_WORKERS", "4"))
MAX_AGE = float(os.environ.get("EDHREC_MAX_AGE", str(14 * 86400)))  # refetch older than this

_lock = threading.Lock()
_next_slot = [0.0]
_stat = {"hit": 0, "get": 0, "404": 0, "err": 0}


def throttle():
    with _lock:
        now = time.time()
        slot = max(now, _next_slot[0])
        _next_slot[0] = slot + 1.0 / RATE
    d = slot - time.time()
    if d > 0:
        time.sleep(d)


def cache_path(kind, slug):
    return os.path.join(CACHE, kind, slug[:2], slug + ".json.gz")


def fetch(kind, slug, tries=4):
    """kind: 'commanders' | 'average-decks'. Returns dict, or None for a real 404."""
    path = cache_path(kind, slug)
    if os.path.exists(path):
        age = time.time() - os.path.getmtime(path)
        if age < MAX_AGE:
            with _lock:
                _stat["hit"] += 1
            try:
                with gzip.open(path, "rt", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                os.remove(path)      # corrupt cache entry, refetch

    url = "%s/%s/%s.json" % (BASE, kind, slug)
    for attempt in range(tries):
        throttle()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
            doc = json.loads(raw)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".part"
            with gzip.open(tmp, "wt", encoding="utf-8") as f:
                json.dump(doc, f)
            os.replace(tmp, path)
            with _lock:
                _stat["get"] += 1
            return doc
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                with _lock:
                    _stat["404"] += 1
                return None
            if e.code == 429 or e.code >= 500:
                time.sleep((2 ** attempt) + random.random())
                continue
            with _lock:
                _stat["err"] += 1
            return None
        except Exception:
            time.sleep((2 ** attempt) + random.random())
    with _lock:
        _stat["err"] += 1
    return None


def theme_slugs():
    """Base theme slugs (no colour/budget variants) from EDHREC's tags sitemap."""
    path = os.path.join(CACHE, "tags-sitemap.xml")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > MAX_AGE:
        os.makedirs(CACHE, exist_ok=True)
        throttle()
        req = urllib.request.Request(TAG_SITEMAP, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            open(path, "wb").write(r.read())
    root = ET.parse(path).getroot()
    out = set()
    for e in root.iter():
        if e.tag.endswith("loc") and e.text and "/tags/" in e.text:
            out.add(e.text.split("/tags/")[-1].strip("/").split("/")[0])
    return sorted(out)


def scrape_themes():
    slugs = theme_slugs()
    print("themes: %d" % len(slugs), flush=True)
    t0 = time.time()
    for i, slug in enumerate(slugs, 1):
        fetch("tags", slug)
        if i % 50 == 0 or i == len(slugs):
            print("%5d/%d themes  %.0fs  %s" % (i, len(slugs), time.time() - t0, _stat), flush=True)


def commander_slugs():
    """Slug list from EDHREC's own sitemap (robots.txt advertises it)."""
    path = os.path.join(CACHE, "commanders-sitemap.xml")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > MAX_AGE:
        os.makedirs(CACHE, exist_ok=True)
        throttle()
        req = urllib.request.Request(SITEMAP, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            open(path, "wb").write(r.read())
    root = ET.parse(path).getroot()
    ns = {"s": "https://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [e.text for e in root.iter()
            if e.tag.endswith("loc") and e.text and "/commanders/" in e.text]
    return sorted({u.rstrip("/").rsplit("/", 1)[-1] for u in locs})


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    slugs = commander_slugs()
    if limit:
        slugs = slugs[:limit]
    jobs = queue.Queue()
    for s in slugs:
        jobs.put(s)
    total = len(slugs)
    print("commanders: %d   rate: %.1f/s   workers: %d" % (total, RATE, WORKERS), flush=True)
    t0 = time.time()
    done = [0]

    def worker():
        while True:
            try:
                slug = jobs.get_nowait()
            except queue.Empty:
                return
            fetch("commanders", slug)
            fetch("average-decks", slug)
            with _lock:
                done[0] += 1
                n = done[0]
            if n % 100 == 0 or n == total:
                el = time.time() - t0
                eta = el / n * (total - n)
                print("%5d/%d  %.0f%%  %.0fs elapsed  eta %.0fm  %s"
                      % (n, total, 100.0 * n / total, el, eta / 60, _stat), flush=True)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(WORKERS)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    print("done in %.0fs  %s" % (time.time() - t0, _stat), flush=True)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "themes":
        scrape_themes()
    else:
        main()

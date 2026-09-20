#!/usr/bin/env python3
"""Download a Scryfall bulk-data file (gzipped JSONL) into data/."""
import json, os, sys, urllib.request

UA = {"User-Agent": "mtg-budget-research/0.1", "Accept": "*/*"}
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")


def bulk_index():
    req = urllib.request.Request("https://api.scryfall.com/bulk-data", headers=UA)
    with urllib.request.urlopen(req) as r:
        return json.load(r)["data"]


def fetch(kind="default_cards"):
    entry = next(e for e in bulk_index() if e["type"] == kind)
    os.makedirs(DATA, exist_ok=True)
    dest = os.path.join(DATA, kind + ".jsonl.gz")
    meta = {"type": kind, "updated_at": entry["updated_at"],
            "uri": entry["jsonl_download_uri"], "compressed_size": entry["compressed_size"]}
    metafile = dest + ".meta.json"
    if os.path.exists(dest) and os.path.exists(metafile):
        old = json.load(open(metafile))
        if old.get("updated_at") == meta["updated_at"]:
            print("up to date:", dest)
            return dest
    print("downloading %s (%.1f MB gz) ..." % (kind, entry["compressed_size"] / 1e6))
    req = urllib.request.Request(entry["jsonl_download_uri"], headers=UA)
    tmp = dest + ".part"
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, dest)
    json.dump(meta, open(metafile, "w"), indent=1)
    print("saved", dest, os.path.getsize(dest), "bytes")
    return dest


if __name__ == "__main__":
    for kind in (sys.argv[1:] or ["default_cards"]):
        fetch(kind)

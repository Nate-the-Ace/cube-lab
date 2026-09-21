#!/usr/bin/env python3
"""Update the prices inside docs/cube_data.json from Scryfall, without a database.

Everything else in the blob - combos, lift, composition, draft odds - needs the
full 1.3 GB build. Prices don't: they are one field per printing in Scryfall's
daily bulk file, and the blob names only a few hundred cards. So this is the one
part of the page CI can keep current on its own.

Scryfall's `usd` is the TCGPlayer market price. A card with no non-foil printing
falls back to the cheapest foil, which is what the loader does too.
"""
import gzip, json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BLOB = os.path.join(HERE, "docs", "ui_data.json")
UA = {"User-Agent": "mtg-cube-lab/1.0", "Accept": "*/*"}


def priced(doc):
    """Every dict in the blob that carries a price, wherever it sits.

    The blob is now whole endpoint responses rather than a hand-picked subset, so
    walking it beats naming the paths - a new priced field in any endpoint gets
    refreshed without touching this file."""
    found = []
    def walk(node):
        if isinstance(node, dict):
            if "oracle_id" in node and "price_usd" in node:
                found.append(node)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(doc)
    return found


def wanted(doc):
    return {c["oracle_id"] for c in priced(doc)}


def cheapest(ids):
    """Scan the bulk file once, keeping the lowest price seen per oracle_id."""
    entry = next(e for e in json.load(urllib.request.urlopen(
        urllib.request.Request("https://api.scryfall.com/bulk-data", headers=UA)))["data"]
        if e["type"] == "default_cards")
    cheap, foil, updated = {}, {}, entry["updated_at"][:10]
    with urllib.request.urlopen(urllib.request.Request(entry["jsonl_download_uri"], headers=UA)) as r:
        raw = gzip.GzipFile(fileobj=r)   # the JSONL bulk file is always gzipped
        for line in raw:
            line = line.strip().rstrip(b",")
            if not line.startswith(b"{"):
                continue
            card = json.loads(line)
            oid = card.get("oracle_id")
            if oid not in ids:
                continue
            pr = card.get("prices") or {}
            nonfoil, anyfoil = pr.get("usd"), pr.get("usd_foil") or pr.get("usd_etched")
            if nonfoil:
                v = float(nonfoil)
                cheap[oid] = v if oid not in cheap else min(cheap[oid], v)
            if anyfoil:
                v = float(anyfoil)
                foil[oid] = v if oid not in foil else min(foil[oid], v)
    best = dict(foil)
    best.update(cheap)          # a real nonfoil price always wins
    return best, updated


def main():
    with open(BLOB, encoding="utf-8") as f:
        doc = json.load(f)
    ids = wanted(doc)
    if not ids:
        sys.exit("blob names no cards")
    print("looking up %d cards" % len(ids))
    best, updated = cheapest(ids)
    print("found %d" % len(best))

    moved = 0
    for c in priced(doc):
        fresh = best.get(c["oracle_id"])
        if fresh is not None and fresh != c.get("price_usd"):
            c["price_usd"], moved = fresh, moved + 1
    # pair totals are derived, so recompute rather than trust the old ones
    for p in doc.get("synergies", {}).get("pairs", []):
        vals = [c.get("price_usd") for c in p.get("cards", [])]
        p["total_price"] = round(sum(v for v in vals if v), 2) if any(vals) else None
    doc.setdefault("stats", {})["scryfall_updated_at"] = updated

    with open(BLOB, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print("%d prices changed; blob now says %s" % (moved, updated))


if __name__ == "__main__":
    main()

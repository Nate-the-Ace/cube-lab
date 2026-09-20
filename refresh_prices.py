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
BLOB = os.path.join(HERE, "docs", "cube_data.json")
UA = {"User-Agent": "mtg-cube-lab/1.0", "Accept": "*/*"}


def wanted(doc):
    """Every oracle_id the page shows a price for."""
    ids = set()
    for c in doc.get("near", {}).get("cards", []):
        ids.add(c["oracle_id"])
    for p in doc.get("pairs", []):
        for c in p.get("cards", []):
            ids.add(c["oracle_id"])
    return ids


def cheapest(ids):
    """Scan the bulk file once, keeping the lowest price seen per oracle_id."""
    entry = next(e for e in json.load(urllib.request.urlopen(
        urllib.request.Request("https://api.scryfall.com/bulk-data", headers=UA)))["data"]
        if e["type"] == "default_cards")
    best, updated = {}, entry["updated_at"][:10]
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
            for key in ("usd", "usd_foil"):
                v = pr.get(key)
                if v:
                    v = float(v)
                    if oid not in best or v < best[oid]:
                        best[oid] = v
                    break
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
    for c in doc["near"]["cards"]:
        new = best.get(c["oracle_id"])
        if new is not None and new != c.get("price_usd"):
            c["price_usd"], moved = new, moved + 1
    for p in doc["pairs"]:
        for c in p["cards"]:
            new = best.get(c["oracle_id"])
            if new is not None and new != c.get("price_usd"):
                c["price_usd"], moved = new, moved + 1
        # the pair total is derived, so recompute it rather than trust the old one
        vals = [c.get("price_usd") for c in p["cards"]]
        p["total_price"] = round(sum(v for v in vals if v), 2) if any(vals) else None
    doc["built_from"]["prices"] = updated

    with open(BLOB, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print("%d prices changed; blob now says %s" % (moved, updated))


if __name__ == "__main__":
    main()

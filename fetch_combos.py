#!/usr/bin/env python3
"""Download the Commander Spellbook combo database.

Commander Spellbook publishes the whole variant list as one large static JSON
document, which is what they want bulk consumers to use - the paginated API rate
limits a crawl almost immediately. The file is ~650 MB, so it is streamed and
reduced to the handful of fields we need, written out as gzipped JSONL.

These are the combos people already KNOW about. We use them as the novelty
filter: a candidate our own analysis proposes is only "fresh" if it isn't here.
"""
import gzip, json, os, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "combos.jsonl.gz")
URL = "https://json.commanderspellbook.com/variants.json"
UA = {"User-Agent": "mtg-budget-research/0.1 (personal deckbuilding research)"}


def slim(v):
    """Keep the fields that decide whether a combo is actually assemblable.

    The first version dropped the prerequisites, which made combos look complete
    when they weren't: Boros Reckoner + Boros Charm lists two cards but also
    requires "a way to give Boros Reckoner lifelink" and "a way to deal damage to
    Boros Reckoner". Showing that as a two-card combo you can draft is wrong.
    """
    return {
        "id": v.get("id"),
        "cards": [u.get("card", {}).get("name") for u in (v.get("uses") or [])],
        "oracle_ids": [u.get("card", {}).get("oracleId") for u in (v.get("uses") or [])],
        "produces": [p.get("feature", {}).get("name") for p in (v.get("produces") or [])],
        "identity": v.get("identity"),
        "popularity": v.get("popularity"),
        "status": v.get("status"),
        "legal_commander": (v.get("legalities") or {}).get("commander"),
        "manaNeeded": v.get("manaNeeded"),
        "bracket": v.get("bracketTag"),
        "notable_prereqs": v.get("notablePrerequisites") or "",
        "easy_prereqs": v.get("easyPrerequisites") or "",
        "description": v.get("description") or "",
        "requires": [t.get("template", {}).get("name")
                     for t in (v.get("requires") or []) if isinstance(t, dict)],
    }


def main():
    req = urllib.request.Request(URL, headers=UA)
    dec = json.JSONDecoder()
    t0 = time.time()
    n = 0
    buf = ""
    started = False
    with urllib.request.urlopen(req, timeout=120) as r, \
            gzip.open(OUT + ".part", "wt", encoding="utf-8") as out:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            buf += chunk.decode("utf-8", "replace")
            if not started:
                i = buf.find("[")
                if i < 0:
                    continue
                buf = buf[i + 1:]
                started = True
            while True:
                s = buf.lstrip()
                if s[:1] in (",",):
                    s = s[1:].lstrip()
                if not s or s[0] == "]":
                    buf = s
                    break
                try:
                    obj, end = dec.raw_decode(s)
                except ValueError:
                    buf = s             # need more bytes
                    break
                out.write(json.dumps(slim(obj)) + "\n")
                n += 1
                buf = s[end:]
                if n % 5000 == 0:
                    print("%d combos, %.0fs" % (n, time.time() - t0), flush=True)
    os.replace(OUT + ".part", OUT)
    print("done: %d combos in %.0fs -> %s" % (n, time.time() - t0, OUT), flush=True)


if __name__ == "__main__":
    main()

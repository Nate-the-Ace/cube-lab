#!/usr/bin/env python3
"""Freeze one cube's analysis into a single JSON blob.

The live tool answers from a 1.3 GB database over a local server. A published
page has neither, so everything that doesn't depend on the draft settings is
computed once here and embedded. The draft maths itself is a dozen lines of
arithmetic and gets re-implemented in the page, so the sliders keep working.
"""
import argparse, json, os, sqlite3, sys

import cube

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "mtg.sqlite")


def main(cube_id, out):
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    meta = dict(con.execute("select * from cubes where id = ?", (cube_id,)).fetchone())
    stats = dict(con.execute("select key, value from meta").fetchall())

    combos = cube.cube_combos(con, cube_id)
    tactics = cube.cube_tactics(con, cube_id, need=6)
    syn = cube.cube_synergies(con, cube_id, limit=120)
    opp = cube.cube_opportunities(con, cube_id)
    bal = cube.cube_balance(con, cube_id)
    near = cube.cube_near_misses(con, cube_id, limit=60)

    # how many game nights the measured lane numbers rest on. The count is all
    # that travels - never a name, never a per-player figure.
    local_nights = 0
    try:
        import nights
        local_nights = len(nights.load()["nights"])
    except Exception:
        pass

    # strip the fields that only mean anything at the settings used here; the
    # page recomputes them from its own sliders
    for c in combos["known"] + combos["candidates"]:
        c.pop("p_draft", None)
        c.pop("drafts_to_hit", None)
    for t in tactics["tactics"]:
        t.pop("expected_drafted", None)
        t.pop("p_draft_enough", None)
    for l in tactics.get("lanes", []):
        l.pop("expected_drafted", None)
    for l in opp["lanes"]:
        l.pop("expected_drafted", None)
    for p in syn["pairs"]:
        p.pop("p_draft_both", None)

    doc = {
        "cube": {"name": meta["name"], "cards": meta["n_cards"],
                 "refreshed": meta.get("refreshed_at") or meta.get("created_at")},
        "built_from": {"cards": stats.get("n_cards"),
                       "prices": (stats.get("scryfall_updated_at") or "")[:10],
                       "combos": stats.get("n_combos"),
                       "commanders": stats.get("edhrec_commanders")},
        "combos": {"known": combos["known"], "candidates": combos["candidates"],
                   "self_contained": combos["known_self_contained"],
                   "needs_extra": combos["known_needs_extra"]},
        "near": near,
        "opportunity": opp["lanes"], "has_local": opp.get("has_local", False),
        "local_nights": local_nights,
        "lanes": tactics.get("lanes", []),
        "pairs": syn["pairs"], "pairs_total": syn["total_pairs"],
        "pairs_by_kind": syn["by_kind"],
        "tactics": tactics["tactics"],
        "functions": tactics["functions"],
        "balance": bal,
    }
    with open(out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    print("wrote %s  (%.0f KB)" % (out, os.path.getsize(out) / 1024))


def resolve(con, ref):
    """A cube can be named on the command line by id or by name; with nothing
    named at all, export the only cube there is."""
    rows = con.execute("select id, name from cubes order by name").fetchall()
    if not rows:
        sys.exit("no cubes loaded")
    if ref is None:
        if len(rows) > 1:
            sys.exit("name a cube: " + ", ".join(r["id"] for r in rows))
        return rows[0]["id"]
    for r in rows:
        if ref in (r["id"], r["name"]):
            return r["id"]
    sys.exit("no cube %r; have: %s" % (ref, ", ".join(r["id"] for r in rows)))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("cube", nargs="?", default=None, help="cube id or name")
    ap.add_argument("-o", "--out", default="/tmp/cube_data.json")
    a = ap.parse_args()
    _con = sqlite3.connect(DB)
    _con.row_factory = sqlite3.Row
    main(resolve(_con, a.cube), a.out)

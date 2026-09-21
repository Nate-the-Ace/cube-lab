#!/usr/bin/env python3
"""Freeze every read endpoint the cube page calls, so the real UI can run with no
server behind it.

The earlier export fed a hand-written page that reimplemented a fraction of the
tool. This one captures the ACTUAL endpoint responses, so static-shim.js can
answer ui/cube.js from them and the published page keeps every feature: card
previews, sortable tables, tooltips, lane picks, the lot.

Draft-dependent numbers are the exception. They move with the sliders, so they
are recomputed in the browser from the same arithmetic; what is stored here is
whatever the defaults produced, and the shim overwrites it per request.
"""
import argparse, json, os, sys

import mtgdb
import cube as C

HERE = os.path.dirname(os.path.abspath(__file__))
LANES = ["WU", "WB", "WR", "WG", "UB", "UR", "UG", "BR", "BG", "RG"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cube", nargs="?", default=None)
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "docs", "ui_data.json"))
    ap.add_argument("--pairs", type=int, default=400,
                    help="synergy pairs to keep (the page pages through them)")
    a = ap.parse_args()

    con = mtgdb.connect()
    cubes = C.list_cubes(con)
    if not cubes:
        sys.exit("no cubes loaded")
    cid = a.cube or cubes[0]["id"]
    if cid not in {c["id"] for c in cubes}:
        by_name = {c["name"]: c["id"] for c in cubes}
        cid = by_name.get(a.cube) or sys.exit("no cube %r" % a.cube)

    stats = mtgdb.stats(con)
    data = {
        "cube_id": cid,
        "cubes": [c for c in cubes if c["id"] == cid],
        "stats": {k: stats.get(k) for k in
                  ("n_cards", "n_printings", "n_sets", "n_combos", "n_tags",
                   "edhrec_commanders", "scryfall_updated_at", "source")},
        "combos": C.cube_combos(con, cid),
        "tactics": C.cube_tactics(con, cid, need=6),
        "synergies": C.cube_synergies(con, cid, limit=a.pairs),
        "opportunities": C.cube_opportunities(con, cid),
        "balance": C.cube_balance(con, cid),
        "near_misses": C.cube_near_misses(con, cid, limit=60),
        "picks": {lane: C.lane_picks(con, cid, lane, limit=15) for lane in LANES},
        # every cube card scored as a first pick, so the published page can deal
        # packs itself - it has no server to ask for a fresh one
        "p1p1": C.pick_scores(con, cid),
    }

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print("%s  %.0f KB" % (a.out, os.path.getsize(a.out) / 1024))
    for k, v in data.items():
        if isinstance(v, dict) and "cube_id" in v:
            print("   %-14s %s" % (k, ", ".join(
                "%s=%s" % (n, len(v[n])) for n in v if isinstance(v[n], list))))


if __name__ == "__main__":
    main()

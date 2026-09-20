#!/usr/bin/env python3
"""Local dashboard for the MTG card DB. stdlib only.  python3 server.py [port]"""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import mtgdb

HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, "ui")
_local = threading.local()


def con():
    if not hasattr(_local, "con"):
        _local.con = mtgdb.connect()
    return _local.con


def f(qs, key, cast=float):
    v = qs.get(key, [""])[0]
    if v == "":
        return None
    try:
        return cast(v)
    except ValueError:
        return None


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, name, ctype):
        """Serve a file from the ui/ folder. The name is fixed by the route, never
        taken from the request, so there is no path to traverse."""
        with open(os.path.join(UI, name), "rb") as fh:
            return self._send(200, fh.read(), ctype)

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        p = u.path
        try:
            if p in ("/", "/index.html"):
                return self._send_file("index.html", "text/html; charset=utf-8")
            if p in ("/cube", "/cube.html"):
                return self._send_file("cube.html", "text/html; charset=utf-8")
            if p in ("/shared.css", "/shared.js", "/cube.js"):
                kind = ("text/css" if p.endswith(".css")
                        else "application/javascript") + "; charset=utf-8"
                return self._send_file(p.lstrip("/"), kind)
            if p == "/api/stats":
                return self._send(200, mtgdb.stats(con()))
            if p == "/api/set-types":
                rows = con().execute("""
                    select s.set_type, count(distinct s.code) sets,
                           count(distinct p.oracle_id) cards
                    from sets s join printings p on p.set_code = s.code
                    group by s.set_type order by cards desc""")
                return self._send(200, [dict(r) for r in rows])
            if p == "/api/formats":
                rows = con().execute(
                    "select format, count(*) n from legalities where status in ('legal','restricted') group by format order by n desc")
                return self._send(200, [{"format": r[0], "n": r[1]} for r in rows])
            if p == "/api/search":
                g = lambda k: qs.get(k, [""])[0]
                return self._send(200, mtgdb.search(
                    con(), q=g("q"), fmt=g("fmt") or "", ci=g("ci"),
                    max_usd=f(qs, "max_usd"), min_usd=f(qs, "min_usd"),
                    types=g("types"), rarity=g("rarity"), sort=g("sort") or "price",
                    limit=min(int(f(qs, "limit", int) or 60), 300),
                    offset=int(f(qs, "offset", int) or 0),
                    funny=g("funny") or "include",
                    kind=g("kind") or "all",
                    set_type=g("set_type"), set_code=g("set")))
            if p == "/api/swaps":
                oid = qs.get("oracle_id", [""])[0]
                cap = f(qs, "max_usd") or 2.0
                lim = int(f(qs, "limit", int) or 24)
                # EDHREC co-occurrence beats the text heuristic whenever we have it
                if mtgdb.has_edhrec(con()):
                    d = mtgdb.swaps_edhrec(con(), oid, max_usd=cap, limit=lim,
                                           ci=qs.get("ci", [None])[0])
                    if d.get("results"):
                        return self._send(200, d)
                d = mtgdb.swaps(con(), oid, max_usd=cap,
                                fmt=qs.get("fmt", ["commander"])[0],
                                ci=qs.get("ci", [None])[0], limit=lim)
                d["method"] = "text"
                return self._send(200, d)
            if p == "/api/commanders":
                g = lambda k: qs.get(k, [""])[0]
                return self._send(200, mtgdb.commanders(
                    con(), q=g("q"), max_usd=f(qs, "max_usd"), ci=g("ci") or None,
                    min_decks=int(f(qs, "min_decks", int) or 0), sort=g("sort") or "popular",
                    limit=min(int(f(qs, "limit", int) or 60), 200),
                    offset=int(f(qs, "offset", int) or 0)))
            if p == "/api/staples":
                return self._send(200, mtgdb.commander_staples(
                    con(), qs.get("slug", [""])[0], max_usd=f(qs, "max_usd"),
                    limit=min(int(f(qs, "limit", int) or 150), 600)))
            if p == "/api/cubes":
                import cube as cube_mod
                return self._send(200, cube_mod.list_cubes(con()))
            if p == "/api/cube/near-misses":
                import cube as cube_mod
                return self._send(200, cube_mod.cube_near_misses(
                    con(), qs.get("cube_id", [""])[0],
                    limit=min(int(f(qs, "limit", int) or 40), 200),
                    max_extra=int(f(qs, "max_extra", int) or 0),
                    legal_only=qs.get("all_formats", [""])[0] != "1"))
            if p == "/api/cube/neighbors":
                import cube as cube_mod
                return self._send(200, cube_mod.cube_neighbors(
                    con(), qs.get("cube_id", [""])[0],
                    limit=min(int(f(qs, "limit", int) or 50), 500)))
            if p == "/api/cube/balance":
                import cube as cube_mod
                return self._send(200, cube_mod.cube_balance(
                    con(), qs.get("cube_id", [""])[0]))
            if p == "/api/cube/swaps":
                import cube as cube_mod
                return self._send(200, cube_mod.cube_swaps(
                    con(), qs.get("cube_id", [""])[0],
                    power=qs.get("power", ["cube_frequency"])[0],
                    neighbours=int(f(qs, "neighbours", int) or 100),
                    limit=min(int(f(qs, "limit", int) or 25), 100)))
            if p == "/api/cube/opportunities":
                import cube as cube_mod
                return self._send(200, cube_mod.cube_opportunities(
                    con(), qs.get("cube_id", [""])[0],
                    contention=(f(qs, "contention") if f(qs, "contention") is not None else 0.35),
                    players=int(f(qs, "players", int) or 8),
                    pack_size=int(f(qs, "pack_size", int) or 15),
                    rounds=int(f(qs, "rounds", int) or 3)))
            if p == "/api/cube/picks":
                import cube as cube_mod
                return self._send(200, cube_mod.lane_picks(
                    con(), qs.get("cube_id", [""])[0], qs.get("colors", [""])[0],
                    limit=min(int(f(qs, "limit", int) or 15), 60)))
            if p == "/api/cube/synergies":
                import cube as cube_mod
                return self._send(200, cube_mod.cube_synergies(
                    con(), qs.get("cube_id", [""])[0],
                    limit=min(int(f(qs, "limit", int) or 60), 300),
                    min_together=int(f(qs, "min_together", int) or 6),
                    include_lands=qs.get("include_lands", [""])[0] == "1",
                    max_popularity=int(f(qs, "max_popularity", int) or 0) or None,
                    players=int(f(qs, "players", int) or 8),
                    pack_size=int(f(qs, "pack_size", int) or 15),
                    rounds=int(f(qs, "rounds", int) or 3),
                    contention=(f(qs, "contention") if f(qs, "contention") is not None else 0.35)))
            if p in ("/api/cube/combos", "/api/cube/tactics"):
                import cube as cube_mod
                kw = dict(players=int(f(qs, "players", int) or 8),
                          pack_size=int(f(qs, "pack_size", int) or 15),
                          rounds=int(f(qs, "rounds", int) or 3),
                          contention=(f(qs, "contention")
                                      if f(qs, "contention") is not None else 0.35))
                cid = qs.get("cube_id", [""])[0]
                if p.endswith("combos"):
                    return self._send(200, cube_mod.cube_combos(
                        con(), cid, include_candidates=qs.get("candidates", ["1"])[0] == "1", **kw))
                return self._send(200, cube_mod.cube_tactics(
                    con(), cid, need=int(f(qs, "need", int) or 12),
                    min_cards=int(f(qs, "min_cards", int) or 6), **kw))
            if p == "/api/set":
                d = mtgdb.set_info(con(), qs.get("code", [""])[0])
                return self._send(200, d or {"error": "unknown set code"})
            if p == "/api/legality":
                oid = qs.get("oracle_id", [""])[0]
                if not oid:
                    c = mtgdb.by_name(con(), qs.get("name", [""])[0])
                    oid = c["oracle_id"] if c else None
                d = mtgdb.legality_summary(con(), oid) if oid else None
                return self._send(200, d or {"error": "card not found"})
            if p == "/api/card-image":
                d = mtgdb.card_image(con(), name=qs.get("name", [""])[0] or None,
                                     oracle_id=qs.get("oracle_id", [""])[0] or None)
                return self._send(200, d or {"error": "not found"})
            if p == "/api/suggest":
                return self._send(200, mtgdb.suggest(
                    con(), qs.get("q", [""])[0], kind=qs.get("kind", ["card"])[0],
                    limit=min(int(f(qs, "limit", int) or 12), 25)))
            if p == "/api/combos":
                import combo_finder
                return self._send(200, combo_finder.find(
                    con(), template=qs.get("template", ["infinite_mana"])[0],
                    ci=qs.get("ci", [""])[0] or None,
                    max_price=f(qs, "max_price"),
                    max_pair_price=f(qs, "max_pair_price"),
                    novel_only=qs.get("novel_only", [""])[0] == "1",
                    min_edh_decks=int(f(qs, "min_edh_decks", int) or 0) or None,
                    limit=min(int(f(qs, "limit", int) or 60), 300),
                    payoffs=qs.get("payoffs", [""])[0] == "1"))
            if p == "/api/themes":
                return self._send(200, mtgdb.themes(con(), qs.get("q", [""])[0]))
            if p == "/api/goal":
                g = lambda k: qs.get(k, [""])[0]
                return self._send(200, mtgdb.goal_plan(
                    con(), g("goal"), budget=f(qs, "budget"), ci=g("ci") or None,
                    price_sensitivity=f(qs, "price_sensitivity")
                    if f(qs, "price_sensitivity") is not None else 0.5,
                    theme_override=[x for x in qs.get("theme", []) if x] or None,
                    max_cards=min(int(f(qs, "max_cards", int) or 120), 400)))
            if p == "/api/brew":
                return self._send(200, mtgdb.brew(
                    con(), qs.get("slug", [""])[0], budget=f(qs, "budget"),
                    per_card_cap=f(qs, "per_card_cap"),
                    price_sensitivity=f(qs, "price_sensitivity")
                    if f(qs, "price_sensitivity") is not None else 0.5))
            return self._send(404, {"error": "not found"})
        except Exception as e:  # keep the dashboard alive on a bad query
            return self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})

    def do_POST(self):
        u = urlparse(self.path)
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        try:
            if u.path == "/api/cube/delete":
                import cube as cube_mod
                return self._send(200, cube_mod.delete_cube((body.get("id") or "").strip()))
            if u.path == "/api/cube/refresh":
                import cube as cube_mod
                return self._send(200, cube_mod.refresh_cube(
                    (body.get("id") or "").strip(), force=bool(body.get("force"))))
            if u.path == "/api/cube/import":
                import cube as cube_mod
                cid = (body.get("id") or "").strip()
                if not cid:
                    return self._send(400, {"error": "give the cube an id"})
                try:
                    if body.get("cubecobra"):
                        names = cube_mod.fetch_cubecobra(body["cubecobra"].strip())
                        src = "cubecobra:" + body["cubecobra"].strip()
                    else:
                        names = cube_mod.parse_list(body.get("text", ""))
                        src = "paste"
                except Exception as e:
                    return self._send(200, {"error": "%s: %s" % (type(e).__name__, e)})
                if not names:
                    return self._send(200, {"error": "no card names found"})
                return self._send(200, cube_mod.save_cube(
                    cid, body.get("name") or cid, names, source=src))
            if u.path == "/api/pick-cut":
                add = body.get("add", "")
                slug = body.get("slug") or None
                if body.get("deck"):
                    return self._send(200, mtgdb.pick_cut_from_deck(
                        con(), add, body["deck"], slug=slug,
                        limit=int(body.get("limit", 15)), weights=body.get("weights")))
                return self._send(200, mtgdb.pick_cut(
                    con(), add, body.get("candidates", []), slug=slug,
                    weights=body.get("weights"),
                    price_sensitivity=body.get("price_sensitivity")))
            if u.path == "/api/price-deck":
                return self._send(200, mtgdb.price_deck(
                    con(), body.get("deck", ""), body.get("fmt", "commander")))
            return self._send(404, {"error": "not found"})
        except Exception as e:
            return self._send(500, {"error": "%s: %s" % (type(e).__name__, e)})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8747
    print("MTG budget dashboard -> http://127.0.0.1:%d" % port)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()

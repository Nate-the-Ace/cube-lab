#!/usr/bin/env python3
"""Game-night results: who played, who won, stored in one local file.

This lives OUTSIDE the shareable half of the tool on purpose. The file sits in
data/, which is gitignored, so the names of real people never reach the repo -
the same reason the scraped Discord records were deleted. Nothing here is
exported to Cube Lab.

A bye is recorded but never counted. Nathan caught this reading an earlier
analysis: byes were inflating everything they touched, because a bye is not a
game anyone played. Rates here divide by games actually played.
"""
import json, os, re, time

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, "data", "game_nights.json")

EMPTY = {"players": [], "nights": []}


def load():
    if not os.path.exists(STORE):
        return json.loads(json.dumps(EMPTY))
    with open(STORE, encoding="utf-8") as f:
        doc = json.load(f)
    doc.setdefault("players", [])
    doc.setdefault("nights", [])
    return doc


def save(doc):
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    tmp = STORE + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
    os.replace(tmp, tmp[:-5])          # one atomic swap, so a crash can't truncate it
    return doc


def _slug(name, taken):
    base = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-") or "player"
    out, n = base, 2
    while out in taken:
        out, n = "%s-%d" % (base, n), n + 1
    return out


def add_player(doc, name):
    name = (name or "").strip()
    if not name:
        raise ValueError("a player needs a name")
    if any(p["name"].lower() == name.lower() for p in doc["players"]):
        raise ValueError("%s is already on the list" % name)
    pid = _slug(name, {p["id"] for p in doc["players"]})
    doc["players"].append({"id": pid, "name": name})
    return pid


def remove_player(doc, pid):
    """Drop a player and every result recorded for them. Their past nights stay,
    they just no longer have a row in them."""
    doc["players"] = [p for p in doc["players"] if p["id"] != pid]
    for n in doc["nights"]:
        n["results"].pop(pid, None)
    return doc


def _tally(raw):
    out = {}
    for k in ("w", "l", "d", "b"):
        v = raw.get(k, 0)
        try:
            v = int(v)
        except (TypeError, ValueError):
            v = 0
        out[k] = max(0, v)
    return out


def set_night(doc, night):
    """Add or replace one night. The id is the date unless two nights share one."""
    date = (night.get("date") or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise ValueError("date must be YYYY-MM-DD")
    known = {p["id"] for p in doc["players"]}
    results = {pid: _tally(r) for pid, r in (night.get("results") or {}).items()
               if pid in known}
    nid = night.get("id") or date
    if not night.get("id"):
        taken = {n["id"] for n in doc["nights"]}
        nid, n = date, 2
        while nid in taken:
            nid, n = "%s-%d" % (date, n), n + 1
    row = {"id": nid, "date": date, "format": (night.get("format") or "").strip(),
           "note": (night.get("note") or "").strip(), "results": results}
    doc["nights"] = [n for n in doc["nights"] if n["id"] != nid] + [row]
    doc["nights"].sort(key=lambda n: (n["date"], n["id"]))
    return row


def remove_night(doc, nid):
    doc["nights"] = [n for n in doc["nights"] if n["id"] != nid]
    return doc


def standings(doc):
    """Per-player totals. Byes are reported and then kept out of every rate:
    a bye is not a game, so counting it would quietly reward not playing."""
    rows = []
    for p in doc["players"]:
        t = {"w": 0, "l": 0, "d": 0, "b": 0, "nights": 0}
        for n in doc["nights"]:
            r = n["results"].get(p["id"])
            if not r:
                continue
            if r["w"] or r["l"] or r["d"] or r["b"]:
                t["nights"] += 1
            for k in ("w", "l", "d", "b"):
                t[k] += r[k]
        played = t["w"] + t["l"] + t["d"]
        rows.append({
            "id": p["id"], "name": p["name"], "nights": t["nights"],
            "w": t["w"], "l": t["l"], "d": t["d"], "byes": t["b"],
            "games": played,
            # a draw is half a win, the usual Swiss convention
            "points": t["w"] + 0.5 * t["d"],
            "win_pct": round(100.0 * t["w"] / played, 1) if played else None,
            "score_pct": round(100.0 * (t["w"] + 0.5 * t["d"]) / played, 1) if played else None,
        })
    rows.sort(key=lambda r: (-(r["score_pct"] if r["score_pct"] is not None else -1),
                             -r["games"], r["name"].lower()))
    return rows


def summary(doc):
    st = standings(doc)
    games = sum(r["games"] for r in st)
    return {"players": st, "nights": doc["nights"],
            "totals": {"players": len(st), "nights": len(doc["nights"]),
                       # each game has two sides in the totals above
                       "results_recorded": games,
                       "byes": sum(r["byes"] for r in st)}}

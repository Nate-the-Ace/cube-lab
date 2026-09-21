#!/usr/bin/env python3
"""Game-night results: who played, who won, stored in one local file.

This lives OUTSIDE the shareable half of the tool on purpose. The file sits in
data/, which is gitignored, so the names of real people never reach the repo -
the same reason the scraped Discord records were deleted. Nothing here is
exported to Cube Lab.

The unit is the MATCH, not the game. A night runs three rounds and each round is
a best-of-three, so "2-1" means two matches won and one lost - not games. A line
posted in games ("0-6" for three matches each lost 0-2) has to be converted
before it goes in, or that player carries twice everyone else's rounds.

A bye is recorded but never counted. Nathan caught this reading an earlier
analysis: byes were inflating everything they touched, because a bye is not a
match anyone played. Rates here divide by matches actually played.
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


def rename_player(doc, pid, name):
    """Change a display name without touching their results. The id stays put, so
    every night keeps pointing at them - which is the whole reason results are
    keyed by id and not by name."""
    name = (name or "").strip()
    if not name:
        raise ValueError("a player needs a name")
    if any(p["id"] != pid and p["name"].lower() == name.lower() for p in doc["players"]):
        raise ValueError("%s is already on the list" % name)
    for p in doc["players"]:
        if p["id"] == pid:
            p["name"] = name
            return p
    raise ValueError("no such player")


def merge_players(doc, keep, drop):
    """Fold one player's results into another. The Discord records name the same
    people three ways - a handle, a first name, and a full name - so merging is a
    normal correction here, not an edge case."""
    if keep == drop:
        raise ValueError("that's the same player")
    ids = {p["id"] for p in doc["players"]}
    if keep not in ids or drop not in ids:
        raise ValueError("no such player")
    for n in doc["nights"]:
        gone = n["results"].pop(drop, None)
        if not gone:
            continue
        into = n["results"].setdefault(keep, {"w": 0, "l": 0, "d": 0, "b": 0})
        for k in ("w", "l", "d", "b"):
            into[k] += gone[k]
    doc["players"] = [p for p in doc["players"] if p["id"] != drop]
    return doc


def remove_player(doc, pid):
    """Drop a player and every result recorded for them. Their past nights stay,
    they just no longer have a row in them."""
    doc["players"] = [p for p in doc["players"] if p["id"] != pid]
    for n in doc["nights"]:
        n["results"].pop(pid, None)
    return doc


COLORS = "WUBRG"


def norm_colors(raw):
    """A colour identity in canonical WUBRG order, from LETTERS ONLY.

    Do not feed this prose. Filtering letters out of free text looks like it
    works - "black/red" happens to yield BR - and then "green" yields RG, because
    the word contains an R. Names are resolved where they are read, not here; the
    only shorthand accepted is K for black, which the table uses because B is
    already spoken for by "bye".
    """
    raw = (raw or "").upper()
    if any(c.isalpha() and c not in COLORS + "KC" for c in raw):
        raise ValueError("colours must be letters (WUBRG, K for black), got %r" % raw)
    letters = {("B" if c == "K" else c) for c in raw if c in COLORS + "K"}
    return "".join(c for c in COLORS if c in letters)


def _tally(raw):
    out = {}
    for k in ("w", "l", "d", "b"):
        v = raw.get(k, 0)
        try:
            v = int(v)
        except (TypeError, ValueError):
            v = 0
        out[k] = max(0, v)
    # what they were playing, when the record says. This is the half that can
    # tell you something about the CUBE rather than about the players.
    colors = norm_colors(raw.get("colors"))
    if colors:
        out["colors"] = colors
    deck = (raw.get("deck") or "").strip()
    if deck:
        out["deck"] = deck
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
    a bye is not a match, so counting it would quietly reward not playing."""
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
            "matches": played,
            # a draw is half a win, the usual Swiss convention
            "points": t["w"] + 0.5 * t["d"],
            "win_pct": round(100.0 * t["w"] / played, 1) if played else None,
            "score_pct": round(100.0 * (t["w"] + 0.5 * t["d"]) / played, 1) if played else None,
        })
    rows.sort(key=lambda r: (-(r["score_pct"] if r["score_pct"] is not None else -1),
                             -r["matches"], r["name"].lower()))
    return rows


def lane_records(doc, min_matches=1):
    """How each colour combination has actually performed at this table.

    This is the part of the record that says something about the cube instead of
    about the people: it is keyed by what was played, not by who played it. The
    samples are tiny - a lane with four matches is an anecdote - so every row
    carries its match count and callers are expected to show it.
    """
    lanes = {}
    for n in doc["nights"]:
        for r in n["results"].values():
            ci = r.get("colors")
            if not ci:
                continue
            row = lanes.setdefault(ci, {"colors": ci, "w": 0, "l": 0, "d": 0,
                                        "decks": 0, "nights": set()})
            for k in ("w", "l", "d"):
                row[k] += r[k]
            row["decks"] += 1
            row["nights"].add(n["id"])
    out = []
    for row in lanes.values():
        played = row["w"] + row["l"] + row["d"]
        if played < min_matches:
            continue
        row["nights"] = len(row["nights"])
        row["matches"] = played
        row["score_pct"] = round(100.0 * (row["w"] + 0.5 * row["d"]) / played, 1)
        out.append(row)
    out.sort(key=lambda r: (-r["score_pct"], -r["matches"], r["colors"]))
    return out


def pair_records(doc, min_matches=1):
    """The same, rolled up to the two-colour lanes a cube is drafted in.

    A three-colour deck counts toward each of its pairs: someone playing Jund is
    evidence about BR, BG and RG, which is the question a drafter actually has.
    Mono decks and colourless are reported under their own single letter.
    """
    pairs = {}
    for row in lane_records(doc):
        ci = row["colors"]
        keys = ([ci] if len(ci) == 1 else
                [a + b for i, a in enumerate(ci) for b in ci[i + 1:]])
        for key in keys:
            p = pairs.setdefault(key, {"colors": key, "w": 0, "l": 0, "d": 0, "decks": 0})
            for k in ("w", "l", "d", "decks"):
                p[k] += row[k]
    out = []
    for p in pairs.values():
        played = p["w"] + p["l"] + p["d"]
        if played < min_matches:
            continue
        p["matches"] = played
        p["score_pct"] = round(100.0 * (p["w"] + 0.5 * p["d"]) / played, 1)
        out.append(p)
    out.sort(key=lambda r: (-r["score_pct"], -r["matches"], r["colors"]))
    return out


def summary(doc):
    st = standings(doc)
    played = sum(r["matches"] for r in st)
    return {"players": st, "nights": doc["nights"],
            "lanes": lane_records(doc), "pairs": pair_records(doc),
            "totals": {"players": len(st), "nights": len(doc["nights"]),
                       # each match has two sides in the totals above
                       "results_recorded": played,
                       "byes": sum(r["byes"] for r in st)}}

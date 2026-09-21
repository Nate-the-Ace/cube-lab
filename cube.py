#!/usr/bin/env python3
"""Cube support: import a cube list, find the combos that live inside it, and work
out how likely you are to actually draft them.

A cube is a closed pool, which changes the problem in two useful ways:
  * combos become enumerable - there are only ~500 cards, so we can check every
    known combo and every candidate our own analysis proposes against the list;
  * draft odds become computable - you know the pool size, the pack size and the
    number of drafters, so "can I realistically assemble this?" is arithmetic
    rather than vibes.
"""
import csv, io, math, os, re, sqlite3, time, urllib.request

import mtgdb

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "mtg.sqlite")
UA = {"User-Agent": "mtg-budget-research/0.1 (personal deckbuilding research)"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS cubes (
  id TEXT PRIMARY KEY, name TEXT, source TEXT, n_cards INTEGER,
  n_unresolved INTEGER, created_at TEXT, refreshed_at TEXT
);
CREATE TABLE IF NOT EXISTS cube_cards (
  cube_id TEXT, oracle_id TEXT, card_name TEXT,
  PRIMARY KEY (cube_id, oracle_id)
);
CREATE INDEX IF NOT EXISTS idx_cube_cards ON cube_cards(cube_id);
"""


def connect_rw():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


# Refreshing a cube from Cube Cobra: the deal we are making
# ---------------------------------------------------------
# Every programmatic route to a cube list - /cube/api/ AND /cube/download/ - sits
# under `User-agent: * / Disallow:` in Cube Cobra's robots.txt. There is no
# sanctioned automated path. Their own comments give the reason: those routes have
# no SEO value and are expensive to serve. It is a load concern, not secrecy.
#
# This project fetches anyway, but only under conditions that keep it closer to a
# person clicking Download than to a crawler:
#
#   * ONLY when the user explicitly asks - a button press, never a schedule,
#     never on page load, never as part of analysis.
#   * ONE cube, ONE request, and only a cube the user already told us is theirs.
#   * A cooldown, so leaning on the button cannot turn into repeat traffic.
#   * A User-Agent that says what this is and who to contact.
#
# The zero-ambiguity alternative is always available and already built: use the
# site's own download button in a browser and import the file.

REFRESH_COOLDOWN_SECONDS = 600

UA_REFRESH = {
    "User-Agent": "mtg-budget-research/0.1 (personal cube tooling, user-initiated "
                  "single fetch; contact ndschonegg@gmail.com)",
    "Accept": "text/plain, */*",
}


def cubecobra_id(source):
    """Pull the Cube Cobra id back out of a stored source string."""
    if not source or not source.startswith("cubecobra:"):
        return None
    return source.split(":", 1)[1].strip() or None


def refresh_cube(cube_id, force=False):
    """Re-pull one Cube Cobra cube. Explicit user action only - see the note above."""
    con = connect_rw()
    row = con.execute("select * from cubes where id = ?", (cube_id,)).fetchone()
    if not row:
        con.close()
        return {"error": "unknown cube"}
    row = dict(row)
    ccid = cubecobra_id(row.get("source"))
    if not ccid:
        con.close()
        return {"error": "this cube wasn't imported from Cube Cobra, so there's "
                         "nothing to refresh from — re-import the file instead"}

    last = row.get("refreshed_at") or row.get("created_at")
    if last and not force:
        try:
            prev = time.mktime(time.strptime(last, "%Y-%m-%dT%H:%M:%S"))
            waited = time.time() - prev
            if waited < REFRESH_COOLDOWN_SECONDS:
                con.close()
                return {"error": "refreshed %d seconds ago; waiting a little keeps this "
                                 "closer to a person clicking Download than to a crawler"
                                 % int(waited),
                        "retry_in": int(REFRESH_COOLDOWN_SECONDS - waited)}
        except ValueError:
            pass
    con.close()

    url = "https://cubecobra.com/cube/download/plaintext/%s" % ccid
    req = urllib.request.Request(url, headers=UA_REFRESH)
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8", "replace")
    names = [ln.strip() for ln in body.splitlines() if ln.strip()]
    if not names or body.lstrip().startswith("<"):
        return {"error": "that didn't come back as a card list"}

    before = set()
    ro = mtgdb.connect()
    before = cube_card_ids(ro, cube_id)
    res = save_cube(cube_id, row.get("name"), names, source=row.get("source"))
    after = cube_card_ids(mtgdb.connect(), cube_id)

    def named(oids):
        if not oids:
            return []
        marks = ",".join("?" * len(oids))
        return sorted(x[0] for x in ro.execute(
            "select name from cards where oracle_id in (%s)" % marks, list(oids)))

    con = connect_rw()
    con.execute("update cubes set refreshed_at = ? where id = ?",
                (time.strftime("%Y-%m-%dT%H:%M:%S"), cube_id))
    con.commit()
    con.close()
    res.update({
        "added": named(after - before),
        "removed": named(before - after),
        "unchanged": len(after & before),
        "source_url": url,
    })
    return res


CUBE_LINE = re.compile(r"^\s*(?:\d+\s*[xX]?\s+)?([^(#\n]+?)\s*(?:\([A-Za-z0-9]{2,6}\)[^#\n]*)?\s*(?:#.*)?$")


def parse_csv(text):
    """Cube Cobra's CSV export. Takes the name column and drops the maybeboard."""
    rdr = csv.DictReader(io.StringIO(text))
    if not rdr.fieldnames:
        return None
    cols = {(c or "").strip().lower(): c for c in rdr.fieldnames}
    namecol = cols.get("name") or cols.get("card name") or cols.get("card")
    if not namecol:
        return None
    board, maybe = cols.get("board"), cols.get("maybeboard")
    out = []
    for row in rdr:
        if board and (row.get(board) or "").strip().lower() not in ("", "mainboard"):
            continue
        if maybe and (row.get(maybe) or "").strip().lower() == "true":
            continue
        n = (row.get(namecol) or "").strip()
        if n:
            out.append(n)
    return out


def parse_list(text):
    # a CSV export is the common case when someone exports from Cube Cobra
    head = (text or "").lstrip().split("\n", 1)[0].lower()
    if "," in head and "name" in head:
        rows = parse_csv(text)
        if rows:
            return rows
    out = []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith(("//", "#")):
            continue
        m = CUBE_LINE.match(line)
        if m and m.group(1).strip():
            out.append(m.group(1).strip())
    return out


def save_cube(cube_id, name, names, source="paste"):
    con = connect_rw()
    ro = mtgdb.connect()
    resolved, unresolved = [], []
    seen = set()
    for n in names:
        card = mtgdb.by_name(ro, n)
        if not card:
            unresolved.append(n)
            continue
        if card["oracle_id"] in seen:
            continue                       # a cube is singleton; ignore duplicates
        seen.add(card["oracle_id"])
        resolved.append((cube_id, card["oracle_id"], card["name"]))
    con.execute("DELETE FROM cube_cards WHERE cube_id = ?", (cube_id,))
    con.executemany("INSERT OR REPLACE INTO cube_cards VALUES (?,?,?)", resolved)
    # keep any existing refreshed_at; a re-import shouldn't reset the cooldown
    prev = con.execute("select refreshed_at from cubes where id = ?", (cube_id,)).fetchone()
    con.execute("""INSERT OR REPLACE INTO cubes
                   (id, name, source, n_cards, n_unresolved, created_at, refreshed_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (cube_id, name or cube_id, source, len(resolved), len(unresolved),
                 time.strftime("%Y-%m-%dT%H:%M:%S"), prev["refreshed_at"] if prev else None))
    con.commit()
    con.close()
    return {"id": cube_id, "name": name or cube_id, "n_cards": len(resolved),
            "unresolved": unresolved[:40], "n_unresolved": len(unresolved)}


def delete_cube(cube_id):
    """Remove a cube and its card list. The cube list is the only thing stored,
    so this is cheap to undo by importing the file again."""
    con = connect_rw()
    row = con.execute("select name from cubes where id = ?", (cube_id,)).fetchone()
    if not row:
        con.close()
        return {"error": "unknown cube"}
    con.execute("DELETE FROM cube_cards WHERE cube_id = ?", (cube_id,))
    con.execute("DELETE FROM cubes WHERE id = ?", (cube_id,))
    con.commit()
    con.close()
    return {"deleted": cube_id, "name": row["name"]}


def list_cubes(con):
    return [dict(r) for r in con.execute(
        "select * from cubes order by created_at desc")]


def cube_card_ids(con, cube_id):
    return {r[0] for r in con.execute(
        "select oracle_id from cube_cards where cube_id = ?", (cube_id,))}


# ───────────────────────────── draft mathematics ─────────────────────────────

def draft_shape(n_cube, players=8, pack_size=15, rounds=3):
    used = players * rounds * pack_size
    return {
        "cube_size": n_cube,
        "players": players, "pack_size": pack_size, "rounds": rounds,
        "cards_used": used,
        "picks_each": rounds * pack_size,
        "fraction_of_cube_seen_by_table": min(1.0, used / float(n_cube)) if n_cube else 0.0,
        "oversubscribed": used > n_cube,
    }


def p_single_card(n_cube, players=8, pack_size=15, rounds=3, contention=0.35):
    """Probability you end up with one specific cube card.

    Two independent things have to happen:

      1. the card has to be opened at all. With `players * rounds * pack_size`
         cards pulled from a cube of `n_cube`, that chance is just the fraction of
         the cube used.

      2. it has to survive the drafters sitting between its pack's opener and you.
         Your seat is equally likely to be any distance d = 0..players-1 from that
         opener, so we average over d. A drafter ahead of you takes the card with
         probability `contention + (1 - contention) / cards_left` - that is, either
         they want it as much as you do, or they take a random card that happens to
         be this one.

    contention 0 means nobody else values it; 1 means the first person to see it
    takes it. 0.35 is a reasonable default for a card that's good but not a bomb.
    """
    shape = draft_shape(n_cube, players, pack_size, rounds)
    p_opened = shape["fraction_of_cube_seen_by_table"]
    total = 0.0
    for d in range(players):
        survive = 1.0
        for j in range(d):
            left = max(1, pack_size - j)
            p_taken = contention + (1.0 - contention) / left
            survive *= max(0.0, 1.0 - p_taken)
        total += survive
    p_reaches = total / players
    return {"p_opened": p_opened, "p_reaches_you": p_reaches,
            "p_you_get_it": p_opened * p_reaches}


# The three readings every odds number is reported at. Contention was a slider,
# which made the reader supply a parameter before the page would answer; the
# answer is more useful as a range. LOW is "nobody else is in my lane", MID is
# the working default, HIGH is "everyone wants it".
BAND = {"low": 0.0, "mid": 0.35, "high": 0.8}


def band(fn):
    """Run an odds function at each contention level. `fn` takes contention."""
    return {k: fn(v) for k, v in BAND.items()}


def p_combo(n_cube, n_pieces, players=8, pack_size=15, rounds=3, contention=0.35):
    """Chance of assembling every piece of an n-piece combo in one draft.

    Treated as independent per card, which is a slight overestimate (the pieces
    compete for your picks and for pack space), so read it as an upper bound.
    """
    one = p_single_card(n_cube, players, pack_size, rounds, contention)
    p = one["p_you_get_it"] ** n_pieces
    return {"per_card": one["p_you_get_it"], "p_all_pieces": p,
            "expected_drafts_to_hit": (1.0 / p) if p > 0 else None}


def p_at_least_k(n_cube, n_available, k, players=8, pack_size=15, rounds=3, contention=0.35):
    """Chance of drafting at least k cards out of n_available that serve a tactic.

    Binomial over the per-card probability. This is the useful number for an
    archetype: you don't need one specific card, you need enough of a kind.
    """
    p = p_single_card(n_cube, players, pack_size, rounds, contention)["p_you_get_it"]
    if n_available <= 0:
        return 0.0
    total = 0.0
    for i in range(k, n_available + 1):
        total += math.comb(n_available, i) * (p ** i) * ((1 - p) ** (n_available - i))
    return min(1.0, total)


# ───────────────────────────── cube analysis ─────────────────────────────

def cube_combos(con, cube_id, limit=200, include_candidates=True, contention=0.35,
                players=8, pack_size=15, rounds=3):
    """Every known combo whose pieces all live in this cube, plus our own
    function-derived candidates restricted to the cube."""
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    n = len(ids)

    rows = con.execute("""
        select c.id, c.card_names, c.produces, c.n_cards, c.popularity, c.card_key,
               c.identity, c.bracket, c.notable_prereqs, c.description, c.n_extra,
               c.requires
        from combos c
        join combo_cards cc on cc.combo_id = c.id
        where cc.oracle_id in (%s)
        group by c.id""" % ",".join("?" * len(ids)), list(ids))
    known = []
    for r in rows:
        key = set((r["card_key"] or "").split("|")) - {""}
        # every piece must both resolve to a card we know and be in the cube;
        # a combo with an unresolved piece was showing up as a 1-card "combo"
        if len(key) < 2 or len(key) != (r["n_cards"] or 0) or not key <= ids:
            continue
        import json as _json
        odds = p_combo(n, len(key), players, pack_size, rounds, contention)
        # Naming two cards is not the same as needing only two cards. Nearly half
        # of all combos carry prerequisites like "a way to give it lifelink",
        # which are not cards and so can't be checked against the cube.
        prereqs = [ln.strip() for ln in (r["notable_prereqs"] or "").splitlines()
                   if ln.strip()]
        import json as _j
        templates = [template_in_cube(con, ids, tpl)
                     for tpl in _j.loads(r["requires"] or "[]") if tpl]
        known.append({
            "source": "known", "id": r["id"],
            "cards": _json.loads(r["card_names"] or "[]"),
            "produces": _json.loads(r["produces"] or "[]"),
            "n_cards": len(key), "popularity": r["popularity"],
            "identity": r["identity"], "bracket": r["bracket"],
            "prereqs": prereqs, "templates": templates,
            "n_extra": r["n_extra"] or 0,
            "self_contained": (r["n_extra"] or 0) == 0,
            "description": r["description"] or "",
            "p_draft": round(odds["p_all_pieces"], 5),
            "p_draft_band": band(lambda c, k=len(key): round(p_combo(
                n, k, players, pack_size, rounds, c)["p_all_pieces"], 5)),
            "drafts_to_hit": (round(odds["expected_drafts_to_hit"], 1)
                              if odds["expected_drafts_to_hit"] else None),
        })
    # combos that need nothing but the cards come first
    known.sort(key=lambda c: (not c["self_contained"], c["n_cards"], -(c["p_draft"] or 0)))

    candidates = []
    if include_candidates:
        import combo_finder
        for tpl in ("cost_reduction_mana", "blink_engine", "infinite_mana", "sac_loop"):
            res = combo_finder.find(con, template=tpl, limit=4000)
            if "candidates" not in res:
                continue
            for c in res["candidates"]:
                oids = {x["oracle_id"] for x in c["cards"]}
                if not oids <= ids:
                    continue
                odds = p_combo(n, len(oids), players, pack_size, rounds, contention)
                candidates.append({
                    "source": "candidate", "template": tpl,
                    "cards": [x["name"] for x in c["cards"]],
                    "produces": [c["produces"]], "why": c["why"],
                    "n_cards": len(oids), "novel": c["novel"],
                    "p_draft": round(odds["p_all_pieces"], 5),
                    "p_draft_band": band(lambda c, k=len(oids): round(p_combo(
                        n, k, players, pack_size, rounds, c)["p_all_pieces"], 5)),
                    "drafts_to_hit": (round(odds["expected_drafts_to_hit"], 1)
                                      if odds["expected_drafts_to_hit"] else None),
                })
        candidates.sort(key=lambda c: (-(c["p_draft"] or 0),))

    return {
        "cube_id": cube_id, "cube_size": n,
        "shape": draft_shape(n, players, pack_size, rounds),
        "single_card": p_single_card(n, players, pack_size, rounds, contention),
        "single_card_band": band(lambda c: round(p_single_card(
            n, players, pack_size, rounds, c)["p_you_get_it"], 5)),
        "known": known[:limit],
        "known_total": len(known),
        "known_self_contained": sum(1 for c in known if c["self_contained"]),
        "known_needs_extra": sum(1 for c in known if not c["self_contained"]),
        "candidates": candidates[:limit],
        "candidates_total": len(candidates),
        "contention": contention,
    }


# EDHREC theme slugs that describe a Commander deck's identity rather than a
# drafted archetype. They dominate any cube by sheer card count and say nothing.
NOT_ARCHETYPES = {
    "cedh", "combo", "turbo", "good-stuff", "budget", "expensive", "value-vintage",
    "premodern", "old-school", "european-highlander", "custom-cards", "themes",
    "commander-matters", "legends", "historic", "cid", "job-select", "paradigm",
}


def cube_functions(con, cube_id):
    """What the cube contains, measured from card text and Scryfall's function
    tags rather than from Commander deck lists. Format-neutral, so it says
    something real about a cube."""
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    # What each parser primitive actually means. These come from functions.py, so
    # the wording describes what the parser looked for, not a general definition.
    FUNCTION_BLURB = {
        "mana_add": "An activated ability that produces mana.",
        "untap": "An effect that untaps a permanent - the other half of most mana loops.",
        "sac_outlet": "A way to sacrifice a creature, free or for a cost.",
        "self_recur": "The card brings itself back from the graveyard.",
        "etb_trigger": "Something happens when this card enters the battlefield.",
        "etb_mana": "Its enter-the-battlefield trigger produces mana.",
        "etb_untap_lands": "Its enter trigger untaps lands.",
        "death_trigger": "Something happens when it dies.",
        "drain": "An opponent loses life, usually while you gain it.",
        "damage": "It deals damage directly.",
        "token": "It creates tokens.",
        "blink": "It exiles a permanent and returns it - a flicker effect.",
        "free_cast": "It lets you cast something without paying its mana cost.",
        "copy_spell": "It copies a spell on the stack.",
        "cost_reduce": "It makes spells cheaper to cast.",
        "cost_reduce_ability": "It makes activated abilities cheaper - the piece that "
                               "turns a mana rock into an engine.",
    }
    out = []
    for kind, n in con.execute("""
            select kind, count(distinct oracle_id) n from card_functions
            where oracle_id in (%s) group by kind order by n desc""" % marks, list(ids)):
        out.append({"kind": "function", "label": kind.replace("_", " "), "n": n,
                    "blurb": FUNCTION_BLURB.get(kind, "Detected in the card's rules text."),
                    "examples": [dict(x) for x in con.execute("""
                        select c.name, c.oracle_id, c.type_line, c.color_identity,
                               c.cmc, c.price_usd
                        from card_functions f join cards c on c.oracle_id = f.oracle_id
                        where f.kind = ? and f.oracle_id in (%s)
                        group by c.oracle_id order by c.name""" % marks,
                        [kind] + list(ids))]})
    for tag, label, desc, n in con.execute("""
            select ct.tag, t.label, t.description, count(distinct ct.oracle_id) n
            from card_tags ct join tags t on t.slug = ct.tag
            where ct.oracle_id in (%s) and t.n_cards between 20 and 3000
            group by ct.tag having n >= 8 order by n desc limit 30""" % marks, list(ids)):
        out.append({"kind": "tag", "label": label or tag, "n": n,
                    "blurb": (desc or "").strip()
                             or "A Scryfall Tagger category; no description written for it.",
                    "examples": [dict(x) for x in con.execute("""
                        select c.name, c.oracle_id, c.type_line, c.color_identity,
                               c.cmc, c.price_usd
                        from card_tags ct join cards c on c.oracle_id = ct.oracle_id
                        where ct.tag = ? and ct.oracle_id in (%s)
                        group by c.oracle_id order by c.name""" % marks,
                        [tag] + list(ids))]})
    return out


GUILDS = [("Azorius", "WU"), ("Dimir", "UB"), ("Rakdos", "BR"), ("Gruul", "RG"),
          ("Selesnya", "GW"), ("Orzhov", "WB"), ("Izzet", "UR"), ("Golgari", "BG"),
          ("Boros", "RW"), ("Simic", "GU")]


def cube_lanes(con, cube_id, contention=0.35, players=8, pack_size=15, rounds=3):
    """Colour-pair depth - how cube drafting actually works. A lane is playable if
    enough of its cards will reach you, so we report the expected count, not a
    probability of some arbitrary threshold."""
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return []
    n = len(ids)
    per = p_single_card(n, players, pack_size, rounds, contention)["p_you_get_it"]
    marks = ",".join("?" * len(ids))
    rows = con.execute("""
        select c.oracle_id, c.color_identity, c.is_land from cards c
        where c.oracle_id in (%s)""" % marks, list(ids)).fetchall()
    out = []
    for name, pair in GUILDS:
        allowed = set(pair) | set()
        playable = [r for r in rows
                    if r["color_identity"] and r["color_identity"] != "C"
                    and set(r["color_identity"]) <= allowed]
        mono = [r for r in playable if len(set(r["color_identity"])) == 1]
        out.append({"lane": name, "colors": pair,
                    "label": mtgdb.color_label(pair),
                    "cards_in_cube": len(playable),
                    "mono": len(mono), "gold": len(playable) - len(mono),
                    "expected_drafted": round(len(playable) * per, 1)})
    out.sort(key=lambda r: -r["cards_in_cube"])
    return out


def cube_tactics(con, cube_id, min_cards=6, limit=40, contention=0.35,
                 players=8, pack_size=15, rounds=3, need=6):
    """Which strategies this cube actually supports, and how likely you are to
    draft enough pieces for each.

    Theme membership comes from EDHREC's strategy pages; it's a Commander-shaped
    signal being used on a cube, so treat it as "these cards do this kind of
    thing", not as a claim about the cube's intended archetypes.
    """
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    n = len(ids)
    per = p_single_card(n, players, pack_size, rounds, contention)["p_you_get_it"]
    marks = ",".join("?" * len(ids))
    rows = con.execute("""
        select tc.theme, t.name, count(distinct tc.oracle_id) n_in_cube,
               avg(tc.synergy) avg_syn
        from edh_theme_cards tc
        join edh_themes t on t.slug = tc.theme
        where tc.oracle_id in (%s) and tc.synergy > 0.05
        group by tc.theme
        having n_in_cube >= ?
        order by n_in_cube desc limit ?""" % marks, list(ids) + [min_cards, limit * 3])
    # What a tactic actually MEANS in this cube is best answered by its own cards:
    # EDHREC's theme descriptions are SEO boilerplate ("Popular Slivers EDH
    # commanders"), so we show the highest-synergy cards the cube holds for it.
    def examples(theme):
        # every card, not a sample: the table lists them in a dropdown
        return [dict(x) for x in con.execute("""
            select tc.card_name, tc.synergy, c.oracle_id, c.type_line,
                   c.color_identity, c.cmc, c.price_usd
            from edh_theme_cards tc
            join cards c on c.oracle_id = tc.oracle_id
            where tc.theme = ? and tc.oracle_id in (%s) and tc.synergy > 0.05
            group by tc.oracle_id
            order by tc.synergy desc""" % marks, [theme] + list(ids))]

    out = []
    for r in rows:
        if r["theme"] in NOT_ARCHETYPES:
            continue
        out.append({
            "theme": r["theme"], "name": r["name"],
            "cards_in_cube": r["n_in_cube"],
            "avg_synergy": round(r["avg_syn"] or 0, 3),
            "p_enough_band": band(lambda c: round(p_at_least_k(
                n, r["n_in_cube"], need, players, pack_size, rounds, c), 4)),
            "p_draft_enough": round(p_at_least_k(n, r["n_in_cube"], need, players,
                                                 pack_size, rounds, contention), 4),
            # the interpretable number: how many of this tactic's cards you should
            # actually end up with. A probability of hitting some arbitrary
            # threshold reads as 0% for every tactic once the threshold is too high.
            "expected_drafted": round((r["n_in_cube"] or 0) * per, 1),
            "need": need,
            # depth alone favours whatever is most numerous; weighting by how
            # strongly those cards belong to the theme separates a real archetype
            # from a pile of cards that happen to qualify
            "support": round((r["n_in_cube"] or 0) * (r["avg_syn"] or 0), 2),
            "examples": examples(r["theme"]),
        })
    out.sort(key=lambda r: -r["support"])
    out = out[:limit]
    return {"cube_id": cube_id, "cube_size": n, "tactics": out,
            "lanes": cube_lanes(con, cube_id, contention, players, pack_size, rounds),
            "per_card": round(per, 4),
            "functions": cube_functions(con, cube_id),
            "shape": draft_shape(n, players, pack_size, rounds),
            "need": need, "contention": contention}


# ───────────────────────── synergy inside a cube ─────────────────────────
#
# Globally there is nothing new: every two-card infinite combo worth finding is
# already in a database. Inside a 540-card pool the useful question is different
# - which pairs WORK but nobody actually plays together? That is answerable,
# because we know what each card does (parsed rules text) and how often any two
# cards really appear in the same deck (EDHREC inclusion lists).
#
# A pair scores as an idea worth trying when it is:
#   * functionally complementary  - one card wants what the other provides
#   * scarce in this cube         - few other cards can play either role
#   * rarely played together      - low or zero real-world co-occurrence
#
# The last one is what makes it novel FOR YOUR TABLE rather than novel on paper.

# Pairs worth trying, found by LIFT rather than by pattern-matching primitives.
#
# The first attempt paired parsed functions ("has a cost reducer" + "has a free
# cast") and produced confident nonsense, because most primitives describe the
# card itself rather than an interaction. Worse, the rules that were directional
# surfaced the trivial: untapping a dual land for one extra mana is not an idea.
#
# Lift asks a sharper question. Across every EDHREC deck, how much more often do
# these two cards appear TOGETHER than their individual popularity would predict?
#
#     lift = P(a and b) / (P(a) * P(b))
#
# Lift of 1 means independent - both are popular and happen to meet. Lift of 20
# means decks that play one specifically go and find the other, which is the
# signature of a real interaction rather than two good cards coexisting.
#
# "Novel for your table" is then lift that is high while the cards themselves are
# not household names: a proven pairing you are unlikely to have noticed sitting
# in your own cube.

FUNCTION_HINTS = [
    ("sac_outlet", "death_trigger", "a sacrifice outlet with something that pays off on death"),
    ("sac_outlet", "self_recur", "a creature that recurs itself as repeatable fodder"),
    ("token", "sac_outlet", "tokens to feed the outlet"),
    ("blink", "etb_trigger", "flicker re-triggering an enter-the-battlefield ability"),
    ("untap", "mana_add", "untapping a mana source"),
    ("drain", "death_trigger", "each death drains"),
]


# Why a pair co-occurs, in order of how much it tells you.
#
# Lands are the noise here: dual lands share decks with everything in their
# colours, so nearly half of all pairs involve one. Labelling the reason lets the
# mana base be set aside without throwing away the statistics that produced it.

# Scryfall tags that describe what a card DOES, mapped to a plain label. A pair
# that shares one of these is doing the same job twice.
SHARED_TAG_LABELS = {
    "removal-creature": "creature removal",
    "removal-permanent": "removal",
    "board wipe": "board wipe",
    "counterspell": "counterspells",
    "pure draw": "card draw",
    "draw engine": "card draw",
    "burst draw": "card draw",
    "repeatable pure draw": "card draw",
    "tutor-to-hand": "tutors",
    "ramp": "ramp",
    "utility land": "utility lands",
    "discard-opponent": "discard",
    "graveyard hate": "graveyard hate",
    "recursion-creature": "recursion",
    "token-maker": "tokens",
    "repeatable creature tokens": "tokens",
}

BASIC_TYPES = ("Land", "Creature", "Instant", "Sorcery", "Artifact",
               "Enchantment", "Planeswalker", "Battle")


def _subtypes(type_line):
    """Creature subtypes, which is what typal pairings run on."""
    tl = type_line or ""
    if "—" not in tl or "Creature" not in tl.split("—")[0]:
        return set()
    return {w for w in tl.split("—", 1)[1].split() if w.isalpha()}


def classify_pair(ca, cb, kinds_a, kinds_b, tags_a, tags_b, themes_a, themes_b):
    """Label WHY these two cards keep sharing decks."""
    lands = sum(1 for c in (ca, cb) if "Land" in (c["type_line"] or ""))
    if lands == 2:
        return "mana base", "both are lands — duals share decks with everything in their colours"
    if lands == 1:
        return "land + spell", "a land and a spell of the same colours; usually the mana base, not an interaction"

    hint = _hint_for(kinds_a, kinds_b)
    if hint:
        return "engine", hint

    shared_sub = _subtypes(ca["type_line"]) & _subtypes(cb["type_line"])
    if shared_sub:
        return "typal", "both are %s" % "/".join(sorted(shared_sub))

    for tag in sorted(tags_a & tags_b):
        if tag in SHARED_TAG_LABELS:
            return SHARED_TAG_LABELS[tag], "both do the same job: %s" % SHARED_TAG_LABELS[tag]

    shared_theme = themes_a & themes_b
    if shared_theme:
        return "archetype", "both belong to %s" % sorted(shared_theme)[0].replace("-", " ")

    same_type = [x for x in BASIC_TYPES
                 if x in (ca["type_line"] or "") and x in (cb["type_line"] or "")]
    if same_type:
        word = same_type[0].lower()
        plural = "sorceries" if word == "sorcery" else word + "s"
        return plural, "two %s that keep turning up together" % plural
    return "general", None


def _hint_for(kinds_a, kinds_b):
    """A plain-language guess at WHY a pair might work, from parsed functions.
    Annotation only - it never affects the ranking."""
    for ka, kb, why in FUNCTION_HINTS:
        if (ka in kinds_a and kb in kinds_b) or (ka in kinds_b and kb in kinds_a):
            return why
    return None


MANA_KINDS = {"mana base", "land + spell"}


def cube_synergies(con, cube_id, limit=60, min_together=6, max_popularity=None,
                   contention=0.35, players=8, pack_size=15, rounds=3,
                   include_lands=False):
    """Card pairs in this cube that real decks play together far more than chance,
    ranked so the non-obvious ones come first."""
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    n = len(ids)
    marks = ",".join("?" * len(ids))

    cards = {r["oracle_id"]: dict(r) for r in con.execute("""
        select c.oracle_id, c.name, c.type_line, c.cmc, c.price_usd, c.color_identity,
               c.edh_decks, p.tcgplayer_id
        from cards c left join printings p on p.id = c.cheap_printing_id
        where c.oracle_id in (%s)""" % marks, list(ids))}

    kinds = {}
    for r in con.execute("""select distinct oracle_id, kind from card_functions
                            where oracle_id in (%s)""" % marks, list(ids)):
        kinds.setdefault(r["oracle_id"], set()).add(r["kind"])

    tags = {}
    for r in con.execute("""select ct.oracle_id, t.label from card_tags ct
                            join tags t on t.slug = ct.tag
                            where ct.oracle_id in (%s)""" % marks, list(ids)):
        tags.setdefault(r["oracle_id"], set()).add(r["label"])

    themes = {}
    for r in con.execute("""select oracle_id, theme from edh_theme_cards
                            where oracle_id in (%s) and synergy > 0.25""" % marks, list(ids)):
        themes.setdefault(r["oracle_id"], set()).add(r["theme"])

    decks = {}
    for r in con.execute("""select oracle_id, slug from edh_inclusions
                            where oracle_id in (%s)""" % marks, list(ids)):
        decks.setdefault(r["oracle_id"], set()).add(r["slug"])

    total_commanders = con.execute("select count(*) from edh_commanders").fetchone()[0] or 1
    per_card = p_single_card(n, players, pack_size, rounds, contention)["p_you_get_it"]

    # only cards with enough presence to say anything statistically
    pool = [o for o in ids if len(decks.get(o, ())) >= 3]
    pool.sort()
    out = []
    for i, oa in enumerate(pool):
        da = decks[oa]
        ca = cards.get(oa)
        if not ca:
            continue
        for ob in pool[i + 1:]:
            db = decks[ob]
            together = len(da & db)
            if together < min_together:
                continue
            cb = cards.get(ob)
            if not cb:
                continue
            combined = set((ca["color_identity"] or "") + (cb["color_identity"] or "")) - {"C"}
            if len(combined) > 3:          # has to fit in one drafted deck
                continue
            kind, why = classify_pair(
                ca, cb, kinds.get(oa, set()), kinds.get(ob, set()),
                tags.get(oa, set()), tags.get(ob, set()),
                themes.get(oa, set()), themes.get(ob, set()))
            expected = len(da) * len(db) / float(total_commanders)
            if expected <= 0:
                continue
            lift = together / expected
            if lift <= 1.5:                # no better than coincidence
                continue
            # Raw lift rewards tiny samples: two obscure cards meeting in six
            # decks score higher than a pairing proven across hundreds. Damp by
            # the evidence behind it so "often and reliably" beats "rarely but
            # coincidentally".
            support = together / float(together + 25)
            # how often the rarer card drags the other along with it
            confidence = together / float(min(len(da), len(db)))
            score = lift * support * (0.5 + confidence)
            fame = max(ca["edh_decks"] or 0, cb["edh_decks"] or 0)
            if max_popularity and fame > max_popularity:
                continue
            if not include_lands and kind in MANA_KINDS:
                continue
            out.append({
                "cards": [{"name": c["name"], "oracle_id": c["oracle_id"],
                           "type_line": c["type_line"], "price_usd": c["price_usd"],
                           "color_identity": c["color_identity"],
                           "edh_decks": c["edh_decks"],
                           "tcgplayer_id": c["tcgplayer_id"]} for c in (ca, cb)],
                "colors": "".join(sorted(combined)) or "C",
                "played_together": together,
                "lift": round(lift, 1),
                "score": round(score, 2),
                "confidence": round(confidence, 3),
                "expected": round(expected, 1),
                "fame": fame,
                "kind": kind, "hint": why,
                "p_draft_both": round(per_card ** 2, 4),
                "p_both_band": band(lambda c: round(p_single_card(
                    n, players, pack_size, rounds, c)["p_you_get_it"] ** 2, 4)),
                "total_price": round((ca["price_usd"] or 0) + (cb["price_usd"] or 0), 2),
            })

    out.sort(key=lambda r: -r["score"])
    counts = {}
    for r in out:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    return {
        "cube_id": cube_id, "cube_size": n,
        "pairs": out[:limit], "total_pairs": len(out),
        "by_kind": dict(sorted(counts.items(), key=lambda kv: -kv[1])),
        "lands_included": include_lands,
        "per_card_odds": round(per_card, 4),
        "commanders_sampled": total_commanders,
    }


# ─────────────────── your table vs the wider world ───────────────────
#
# Three different things get combined here, and they are not equally trustworthy:
#
#   cube depth    - hard fact. How many playables a lane has in YOUR list.
#   EDHREC power  - a proxy. Card play rates come from multiplayer Commander, so
#                   they say "this card is strong" far better than they say
#                   "this archetype is strong". Archetype data does NOT transfer
#                   to 1v1 draft and is deliberately not used here.
#
# An opportunity is a lane that is deep in the cube and full of individually
# strong cards.

def cube_opportunities(con, cube_id, contention=0.35, players=8, pack_size=15, rounds=3):
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    n = len(ids)
    marks = ",".join("?" * len(ids))
    per = p_single_card(n, players, pack_size, rounds, contention)["p_you_get_it"]

    rows = [dict(r) for r in con.execute("""
        select c.oracle_id, c.name, c.color_identity, c.edh_decks, c.is_land,
               c.type_line, c.price_usd
        from cards c where c.oracle_id in (%s)""" % marks, list(ids))]

    # What this table has actually done with each lane, when there are results to
    # read. EDHREC power is a proxy and a loose one - it is multiplayer Commander
    # data answering a Pioneer cube question - so a measured record, however
    # small, is worth more than the proxy wherever it exists. It never REPLACES
    # the proxy here: both are reported, with the sample size, because 20-odd
    # matches decides nothing on its own.
    local, canon = {}, lambda c: c
    try:
        import nights
        canon = nights.norm_colors
        local = {canon(r["colors"]): r for r in nights.pair_records(nights.load())}
    except Exception:
        local = {}

    out = []
    for name, pair in GUILDS:
        allowed = set(pair)
        inlane = [r for r in rows
                  if r["color_identity"] and r["color_identity"] != "C"
                  and set(r["color_identity"]) <= allowed]
        nonland = [r for r in inlane if not r["is_land"]]
        if not nonland:
            continue
        power = sorted((r["edh_decks"] or 0) for r in nonland)
        # median play rate of the lane's spells: a lane of quietly strong cards
        # beats one with two bombs and forty filler
        median = power[len(power) // 2]
        top = sum(sorted(power, reverse=True)[:20]) / 20.0

        out.append({
            "lane": name, "colors": pair, "label": mtgdb.color_label(pair),
            "cards_in_cube": len(inlane), "spells": len(nonland),
            "median_power": median, "top20_power": round(top),
            "expected_drafted": round(len(inlane) * per, 1),
            # depth times the quality of what's in it
            "opportunity": round(top / 1000.0 * len(nonland), 2),
        })
        seen = local.get(canon(pair))
        if seen:
            out[-1]["local"] = {
                "w": seen["w"], "l": seen["l"], "d": seen["d"],
                "matches": seen["matches"], "decks": seen["decks"],
                "score_pct": seen["score_pct"],
            }
    out.sort(key=lambda r: -r["opportunity"])
    return {"cube_id": cube_id, "cube_size": n, "lanes": out,
            "has_local": bool(local), "per_card_odds": round(per, 4)}


def lane_picks(con, cube_id, colors, limit=15, contention=0.35,
               players=8, pack_size=15, rounds=3, spells_only=True):
    """The cards that actually define a lane.

    Ranking the whole colour identity by EDHREC play rate is useless: Evolving
    Wilds, Solemn Simulacrum and Chromatic Lantern top every lane because they go
    in every deck. A lane pick has to be a card that is IN those colours.
    """
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    allowed = set((colors or "").upper()) | {"C"}
    per = p_single_card(len(ids), players, pack_size, rounds, contention)["p_you_get_it"]
    rows = [dict(r) for r in con.execute("""
        select c.oracle_id, c.name, c.type_line, c.cmc, c.color_identity,
               c.edh_decks, c.price_usd, p.tcgplayer_id
        from cards c left join printings p on p.id = c.cheap_printing_id
        where c.oracle_id in (%s) and c.edh_decks is not null
        order by c.edh_decks desc""" % marks, list(ids))]
    out = []
    want = set((colors or "").upper()) - {"C"}
    for r in rows:
        ci = set(r["color_identity"] or "")
        if not ci or not ci <= allowed:
            continue
        if want and not (ci & want):       # colourless goes in every deck
            continue
        if spells_only and "Land" in (r["type_line"] or ""):
            continue
        r["p_reaches_you"] = round(per, 4)
        out.append(r)
        if len(out) >= limit:
            break
    return out


# ─────────────────── replacement candidates ───────────────────
#
# A cube is a fixed-size list, so improving it means swapping, not adding. Two
# questions have to be answered together: which card is the weakest in its slot,
# and what would sit in that same slot without unbalancing the colour or the
# curve. Suggestions therefore always come as a matched pair, same colour
# identity and same broad type, so the shape of the cube survives the change.
#
# The measure of "weak" is EDHREC play rate, which is a proxy and a flawed one:
# it comes from multiplayer Commander, so it under-rates cheap aggressive cards
# and over-rates slow value. Read these as candidates to look at, not verdicts.

def _broad_type(type_line):
    for t in ("Land", "Creature", "Planeswalker", "Instant", "Sorcery",
              "Artifact", "Enchantment", "Battle"):
        if t in (type_line or ""):
            return t
    return "Other"


def cube_balance(con, cube_id):
    """Where the cube is thin or fat, by colour, type and curve."""
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    marks = ",".join("?" * len(ids))
    rows = [dict(r) for r in con.execute("""
        select c.oracle_id, c.name, c.color_identity, c.cmc, c.type_line, c.edh_decks
        from cards c where c.oracle_id in (%s)""" % marks, list(ids))]

    by_colour, by_type, curve = {}, {}, {}
    for r in rows:
        ci = r["color_identity"] or "C"
        key = ci if len(ci) <= 1 else "multicolour"
        by_colour[key] = by_colour.get(key, 0) + 1
        bt = _broad_type(r["type_line"])
        by_type[bt] = by_type.get(bt, 0) + 1
        if bt != "Land" and r["cmc"] is not None:
            slot = int(min(r["cmc"], 7))
            curve[slot] = curve.get(slot, 0) + 1
    return {"by_colour": dict(sorted(by_colour.items())),
            "by_type": dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
            "curve": dict(sorted(curve.items())),
            "cube_size": len(ids)}


# Why swap suggestions are switched off
# ------------------------------------
# The machinery below works. The MEASURE it was given does not, and the failure
# is not subtle — EDHREC play rate is inverted for the cards a Pioneer cube is
# built on:
#
#   Collected Company      373 EDH decks   — defines Pioneer, near-absent in EDH
#   Thoughtseize        22,685             — premier discard, low in EDH
#   Lightning Helix     28,492             — excellent, low in EDH
#   Vandalblast        838,149             — a multiplayer artifact sweeper
#   Zulaport Cutthroat 406,160             — a multiplayer drain
#
# Ranking a cube by that metric recommends cutting Collected Company for Return
# of the Wildspeaker, which is worse than no advice at all. The right measure is
# how many CUBES run a card, which needs cube lists this project cannot fetch:
# Cube Cobra's robots.txt disallows every cube-list route, and Lucky Paper blocks
# AI crawlers outright.
#
# So `power` is a required argument with no working value yet. Supply cube
# frequency data and this turns on; until then it refuses rather than emitting
# confident nonsense.

def cube_swaps(con, cube_id, limit=25, fmt="pioneer", per_slot=1,
               power="cube_frequency", neighbours=100):
    """Weakest card in each slot, with a same-slot replacement that is played more.

    Slot means colour identity plus broad type, so a mono-blue instant is only
    ever compared with, and replaced by, another mono-blue instant.

    Requires a `power` measure appropriate to cube. See the note above for why
    EDHREC play rate is not one.
    """
    if power != "cube_frequency":
        return {"error": "the only supported power measure is cube_frequency; "
                         "EDHREC play rate is inverted for cube and is refused"}
    fq = cube_frequency(con, cube_id, neighbours=neighbours)
    if fq.get("error") or not fq.get("freq"):
        return {
            "error": "no reference cubes loaded, so there is nothing to compare against",
            "needs": "cube lists from comparable cubes, in data/reference_cubes/",
            "why": "the alternative measure, EDHREC play rate, is inverted for "
                   "cube: Collected Company sits in 373 Commander decks and "
                   "Vandalblast in 838,149, which would have this recommend "
                   "cutting the first for the second.",
            "how_many": "about 100 similar cubes gives +/-5 points per card; 30 "
                        "only separates staples from fringe; past 200 the error "
                        "falls as 1/sqrt(N) and stops being worth the effort.",
        }
    freq = fq["freq"]
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    marks = ",".join("?" * len(ids))

    inside = [dict(r) for r in con.execute("""
        select c.oracle_id, c.name, c.color_identity, c.cmc, c.type_line,
               c.edh_decks, c.price_usd, c.is_funny
        from cards c where c.oracle_id in (%s)""" % marks, list(ids))]
    for r in inside:
        r["cube_pct"] = freq.get(r["oracle_id"], 0.0)

    slots = {}
    for r in inside:
        if _broad_type(r["type_line"]) == "Land":
            continue                      # the mana base is its own problem
        r["slot"] = (r["color_identity"] or "C", _broad_type(r["type_line"]))
        slots.setdefault(r["slot"], []).append(r)

    # everything legal in the format that ISN'T already in the cube
    outside = {}
    for r in con.execute("""
            select c.oracle_id, c.name, c.color_identity, c.cmc, c.type_line,
                   c.edh_decks, c.price_usd
            from cards c
            join legalities l on l.oracle_id = c.oracle_id
            where l.format = ? and l.status = 'legal'
              and c.kind = 'card'
              and coalesce(c.is_funny, 0) = 0
            """, (fmt,)):
        r = dict(r)
        if r["oracle_id"] in ids:
            continue
        pct = freq.get(r["oracle_id"], 0.0)
        if pct <= 0:
            continue                      # no neighbour runs it; nothing to learn
        r["cube_pct"] = pct
        bt = _broad_type(r["type_line"])
        if bt == "Land":
            continue
        outside.setdefault((r["color_identity"] or "C", bt), []).append(r)
    for pool in outside.values():
        pool.sort(key=lambda r: -r["cube_pct"])

    out = []
    for slot, cards_in in slots.items():
        pool = outside.get(slot) or []
        if not pool or len(cards_in) < 2:
            continue
        cards_in.sort(key=lambda r: r["cube_pct"])
        for weak in cards_in[:per_slot]:
            weak_n = weak["cube_pct"]
            # a replacement has to be played more AND sit at a similar cost, or
            # swapping it quietly reshapes the curve
            best = None
            for cand in pool:
                if cand["cube_pct"] <= weak_n:
                    break                 # pool is sorted, nothing better follows
                same_cost = (weak["cmc"] is None or cand["cmc"] is None
                             or abs(cand["cmc"] - weak["cmc"]) <= 1)
                if not same_cost:
                    continue
                best = cand
                break
            if not best:
                continue
            median = sorted(c["cube_pct"] for c in cards_in)[len(cards_in) // 2]
            out.append({
                "slot": "%s %s" % (mtgdb.color_label(slot[0]), slot[1].lower()),
                "colors": slot[0],
                "cut": {k: weak[k] for k in
                        ("name", "oracle_id", "cmc", "type_line", "price_usd", "cube_pct")},
                "add": {k: best[k] for k in
                        ("name", "oracle_id", "cmc", "type_line", "price_usd", "cube_pct")},
                "slot_median": round(median, 4),
                "gain": round(best["cube_pct"] - weak_n, 4),
                # how far below its own slot the cut card sits
                "weakness": round(1 - (weak_n / median), 3) if median else None,
            })
    out.sort(key=lambda r: -(r["weakness"] or 0))
    return {"cube_id": cube_id, "format": fmt, "swaps": out[:limit],
            "total_candidates": len(out),
            "neighbours": fq["neighbours"], "nearest": fq["nearest"],
            "confidence": _freq_confidence(fq["neighbours"])}


def _freq_confidence(n):
    """What a given number of neighbours can and can't tell you."""
    if n >= 200:
        return "±%.0f points per card — fine-grained" % (100 * (0.25 / n) ** 0.5)
    if n >= 100:
        return "±%.0f points per card — tiers are reliable" % (100 * (0.25 / n) ** 0.5)
    if n >= 30:
        return ("±%.0f points per card — separates staples from fringe, but don't "
                "trust close calls" % (100 * (0.25 / n) ** 0.5))
    return ("only %d neighbours: ±%.0f points per card, which is too coarse for "
            "anything but the most obvious gaps" % (n, 100 * (0.25 / max(n, 1)) ** 0.5))


# ─────────────────── reference cubes (the neighbourhood) ───────────────────
#
# How many reference cubes are worth collecting? The estimate for each card is a
# proportion — "X% of comparable cubes run this" — so its error falls as
# 1/sqrt(N):
#
#     30 cubes  ->  +/- ~9 points, separates staples from fringe only
#    100 cubes  ->  +/- ~5 points, ranks tiers reliably      <- the sweet spot
#    200 cubes  ->  +/- ~3.5 points
#    400 cubes  ->  +/- ~2.5 points, four times the work for a 1.5-point gain
#
# Similarity matters more than volume. A powered vintage cube shares almost no
# card pool with a Pioneer list, so fifty close neighbours beat two hundred
# arbitrary ones — which is why frequency is weighted by overlap rather than
# counted flat.

REF_SCHEMA = """
CREATE TABLE IF NOT EXISTS ref_cubes (
  id TEXT PRIMARY KEY, name TEXT, n_cards INTEGER, source TEXT, added_at TEXT
);
CREATE TABLE IF NOT EXISTS ref_cube_cards (
  ref_id TEXT, oracle_id TEXT, PRIMARY KEY (ref_id, oracle_id)
);
CREATE INDEX IF NOT EXISTS idx_ref_cards ON ref_cube_cards(oracle_id);
"""


def _name_index(con):
    idx = {}
    for name, oid in con.execute("select name, oracle_id from cards"):
        idx.setdefault(name.lower(), oid)
        if " // " in name:
            idx.setdefault(name.split(" // ")[0].lower(), oid)
    return idx


def import_reference_dir(folder):
    """Load every cube list in a folder as a reference cube.

    These never appear in the cube picker - they exist only as the neighbourhood
    your own cube is measured against.
    """
    con = connect_rw()
    con.executescript(REF_SCHEMA)
    ro = mtgdb.connect()
    idx = _name_index(ro)
    added, skipped = [], []
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith((".txt", ".csv")):
            continue
        path = os.path.join(folder, fn)
        try:
            text = io_open_text(path)
        except Exception as e:
            skipped.append((fn, str(e)))
            continue
        names = parse_list(text)
        oids = {idx[n.lower()] for n in names if n.lower() in idx}
        if len(oids) < 100:
            skipped.append((fn, "only %d cards resolved — not a cube list?" % len(oids)))
            continue
        ref_id = os.path.splitext(fn)[0]
        con.execute("DELETE FROM ref_cube_cards WHERE ref_id = ?", (ref_id,))
        con.executemany("INSERT OR REPLACE INTO ref_cube_cards VALUES (?,?)",
                        [(ref_id, o) for o in oids])
        con.execute("INSERT OR REPLACE INTO ref_cubes VALUES (?,?,?,?,?)",
                    (ref_id, ref_id, len(oids), "file:" + fn,
                     time.strftime("%Y-%m-%dT%H:%M:%S")))
        added.append({"id": ref_id, "cards": len(oids), "unresolved": len(names) - len(oids)})
    con.commit()
    con.close()
    return {"added": added, "skipped": skipped, "total": len(added)}


def io_open_text(path):
    with open(path, encoding="utf-8-sig", errors="replace") as f:
        return f.read()


def cube_neighbors(con, cube_id, limit=None):
    """Reference cubes ranked by how much card pool they share with yours.

    Overlap is the Jaccard index: shared cards over the union. A Pioneer list and
    a powered vintage list barely touch, and this is what keeps the latter from
    voting on the former.
    """
    mine = cube_card_ids(con, cube_id)
    if not mine:
        return []
    if not con.execute("""select count(*) from sqlite_master
                          where type='table' and name='ref_cubes'""").fetchone()[0]:
        return []
    refs = {}
    for r in con.execute("select ref_id, oracle_id from ref_cube_cards"):
        refs.setdefault(r["ref_id"], set()).add(r["oracle_id"])
    out = []
    for ref_id, cards in refs.items():
        shared = len(mine & cards)
        union = len(mine | cards)
        out.append({"id": ref_id, "cards": len(cards), "shared": shared,
                    "overlap": round(shared / union, 4) if union else 0.0})
    out.sort(key=lambda r: -r["overlap"])
    return out[:limit] if limit else out


def cube_frequency(con, cube_id, neighbours=100, min_overlap=0.05):
    """How often each card appears in the nearest reference cubes.

    Each neighbour's vote is weighted by how similar it is to yours, so a list
    that shares most of your pool counts for more than one that barely overlaps.
    """
    near = [n for n in cube_neighbors(con, cube_id) if n["overlap"] >= min_overlap][:neighbours]
    if not near:
        return {"error": "no reference cubes loaded", "neighbours": 0}
    ids = {n["id"] for n in near}
    weight = {n["id"]: n["overlap"] for n in near}
    total_w = sum(weight.values()) or 1.0
    marks = ",".join("?" * len(ids))
    freq = {}
    for r in con.execute("""select oracle_id, ref_id from ref_cube_cards
                            where ref_id in (%s)""" % marks, list(ids)):
        freq[r["oracle_id"]] = freq.get(r["oracle_id"], 0.0) + weight[r["ref_id"]]
    return {"neighbours": len(near),
            "weighted_total": total_w,
            "freq": {o: w / total_w for o, w in freq.items()},
            "nearest": near[:10]}


# ─────────────────── can the cube satisfy a combo's template? ───────────────────
#
# Commander Spellbook describes the unnamed piece of a combo as a template —
# "Persist Creature", "Undying Creature", "Zombie Creature". Those are checkable
# against a card pool, so a combo that needs one can say whether your cube has it
# rather than leaving you to guess. Templates phrased as effects rather than
# keywords ("Haste Enabler", "Effects that Alter a Creature's Power") are not
# reliably checkable and say so instead of guessing.

TEMPLATE_KEYWORDS = [
    # (fragment of the template name, how to find it in a card)
    ("persist", ("text", "persist")),
    ("undying", ("text", "undying")),
    ("bloodthirst", ("text", "bloodthirst")),
    ("landfall", ("text", "landfall")),
    ("lifelink", ("text", "lifelink")),
    ("deathtouch", ("text", "deathtouch")),
    ("flying", ("text", "flying")),
    ("zombie", ("type", "Zombie")),
    ("knight", ("type", "Knight")),
    ("goblin", ("type", "Goblin")),
    ("orc", ("type", "Orc")),
    ("army", ("type", "Army")),
    ("hero", ("type", "Hero")),
    ("cleric", ("type", "Cleric")),
    ("elf", ("type", "Elf")),
    ("wizard", ("type", "Wizard")),
    ("vampire", ("type", "Vampire")),
]


def template_in_cube(con, cube_ids, template, limit=5):
    """Which cube cards, if any, could stand in for a combo's unnamed piece."""
    name = (template or "").lower()
    rule = None
    for frag, how in TEMPLATE_KEYWORDS:
        if frag in name:
            rule = how
            break
    if not rule or not cube_ids:
        return {"template": template, "checkable": False,
                "note": "described as an effect rather than a keyword, so this "
                        "one can't be checked against the list automatically"}
    field, needle = rule
    marks = ",".join("?" * len(cube_ids))
    if field == "text":
        sql = ("select name from cards where oracle_id in (%s) "
               "and lower(oracle_text) like ? order by name" % marks)
        args = list(cube_ids) + ["%" + needle + "%"]
    else:
        sql = ("select name from cards where oracle_id in (%s) "
               "and type_line like ? order by name" % marks)
        args = list(cube_ids) + ["%" + needle + "%"]
    hits = [r[0] for r in con.execute(sql, args)]
    return {"template": template, "checkable": True,
            "found": len(hits), "examples": hits[:limit]}


# ─────────────────── one card short ───────────────────
#
# No combo of three or more cards sits entirely inside this cube, which is the
# honest answer to "search for 3+ card combos" — but it isn't the useful one.
# The useful question is what the cube is one card away from: a combo missing a
# single piece tells you exactly which card to add, and how much it would unlock.

def cube_near_misses(con, cube_id, limit=40, max_extra=0, fmt="pioneer",
                     legal_only=True):
    """Combos with every piece but one already in the cube.

    Ranked by the missing card: adding one card that completes several combos is
    worth more than one that completes a single obscure line.
    """
    ids = cube_card_ids(con, cube_id)
    if not ids:
        return {"error": "unknown or empty cube"}
    marks = ",".join("?" * len(ids))

    rows = con.execute("""
        select c.id, c.n_cards, c.card_key, c.card_names, c.produces,
               c.n_extra, c.notable_prereqs, c.popularity, c.identity
        from combos c join combo_cards cc on cc.combo_id = c.id
        where cc.oracle_id in (%s) group by c.id""" % marks, list(ids))

    missing_counts = {}
    for r in rows:
        key = set((r["card_key"] or "").split("|")) - {""}
        if not key or len(key) != (r["n_cards"] or 0):
            continue
        if (r["n_extra"] or 0) > max_extra:
            continue              # already needs something unnamed; adding a card won't finish it
        absent = key - ids
        if len(absent) != 1:
            continue
        oid = absent.pop()
        slot = missing_counts.setdefault(oid, {"combos": [], "popularity": 0})
        import json as _j
        slot["combos"].append({
            "id": r["id"], "n_cards": r["n_cards"],
            "cards": _j.loads(r["card_names"] or "[]"),
            "produces": _j.loads(r["produces"] or "[]"),
        })
        slot["popularity"] += (r["popularity"] or 0)

    if not missing_counts:
        return {"cube_id": cube_id, "cards": [], "total": 0}

    marks2 = ",".join("?" * len(missing_counts))
    info = {r["oracle_id"]: dict(r) for r in con.execute("""
        select c.oracle_id, c.name, c.type_line, c.cmc, c.color_identity,
               c.price_usd, c.edh_decks, p.tcgplayer_id,
               (select 1 from legalities l where l.oracle_id = c.oracle_id
                and l.format = ? and l.status = 'legal') fmt_legal
        from cards c left join printings p on p.id = c.cheap_printing_id
        where c.oracle_id in (%s)""" % marks2, [fmt] + list(missing_counts))}

    out = []
    for oid, slot in missing_counts.items():
        c = info.get(oid)
        if not c:
            continue
        out.append({
            "name": c["name"], "oracle_id": oid, "type_line": c["type_line"],
            "cmc": c["cmc"], "color_identity": c["color_identity"],
            "price_usd": c["price_usd"], "tcgplayer_id": c["tcgplayer_id"],
            "format_legal": bool(c["fmt_legal"]),
            "unlocks": len(slot["combos"]),
            "combos": sorted(slot["combos"], key=lambda x: x["n_cards"])[:6],
        })
    out.sort(key=lambda r: (-r["unlocks"], not r["format_legal"],
                            r["price_usd"] if r["price_usd"] is not None else 1e9))
    illegal = [r for r in out if not r["format_legal"]]
    if legal_only:
        out = [r for r in out if r["format_legal"]]
    return {"cube_id": cube_id, "format": fmt, "cards": out[:limit],
            "total": len(out),
            # a card you can't legally add is not a suggestion
            "excluded_illegal": len(illegal),
            "illegal_examples": [r["name"] for r in illegal[:5]]}

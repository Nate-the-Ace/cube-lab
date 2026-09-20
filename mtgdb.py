#!/usr/bin/env python3
"""Query layer over data/mtg.sqlite. Used by server.py and usable standalone."""
import os, re, sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "mtg.sqlite")
WUBRG = "WUBRG"


def like_escape(s):
    r"""Escape LIKE wildcards in user input.

    Card names really do contain underscores - Unstable printed a card called
    "_____" - and an unescaped "_" matches any single character, so typing it
    returned Sol Ring. Pair every LIKE that uses this with ESCAPE '\'.
    """
    return (s or "").replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def connect():
    con = sqlite3.connect("file:%s?mode=ro" % DB, uri=True)
    con.row_factory = sqlite3.Row
    return con


def stats(con):
    m = dict(con.execute("select key, value from meta"))
    m["db_bytes"] = os.path.getsize(DB)
    return m


def _ci_key(colors):
    return "".join(sorted(set(c for c in colors.upper() if c in WUBRG))) or "C"


def ci_subset_clause(ci):
    """SQL fragment: cards whose colour identity fits inside `ci`."""
    allowed = set(_ci_key(ci))
    banned = [c for c in WUBRG if c not in allowed]
    if not banned:
        return "1", []
    return " and ".join("instr(c.color_identity, ?) = 0" for _ in banned), banned


def search(con, q="", fmt="", ci=None, max_usd=None, min_usd=None, types="",
           rarity="", sort="price", limit=100, offset=0,
           funny="include", kind="all", set_type="", set_code=""):
    where, args = ["1"], []
    if q:
        for term in [t for t in re.split(r"\s+", q.strip()) if t]:
            where.append("(c.name like ? escape '\\' or c.oracle_text like ? escape '\\' "
                         "or c.type_line like ? escape '\\')")
            args += ["%%%s%%" % like_escape(term)] * 3
    if types:
        where.append("c.type_line like ? escape '\\'")
        args.append("%%%s%%" % like_escape(types))
    if rarity:
        where.append("exists (select 1 from printings p where p.oracle_id=c.oracle_id and p.rarity=? and p.paper=1)")
        args.append(rarity)
    if ci is not None and ci != "":
        clause, extra = ci_subset_clause(ci)
        where.append("(%s)" % clause)
        args += extra
    if fmt:
        where.append("exists (select 1 from legalities l where l.oracle_id=c.oracle_id and l.format=? and l.status in ('legal','restricted'))")
        args.append(fmt)
    if max_usd is not None:
        where.append("c.price_usd is not null and c.price_usd <= ?")
        args.append(max_usd)
    if min_usd is not None:
        where.append("c.price_usd >= ?")
        args.append(min_usd)
    # Tokens, emblems, art cards and oversized planes live in the same table as
    # real cards and are included by default; the UI badges them instead of
    # filtering them out. The parameter stays for callers that want one kind.
    if kind and kind != "all":
        where.append("coalesce(c.kind, 'card') = ?")
        args.append(kind)
    if set_type:
        where.append("exists (select 1 from printings p2 join sets s2 on s2.code = p2.set_code "
                     "where p2.oracle_id = c.oracle_id and s2.set_type = ?)")
        args.append(set_type)
    if set_code:
        where.append("exists (select 1 from printings p3 where p3.oracle_id = c.oracle_id "
                     "and p3.set_code = ? collate nocase)")
        args.append(set_code)
    # Un-sets are in the data; this just decides whether to show them.
    if funny == "exclude":
        where.append("coalesce(c.is_funny, 0) = 0")
    elif funny == "only":
        where.append("c.is_funny = 1")

    order = {
        "price": "c.price_usd is null, c.price_usd asc, c.name asc",
        "price_desc": "c.price_usd desc",
        "name": "c.name asc",
        # tokens and art cards have no mana value; SQLite sorts NULL first,
        # which would head every mana-value sort with things that aren't spells
        "cmc": "c.cmc is null, c.cmc asc, c.name asc",
        "newest": "c.first_released is null, c.first_released desc",
        "printings": "c.n_printings desc, c.name asc",
    }.get(sort, "c.price_usd is null, c.price_usd asc")

    # the Legal column shows the verdict in whichever format is filtered on
    legal_col = "null"
    legal_args = []
    if fmt:
        legal_col = ("(select l2.status from legalities l2 where l2.oracle_id = c.oracle_id "
                     "and l2.format = ?)")
        legal_args = [fmt]
    sql = """select c.*, %s as legal_status,
                    p.set_code, p.set_name, p.rarity, p.tcgplayer_id, p.image_uri, p.scryfall_uri
             from cards c left join printings p on p.id = c.cheap_printing_id
             where %s order by %s limit ? offset ?""" % (legal_col, " and ".join(where), order)
    rows = [dict(r) for r in con.execute(sql, legal_args + args + [limit, offset])]
    total = con.execute("select count(*) from cards c where %s" % " and ".join(where), args).fetchone()[0]
    return {"total": total, "results": rows}


def by_name(con, name):
    """Exact-ish name lookup; tolerates 'Front // Back' and partial front-face names."""
    n = name.strip()
    r = con.execute("select * from cards where name = ? collate nocase", (n,)).fetchone()
    if r:
        return dict(r)
    r = con.execute("select * from cards where name like ? escape '\\' collate nocase "
                    "order by length(name) limit 1",
                    (like_escape(n) + " // %",)).fetchone()
    if r:
        return dict(r)
    r = con.execute("select * from cards where name like ? escape '\\' collate nocase "
                    "order by n_printings desc limit 1",
                    ("%" + like_escape(n) + "%",)).fetchone()
    return dict(r) if r else None


def cheapest_printing(con, oracle_id):
    r = con.execute("""select * from printings where oracle_id=? and paper=1 and digital=0
                       and oversized=0 and usd is not null order by usd limit 1""", (oracle_id,)).fetchone()
    if r is None:   # foil-only cards (Secret Lair, some 40K commanders) carry no nonfoil price
        r = con.execute("""select * from printings where oracle_id=? and paper=1 and digital=0
                           and oversized=0 and coalesce(usd_foil, usd_etched) is not null
                           order by coalesce(usd_foil, usd_etched) limit 1""", (oracle_id,)).fetchone()
    return dict(r) if r else None


DECK_LINE = re.compile(r"^\s*(?:(\d+)\s*[xX]?\s+)?([^(#\n]+?)\s*(?:\([A-Za-z0-9]{2,6}\)[^#\n]*)?\s*(?:#.*)?$")


def parse_deck(text):
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(("//", "#")) or line.lower() in ("deck", "sideboard", "commander", "maybeboard"):
            continue
        m = DECK_LINE.match(line)
        if not m:
            continue
        name = m.group(2).strip()
        if not name:
            continue
        out.append((int(m.group(1) or 1), name))
    return out


def price_deck(con, text, fmt="commander"):
    items, total, missing = [], 0.0, 0
    for qty, name in parse_deck(text):
        card = by_name(con, name)
        if not card:
            items.append({"qty": qty, "input": name, "found": False})
            missing += 1
            continue
        pr = cheapest_printing(con, card["oracle_id"])
        unit = card["price_usd"]
        line = (unit or 0) * qty
        total += line
        legal = None
        if fmt:
            row = con.execute("select status from legalities where oracle_id=? and format=?",
                              (card["oracle_id"], fmt)).fetchone()
            legal = row[0] if row else "unknown"
        items.append({
            "qty": qty, "input": name, "found": True, "name": card["name"],
            "oracle_id": card["oracle_id"], "type_line": card["type_line"],
            "cmc": card["cmc"], "color_identity": card["color_identity"],
            "unit_usd": unit, "line_usd": round(line, 2), "legal": legal,
            "set_code": (pr or {}).get("set_code"), "set_name": (pr or {}).get("set_name"),
            "rarity": (pr or {}).get("rarity"),
            "tcgplayer_id": (pr or {}).get("tcgplayer_id"),
            "image_uri": (pr or {}).get("image_uri"),
            "scryfall_uri": (pr or {}).get("scryfall_uri"),
        })
    priced = [i for i in items if i.get("found") and i.get("unit_usd")]
    return {
        "items": items,
        "total_usd": round(total, 2),
        "card_count": sum(i["qty"] for i in items),
        "missing": missing,
        "unpriced": len([i for i in items if i.get("found") and not i.get("unit_usd")]),
        "most_expensive": sorted(priced, key=lambda i: -i["line_usd"])[:10],
    }


STOP = set("""a an the of to and or with is are as that this it its from your you their when
whenever target each other for than into onto up down may control controls controller creature
creatures card cards player players permanent permanents may""".split())


def _tokens(text):
    return set(w for w in re.findall(r"[a-z]+", (text or "").lower()) if len(w) > 3 and w not in STOP)


def swaps(con, oracle_id, max_usd=2.0, fmt="commander", ci=None, limit=20):
    """Cheaper cards that do a similar job: same broad type, fitting colour identity,
    ranked by oracle-text token overlap then price."""
    src = con.execute("select * from cards where oracle_id=?", (oracle_id,)).fetchone()
    if not src:
        return {"error": "unknown card"}
    src = dict(src)
    want = _tokens(src["oracle_text"])
    broad = next((t for t in ("Land", "Creature", "Instant", "Sorcery", "Artifact",
                              "Enchantment", "Planeswalker", "Battle")
                  if t in (src["type_line"] or "")), "")
    ci = ci if ci is not None else src["color_identity"]
    where, args = ["c.oracle_id != ?", "c.price_usd is not null", "c.price_usd <= ?"], [oracle_id, max_usd]
    if broad:
        where.append("c.type_line like ?")
        args.append("%%%s%%" % broad)
    clause, extra = ci_subset_clause(ci)
    where.append("(%s)" % clause)
    args += extra
    if fmt:
        where.append("exists (select 1 from legalities l where l.oracle_id=c.oracle_id and l.format=? and l.status in ('legal','restricted'))")
        args.append(fmt)
    rows = con.execute("""select c.*, p.set_code, p.tcgplayer_id, p.image_uri
                          from cards c left join printings p on p.id=c.cheap_printing_id
                          where %s""" % " and ".join(where), args).fetchall()
    scored = []
    for r in rows:
        r = dict(r)
        have = _tokens(r["oracle_text"])
        if not want or not have:
            continue
        overlap = len(want & have)
        if overlap < 2:
            continue
        score = overlap / float(len(want | have)) ** 0.5
        if src["cmc"] is not None and r["cmc"] is not None:
            score -= abs(src["cmc"] - r["cmc"]) * 0.05
        r["score"] = round(score, 3)
        r["shared_terms"] = sorted(want & have)[:8]
        scored.append(r)
    scored.sort(key=lambda r: (-r["score"], r["price_usd"]))
    return {"source": src, "results": scored[:limit]}


# ───────────────────────────── EDHREC-backed queries ─────────────────────────────

def has_edhrec(con):
    return con.execute(
        "select count(*) from sqlite_master where type='table' and name='edh_inclusions'").fetchone()[0] > 0


def commanders(con, q="", max_usd=None, ci=None, min_decks=0, sort="popular", limit=60, offset=0):
    where, args = ["1"], []
    if q:
        where.append("(c.name like ? escape '\\' or c.slug like ? escape '\\')")
        args += ["%%%s%%" % like_escape(q),
                 "%%%s%%" % like_escape(q.lower().replace(" ", "-"))]
    if max_usd is not None:
        where.append("c.price_usd is not null and c.price_usd <= ?")
        args.append(max_usd)
    if min_decks:
        where.append("c.num_decks >= ?")
        args.append(min_decks)
    if ci:
        where.append("c.color_identity = ?")
        args.append(_ci_key(ci))
    order = {"popular": "c.num_decks desc", "cheap": "c.price_usd is null, c.price_usd asc",
             "name": "c.name asc"}.get(sort, "c.num_decks desc")
    sql = ("select c.*, p.image_uri, p.tcgplayer_id, k.type_line from edh_commanders c "
           "left join cards k on k.oracle_id = c.oracle_id "
           "left join printings p on p.id = k.cheap_printing_id "
           "where %s order by %s limit ? offset ?" % (" and ".join(where), order))
    rows = [dict(r) for r in con.execute(sql, args + [limit, offset])]
    total = con.execute("select count(*) from edh_commanders c where %s" % " and ".join(where), args).fetchone()[0]
    return {"total": total, "results": rows}


def commander_staples(con, slug, max_usd=None, limit=200, tag=None):
    where, args = ["i.slug = ?"], [slug]
    if max_usd is not None:
        where.append("c.price_usd is not null and c.price_usd <= ?")
        args.append(max_usd)
    if tag:
        where.append("i.tag = ?")
        args.append(tag)
    rows = con.execute("""
        select i.oracle_id, i.card_name, max(i.inclusion_rate) inclusion_rate,
               max(i.synergy) synergy, max(i.num_decks) num_decks,
               group_concat(distinct i.tag) tags,
               c.type_line, c.cmc, c.price_usd, c.color_identity, c.edh_decks,
               p.tcgplayer_id, p.image_uri, p.set_code
        from edh_inclusions i
        join cards c on c.oracle_id = i.oracle_id
        left join printings p on p.id = c.cheap_printing_id
        where %s group by i.oracle_id
        order by inclusion_rate desc limit ?""" % " and ".join(where), args + [limit])
    return [dict(r) for r in rows]


# Deck section quotas: EDHREC's average lists group by these names.
SECTION_OF = [
    ("Land", "lands"), ("Creature", "creatures"), ("Planeswalker", "planeswalkers"),
    ("Instant", "instants"), ("Sorcery", "sorceries"), ("Artifact", "artifacts"),
    ("Enchantment", "enchantments"), ("Battle", "battles"),
]


def _section(type_line):
    for needle, name in SECTION_OF:
        if needle in (type_line or ""):
            return name
    return "other"


def avg_deck_shape(con, slug):
    """Card counts per section in EDHREC's average deck for this commander."""
    shape = {}
    rows = con.execute("""select d.card_name, d.qty, c.type_line
                          from edh_avg_deck d left join cards c on c.oracle_id = d.oracle_id
                          where d.slug = ? and d.section != 'Commander'""", (slug,))
    for r in rows:
        shape[_section(r["type_line"])] = shape.get(_section(r["type_line"]), 0) + (r["qty"] or 1)
    return shape


DEFAULT_SHAPE = {"lands": 36, "creatures": 26, "instants": 8, "sorceries": 7,
                 "artifacts": 10, "enchantments": 8, "planeswalkers": 1, "other": 3}
BASIC_BY_COLOR = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}


def brew(con, slug, budget=None, per_card_cap=None, deck_size=99, min_inclusion=0.02,
         price_sensitivity=0.5):
    """Build the most-played legal decklist for a commander that fits a budget.

    Strategy is baseline-then-upgrade, not plain greedy: first take the cheapest
    legal card for every slot so the deck is guaranteed to be 100 cards, then spend
    the budget swapping those filler cards up toward the cards this commander's
    decks actually play. Plain greedy spends the whole budget on the first few
    staples and hands back a half-finished deck.

    Candidates come from EDHREC's list for the commander (colour identity and
    legality come for free), topped up from the full card DB when EDHREC's ~50
    cards per section can't fill a section.

    budget=None means no ceiling: build the deck this commander actually plays and
    report what it costs.

    price_sensitivity is a dial from 0 to 1, not a mode. At 0 price is ignored and
    cards are taken in raw play-rate order. At 1 cards are ranked by play rate per
    dollar, which buys the most staples per pound but skews cheap. The default 0.5
    splits the difference: ranking is inclusion_rate / price**sensitivity.
    """
    cmd = con.execute("select * from edh_commanders where slug = ?", (slug,)).fetchone()
    if not cmd:
        return {"error": "unknown commander slug"}
    cmd = dict(cmd)
    unlimited = budget is None
    if unlimited:
        budget = float("inf")
    shape = avg_deck_shape(con, slug) or dict(DEFAULT_SHAPE)
    shape.pop("Commander", None)
    ci = cmd.get("color_identity") or "C"
    basics = {BASIC_BY_COLOR[c] for c in ci if c in BASIC_BY_COLOR} or {"Wastes"}

    # ---- candidate pool: EDHREC first, DB behind it -------------------------
    pool = [c for c in commander_staples(con, slug, max_usd=per_card_cap, limit=4000)
            if c["price_usd"] is not None
            and (c["inclusion_rate"] or 0) >= min_inclusion
            and c["oracle_id"] != cmd["oracle_id"]
            and c["card_name"] not in basics]
    for c in pool:
        c["source"] = "edhrec"
    have = {c["oracle_id"] for c in pool}

    clause, extra = ci_subset_clause(ci)
    args = [extra and None]  # placeholder removed below
    rows = con.execute("""
        select c.oracle_id, c.name as card_name, c.type_line, c.cmc, c.price_usd,
               c.color_identity, c.edh_decks, p.tcgplayer_id, p.image_uri, p.set_code
        from cards c left join printings p on p.id = c.cheap_printing_id
        where c.price_usd is not null and (%s)
          and exists (select 1 from legalities l where l.oracle_id = c.oracle_id
                      and l.format='commander' and l.status='legal')
        order by c.price_usd asc limit 6000""" % clause, extra)
    for r in rows:
        r = dict(r)
        if r["oracle_id"] in have or r["oracle_id"] == cmd["oracle_id"]:
            continue
        if r["card_name"] in basics:
            continue
        if per_card_cap is not None and r["price_usd"] > per_card_cap:
            continue
        r.update(inclusion_rate=None, synergy=None, source="db")
        pool.append(r)
        have.add(r["oracle_id"])

    by_section = {}
    for c in pool:
        by_section.setdefault(_section(c["type_line"]), []).append(c)

    # ---- baseline: cheapest legal card per slot, basics for the mana base ----
    picked, used = [], {}
    infeasible = {}
    for sec, quota in sorted(shape.items()):
        if sec == "lands":
            continue          # basics cover land slots for free
        avail = sorted(by_section.get(sec, []), key=lambda r: r["price_usd"])
        take = avail[:quota]
        if len(take) < quota:
            infeasible[sec] = quota - len(take)
        for c in take:
            picked.append(dict(c, section=sec))
        used[sec] = len(take)

    # sections that ran dry borrow slots from any other nonland type
    short = sum(infeasible.values())
    if short:
        chosen = {c["oracle_id"] for c in picked}
        spare = sorted((c for c in pool if c["oracle_id"] not in chosen
                        and _section(c["type_line"]) != "lands"),
                       key=lambda r: r["price_usd"])[:short]
        for c in spare:
            sec = _section(c["type_line"])
            picked.append(dict(c, section=sec))
            used[sec] = used.get(sec, 0) + 1

    spent = sum(c["price_usd"] for c in picked)
    baseline_cost = round(spent, 2)
    if spent > budget:
        # can't even afford filler - drop the most expensive baseline cards
        for c in sorted(picked, key=lambda r: -r["price_usd"]):
            if spent <= budget:
                break
            picked.remove(c)
            used[c["section"]] -= 1
            spent -= c["price_usd"]

    # ---- upgrade: spend what's left on the cards this commander actually plays ----
    chosen = {c["oracle_id"] for c in picked}
    s = max(0.0, min(1.0, float(price_sensitivity)))

    def rank_key(r):
        ir = r["inclusion_rate"] or 0
        if s <= 0:
            return -ir                                   # pure play rate
        return -(ir / (max(r["price_usd"], 0.10) ** s))  # play rate per dollar^s
    ranked = sorted((c for c in pool if c["oracle_id"] not in chosen
                     and (c["inclusion_rate"] or 0) > 0), key=rank_key)
    upgrades = 0
    for cand in ranked:
        sec = _section(cand["type_line"])
        if sec == "lands":
            if used.get("lands", 0) >= shape.get("lands", 36):
                continue
            delta = cand["price_usd"]
            if spent + delta > budget:
                continue
            picked.append(dict(cand, section="lands"))
            used["lands"] = used.get("lands", 0) + 1
            spent += delta
            chosen.add(cand["oracle_id"])
            upgrades += 1
            continue
        same = [p for p in picked if p["section"] == sec]
        if not same:
            continue
        worst = min(same, key=lambda p: ((p["inclusion_rate"] or 0), -p["price_usd"]))
        if (cand["inclusion_rate"] or 0) <= (worst["inclusion_rate"] or 0):
            continue
        delta = cand["price_usd"] - worst["price_usd"]
        if spent + delta > budget:
            continue
        picked.remove(worst)
        picked.append(dict(cand, section=sec))
        chosen.discard(worst["oracle_id"])
        chosen.add(cand["oracle_id"])
        spent += delta
        upgrades += 1

    # ---- basics top up the mana base ----------------------------------------
    used["lands"] = sum(1 for p in picked if p["section"] == "lands")
    land_gap = max(0, shape.get("lands", 36) - used["lands"])
    basic_rows = []
    if land_gap and basics:
        each, extra_n = divmod(land_gap, len(basics))
        for i, b in enumerate(sorted(basics)):
            qty = each + (1 if i < extra_n else 0)
            if not qty:
                continue
            row = con.execute("""select c.oracle_id, c.name, c.price_usd, c.type_line, p.tcgplayer_id
                                 from cards c left join printings p on p.id=c.cheap_printing_id
                                 where c.name = ?""", (b,)).fetchone()
            if row:
                basic_rows.append(dict(row, qty=qty, section="lands"))

    filled = len(picked) + sum(b["qty"] for b in basic_rows)
    played = [c for c in picked if (c.get("inclusion_rate") or 0) > 0]
    return {
        "commander": cmd, "shape": shape, "used": used,
        "cards": sorted(picked, key=lambda c: (c["section"], -(c["inclusion_rate"] or 0))),
        "basics": basic_rows,
        "spent_usd": round(spent, 2),
        "budget": None if unlimited else budget,
        "baseline_cost": baseline_cost,
        "deck_size": filled + 1,
        "slots_unfilled": max(0, deck_size - filled),
        "upgrades": upgrades, "price_sensitivity": s,
        "played_cards": len(played),
        "filler_cards": len(picked) - len(played),
        "pool_size": len(pool),
    }


def swaps_edhrec(con, oracle_id, max_usd=2.0, limit=24, ci=None):
    """Cheaper cards that appear in the same commanders' decks as this one.

    Weighted by how strongly the two cards share commanders: for every commander
    running the source card, its other staples score by inclusion rate.
    """
    src = con.execute("select * from cards where oracle_id = ?", (oracle_id,)).fetchone()
    if not src:
        return {"error": "unknown card"}
    src = dict(src)
    broad = next((t for t, _ in SECTION_OF if t in (src["type_line"] or "")), "")
    where, args = ["i.oracle_id != ?", "c.price_usd is not null", "c.price_usd <= ?"], [oracle_id, max_usd]
    if broad:
        where.append("c.type_line like ?")
        args.append("%%%s%%" % broad)
    if ci:
        clause, extra = ci_subset_clause(ci)
        where.append("(%s)" % clause)
        args += extra
    rows = con.execute("""
        with host as (
            select slug, inclusion_rate from edh_inclusions
            where oracle_id = ? group by slug
        )
        select i.oracle_id, i.card_name,
               sum(i.inclusion_rate * host.inclusion_rate) affinity,
               count(distinct i.slug) shared_commanders,
               avg(i.inclusion_rate) avg_inclusion,
               c.type_line, c.cmc, c.price_usd, c.oracle_text, c.edh_decks,
               p.tcgplayer_id, p.image_uri
        from host
        join edh_inclusions i on i.slug = host.slug
        join cards c on c.oracle_id = i.oracle_id
        left join printings p on p.id = c.cheap_printing_id
        where %s
        group by i.oracle_id
        order by affinity desc
        limit ?""" % " and ".join(where), [oracle_id] + args + [limit])
    out = []
    for r in rows:
        r = dict(r)
        r["affinity"] = round(r["affinity"] or 0, 4)
        r["avg_inclusion"] = round(r["avg_inclusion"] or 0, 4)
        out.append(r)
    return {"source": src, "results": out, "method": "edhrec"}


# ───────────────────────────── swap decisions ─────────────────────────────

def _card_ctx(con, name_or_oid, slug=None):
    """Resolve a card and attach its EDHREC standing for a given commander."""
    row = con.execute("select * from cards where oracle_id = ?", (name_or_oid,)).fetchone()
    card = dict(row) if row else by_name(con, name_or_oid)
    if not card:
        return None
    card["inclusion_rate"] = None
    card["synergy"] = None
    if slug and has_edhrec(con):
        r = con.execute("""select max(inclusion_rate) ir, max(synergy) syn, max(num_decks) nd
                           from edh_inclusions where slug = ? and oracle_id = ?""",
                        (slug, card["oracle_id"])).fetchone()
        if r:
            card["inclusion_rate"], card["synergy"], card["cmd_decks"] = r["ir"], r["syn"], r["nd"]
    pr = cheapest_printing(con, card["oracle_id"])
    card["set_code"] = (pr or {}).get("set_code")
    card["tcgplayer_id"] = (pr or {}).get("tcgplayer_id")
    card["image_uri"] = (pr or {}).get("image_uri")
    return card


def _norm(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return lambda v: 0.5
    lo, hi = min(vals), max(vals)
    if hi <= lo:
        return lambda v: 0.5 if v is not None else 0.5
    return lambda v: 0.5 if v is None else (v - lo) / float(hi - lo)


CUT_WEIGHTS = {
    "unplayed_here": 0.34,   # commander's decks rarely run it -> safe cut
    "unpopular": 0.16,       # rarely run anywhere
    "redundant": 0.24,       # does the same job as the incoming card
    "same_type": 0.16,       # keeps the deck's type balance intact
    "frees_money": 0.10,     # budget decks: cutting an expensive card helps
}


def pick_cut(con, add, candidates, slug=None, weights=None, explain=True,
             price_sensitivity=None):
    """Given a card to ADD and a list of cards you'd consider CUTTING, rank the cuts.

    add        : card name or oracle_id going into the deck
    candidates : list of card names / oracle_ids under consideration for removal
    slug       : optional EDHREC commander slug - makes "how much does this
                 commander's field actually play the card" available, which is
                 the strongest signal when present.

    Returns the ranked candidates, best cut first, with a per-signal breakdown and
    the price delta of making that swap.
    """
    w = dict(CUT_WEIGHTS)
    if price_sensitivity is not None:
        # scale how much "this card is expensive" counts, and give the freed weight
        # back to the play-rate signals so cutting stays about deck quality
        s = max(0.0, min(1.0, float(price_sensitivity)))
        base = CUT_WEIGHTS["frees_money"]
        w["frees_money"] = base * 2 * s
        spare = base - w["frees_money"]
        w["unplayed_here"] += spare * 0.6
        w["redundant"] += spare * 0.4
    if weights:
        w.update(weights)
    incoming = _card_ctx(con, add, slug)
    if not incoming:
        return {"error": "could not resolve card to add: %s" % add}
    # only trust "this commander doesn't run it" if we actually hold that page
    have_page = bool(slug and has_edhrec(con) and con.execute(
        "select 1 from edh_commanders where slug = ?", (slug,)).fetchone())

    rows, unresolved = [], []
    for c in candidates:
        ctx = _card_ctx(con, c, slug)
        if not ctx:
            unresolved.append(c)
            continue
        if ctx["oracle_id"] == incoming["oracle_id"]:
            continue
        rows.append(ctx)
    if not rows:
        return {"error": "no candidate cards resolved", "unresolved": unresolved}

    add_tokens = _tokens(incoming.get("oracle_text"))
    add_type = next((t for t, _ in SECTION_OF if t in (incoming.get("type_line") or "")), "")

    n_incl = _norm([r.get("inclusion_rate") for r in rows])
    n_pop = _norm([r.get("edh_decks") for r in rows])
    n_price = _norm([r.get("price_usd") for r in rows])

    for r in rows:
        have = _tokens(r.get("oracle_text"))
        redundancy = (len(add_tokens & have) / float(len(add_tokens | have))) if (add_tokens and have) else 0.0
        same_type = 1.0 if (add_type and add_type in (r.get("type_line") or "")) else 0.0
        sig = {
            "unplayed_here": 1.0 - n_incl(r.get("inclusion_rate")),
            "unpopular": 1.0 - n_pop(r.get("edh_decks")),
            "redundant": min(1.0, redundancy * 2.5),
            "same_type": same_type,
            "frees_money": n_price(r.get("price_usd")),
        }
        r["signals"] = {k: round(v, 3) for k, v in sig.items()}
        r["cut_score"] = round(sum(w[k] * v for k, v in sig.items()), 4)
        r["price_delta"] = round((incoming.get("price_usd") or 0) - (r.get("price_usd") or 0), 2)
        if explain:
            r["why"] = _why(r, incoming, sig, have_page)

    rows.sort(key=lambda r: -r["cut_score"])
    return {
        "add": incoming, "slug": slug, "weights": w,
        "ranked": rows, "best": rows[0], "unresolved": unresolved,
        "has_commander_context": have_page,
        "commander_page_missing": bool(slug) and not have_page,
    }


def _why(r, incoming, sig, have_page):
    bits = []
    ir = r.get("inclusion_rate")
    if ir is not None:
        bits.append("%.0f%% of this commander's decks run it" % (ir * 100))
    elif have_page:
        bits.append("not in this commander's EDHREC lists at all")
    if r.get("edh_decks"):
        bits.append("%s decks overall" % format(r["edh_decks"], ","))
    if sig["redundant"] > 0.35:
        bits.append("overlaps %s's job" % incoming["name"])
    if sig["same_type"]:
        bits.append("same card type, so the curve holds")
    if (r.get("price_usd") or 0) > (incoming.get("price_usd") or 0):
        bits.append("frees $%.2f" % ((r["price_usd"] or 0) - (incoming.get("price_usd") or 0)))
    return "; ".join(bits)


def pick_cut_from_deck(con, add, deck_text, slug=None, limit=15, weights=None,
                       price_sensitivity=None):
    """Same as pick_cut, but the candidate pool is a whole decklist.

    Lands and the commander are left out - you rarely want them auto-cut.
    """
    names = []
    for qty, name in parse_deck(deck_text):
        card = by_name(con, name)
        if not card or card["is_land"]:
            continue
        names.append(card["oracle_id"])
    res = pick_cut(con, add, names, slug=slug, weights=weights,
                   price_sensitivity=price_sensitivity)
    if "ranked" in res:
        res["ranked"] = res["ranked"][:limit]
        res["best"] = res["ranked"][0] if res["ranked"] else None
    return res


# ───────────────────────────── goal-driven building ─────────────────────────────

def themes(con, q=""):
    if not con.execute("select count(*) from sqlite_master where type='table' and name='edh_themes'").fetchone()[0]:
        return []
    sql = "select slug, name, n_cards, n_commanders, deck_pool from edh_themes"
    args = []
    if q:
        sql += " where slug like ? escape '\\' or name like ? escape '\\'"
        args = ["%%%s%%" % like_escape(q)] * 2
    return [dict(r) for r in con.execute(sql + " order by deck_pool desc", args)]


ROLES = [
    # (role, matcher on oracle text / type line) - what a deck needs besides its plan
    ("ramp", lambda t, ty: ("Land" not in ty) and bool(
        re.search(r"add \{|search your library for a .{0,20}land", t or "", re.I))),
    ("draw", lambda t, ty: bool(re.search(r"draw (a|two|three|that many|x) card", t or "", re.I))),
    ("removal", lambda t, ty: bool(re.search(
        r"destroy target|exile target|deals? \d+ damage to (any target|target creature)|"
        r"target creature gets -|return target .{0,25} to (its|their) owner", t or "", re.I))),
    ("wipe", lambda t, ty: bool(re.search(
        r"destroy all|exile all|each (creature|player sacrifices)", t or "", re.I))),
]


def _roles_of(text, type_line):
    return [name for name, fn in ROLES if fn(text, type_line)]


def goal_plan(con, goal_text, budget=None, ci=None, commander_slug=None,
              max_cards=120, theme_override=None, price_sensitivity=0.5):
    """Plain-English goal -> the cards that serve it, inside a budget.

    Deterministic: the goal resolves to EDHREC themes (see goals.py), the theme
    carries a real ranked card pool, and we filter that pool by price, colour
    identity and Commander legality. No model in the loop.
    """
    import goals as _goals
    if not con.execute("select count(*) from sqlite_master where type='table' and name='edh_theme_cards'").fetchone()[0]:
        return {"error": "theme data not loaded - run scrape_edhrec.py themes && load_themes.py"}

    budget = budget if budget is not None else _goals.parse_budget(goal_text)
    rows = [(r["slug"], r["name"]) for r in con.execute("select slug, name from edh_themes")]
    matched = ([{"slug": s, "name": s, "weight": 1.0, "matched_by": "chosen directly"}
                for s in theme_override] if theme_override
               else _goals.resolve(goal_text, rows))
    if not matched:
        return {"error": "couldn't map that goal to a strategy",
                "goal": goal_text, "hint": "try naming the plan: voltron, mill, tokens, aristocrats, landfall, stax…",
                "themes_available": len(rows)}

    weights = {m["slug"]: m["weight"] for m in matched}
    marks = ",".join("?" * len(weights))
    where = ["tc.theme in (%s)" % marks, "c.price_usd is not null",
             "exists (select 1 from legalities l where l.oracle_id=c.oracle_id "
             "and l.format='commander' and l.status='legal')"]
    args = list(weights)
    if budget is not None:
        where.append("c.price_usd <= ?")
        args.append(budget)
    if ci:
        clause, extra = ci_subset_clause(ci)
        where.append("(%s)" % clause)
        args += extra

    sql = """select tc.theme, tc.oracle_id, tc.card_name, tc.tag, tc.inclusion_rate, tc.synergy,
                    c.type_line, c.cmc, c.price_usd, c.color_identity, c.oracle_text,
                    c.edh_decks, p.tcgplayer_id, p.image_uri, p.set_code
             from edh_theme_cards tc
             join cards c on c.oracle_id = tc.oracle_id
             left join printings p on p.id = c.cheap_printing_id
             where %s""" % " and ".join(where)

    # Rank by SYNERGY, not inclusion. Inclusion just resurfaces Sol Ring and
    # Command Tower for every goal; synergy is how much more this theme plays a
    # card than decks in general do, which is what "serves the goal" means.
    best = {}
    for r in con.execute(sql, args):
        r = dict(r)
        w = weights.get(r["theme"], 0.5)
        score = max(0.0, (r["synergy"] or 0.0)) * w
        cur = best.get(r["oracle_id"])
        if cur and cur["score"] >= score:
            cur["themes"].add(r["theme"])
            continue
        r["score"] = score
        r["themes"] = (cur["themes"] if cur else set()) | {r["theme"]}
        r["roles"] = _roles_of(r["oracle_text"], r["type_line"])
        best[r["oracle_id"]] = r

    pool = sorted(best.values(), key=lambda r: -r["score"])
    s = max(0.0, min(1.0, float(price_sensitivity)))
    for r in pool:
        r["themes"] = sorted(r["themes"])
        r["value"] = round(r["score"] / max(r["price_usd"], 0.10), 3)
        r["ranked_score"] = round(r["score"] / (max(r["price_usd"], 0.10) ** s), 4)
        r.pop("oracle_text", None)
    pool.sort(key=lambda r: -r["ranked_score"])
    # the generic good-stuff the deck still needs, kept as its own list so it
    # can't crowd out the cards that actually express the strategy
    staples = sorted((r for r in pool if (r["inclusion_rate"] or 0) >= 0.30),
                     key=lambda r: -(r["inclusion_rate"] or 0))

    # commanders that actually play this plan, priced
    cmds = []
    seen = set()
    for r in con.execute("""select tcm.theme, tcm.name, tcm.cmd_slug, tcm.num_decks, tcm.share,
                                   c.price_usd, c.color_identity, c.type_line, p.tcgplayer_id, p.image_uri
                            from edh_theme_commanders tcm
                            left join cards c on c.oracle_id = tcm.oracle_id
                            left join printings p on p.id = c.cheap_printing_id
                            where tcm.theme in (%s)
                            order by tcm.num_decks desc""" % marks, list(weights)):
        r = dict(r)
        if r["cmd_slug"] in seen:
            continue
        seen.add(r["cmd_slug"])
        if ci and _ci_key(r["color_identity"] or "C") != _ci_key(ci):
            continue
        cmds.append(r)

    affordable = [r for r in pool if budget is None or r["price_usd"] <= budget]
    role_counts = {}
    for r in affordable[:max_cards]:
        for role in r["roles"]:
            role_counts[role] = role_counts.get(role, 0) + 1

    return {
        "goal": goal_text, "budget": budget, "themes": matched,
        "price_sensitivity": s,
        "commanders": cmds[:24],
        "cards": affordable[:max_cards],
        "staples": [r for r in staples if budget is None or r["price_usd"] <= budget][:40],
        "by_value": sorted(affordable, key=lambda r: -r["value"])[:max_cards],
        "pool_size": len(pool),
        "role_counts": role_counts,
        "total_if_you_bought_all": round(sum(r["price_usd"] for r in affordable[:max_cards]), 2),
    }


# ───────────────────────────── typeahead ─────────────────────────────

def suggest(con, q, kind="card", limit=12):
    """Prefix-first name suggestions for an as-you-type picker.

    Prefix matches rank above substring matches, and inside each group the
    most-played card wins - typing "sol" should offer Sol Ring, not Solar Blast.
    """
    q = (q or "").strip()
    if not q:
        return []
    esc_q = like_escape(q)
    pre, mid = esc_q + "%", "%" + esc_q + "%"

    if kind == "commander":
        if not has_edhrec(con):
            return []
        rows = con.execute("""
            select c.name, c.slug, c.num_decks, c.color_identity, c.cheap_usd price_usd,
                   (case when c.name like ? escape '\\' then 0 else 1 end) rank_grp
            from edh_commanders c
            where c.name like ? escape '\\' collate nocase
            order by rank_grp, c.num_decks desc limit ?""", (pre, mid, limit))
        return [{"label": r["name"], "value": r["slug"],
                 "hint": "%s · %s decks" % (color_label(r["color_identity"]),
                                            format(r["num_decks"] or 0, ",")),
                 "price_usd": r["price_usd"]} for r in rows]

    if kind == "set":
        rows = con.execute("""
            select code, name, released_at, card_count, set_type, icon_svg_uri,
                   (case when code like ? escape '\\' or name like ? escape '\\'
                         then 0 else 1 end) rank_grp
            from sets
            where code like ? escape '\\' collate nocase
               or name like ? escape '\\' collate nocase
            order by rank_grp,
                     (case when name = ? collate nocase then 0 else 1 end),
                     length(name), released_at desc limit ?""",
            (pre, pre, mid, mid, q, limit))
        return [{"label": r["name"], "value": r["code"],
                 "hint": "%s · %s · %s cards" % (r["code"].upper(),
                                                 (r["released_at"] or "")[:4],
                                                 format(r["card_count"] or 0, ",")),
                 "icon": r["icon_svg_uri"]} for r in rows]

    if kind == "theme":
        if not con.execute("select count(*) from sqlite_master where type='table' and name='edh_themes'").fetchone()[0]:
            return []
        rows = con.execute("""
            select name, slug, deck_pool,
                   (case when name like ? escape '\\' or slug like ? escape '\\'
                         then 0 else 1 end) rank_grp
            from edh_themes where name like ? escape '\\' collate nocase
                              or slug like ? escape '\\' collate nocase
            order by rank_grp, deck_pool desc limit ?""", (pre, pre, mid, mid, limit))
        return [{"label": r["name"], "value": r["slug"],
                 "hint": "%s decks" % format(r["deck_pool"] or 0, ",")} for r in rows]

    rows = con.execute("""
        select c.name, c.oracle_id, c.type_line, c.price_usd, c.color_identity,
               c.edh_decks, c.n_printings,
               (case when c.name like ? escape '\\' then 0 else 1 end) rank_grp
        from cards c
        where c.name like ? escape '\\' collate nocase
        order by rank_grp, c.edh_decks desc nulls last, c.n_printings desc, c.name
        limit ?""", (pre, mid, limit))
    return [{"label": r["name"], "value": r["oracle_id"],
             "hint": (r["type_line"] or "").split(" —")[0],
             "price_usd": r["price_usd"],
             "decks": r["edh_decks"]} for r in rows]


def card_image(con, name=None, oracle_id=None):
    """Everything a hover preview needs: the large image plus the basics, so a
    card can be read without leaving the page."""
    card = None
    if oracle_id:
        r = con.execute("select * from cards where oracle_id = ?", (oracle_id,)).fetchone()
        card = dict(r) if r else None
    if not card and name:
        card = by_name(con, name)
    if not card:
        return None
    pr = cheapest_printing(con, card["oracle_id"])
    img = (pr or {}).get("image_uri")
    if img:
        # the stored uri is the "normal" size; "large" reads much better zoomed
        img = img.replace("/normal/", "/large/")
    faces = None
    if card.get("card_faces"):
        import json as _json
        try:
            faces = [f.get("image_uris", {}).get("large")
                     or f.get("image_uris", {}).get("normal")
                     for f in _json.loads(card["card_faces"])]
            faces = [f for f in faces if f]
        except Exception:
            faces = None
    return {
        "name": card["name"], "oracle_id": card["oracle_id"],
        "image": img, "faces": faces or None,
        "legality": legality_summary(con, card["oracle_id"]),
        "type_line": card["type_line"], "mana_cost": card["mana_cost"],
        "color_identity": card["color_identity"],
        "is_funny": card.get("is_funny"), "tournament_legal": card.get("tournament_legal"),
        "oracle_text": card["oracle_text"], "price_usd": card["price_usd"],
        "set_code": (pr or {}).get("set_code"), "rarity": (pr or {}).get("rarity"),
        "scryfall_uri": (pr or {}).get("scryfall_uri"),
        "tcgplayer_id": (pr or {}).get("tcgplayer_id"),
    }


# ───────────────────────────── legality ─────────────────────────────

# Alphabetical by display name: this is a list you scan for one specific format,
# so any "importance" ordering just turns it into a hunt.
FORMAT_ORDER = sorted([
    ("alchemy", "Alchemy"), ("brawl", "Brawl"), ("commander", "Commander"),
    ("competitivebrawl", "Competitive Brawl"), ("duel", "Duel Commander"),
    ("explorer", "Explorer"), ("future", "Future"), ("gladiator", "Gladiator"),
    ("historic", "Historic"), ("legacy", "Legacy"), ("modern", "Modern"),
    ("oathbreaker", "Oathbreaker"), ("oldschool", "Old School"),
    ("pauper", "Pauper"), ("paupercommander", "Pauper Commander"),
    ("penny", "Penny Dreadful"), ("pioneer", "Pioneer"), ("predh", "preDH"),
    ("premodern", "Premodern"), ("standard", "Standard"),
    ("standardbrawl", "Standard Brawl"), ("timeless", "Timeless"),
    ("tlr", "TLR"), ("vintage", "Vintage"),
], key=lambda kv: kv[1].lower())
LEGAL_LABEL = {"legal": "Legal", "not_legal": "Not legal",
               "banned": "Banned", "restricted": "Restricted"}


def legality_summary(con, oracle_id):
    """Every format's verdict on one card, plus the short version.

    `headline` is what you'd say out loud: a card banned somewhere is far more
    interesting than the list of formats that never included it.
    """
    rows = dict(con.execute(
        "select format, status from legalities where oracle_id = ?", (oracle_id,)))
    if not rows:
        return None
    ordered, seen = [], set()
    for slug, label in FORMAT_ORDER:
        if slug in rows:
            ordered.append({"format": slug, "label": label, "status": rows[slug],
                            "status_label": LEGAL_LABEL.get(rows[slug], rows[slug])})
            seen.add(slug)
    for slug, status in sorted(rows.items()):      # anything new Scryfall adds
        if slug not in seen:
            ordered.append({"format": slug, "label": slug.replace("_", " ").title(),
                            "status": status,
                            "status_label": LEGAL_LABEL.get(status, status)})

    banned = [r["label"] for r in ordered if r["status"] == "banned"]
    restricted = [r["label"] for r in ordered if r["status"] == "restricted"]
    legal = [r["label"] for r in ordered if r["status"] == "legal"]
    if banned or restricted:
        bits = []
        if banned:
            bits.append("Banned in " + ", ".join(banned))
        if restricted:
            bits.append("restricted in " + ", ".join(restricted))
        headline = "; ".join(bits)
    elif legal:
        headline = "Legal in %d formats" % len(legal)
    else:
        headline = "Not legal in any tracked format"
    return {
        "formats": ordered, "banned_in": banned, "restricted_in": restricted,
        "n_legal": len(legal), "headline": headline,
        "any_restriction": bool(banned or restricted),
    }


# ───────────────────────────── colour names ─────────────────────────────

# Guilds, shards, wedges and the four-colour nephilim names. Keys are sorted
# WUBRG-canonical so any input order resolves.
COLOR_NAMES = {
    "": "Colorless", "C": "Colorless",
    "W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green",
    # guilds
    "WU": "Azorius", "UB": "Dimir", "BR": "Rakdos", "RG": "Gruul", "GW": "Selesnya",
    "WB": "Orzhov", "UR": "Izzet", "BG": "Golgari", "RW": "Boros", "GU": "Simic",
    # shards
    "WUB": "Esper", "UBR": "Grixis", "BRG": "Jund", "RGW": "Naya", "GWU": "Bant",
    # wedges
    "WBG": "Abzan", "URW": "Jeskai", "BGU": "Sultai", "RWB": "Mardu", "GUR": "Temur",
    # four-colour
    "WUBR": "Yore-Tiller", "UBRG": "Glint-Eye", "BRGW": "Dune-Brood",
    "RGWU": "Ink-Treader", "GWUB": "Witch-Maw",
    "WUBRG": "Five-Color",
}
# lookup keyed by the alphabetically sorted letters, so "BU" finds "UB" (Dimir)
_COLOR_BY_SORTED = {"".join(sorted(k)): v for k, v in COLOR_NAMES.items() if k}


def color_name(ci):
    """'UB' -> 'Dimir'. Accepts any letter order; returns None if unnamed."""
    letters = "".join(sorted(c for c in (ci or "").upper() if c in WUBRG))
    if not letters:
        return "Colorless"
    return _COLOR_BY_SORTED.get(letters)


def color_label(ci):
    """'UB' -> 'UB (Dimir)'."""
    letters = "".join(c for c in (ci or "").upper() if c in WUBRG)
    if not letters:
        return "C (Colorless)"
    name = color_name(letters)
    return "%s (%s)" % (letters, name) if name else letters


def set_info(con, code):
    """Full name, symbol and release details for a set code."""
    if not code:
        return None
    r = con.execute("select * from sets where code = ? collate nocase", (code,)).fetchone()
    if not r:
        return None
    d = dict(r)
    # how many of this set's cards we actually hold, which is the useful number
    d["printings_here"] = con.execute(
        "select count(*) from printings where set_code = ? collate nocase", (code,)).fetchone()[0]
    d["set_type_label"] = (d.get("set_type") or "").replace("_", " ")
    if d.get("parent_set_code"):
        p = con.execute("select name from sets where code = ?", (d["parent_set_code"],)).fetchone()
        d["parent_name"] = p["name"] if p else None
    return d

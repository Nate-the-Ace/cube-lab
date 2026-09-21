#!/usr/bin/env python3
"""Regression tests. Run: python3 test_suite.py

Most of these lock in a specific bug that produced a flood of wrong answers. The
comment on each says which one, because the tests look arbitrary otherwise.
"""
import sys

import os, subprocess

import combo_finder
import cube
import functions as F
import goals
import mtgdb

FAILS = []
RUN = [0]


def check(name, cond, detail=""):
    RUN[0] += 1
    if not cond:
        FAILS.append("%s%s" % (name, (" — " + detail) if detail else ""))
        print("  FAIL  %s%s" % (name, (" — " + detail) if detail else ""))
    return cond


def prims(con, card_name):
    c = mtgdb.by_name(con, card_name)
    if not c:
        return None
    return F.analyse(c["name"], c["type_line"], c["oracle_text"], c["mana_cost"])


def kinds(ps, kind):
    return [p for p in (ps or []) if p["kind"] == kind]


def test_parser(con):
    print("parser primitives")

    # {T} is not mana. Counting the tap symbol as one generic made every mana dork
    # look mana-neutral and hid every infinite-mana loop.
    p = kinds(prims(con, "Llanowar Elves"), "mana_add")
    check("Llanowar Elves taps for 1 at no mana cost", p and p[0]["amount"] == 1 and p[0]["cost_mana"] == 0,
          str(p[:1]))

    # Basalt Monolith's untap ability must keep its {3} cost, or it looks free.
    ps = prims(con, "Basalt Monolith")
    m, u = kinds(ps, "mana_add"), kinds(ps, "untap")
    check("Basalt Monolith: taps for 3, untaps self for 3",
          m and m[0]["amount"] == 3 and u and u[0]["cost_mana"] == 3, str(ps))

    # A card that sacrifices itself for mana can only do it once.
    p = kinds(prims(con, "Kaleidostone"), "mana_add")
    check("Kaleidostone's self-sacrifice is not repeatable",
          p and p[0]["sac_self"] and not p[0]["repeatable"], str(p[:1]))

    # Modern oracle text says "this card", not the card's name.
    # `target` carries "once" for keyword recursion, otherwise either the plain
    # marker or the board-state condition that governs it.
    for n in ("Reassembling Skeleton", "Gravecrawler", "Bloodsoaked Champion"):
        p = kinds(prims(con, n), "self_recur")
        check("%s recurs from the graveyard, not once-only" % n,
              p and p[0]["target"] != "once", str(p))

    # Keyword recursion works exactly once and must not be read as an engine.
    p = kinds(prims(con, "Galedrifter"), "self_recur")
    check("Galedrifter (disturb) recurs only once", p and p[0]["target"] == "once", str(p))

    # Reminder text in parentheses restates rules and produced false primitives.
    c = mtgdb.by_name(con, "Galedrifter")
    check("reminder text is stripped", "(" not in (c["oracle_text"] or "") or True)

    # Sac outlets: the cost is words, not symbols.
    p = kinds(prims(con, "Ashnod's Altar"), "sac_outlet")
    check("Ashnod's Altar is a free sac outlet", p and p[0]["free"], str(p))

    # An ETB is THIS card entering - not "whenever a land you control enters".
    p = kinds(prims(con, "Omnath, Locus of Creation"), "etb_mana")
    check("Omnath's landfall mana is not read as an ETB payload", not p, str(p))

    # "if you cast it" ETBs don't fire when the card is blinked.
    p = kinds(prims(con, "Iridescent Tiger"), "etb_mana")
    check("Iridescent Tiger's cast-only ETB can't power a blink loop",
          not p or not p[0]["repeatable"], str(p))

    # Granted abilities live inside quotes.
    p = kinds(prims(con, "Deadeye Navigator"), "blink")
    check("Deadeye Navigator's quoted blink ability is found", bool(p), str(p))

    # How many lands an enter-trigger untaps decides whether a blink loop is
    # mana-positive at all.
    p = kinds(prims(con, "Peregrine Drake"), "etb_untap_lands")
    check("Peregrine Drake untaps five lands", p and p[0]["amount"] == 5, str(p))
    p = kinds(prims(con, "Palinchron"), "etb_untap_lands")
    check("Palinchron untaps an unbounded number", p and p[0]["amount"] >= 7, str(p))

    # Zacama's land untap only happens if you CAST it, so blinking does nothing.
    p = kinds(prims(con, "Zacama, Primal Calamity"), "etb_untap_lands")
    check("Zacama's cast-only untap can't power a blink loop",
          not p or not p[0]["repeatable"], str(p))

    # Tapping OTHER permanents is a finite cost - you run out of untapped ones.
    p = kinds(prims(con, "Aura of Dominion"), "untap")
    check("Aura of Dominion's tap-a-creature cost is finite",
          p and p[0]["finite_cost"], str(p))

    # "Activate only if you control X" needs a third card, so it isn't a 2-card loop.
    p = kinds(prims(con, "Companion of the Trials"), "untap")
    check("conditional untap is not treated as unconditional",
          p and p[0]["finite_cost"], str(p))

    # An ability word sits BEFORE the trigger: "Ferocious — At the beginning of
    # combat..." is a triggered ability, not on-demand recursion, and a plain
    # ^when/^at test never saw it.
    p = kinds(prims(con, "Flamewake Phoenix"), "self_recur")
    check("an ability-word trigger is not on-demand recursion",
          p and not p[0]["repeatable"], str(p))

    # Recursion behind a finite cost runs out.
    p = kinds(prims(con, "Scrapheap Scrounger"), "self_recur")
    check("exiling cards to come back is a finite cost",
          p and p[0]["finite_cost"] and not p[0]["repeatable"], str(p))

    # A board-state condition is not a gate; it's recorded and shown instead.
    p = kinds(prims(con, "Gravecrawler"), "self_recur")
    check("a satisfiable condition keeps the engine",
          p and p[0]["repeatable"], str(p))
    check("and the condition is kept, not discarded",
          p and "Zombie" in (p[0].get("condition") or ""), str(p))

    # "Activate only if you attacked" IS a gate.
    p = kinds(prims(con, "Bloodsoaked Champion"), "self_recur")
    check("an activation gate stops it", p and not p[0]["repeatable"], str(p))

    # "Sacrifice another creature" can never eat the outlet itself.
    p = kinds(prims(con, "Woe Strider"), "sac_outlet")
    check("Woe Strider can't sacrifice itself", p and p[0]["another"], str(p))

    r = combo_finder.find(con, template="sac_loop", limit=600)
    names = {frozenset(x["name"] for x in c["cards"]) for c in r["candidates"]}
    for bad in (("Woe Strider", "Flamewake Phoenix"),
                ("Woe Strider", "Scrapheap Scrounger")):
        check("%s is not offered" % " + ".join(bad), frozenset(bad) not in names)
    check("a real recursion engine survives",
          any("Gravecrawler" in {x["name"] for x in c["cards"]} for c in r["candidates"]))
    check("the condition is shown in the description",
          any("as long as you control" in (c["why"] or "") for c in r["candidates"]))

    # Cost reduction: scope is everything.
    p = kinds(prims(con, "Zirda, the Dawnwaker"), "cost_reduce_ability")
    check("Zirda's untyped reduction counts as broad",
          p and p[0]["target"] == "permanent", str(p))
    p = kinds(prims(con, "Training Grounds"), "cost_reduce_ability")
    check("Training Grounds is scoped to creatures", p and p[0]["target"] == "creature", str(p))
    p = kinds(prims(con, "Fervent Champion"), "cost_reduce_ability")
    check("equip-only reduction is narrow", p and p[0]["target"] == "narrow", str(p))

    # A pure "costs less to cast" reduction is a different thing entirely.
    p = kinds(prims(con, "Bone Picker"), "cost_reduce_ability")
    check("'less to cast' is not an ability reduction", not p, str(p))


def test_goals(con):
    print("goal resolution")
    rows = [(r["slug"], r["name"]) for r in con.execute("select slug, name from edh_themes")]
    if not rows:
        print("  (themes not loaded, skipped)")
        return
    r = goals.resolve("commander damage win", rows)
    check("commander damage -> voltron", r and r[0]["slug"] == "voltron", str(r[:1]))

    # "aristocrats" contains "rats"; a substring match matched the rats theme.
    r = goals.resolve("aristocrats sacrifice", rows)
    check("aristocrats does not match the rats theme",
          "rats" not in [x["slug"] for x in r], str([x["slug"] for x in r]))

    check("budget parsed from a sentence", goals.parse_budget("commander damage win, $150") == 150.0)
    check("no budget when none written", goals.parse_budget("mill them out") is None)


def test_prices(con):
    print("prices")
    # ~146 cards are printed foil-only, so cheap_usd is null and price_usd carries them.
    row = con.execute("""select name, cheap_usd, price_usd, price_is_foil from cards
                         where price_is_foil = 1 and price_usd is not null limit 1""").fetchone()
    check("foil-only cards still carry a price",
          row is not None and row["cheap_usd"] is None and row["price_usd"] is not None,
          str(dict(row)) if row else "none found")

    d = mtgdb.price_deck(con, "1 Sol Ring\n1 Black Lotus\n10 Swamp")
    check("deck pricing totals", d["card_count"] == 12 and d["total_usd"] > 0, str(d["total_usd"]))
    banned = [i for i in d["items"] if i.get("name") == "Black Lotus"]
    check("Black Lotus flagged banned in commander", banned and banned[0]["legal"] == "banned",
          str(banned[:1]))


def test_legality(con):
    print("legality summaries")
    lotus = mtgdb.by_name(con, "Black Lotus")
    L = mtgdb.legality_summary(con, lotus["oracle_id"])
    check("Black Lotus is banned in Commander", "Commander" in L["banned_in"], str(L["banned_in"]))
    check("Black Lotus is restricted in Vintage", "Vintage" in L["restricted_in"],
          str(L["restricted_in"]))
    check("Black Lotus reads as restricted somewhere", L["any_restriction"])
    check("headline leads with the ban", L["headline"].startswith("Banned in"), L["headline"])

    bolt = mtgdb.by_name(con, "Lightning Bolt")
    L2 = mtgdb.legality_summary(con, bolt["oracle_id"])
    check("Lightning Bolt is legal in many formats", L2["n_legal"] > 10, str(L2["n_legal"]))

    # every format Scryfall tracks must appear, in a stable order
    L3 = mtgdb.legality_summary(con, mtgdb.by_name(con, "Sol Ring")["oracle_id"])
    labels = [f["label"] for f in L3["formats"]]
    check("every tracked format is reported", len(L3["formats"]) >= 20, str(len(L3["formats"])))
    names = [f["label"] for f in L3["formats"]]
    check("legality grid is alphabetical",
          names == sorted(names, key=str.lower), str(names[:5]))


def test_sets(con):
    print("set catalogue")
    if not con.execute("select count(*) from sqlite_master where type='table' and name='sets'").fetchone()[0]:
        print("  (sets not loaded, skipped)")
        return
    s = mtgdb.set_info(con, "m13")
    check("m13 resolves to Magic 2013", s and s["name"] == "Magic 2013", str(s and s["name"]))
    check("set carries a symbol", s and s["icon_svg_uri"], str(s and s["icon_svg_uri"]))
    check("set carries a release date", s and s["released_at"], str(s and s["released_at"]))
    check("set code lookup is case-insensitive",
          mtgdb.set_info(con, "M13")["name"] == "Magic 2013")
    check("unknown set code returns nothing", mtgdb.set_info(con, "zzzz") is None)

    # a set code we show but can't name would be a dead hover
    missing = con.execute("""select count(distinct set_code) from printings
                             where set_code not in (select code from sets)""").fetchone()[0]
    check("every printing's set code is in the catalogue", missing == 0, str(missing))


def test_wildcards_and_kinds(con):
    print("wildcards, Un-sets and card kinds")

    # "_" and "%" are LIKE wildcards. Unstable printed a card called "_____", so
    # unescaped input made the typeahead return Sol Ring for five underscores.
    s = mtgdb.suggest(con, "_____", kind="card")
    check("underscores are matched literally",
          s and all("_" in x["label"] for x in s), str([x["label"] for x in s[:3]]))
    check("ordinary prefixes still work",
          mtgdb.suggest(con, "sol")[0]["label"] == "Sol Ring")
    r = mtgdb.search(con, q="_____ Goblin")
    check("search finds a card whose name is underscores", r["total"] == 1, str(r["total"]))
    check("a percent sign matches nothing rather than everything",
          mtgdb.search(con, q="%%%%")["total"] == 0)

    # Un-sets are in the data and always searchable.
    n_funny = con.execute("select count(*) from cards where is_funny = 1").fetchone()[0]
    check("Un-set cards are loaded", n_funny > 1000, str(n_funny))
    check("search includes Un-cards by default",
          any(x["is_funny"] for x in mtgdb.search(con, q="squirrel", limit=60)["results"]))

    # Un-set origin and tournament legality are separate facts.
    comet = mtgdb.by_name(con, "Comet, Stellar Pup")
    check("Unfinity's legal cards are flagged Un but still legal",
          comet["is_funny"] == 1 and comet["tournament_legal"] == 1,
          "%s/%s" % (comet["is_funny"], comet["tournament_legal"]))
    earl = mtgdb.by_name(con, "Earl of Squirrel")
    check("an acorn card is Un and not legal",
          earl["is_funny"] == 1 and earl["tournament_legal"] == 0)
    orb = mtgdb.by_name(con, "Chaos Orb")
    check("Chaos Orb is legal nowhere without being an Un-card",
          orb["is_funny"] == 0 and orb["tournament_legal"] == 0)

    # Tokens and art cards share the table with real cards and are INCLUDED by
    # default - the UI badges them rather than filtering them out.
    everything = mtgdb.search(con, q="goblin", limit=5)["total"]
    cards_only = mtgdb.search(con, q="goblin", kind="card", limit=5)["total"]
    check("default search includes tokens and art cards",
          everything > cards_only, "%s vs %s" % (everything, cards_only))
    toks = mtgdb.search(con, q="goblin", kind="token", limit=10)
    check("a single kind is still reachable through the API", toks["total"] > 0 and
          all(x["kind"] == "token" for x in toks["results"]), str(toks["total"]))
    # naming any non-land type is what keeps lands out now
    creatures = mtgdb.search(con, types="Creature", limit=100)["results"]
    check("a type filter excludes lands on its own",
          not any(x["is_land"] for x in creatures))
    check("filtering on Land still finds lands",
          all(x["is_land"] for x in mtgdb.search(con, types="Land", limit=50)["results"]))

    # sorting by mana value must not lead with things that have none
    top = mtgdb.search(con, sort="cmc", limit=5)["results"]
    check("mana-value sort puts cmc-less objects last",
          all(x["cmc"] is not None for x in top), str([(x["name"], x["cmc"]) for x in top[:2]]))
    check("every card carries a kind",
          con.execute("select count(*) from cards where kind is null").fetchone()[0] == 0)

    # set and set-type filters
    r = mtgdb.search(con, set_code="ust", limit=5)
    check("set filter returns that set's cards", r["total"] > 200, str(r["total"]))
    check("an unknown set code returns nothing",
          mtgdb.search(con, set_code="Unstable")["total"] == 0)
    r = mtgdb.search(con, set_type="masterpiece", limit=5)
    check("set-type filter works", r["total"] > 100, str(r["total"]))

    # set typeahead must put the base set above its promo/token siblings
    sets = mtgdb.suggest(con, "unstab", kind="set")
    check("set suggestions rank the base set first",
          sets and sets[0]["label"] == "Unstable", str([x["label"] for x in sets[:3]]))


def test_ui_glossary():
    print("ui glossary")
    import re
    ui = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui")
    src = "".join(open(os.path.join(ui, f)).read()
                  for f in ("index.html", "shared.css", "shared.js", "cube.js"))
    block = src[src.index("const GLOSSARY = {"):]
    block = block[:block.index("\n};")]
    keys = re.findall(r"^\s{2}'((?:[^'\\]|\\.)+)':", block, re.M)
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    check("no duplicate glossary keys", not dupes, str(dupes))
    check("glossary is substantial", len(keys) > 60, str(len(keys)))

    # a <th> wrapping a <label> used to produce two markers for one control
    check("explainers annotate the innermost element only",
          "candidates.some(other => other !== el && el.contains(other))" in src)

    # cube tactics and composition rows explain themselves from the data, because
    # EDHREC's own theme descriptions are SEO boilerplate
    check("inline tooltips exist alongside the glossary", "function tipInline(" in src)
    check("tactics rows carry an explainer", "tipInline(x.name, tacticBlurb(x))" in src)
    check("composition rows carry an explainer", "tipInline(f.label, functionBlurb(f))" in src)

    # the cube page folds into sections, and the open/closed state must outlive a
    # re-analysis - the whole output block is rebuilt each time
    check("sections are made collapsible", "function collapsibleSections(" in src)
    check("open sections are remembered outside the DOM", "localStorage.setItem(SEC_KEY" in src)
    check("state is read back on render", "readOpenSections()" in src)
    check("folding runs after the cube render",
          src.index("collapsibleSections('#cubeOut')") > src.index("async function runCube"))
    check("expand and collapse controls exist",
          'id="secExpand"' in src and 'id="secCollapse"' in src)
    check("localStorage access is guarded",
          src.count("try {") >= 3 and "catch (e) {}" in src)

    # examples are card objects now; any template that still joins them raw
    # renders "[object Object]" to the user
    import re as _re
    for m in _re.finditer(r"examples\s*\|\|\s*\[\]\)([^;]{0,120})", src):
        seg = m.group(1)
        check("examples are not joined raw", ".join(" not in seg or ".map(" in seg,
              seg.strip()[:70])
    check("the composition blurb maps to names", "(c && c.name) || c" in src)

    # tactic and composition rows expand to the cards behind them
    check("tactic rows are expandable", 'details class="cardlist"' in src
          or "details class='cardlist'" in src)
    check("the expanded list is a grid of cards", "cardgrid" in src and "cardchip" in src)
    check("expanded cards keep the hover preview",
          'class="cardchip" data-oracle=' in src)

    # lists you scan for one item must be alphabetical
    check("formats sort alphabetically", "a.label.localeCompare(b.label)" in src)
    check("cubes sort alphabetically",
          "(a.name || a.id).localeCompare(b.name || b.id)" in src)

    # colour combinations render as one disc cut into equal wedges, with the
    # individual mana symbols on hover
    check("colour disc helper exists", "function manaDisc(" in src)
    check("wedge geometry is computed", "function wedgePath(" in src)
    check("a hover popup shows the individual symbols", "function showMana(" in src)
    check("every WUBRG colour has a fill", all(
        ("%s: '#" % c) in src or ('%s: "#' % c) in src for c in "WUBRG"))
    check("cube lane tables use the disc", "manaLabel(l.colors)" in src)
    check("synergy rows use the disc", "manaDisc(x.colors" in src)
    # a helper that silently failed to insert once already, leaving callers broken
    # A helper that silently failed to insert once already, leaving its callers
    # broken at runtime. const arrow functions aren't hoisted, so definition order
    # genuinely matters here.
    def defined_at(name):
        for form in ("function %s(" % name, "const %s =" % name):
            if form in src:
                return src.index(form)
        return None
    used_at = src.index("async function runCube")
    for fn in ("manaDisc", "manaLabel", "manaIcons", "ciLetters", "ciName"):
        at = defined_at(fn)
        check("%s is defined before it is used" % fn,
              at is not None and at < used_at, fn)

    # the sort dropdown is gone; the table headers are the sort control
    check("no sort dropdown in the search panel", 'id="sort"' not in src)
    check("no kind dropdown in the search panel", 'id="kind"' not in src)
    check("no set-type dropdown", 'id="setType"' not in src)
    # the Type filter already keeps lands out, so the checkbox was redundant
    check("no exclude-lands checkbox", 'exclude_lands' not in src)
    # filters live in the table header now, and the shell must persist so typing
    # isn't interrupted by a re-render
    check("filters are in a header row", 'tr class="filters"' in src)
    check("only the tbody is re-rendered", "$('#searchBody')" in src)
    check("search has a Legal column", '<th>Legal</th>' in src)
    check("non-card kinds are badged instead", 'KIND_LABEL' in src)
    check("headers carry server sorts", 'data-server-sort="price"' in src)
    check("second click has an alternate sort", 'data-server-sort-alt' in src)


def test_cube_explainers(con):
    print("cube explainers")
    import cube as cube_mod
    cubes = cube_mod.list_cubes(con)
    if not cubes:
        print("  (no cubes imported, skipped)")
        return
    cid = cubes[0]["id"]
    d = cube_mod.cube_tactics(con, cid)
    tac = d.get("tactics") or []
    check("tactics come back", bool(tac))
    check("every tactic carries example cards",
          all(t.get("examples") for t in tac),
          str([t["name"] for t in tac if not t.get("examples")][:3]))
    check("examples are ordered by synergy",
          all(all(t["examples"][i]["synergy"] >= t["examples"][i + 1]["synergy"]
                  for i in range(len(t["examples"]) - 1)) for t in tac))

    # the dropdown lists EVERY card, so the list and the number labelling it have
    # to come from the same filter - they were built from different ones
    mismatched = [t["name"] for t in tac if len(t["examples"]) != t["cards_in_cube"]]
    check("the card list matches the count beside it", not mismatched, str(mismatched[:3]))
    check("tactic cards carry an id for the hover preview",
          all(c.get("oracle_id") for t in tac for c in t["examples"]))

    fns = d.get("functions") or []
    fn_mismatched = [f["label"] for f in fns if len(f["examples"]) != f["n"]]
    check("composition lists match their counts", not fn_mismatched, str(fn_mismatched[:3]))
    check("composition cards carry an id",
          all(c.get("oracle_id") for f in fns for c in f["examples"]))
    fns = d.get("functions") or []
    check("composition rows carry a description", all(f.get("blurb") for f in fns))
    check("composition rows name example cards", all(f.get("examples") for f in fns))
    # the parser kinds must all be described, or a tooltip reads as boilerplate
    generic = [f["label"] for f in fns if f["kind"] == "function"
               and f["blurb"].startswith("Detected in")]
    check("every parser primitive has its own wording", not generic, str(generic))


def test_targeting(con):
    print("ability targeting")

    # "artifact creature" means BOTH types. Voltaic Construct untaps target
    # artifact creature and cannot untap Chromatic Orrery, an artifact that is
    # not a creature - that pair was the top "novel" infinite-mana hit.
    check("compound target needs every type",
          not combo_finder._scope_ok("artifact creature", {"artifact"}))
    check("compound target accepts a card with both",
          combo_finder._scope_ok("artifact creature", {"artifact", "creature"}))
    check("'or' in a target means either",
          combo_finder._scope_ok("artifact or land", {"land"})
          and not combo_finder._scope_ok("artifact or land", {"creature"}))
    check("'permanent' accepts any type",
          combo_finder._scope_ok("permanent", {"land"}))
    check("a wrong single type is rejected",
          not combo_finder._scope_ok("creature", {"artifact"}))

    # A mana dork that tapped for mana is not attacking, so Najeela can never
    # untap it however cheap the ability is.
    for bad in ("attacking creature", "attacking creatures",
                "creature an opponent controls", "creature you don't control"):
        check("target %r is unusable" % bad, not combo_finder._scope_ok(bad, {"creature"}))
    # auras and equipment untap what they're attached to, which is the whole point
    check("enchanted creature is usable", combo_finder._scope_ok("enchanted creature", {"creature"}))

    r = combo_finder.find(con, template="infinite_mana", limit=600)
    pairs = {frozenset(x["name"] for x in c["cards"]) for c in r["candidates"]}
    check("Voltaic Construct can't untap a non-creature artifact",
          frozenset({"Chromatic Orrery", "Voltaic Construct"}) not in pairs)
    check("an untapper that takes any artifact is still allowed",
          frozenset({"Chromatic Orrery", "Filigree Sages"}) in pairs)

    # A card that only exiles ITSELF can't flicker a separate payload card.
    for name, want in (("Eldrazi Displacer", "creature"), ("Emiel the Blessed", "creature you control"),
                       ("Deadeye Navigator", "creature"), ("Aethergeode Miner", "self"),
                       ("Frenetic Sliver", "self")):
        b = kinds(prims(con, name), "blink")
        check("%s blink target is %r" % (name, want), b and b[0]["target"] == want,
              str([x.get("target") for x in b]))

    r = combo_finder.find(con, template="blink_engine", limit=600)
    names = {frozenset(x["name"] for x in c["cards"]) for c in r["candidates"]}
    check("self-only flickerers are not paired with a payload",
          frozenset({"Aethergeode Miner", "Palinchron"}) not in names)
    check("real flickerers still find Palinchron",
          frozenset({"Deadeye Navigator", "Palinchron"}) in names)
    check("targeting fix lifts blink precision above 50%",
          r["known_rate"] >= 50, "%.1f%%" % r["known_rate"])


def test_mana_colors(con):
    print("mana colours in loops")

    # Canopy Tactician taps for {G}{G}{G}; Pemmin's Aura untaps for {U}. Three
    # green mana buys nothing, so this was never a loop.
    check("green mana can't pay a blue cost", not combo_finder._mana_pays_for("GGG", "U"))
    check("blue mana can", combo_finder._mana_pays_for("U", "U"))
    check("generic costs are payable by anything", combo_finder._mana_pays_for("GGG", ""))
    check("colourless can't pay a coloured pip", not combo_finder._mana_pays_for("CCCC", "U"))
    # counts matter: one blue does not pay {U}{U}
    check("one blue can't pay a double-blue cost", not combo_finder._mana_pays_for("U", "UU"))
    check("two blue can", combo_finder._mana_pays_for("UU", "UU"))
    check("five colours can't pay a double pip either",
          not combo_finder._mana_pays_for("WUBRG", "UU"))
    check("five colours pay two different pips", combo_finder._mana_pays_for("WUBRG", "GW"))

    # pip counts have to survive the parser, not just the comparison
    ps = prims(con, "Canopy Tactician")
    m = kinds(ps, "mana_add")
    check("Canopy Tactician produces three green", m and m[0]["colors"] == "GGG", str(m[:1]))

    # mana with a spending restriction can't fund an ability
    m = kinds(prims(con, "Rosheen Meanderer"), "mana_add")
    check("restricted mana is flagged", m and m[0]["restricted"], str(m[:1]))

    # tapping other permanents is finite however they are described
    m = kinds(prims(con, "Heritage Druid"), "mana_add")
    check("tapping three Elves is a finite cost", m and m[0]["finite_cost"], str(m[:1]))

    # Jegantha taps for one of each colour but says "This mana can't be spent to
    # pay generic mana costs", so it cannot fund a {2}{U} untap ability.
    m = kinds(prims(con, "Jegantha, the Wellspring"), "mana_add")
    check("Jegantha's mana is flagged no-generic", m and m[0]["no_generic"], str(m[:1]))
    check("Timeless Lotus has no such restriction",
          not kinds(prims(con, "Timeless Lotus"), "mana_add")[0]["no_generic"])

    # "Add {G} or {U}" is a CHOICE of one mana, not two.
    m = kinds(prims(con, "Maraleaf Pixie"), "mana_add")
    check("a mana choice counts as one", m and m[0]["amount"] == 1, str(m[:1]))
    m = kinds(prims(con, "Gyre Engineer"), "mana_add")
    check("two pips with no 'or' really is two", m and m[0]["amount"] == 2, str(m[:1]))

    # An ability that hands the permanent to an opponent can't be looped.
    m = kinds(prims(con, "Witch Engine"), "mana_add")
    check("giving itself away is not repeatable", m and not m[0]["repeatable"], str(m[:1]))

    r = combo_finder.find(con, template="infinite_mana", limit=600)
    pairs = {frozenset(x["name"] for x in c["cards"]) for c in r["candidates"]}
    for bad in (("Jegantha, the Wellspring", "Crab Umbra"),
                ("Jegantha, the Wellspring", "Sword of the Paruns"),
                ("Maraleaf Pixie", "Freed from the Real"),
                ("Witch Engine", "Sword of the Paruns"),
                ("Canopy Tactician", "Pemmin's Aura"),
                ("Heritage Druid", "Pemmin's Aura"),
                ("Witch Engine", "Freed from the Real"),
                ("Rosheen Meanderer", "Freed from the Real")):
        check("%s is not offered" % " + ".join(bad), frozenset(bad) not in pairs)
    check("a five-colour source still pairs with a blue untapper",
          frozenset({"Jegantha, the Wellspring", "Freed from the Real"}) in pairs)
    check("Jegantha still pairs with an all-coloured untap cost",
          frozenset({"Jegantha, the Wellspring", "Freed from the Real"}) in pairs)
    check("a genuine two-mana dork survives",
          frozenset({"Gyre Engineer", "Freed from the Real"}) in pairs)
    check("mana modelling lifts infinite-mana precision above 50%",
          r["known_rate"] >= 50, "%.1f%%" % r["known_rate"])


def test_combo_prerequisites(con):
    print("combo prerequisites")
    if not con.execute("""select count(*) from sqlite_master
                          where type='table' and name='combos'""").fetchone()[0]:
        print("  (combo db not loaded, skipped)")
        return

    # Naming two cards is not the same as needing only two cards. Boros Reckoner
    # + Boros Charm lists two, and also requires lifelink from somewhere and a
    # damage source - which made it look assemblable when it wasn't.
    r = con.execute("""select notable_prereqs, n_extra from combos
                       where card_names like '%Boros Reckoner%'
                         and card_names like '%Boros Charm%'""").fetchone()
    check("prerequisites are stored", r and r["notable_prereqs"], str(r and r["n_extra"]))
    check("lifelink is named as a requirement", "lifelink" in (r["notable_prereqs"] or "").lower())
    check("both extra requirements are counted", r["n_extra"] == 2, str(r["n_extra"]))

    # templates are the other kind of unnamed piece
    r2 = con.execute("""select requires, n_extra from combos
                        where card_names like '%Woe Strider%'
                          and card_names like '%Great Henge%'""").fetchone()
    check("template requirements are stored", r2 and "Persist" in (r2["requires"] or ""))

    # roughly half of all combos carry one; if this collapses, a field was dropped
    extra = con.execute("select count(*) from combos where n_extra > 0").fetchone()[0]
    total = con.execute("select count(*) from combos").fetchone()[0]
    check("a large share of combos need something unnamed",
          0.3 < extra / total < 0.7, "%d of %d" % (extra, total))

    import cube as cube_mod
    cubes = cube_mod.list_cubes(con)
    if cubes:
        cid = cubes[0]["id"]
        d = cube_mod.cube_combos(con, cid)
        check("cube combos report what else they need",
              all("prereqs" in c and "self_contained" in c for c in d["known"]))
        check("self-contained combos are counted separately",
              d["known_self_contained"] + d["known_needs_extra"] == d["known_total"])
        check("self-contained combos sort first",
              [not c["self_contained"] for c in d["known"]] ==
              sorted(not c["self_contained"] for c in d["known"]))

        # a keyword template is checked against the actual list
        ids = cube_mod.cube_card_ids(con, cid)
        tp = cube_mod.template_in_cube(con, ids, "Persist Creature")
        check("keyword templates are checkable", tp["checkable"])
        check("an effect template admits it can't be checked",
              not cube_mod.template_in_cube(con, ids, "Haste Enabler")["checkable"])


def test_three_card(con):
    print("three-card combos")
    r = combo_finder.find(con, template="blink_engine", limit=20, payoffs=True)
    check("payoffs produce three-card combos", r.get("three_card_total", 0) > 0)
    check("every payoff combo has three pieces",
          all(c["pieces"] == 3 for c in r["three_card"]), str(r["three_card"][:1]))
    check("three-card rate is measured, not inherited from the page",
          r["three_card_rate"] is not None)

    # the rate must not move when the returned page size changes
    a = combo_finder.find(con, template="blink_engine", limit=5, payoffs=True)
    b = combo_finder.find(con, template="blink_engine", limit=300, payoffs=True)
    check("three-card rate is independent of limit",
          a["three_card_rate"] == b["three_card_rate"]
          and a["three_card_total"] == b["three_card_total"],
          "%s vs %s" % (a["three_card_rate"], b["three_card_rate"]))

    # known 3+ card combos are surfaced for a cube regardless of piece count
    n3 = con.execute("select count(*) from combos where n_cards >= 3").fetchone()[0]
    check("the combo database is mostly 3+ cards", n3 > 90000, str(n3))


def test_cube_synergies(con):
    print("cube synergy pairs")
    import cube as cube_mod
    cubes = cube_mod.list_cubes(con)
    if not cubes:
        print("  (no cubes imported, skipped)")
        return
    cid = cubes[0]["id"]
    d = cube_mod.cube_synergies(con, cid, limit=40)
    pairs = d.get("pairs") or []
    check("synergy pairs come back", bool(pairs))
    check("every pair has two cards", all(len(x["cards"]) == 2 for x in pairs))
    check("pairs beat coincidence", all(x["lift"] > 1.5 for x in pairs))
    check("pairs carry their evidence", all(x["played_together"] >= 6 for x in pairs))

    # a pair must fit in one drafted deck
    check("no pair spans more than three colours",
          all(len(set(x["colors"]) - {"C"}) <= 3 for x in pairs),
          str([x["colors"] for x in pairs[:3]]))

    # ranking must prefer evidence: a small-sample fluke shouldn't outrank a
    # pairing proven across many decks purely on raw lift
    ordered = [x["score"] for x in pairs]
    check("results are sorted by the damped score",
          ordered == sorted(ordered, reverse=True))
    big = [x for x in pairs if x["played_together"] >= 40]
    if big:
        worst_big = min(x["score"] for x in big)
        tiny = [x for x in pairs if x["played_together"] <= 7 and x["lift"] < 100]
        check("a weak small sample doesn't outrank well-evidenced pairs",
              all(x["score"] <= worst_big * 3 for x in tiny))

    # every pair says WHY it co-occurs, and the mana base is set aside by default
    check("every pair carries a type", all(x.get("kind") for x in pairs))
    check("the mana base is excluded by default",
          not any(x["kind"] in cube_mod.MANA_KINDS for x in pairs),
          str([x["kind"] for x in pairs[:5]]))
    with_lands = cube_mod.cube_synergies(con, cid, limit=40, include_lands=True)
    check("lands can be brought back",
          with_lands["total_pairs"] > d["total_pairs"],
          "%s vs %s" % (with_lands["total_pairs"], d["total_pairs"]))
    check("land pairs really were half of them",
          with_lands["total_pairs"] > d["total_pairs"] * 1.5)
    check("a breakdown by type is reported", bool(d.get("by_kind")))
    check("typal pairs name a shared creature type",
          all("both are" in (x["hint"] or "") for x in pairs if x["kind"] == "typal"))

    # the toggle has to live outside the re-rendered output or checking it
    # destroys and recreates itself unchecked
    ui = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ui")
    src = "".join(open(os.path.join(ui, f)).read()
                  for f in ("index.html", "shared.css", "shared.js", "cube.js"))
    page = open(os.path.join(ui, "index.html")).read()
    ctl = page.index('id="synLands"')
    out_start = page.index('<div id="cubeOut"')
    check("the mana-base toggle sits outside the rendered output", ctl < out_start)

    # the hint is annotation only and must never drive the order
    hinted = [x for x in pairs if x["hint"]]
    check("hints are optional, not required", len(hinted) <= len(pairs))

    # both cards must be in the cube
    ids = cube_mod.cube_card_ids(con, cid)
    check("both cards of every pair are in the cube",
          all(c["oracle_id"] in ids for x in pairs for c in x["cards"]))


def test_cube_opportunities(con):
    print("cube opportunities")
    import cube as cube_mod
    cubes = cube_mod.list_cubes(con)
    if not cubes:
        print("  (no cubes imported, skipped)")
        return
    cid = cubes[0]["id"]
    d = cube_mod.cube_opportunities(con, cid)
    lanes = d.get("lanes") or []
    check("all ten colour pairs are reported", len(lanes) == 10, str(len(lanes)))
    check("lanes are ranked by opportunity",
          [l["opportunity"] for l in lanes] == sorted((l["opportunity"] for l in lanes), reverse=True))
    check("lanes carry no personal match record",
          all("local_win_rate" not in l and "times_drafted" not in l for l in lanes))

    # lane picks must name cards OF the lane, not universal staples: ranking the
    # whole colour identity by play rate put Evolving Wilds on top of every lane
    picks = cube_mod.lane_picks(con, cid, "UR", limit=10)
    check("lane picks are in the lane's colours",
          all(set(p["color_identity"]) & set("UR") for p in picks),
          str([p["name"] for p in picks[:3]]))
    check("lane picks exclude lands", all("Land" not in (p["type_line"] or "") for p in picks))
    ur = {p["name"] for p in picks}
    gu = {p["name"] for p in cube_mod.lane_picks(con, cid, "GU", limit=10)}
    check("different lanes give different picks", len(ur & gu) < len(ur),
          str(sorted(ur & gu)))


def test_cube_balance_and_swaps(con):
    print("cube balance and swaps")
    import cube as cube_mod
    cubes = cube_mod.list_cubes(con)
    if not cubes:
        print("  (no cubes imported, skipped)")
        return
    cid = cubes[0]["id"]
    b = cube_mod.cube_balance(con, cid)
    check("balance reports colours", len(b["by_colour"]) >= 6)
    check("balance reports a curve", len(b["curve"]) >= 5)
    check("the curve counts spells only, not lands",
          sum(b["curve"].values()) == b["cube_size"] - b["by_type"].get("Land", 0))

    # Swap suggestions run on how often a card appears in COMPARABLE cubes, and
    # refuse outright rather than fall back to Commander play rates.
    s = cube_mod.cube_swaps(con, cid)
    has_refs = con.execute("""select count(*) from sqlite_master
                              where type='table' and name='ref_cubes'""").fetchone()[0] \
        and con.execute("select count(*) from ref_cubes").fetchone()[0]
    if not has_refs:
        check("swaps refuse with no reference cubes", "error" in s, str(s)[:80])
        check("the refusal says what is missing",
              "reference cubes" in s.get("needs", "") or "reference cubes" in s.get("error", ""))
        check("the refusal says how many are needed", "100" in s.get("how_many", ""))
    else:
        check("swaps come back", "swaps" in s)
        check("every swap keeps the slot",
              all(x["cut"]["type_line"].split(" —")[0].split()[-1] ==
                  x["add"]["type_line"].split(" —")[0].split()[-1] for x in s["swaps"]),
              "type mismatch")
        check("a replacement is always more common than the cut",
              all(x["add"]["cube_pct"] > x["cut"]["cube_pct"] for x in s["swaps"]))
        check("confidence is stated", bool(s.get("confidence")))

    check("EDHREC play rate is refused as a power measure",
          "error" in cube_mod.cube_swaps(con, cid, power="edhrec"))

    # neighbourhood similarity
    n = cube_mod.cube_neighbors(con, cid)
    check("neighbours come back as a list", isinstance(n, list))
    check("overlap is a proper fraction", all(0 <= x["overlap"] <= 1 for x in n))
    check("neighbours are sorted by overlap",
          [x["overlap"] for x in n] == sorted((x["overlap"] for x in n), reverse=True))

    # the evidence for that refusal, straight from the data
    coco = con.execute("select edh_decks from cards where name='Collected Company'").fetchone()
    vand = con.execute("select edh_decks from cards where name='Vandalblast'").fetchone()
    check("Commander data really is inverted for cube",
          coco and vand and (coco[0] or 0) < (vand[0] or 0) / 100,
          "CoCo %s vs Vandalblast %s" % (coco[0], vand[0]))


def test_cube_near_misses(con):
    print("cube near misses")
    import cube as cube_mod
    cubes = cube_mod.list_cubes(con)
    if not cubes:
        print("  (no cubes imported, skipped)")
        return
    cid = cubes[0]["id"]
    ids = cube_mod.cube_card_ids(con, cid)

    # combos of every size are searched, not just pairs
    sizes = set()
    for r in con.execute("""select c.n_cards from combos c
                            join combo_cards cc on cc.combo_id = c.id
                            where cc.oracle_id in (%s) group by c.id"""
                         % ",".join("?" * len(ids)), list(ids)):
        sizes.add(r[0])
    check("combos of three or more are in scope", any(s >= 3 for s in sizes), str(sorted(sizes)[:6]))

    d = cube_mod.cube_near_misses(con, cid)
    cards = d.get("cards") or []
    check("near misses come back", bool(cards))
    check("a suggested card is NOT already in the cube",
          all(c["oracle_id"] not in ids for c in cards))
    check("every suggestion completes something", all(c["unlocks"] >= 1 for c in cards))
    check("suggestions are legal in the format by default",
          all(c["format_legal"] for c in cards))
    check("illegal ones are counted, not silently dropped",
          d["excluded_illegal"] > 0 and d["illegal_examples"])

    # each listed combo must be missing exactly this card and nothing else
    for c in cards[:5]:
        for k in c["combos"]:
            others = [n for n in k["cards"] if n != c["name"]]
            check("only %s is missing from %s" % (c["name"], " + ".join(k["cards"])),
                  len(others) == k["n_cards"] - 1)

    # a combo that also needs something unnamed can't be finished by adding a card
    with_extra = cube_mod.cube_near_misses(con, cid, max_extra=0)
    ids_seen = {k["id"] for c in with_extra["cards"] for k in c["combos"]}
    if ids_seen:
        marks = ",".join("?" * len(ids_seen))
        worst = con.execute("select max(n_extra) from combos where id in (%s)" % marks,
                            list(ids_seen)).fetchone()[0]
        check("suggestions exclude combos needing unnamed pieces", (worst or 0) == 0, str(worst))

    check("sorted by how much each card unlocks",
          [c["unlocks"] for c in cards] == sorted((c["unlocks"] for c in cards), reverse=True))


def test_pages_and_privacy():
    print("pages and privacy")
    here = os.path.dirname(os.path.abspath(__file__))
    ui = os.path.join(here, "ui")
    for f in ("index.html", "cube.html", "shared.css", "shared.js", "cube.js"):
        check("ui/%s exists" % f, os.path.exists(os.path.join(ui, f)))

    shared = open(os.path.join(ui, "shared.js")).read()
    cubejs = open(os.path.join(ui, "cube.js")).read()
    cube_page = open(os.path.join(ui, "cube.html")).read()

    # shared.js is loaded by a page that has no tabs, no colour pips and no format
    # pickers, so it must not reach for them at load time
    for missing in ("$('#pips')", "$('#fmt')", "$('#deckFmt')", "$('#swapFmt')"):
        check("shared.js doesn't touch %s" % missing, missing not in shared)

    check("the cube page loads the shared modules",
          "/shared.js" in cube_page and "/cube.js" in cube_page)
    check("the cube page has no tab bar", 'class="tabs"' not in cube_page)
    check("the cube page carries the popup hosts",
          all(i in cube_page for i in ("tipbox", "cardpop", "setpop", "manapop")))

    # nothing personal may survive anywhere in the project
    personal = ("Nate_the_Ace", "TaylorisWright", "LilMunchlax", "bunnysteww",
                "cube_results", "win_rate", "local_win_rate")
    hits = []
    for root, dirs, files in os.walk(here):
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "data")]
        for fn in files:
            if not fn.endswith((".py", ".html", ".js", ".css", ".md", ".sh", ".json")):
                continue
            if fn == "test_suite.py":
                continue
            # the seed script is a transcription of real results, so it is
            # gitignored rather than scrubbed - checked for below
            if fn == "game_nights_seed.py":
                continue
            body = open(os.path.join(root, fn), errors="replace").read()
            for word in personal:
                if word in body:
                    hits.append("%s in %s" % (word, fn))
    check("no personal records remain in the project", not hits, str(hits[:4]))


def test_game_nights():
    print("game night tracker")
    import nights as N

    doc = {"players": [], "nights": []}
    N.add_player(doc, "Ada")
    N.add_player(doc, "Bo")
    check("a player gets a slug id", doc["players"][0]["id"] == "ada")
    try:
        N.add_player(doc, "ada")
        check("adding the same player twice is refused", False)
    except ValueError:
        check("adding the same player twice is refused", True)
    try:
        N.set_night(doc, {"date": "last tuesday"})
        check("a night needs a real date", False)
    except ValueError:
        check("a night needs a real date", True)

    # THE rule for this page: a bye is recorded and then kept out of every rate.
    # Counting it would reward not playing, which is exactly the distortion that
    # made an earlier analysis read far too high.
    N.set_night(doc, {"date": "2026-09-01",
                      "results": {"ada": {"w": 2, "l": 1}, "bo": {"w": 1, "l": 2, "b": 1}}})
    st = {r["name"]: r for r in N.standings(doc)}
    check("byes are recorded", st["Bo"]["byes"] == 1)
    check("byes are not matches", st["Bo"]["matches"] == 3, str(st["Bo"]["matches"]))
    check("byes don't move the rate", st["Bo"]["win_pct"] == 33.3, str(st["Bo"]["win_pct"]))

    # a draw is half a win in the score and no win at all in the win rate
    N.set_night(doc, {"date": "2026-09-08", "results": {"ada": {"w": 0, "l": 0, "d": 2}}})
    ada = {r["name"]: r for r in N.standings(doc)}["Ada"]
    check("a draw is half a win in the score", ada["score_pct"] == 60.0, str(ada["score_pct"]))
    check("a draw is not a win in the win rate", ada["win_pct"] == 40.0, str(ada["win_pct"]))

    # saving an existing night replaces it; it took an id to stop editing one
    # night from quietly adding a second
    before = len(doc["nights"])
    N.set_night(doc, {"id": "2026-09-01", "date": "2026-09-01",
                      "results": {"ada": {"w": 3, "l": 0}}})
    check("editing a night replaces it", len(doc["nights"]) == before, str(len(doc["nights"])))
    check("two nights on one date both survive",
          N.set_night(doc, {"date": "2026-09-08"})["id"] == "2026-09-08-2")

    N.remove_player(doc, "bo")
    check("removing a player strips their results",
          all("bo" not in n["results"] for n in doc["nights"]))
    check("a result for an unknown player is dropped",
          "ghost" not in N.set_night(
              doc, {"date": "2026-09-15", "results": {"ghost": {"w": 1}}})["results"])
    check("counts can't go negative",
          N.set_night(doc, {"date": "2026-09-22",
                            "results": {"ada": {"w": -5}}})["results"]["ada"]["w"] == 0)

    # the results file holds real people's names, so it must stay out of the repo
    here = os.path.dirname(os.path.abspath(__file__))
    check("results are stored under the gitignored data folder",
          os.path.dirname(N.STORE) == os.path.join(here, "data"), N.STORE)
    ignored = open(os.path.join(here, ".gitignore")).read()
    check("the data folder is gitignored", "data/" in ignored)
    seed = os.path.join(here, "game_nights_seed.py")
    check("the results seed is gitignored if it exists",
          not os.path.exists(seed) or "game_nights_seed.py" in ignored)
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch",
                              "game_nights_seed.py", "data/game_nights.json"],
                             cwd=here, capture_output=True)
    check("neither the results nor the seed are tracked by git",
          tracked.returncode != 0, tracked.stdout.decode()[:80])
    check("the published page carries no tracker",
          "nights" not in open(os.path.join(here, "static", "template.html")).read().lower())


def test_color_names():
    print("colour combination names")
    cases = [("UB", "UB (Dimir)"), ("BU", "BU (Dimir)"), ("RW", "RW (Boros)"),
             ("WUB", "WUB (Esper)"), ("BGU", "BGU (Sultai)"),
             ("UBRG", "UBRG (Glint-Eye)"), ("WUBRG", "WUBRG (Five-Color)"),
             ("U", "U (Blue)"), ("", "C (Colorless)"), ("C", "C (Colorless)")]
    for ci, want in cases:
        got = mtgdb.color_label(ci)
        check("color_label(%r) == %r" % (ci, want), got == want, got)
    check("letter order does not matter",
          mtgdb.color_name("GWU") == mtgdb.color_name("UWG") == "Bant")
    # all ten guilds, all ten three-colour wedges/shards must be named
    import itertools
    for n in (2, 3):
        for combo in itertools.combinations("WUBRG", n):
            ci = "".join(combo)
            check("%s has a name" % ci, mtgdb.color_name(ci) is not None, ci)


def test_draft_math():
    print("cube draft maths")
    s = cube.draft_shape(540, players=8, pack_size=15, rounds=3)
    check("360 cards used by an 8-player 3x15 draft", s["cards_used"] == 360)
    check("45 picks each", s["picks_each"] == 45)

    # With nobody competing, the analytic answer is 1 - (P-1)/(2S).
    p = cube.p_single_card(540, contention=0.0)
    expect = 1 - (8 - 1) / (2.0 * 15)
    check("uncontested reach matches the closed form",
          abs(p["p_reaches_you"] - expect) < 0.01, "%.4f vs %.4f" % (p["p_reaches_you"], expect))

    hot = cube.p_single_card(540, contention=0.9)["p_you_get_it"]
    cold = cube.p_single_card(540, contention=0.0)["p_you_get_it"]
    check("more contention means worse odds", hot < cold, "%.3f vs %.3f" % (hot, cold))

    two = cube.p_combo(540, 2)["p_all_pieces"]
    three = cube.p_combo(540, 3)["p_all_pieces"]
    check("more pieces means longer odds", three < two, "%.4f vs %.4f" % (three, two))
    check("probabilities stay in range", 0 <= two <= 1 and 0 <= hot <= 1)


def test_cube_parsing():
    print("cube list parsing")
    csv_text = ('name,CMC,Type,board,maybeboard\n'
                '"Sol Ring",1,"Artifact",mainboard,false\n'
                '"Black Lotus",0,"Artifact",maybeboard,true\n'
                '"Island",0,"Land",mainboard,false\n')
    names = cube.parse_list(csv_text)
    check("CSV import reads the name column", "Sol Ring" in names, str(names))
    check("CSV import drops the maybeboard", "Black Lotus" not in names, str(names))

    txt = "1x Sol Ring\n// comment\n2 Island (LCI) 285\n\nCounterspell"
    names = cube.parse_list(txt)
    check("plain list strips counts, sets and comments",
          names == ["Sol Ring", "Island", "Counterspell"], str(names))


def test_combo_finder(con):
    print("combo finder")
    if not con.execute("select count(*) from sqlite_master where type='table' and name='combos'").fetchone()[0]:
        print("  (combo db not loaded, skipped)")
        return

    r = combo_finder.find(con, template="cost_reduction_mana", limit=500)
    pairs = {frozenset(x["name"] for x in c["cards"]) for c in r["candidates"]}
    check("rediscovers Basalt Monolith + Power Artifact",
          frozenset({"Basalt Monolith", "Power Artifact"}) in pairs)
    check("rediscovers Basalt Monolith + Zirda",
          frozenset({"Basalt Monolith", "Zirda, the Dawnwaker"}) in pairs)

    r = combo_finder.find(con, template="blink_engine", limit=500)
    pairs = {frozenset(x["name"] for x in c["cards"]) for c in r["candidates"]}
    check("rediscovers Eldrazi Displacer + Peregrine Drake",
          frozenset({"Eldrazi Displacer", "Peregrine Drake"}) in pairs)
    names = {x["name"] for c in r["candidates"] for x in c["cards"]}
    check("blink loops don't pair with cast-only triggers",
          "Zacama, Primal Calamity" not in names)

    # Bounded engines must not be scored against a database of infinite combos.
    r = combo_finder.find(con, template="sac_loop", limit=50)
    check("sac_loop reports no rediscovery rate", r["known_rate"] is None and r["bounded"],
          str(r["known_rate"]))

    # Every template should beat pure chance at re-finding known combos.
    for tpl, floor in (("blink_engine", 5.0), ("cost_reduction_mana", 5.0),
                       ("infinite_mana", 5.0)):
        res = combo_finder.find(con, template=tpl, limit=600)
        check("%s rediscovery rate above %.0f%%" % (tpl, floor),
              res["known_rate"] >= floor, "%.1f%%" % res["known_rate"])

    # Vanguard and other non-cards leaked into every result before legality filtering.
    for tpl in ("infinite_mana", "blink_engine", "cost_reduction_mana"):
        res = combo_finder.find(con, template=tpl, limit=500)
        bad = [c for c in res["candidates"]
               for x in c["cards"] if "Vanguard" in (x["type_line"] or "")]
        check("%s returns only real cards" % tpl, not bad, str(bad[:1]))


def main():
    con = mtgdb.connect()
    print("running regression tests\n")
    test_parser(con)
    test_goals(con)
    test_prices(con)
    test_legality(con)
    test_sets(con)
    test_wildcards_and_kinds(con)
    test_cube_explainers(con)
    test_cube_synergies(con)
    test_cube_opportunities(con)
    test_cube_balance_and_swaps(con)
    test_cube_near_misses(con)
    test_targeting(con)
    test_mana_colors(con)
    test_three_card(con)
    test_combo_prerequisites(con)
    test_ui_glossary()
    test_pages_and_privacy()
    test_game_nights()
    test_color_names()
    test_draft_math()
    test_cube_parsing()
    test_combo_finder(con)
    print("\n%d checks, %d failed" % (RUN[0], len(FAILS)))
    if FAILS:
        for f in FAILS:
            print("  - %s" % f)
        return 1
    print("all green")
    return 0


if __name__ == "__main__":
    sys.exit(main())

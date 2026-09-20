#!/usr/bin/env python3
"""Turn a plain-English deck goal into EDHREC themes - no language model involved.

Resolution is three deterministic layers:
  1. a hand-written alias table for how players actually phrase win conditions
     ("commander damage" -> voltron/equipment/auras)
  2. exact and substring matches against the 435 real EDHREC theme names
  3. token overlap scoring as a fallback

Each layer returns weighted themes, so the caller can show what it matched and why
instead of silently guessing.
"""
import re

# goal phrasing -> (theme slug, weight). Weights say how central a theme is to the
# stated goal: the first is the plan, the rest support it.
ALIASES = {
    "commander damage": [("voltron", 1.0), ("equipment", 0.7), ("auras", 0.6), ("unblockable", 0.4)],
    "voltron": [("voltron", 1.0), ("equipment", 0.7), ("auras", 0.6)],
    "suit up": [("voltron", 1.0), ("equipment", 0.8)],
    "one big creature": [("voltron", 0.9), ("stompy", 0.6), ("big-mana", 0.4)],
    "mill": [("mill", 1.0), ("self-mill", 0.5), ("graveyard", 0.4)],
    "self mill": [("self-mill", 1.0), ("graveyard", 0.7), ("reanimator", 0.5)],
    "poison": [("infect", 1.0), ("unblockable", 0.4)],
    "infect": [("infect", 1.0)],
    "tokens": [("tokens", 1.0), ("populate", 0.5), ("anthems", 0.5), ("weenies", 0.4)],
    "go wide": [("tokens", 1.0), ("weenies", 0.7), ("anthems", 0.6)],
    "sacrifice": [("aristocrats", 1.0), ("sacrifice", 0.9), ("lifedrain", 0.5)],
    "aristocrats": [("aristocrats", 1.0), ("sacrifice", 0.8), ("lifedrain", 0.6)],
    "drain": [("lifedrain", 1.0), ("aristocrats", 0.6), ("lifegain", 0.4)],
    "lifegain": [("lifegain", 1.0), ("lifedrain", 0.5)],
    "burn": [("burn", 1.0), ("spellslinger", 0.6), ("pingers", 0.4)],
    "direct damage": [("burn", 1.0), ("pingers", 0.5)],
    "spellslinger": [("spellslinger", 1.0), ("storm", 0.5), ("spell-copy", 0.5)],
    "storm": [("storm", 1.0), ("spellslinger", 0.6), ("ad-nauseam", 0.4)],
    "combo": [("combo", 1.0), ("cedh", 0.5), ("toolbox", 0.4)],
    "control": [("control", 1.0), ("counterspells", 0.8), ("stax", 0.3)],
    "counterspells": [("counterspells", 1.0), ("control", 0.7)],
    "stax": [("stax", 1.0), ("prison", 0.8), ("hatebears", 0.5)],
    "prison": [("prison", 1.0), ("stax", 0.8), ("pillow-fort", 0.6)],
    "pillow fort": [("pillow-fort", 1.0), ("politics", 0.5)],
    "group hug": [("group-hug", 1.0), ("politics", 0.6)],
    "politics": [("politics", 1.0), ("voting", 0.6), ("monarch", 0.5), ("group-hug", 0.4)],
    "landfall": [("landfall", 1.0), ("lands-matter", 0.8), ("ramp", 0.4)],
    "lands": [("lands-matter", 1.0), ("landfall", 0.7)],
    "land destruction": [("land-destruction", 1.0), ("stax", 0.4)],
    "reanimate": [("reanimator", 1.0), ("graveyard", 0.7), ("self-mill", 0.5)],
    "graveyard": [("graveyard", 1.0), ("reanimator", 0.7), ("self-mill", 0.5)],
    "extra turns": [("extra-turns", 1.0), ("control", 0.3)],
    "extra combats": [("extra-combats", 1.0), ("voltron", 0.3), ("attack-triggers", 0.5)],
    "counters": [("plus-1-plus-1-counters", 1.0), ("counters-matter", 0.8), ("proliferate", 0.6)],
    "proliferate": [("proliferate", 1.0), ("counters-matter", 0.7), ("infect", 0.4)],
    "artifacts": [("artifacts", 1.0), ("affinity", 0.6), ("improvise", 0.4), ("thopters", 0.3)],
    "enchantments": [("enchantress", 1.0), ("auras", 0.7), ("shrines", 0.3)],
    "blink": [("blink", 1.0), ("etb", 0.8)],
    "flicker": [("blink", 1.0), ("etb", 0.8)],
    "steal": [("theft", 1.0), ("donate", 0.5), ("clones", 0.3)],
    "theft": [("theft", 1.0), ("donate", 0.5)],
    "wheels": [("wheels", 1.0), ("discard", 0.6)],
    "discard": [("discard", 1.0), ("wheels", 0.6), ("madness", 0.4)],
    "ramp": [("ramp", 1.0), ("big-mana", 0.8), ("mana-dorks", 0.5), ("mana-rocks", 0.5)],
    "big mana": [("big-mana", 1.0), ("ramp", 0.8), ("stompy", 0.4)],
    "treasure": [("treasure", 1.0), ("artifacts", 0.4)],
    "card draw": [("card-draw", 1.0), ("cantrips", 0.5), ("wheels", 0.4)],
    "aggro": [("aggro", 1.0), ("weenies", 0.6), ("haste", 0.5)],
    "hatebears": [("hatebears", 1.0), ("stax", 0.6), ("weenies", 0.4)],
    "unblockable": [("unblockable", 1.0), ("voltron", 0.4), ("saboteurs", 0.5)],
    "vehicles": [("vehicles", 1.0), ("artifacts", 0.5)],
    "equipment": [("equipment", 1.0), ("voltron", 0.7)],
    "auras": [("auras", 1.0), ("enchantress", 0.6), ("voltron", 0.5)],
    "cedh": [("cedh", 1.0), ("combo", 0.7)],
    "budget": [],   # handled as a price constraint, not a theme
}

# words that describe intent rather than strategy - stripped before matching
NOISE = set("""deck build building win wins winning want strategy plan around based
the a an my for with under on and or that to i'd like make me some cards card good
best cheap budget dollars dollar bucks usd about approx around commander edh""".split())

MONEY = re.compile(r"\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*)\s*(?:usd|dollars|bucks)\b", re.I)


def parse_budget(text):
    """Pull a dollar figure out of the goal text, if the user wrote one."""
    m = MONEY.search(text or "")
    if not m:
        return None
    raw = (m.group(1) or m.group(2) or "").replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def _norm(s):
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower()).strip()


def _tokens(s):
    return [w for w in _norm(s).split() if w and w not in NOISE]


def resolve(text, theme_rows, limit=6):
    """text -> ranked themes.

    theme_rows: iterable of (slug, name) for every theme in the DB.
    Returns [{slug, name, weight, matched_by}], best first.
    """
    raw = _norm(text)
    toks = _tokens(text)
    if not raw:
        return []
    by_slug = {}
    names = {}
    for slug, name in theme_rows:
        names[slug] = name or slug.replace("-", " ").title()

    def add(slug, w, how):
        if slug not in names:          # alias points at a theme we don't have cached
            return
        cur = by_slug.get(slug)
        if not cur or w > cur["weight"]:
            by_slug[slug] = {"slug": slug, "name": names[slug], "weight": round(w, 3),
                             "matched_by": how}

    # 1. alias table - longest phrase first so "extra turns" beats "turns"
    for phrase in sorted(ALIASES, key=len, reverse=True):
        if phrase in raw:
            for slug, w in ALIASES[phrase]:
                add(slug, w, "goal phrase '%s'" % phrase)

    # 2. direct hits on real theme names/slugs, on WORD boundaries -
    #    a substring test makes "aristocrats" match the theme "rats"
    for slug, name in names.items():
        n = _norm(name)
        if not n:
            continue
        if n == raw or slug == raw.replace(" ", "-"):
            add(slug, 1.0, "exact theme name")
        elif len(n) > 3 and re.search(r"\b%s\b" % re.escape(n), raw):
            add(slug, 0.85, "theme name appears in goal")

    # 3. token overlap fallback
    if not by_slug and toks:
        tset = set(toks)
        for slug, name in names.items():
            ntoks = set(_norm(name).split()) | set(slug.split("-"))
            hit = tset & ntoks
            if hit:
                add(slug, 0.3 + 0.2 * len(hit), "shares '%s'" % ", ".join(sorted(hit)))

    out = sorted(by_slug.values(), key=lambda r: -r["weight"])
    return out[:limit]

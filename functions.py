#!/usr/bin/env python3
"""Parse oracle text into typed effect primitives.

This is the part that does NOT care how often a card is played. It reads what a
card actually does, so two cards that have never appeared in a deck together can
still be recognised as fitting together.

The output per card is a set of facts like:
    mana_add(amount=3, colors='C', cost='{T}', repeatable=True)
    untap(target='artifact', cost='{3}', repeatable=True)
    sac_outlet(free=True, what='creature')
    self_recur(kind='from_graveyard')
    death_trigger(effect='drain')

Deliberately conservative: it would rather miss a card than claim a card does
something it doesn't, because a false primitive turns into a fake combo.
"""
import re

SYM = r"\{[^}]+\}"

NUM_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
             "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def _count(text):
    """How many things an effect names: 'up to five lands' -> 5. Unbounded
    wordings ('all', 'each') return a big number; unknown returns 1."""
    s = (text or "").lower()
    if re.search(r"\ball\b|\beach\b|\bany number\b", s):
        return 99
    m = re.search(r"(?:up to\s+)?(\d+|%s)\s+\w*\s*lands?" % "|".join(NUM_WORDS), s)
    if m:
        v = m.group(1)
        return int(v) if v.isdigit() else NUM_WORDS.get(v, 1)
    m = re.search(r"(?:up to\s+)?(\d+|%s)\b" % "|".join(NUM_WORDS), s)
    if m:
        v = m.group(1)
        return int(v) if v.isdigit() else NUM_WORDS.get(v, 1)
    return 1


NON_MANA_SYMBOLS = {"T", "Q", "E", "PW", "CHAOS", "TK"}


def _mana_amount(blob):
    """Count MANA symbols in a cost/production blob, treating {2} as 2.

    {T} and {Q} are not mana - counting the tap symbol as one generic makes every
    mana dork look mana-neutral and hides every infinite-mana loop.
    """
    n = 0
    for s in re.findall(SYM, blob or ""):
        inner = s[1:-1].upper()
        if inner in NON_MANA_SYMBOLS:
            continue
        if inner.isdigit():
            n += int(inner)
        elif inner == "X":
            n += 0          # unknown, treat as zero for safety
        else:
            n += 1
    return n


def _colors(blob):
    """Coloured pips WITH their counts: "{G}{G}{G}" -> "GGG".

    Counts matter. A source producing one blue mana per tap cannot pay a {U}{U}
    untap cost, so collapsing this to a set of colours would keep a loop that
    never actually runs.
    """
    out = []
    for s in re.findall(SYM, blob or ""):
        inner = s[1:-1]
        if "/" in inner:            # hybrid: either half will do, so don't demand one
            continue
        for ch in inner:
            if ch in "WUBRGC":
                out.append(ch)
    return "".join(sorted(out))

def _production(blob):
    """Mana produced by one activation: (amount, colours).

    "Add {G} or {U}" is a CHOICE of one mana, not two. Counting both symbols made
    every two-colour dork look like a two-mana source, which is the difference
    between a loop and nothing. "Add {G}{U}" really is two.
    """
    options = re.split(r"\bor\b", blob or "")
    best_n, best_c = 0, ""
    for opt in options:
        n = _mana_amount(opt)
        if n > best_n:
            best_n, best_c = n, _colors(opt)
    return best_n, best_c


# An activated ability is "cost: effect". Split on the first colon rather than
# matching the cost with a regex - a nested-alternation cost pattern backtracks
# catastrophically on long reminder text.
ONCE_PER_TURN = re.compile(r"activate (only )?once each turn|only once each turn|"
                           r"only any time you could cast a sorcery|"
                           r"only during your (upkeep|turn|untap step|end step)|"
                           r"only during (an opponent|your next)|"
                           r"activate only as a sorcery", re.I)

# A cost is short, has no sentence punctuation, and either contains a mana symbol
# or opens with one of the cost verbs ("Sacrifice a creature", "Pay 3 life").
COST_VERB = re.compile(r"^(T|Tap|Untap|Sacrifice|Discard|Pay|Exile|Remove|Return|"
                       r"Reveal|Put|\{)", re.I)


def _is_cost(s):
    if not s or len(s) > 60 or re.search(r"[.;!?]", s):
        return False
    return bool(re.search(SYM, s) or COST_VERB.match(s))


QUOTED = re.compile(r'"([^"]{4,200})"')


def abilities(text):
    """Yield (cost, effect, repeatable) for each activated ability found.

    Granted abilities written in quotes ("... has \"{1}{U}: Exile this creature\"")
    count too - that is where cards like Deadeye Navigator keep their engine.
    """
    lines = [(ln, False) for ln in (text or "").split("\n")]
    # an ability written in quotes is handed to another permanent, so "exile this
    # creature" inside quotes flickers that OTHER creature - which is exactly how
    # Deadeye Navigator works
    lines += [(ln, True) for ln in QUOTED.findall(text or "")]
    for line, granted in lines:
        if ":" not in line:
            continue
        cost, _, effect = line.partition(":")
        cost, effect = cost.strip(), effect.strip()
        if not effect or not _is_cost(cost):
            continue
        yield cost, effect, not bool(ONCE_PER_TURN.search(line)), granted


MANA_ADD = re.compile(r"\badds?\s+((?:%s|\s|or|and)+)" % SYM, re.I)
TAP_COST = re.compile(r"\{T\}")
UNTAP_TARGET = re.compile(
    r"untap (?:target|another target|up to \w+(?: target)?|all|each|that|enchanted|"
    r"equipped|the?) (?P<what>[a-z, \-]*?)(?=\.|,|$| you| they| it| under)", re.I)
UNTAP_SELF = re.compile(r"untap (it|~)(?![\w])", re.I)
SAC_OUTLET = re.compile(r"sacrifice (a|another|one or more|any number of) "
                        r"(?P<what>creature|artifact|permanent|land|token)s?\b", re.I)
# Recursion that can be used over and over (the engine kind)
RECUR_REPEATABLE = re.compile(
    r"(return ~ from your graveyard to the battlefield)|"
    r"(you may cast ~ from your graveyard)|"
    r"(cast ~ from your graveyard)", re.I)
# Recursion that works exactly once - these do NOT loop
RECUR_ONCE = re.compile(r"\bunearth\b|\bdisturb\b|\bencore\b|\bflashback\b|"
                        r"\bembalm\b|\beternalize\b|\bescape\b|\bpersist\b|\bundying\b|"
                        r"\baftermath\b|\bjump-start\b", re.I)

SAC_SELF = re.compile(r"sacrifice ~", re.I)

# "Ferocious — At the beginning of combat..." is a triggered ability wearing an
# ability word. Strip the prefix before testing whether a line is a trigger, or
# Flamewake Phoenix reads as free on-demand recursion.
ABILITY_WORD = re.compile(r"^\s*[A-Z][A-Za-z'’ ]{2,24}\s*[—-]\s*", re.U)
TRIGGER_START = re.compile(r"^\s*(when|whenever|at the beginning|at end of)\b", re.I)


def _is_triggered(line):
    return bool(TRIGGER_START.match(ABILITY_WORD.sub("", line or "")))

# "Spend this mana only on costs that contain {X}" - such mana cannot pay an
# activated ability's cost, so it can't sustain a loop.
RESTRICTED_MANA = re.compile(r"spend this mana only", re.I)

# Jegantha taps for one of each colour but adds "This mana can't be spent to pay
# generic mana costs", so it cannot pay the {2} in a {2}{U} untap ability.
NO_GENERIC_MANA = re.compile(r"can't be spent to pay generic mana costs", re.I)

# Witch Engine taps for four black and then hands itself to an opponent. An
# ability that gives the permanent away, exiles it or bounces it cannot loop.
GIVES_ITSELF_AWAY = re.compile(
    r"(opponent|player) gains control of (~|this)|"
    r"exile ~ at |sacrifice ~ at |return ~ to its owner's hand", re.I)

# Any other "can't be spent" wording is a restriction we haven't modelled; treat
# it as unusable rather than quietly assuming it's fine.
OTHER_MANA_LIMIT = re.compile(r"can't be spent to (?!pay generic mana costs)", re.I)

# The opposite: cards that let their mana pay for anything. Chromatic Orrery taps
# for five colourless but says "You may spend mana as though it were mana of any
# color", so its mana really does pay a {U} cost.
ANY_COLOR = re.compile(r"spend (this |that )?mana as though it were mana of any (color|type)|"
                       r"as though it were mana of any color", re.I)

# Costs that are not mana but are still finite. A loop that pays one of these per
# iteration runs out; it is not infinite.
FINITE_COST = re.compile(r"discard|sacrifice|exile .{0,30}(from your graveyard|from your hand)|"
                         r"pay \d+ life|remove .{0,20}counter|"
                         r"return .{0,30} to (its owner|your hand)|reveal|"
                         # tapping OTHER permanents runs out just as surely as
                         # discarding does - you only have so many untapped, and
                         # they may be named by subtype ("three untapped Elves")
                         r"\btap (an|another|two|three|four|five|\d+|x)\b", re.I)

# "Activate only if you control a Gideon planeswalker" doesn't stop the loop, but
# it means a third card is needed, so it isn't the two-card combo we'd be claiming.
CONDITIONAL = re.compile(r"activate only if|only if you (control|have)|"
                         r"as long as you control", re.I)
DRAIN = re.compile(
    r"each opponent loses (\d+|x) life|target (opponent|player) loses (\d+|x) life|"
    r"loses? \d+ life and you gain", re.I)
DAMAGE_ANY = re.compile(r"deals? (\d+|x) damage to (any target|target player|each opponent)", re.I)
DEATH_TRIGGER = re.compile(r"when(ever)? (~|this creature|[A-Z][\w' ,\-]{2,30}|another creature|"
                           r"a creature you control) dies", re.I)
ETB_TRIGGER = re.compile(r"when(ever)? ~ enters", re.I)
# a trigger on something ELSE entering - useful, but it is not this card's ETB
OTHER_ETB = re.compile(r"when(ever)? (a|another|one or more)[\w ,\-]{0,30} enters", re.I)
# self-references are normalised to ~ before this runs, so "Exile this creature"
# arrives as "Exile ~" - the literal words never match
# What a flicker effect can actually exile matters: most "blinkers" only exile
# THEMSELVES ("Exile this creature, then return it"), which cannot flicker a
# separate payload card. Only an effect naming another target can.
BLINK = re.compile(r"exile (?P<what>target [a-z ]+|another target [a-z ]+|"
                   r"any number of target [a-z ]+|~|it)"
                   r"[^.]{0,70}?return (it|them|that card|those cards|that creature|~)"
                   r"[^.]{0,70}?to the battlefield", re.I)
TOKEN = re.compile(r"create (\w+|x) .{0,40}?token", re.I)
# Two very different things say "costs less". Only the second one can turn a
# mana rock into an engine.
COST_REDUCE_CAST = re.compile(r"costs? \{?(\d+)\}? less to cast", re.I)
COST_REDUCE_ABILITY = re.compile(
    r"(?P<subject>[^.\n]{0,70}?)abilit(?:y|ies)[^.\n]{0,50}?"
    r"costs? \{?(?P<amt>\d+)\}? less to activate", re.I)
# A reduction that only covers equip, crew, cycling or the card's own abilities
# can't make someone else's mana rock cheaper to untap.
NARROW_REDUCTION = re.compile(r"\bequip\b|\bcrew\b|\bcycling\b|\bninjutsu\b|"
                              r"\bloyalty\b|\blevel up\b|\bmorph\b|\bunearth\b|"
                              r"\bchannel\b|\b~\b|\bthis\b", re.I)
FREE_CAST = re.compile(r"without paying its mana cost|cast .{0,30} for free", re.I)
COPY_SPELL = re.compile(r"copy target (instant|sorcery|spell)|copy that spell", re.I)


def analyse(name, type_line, oracle_text, mana_cost=""):
    """Return a list of primitive dicts for one card."""
    t = oracle_text or ""
    # Normalise every way a card refers to itself to "~". Modern oracle text says
    # "this card" / "this creature" rather than repeating the name, so matching on
    # the name alone finds almost nothing.
    if name:
        t = t.replace(name, "~")
        if "," in name:
            t = t.replace(name.split(",")[0], "~")
    t = re.sub(r"\bthis (card|creature|permanent|artifact|land|enchantment|planeswalker|token)\b",
               "~", t, flags=re.I)
    # Reminder text restates the rules for a keyword; it is not what makes this
    # card different, and it produces false primitives (disturb's reminder text
    # says "cast this card from your graveyard").
    t = re.sub(r"\([^)]*\)", "", t)
    out = []
    type_line = type_line or ""

    for cost, effect, repeatable, granted in abilities(t):
        cost_mana = _mana_amount(cost)
        taps = bool(TAP_COST.search(cost)) or bool(re.match(r"^\s*(T|Tap)\b", cost))
        # an ability that eats the permanent itself can only ever be used once
        sac_self = bool(SAC_SELF.search(cost))
        finite = bool(FINITE_COST.search(cost))
        conditional = bool(CONDITIONAL.search(effect))
        if GIVES_ITSELF_AWAY.search(effect):
            repeatable = False
        if sac_self:
            repeatable = False
        m = MANA_ADD.search(effect)
        if m:
            produced_n, produced_c = _production(m.group(1))
            out.append({"kind": "mana_add", "amount": produced_n,
                        "colors": produced_c,
                        "restricted": bool(RESTRICTED_MANA.search(effect))
                                      or bool(OTHER_MANA_LIMIT.search(effect)),
                        "no_generic": bool(NO_GENERIC_MANA.search(effect)),
                        "any_color": bool(ANY_COLOR.search(t)),
                        "cost_colors": _colors(cost), "cost_mana": cost_mana,
                        "taps": taps, "repeatable": repeatable, "sac_self": sac_self,
                        "finite_cost": finite or conditional,
                        "net": _mana_amount(m.group(1)) - cost_mana, "src": effect[:90]})
        if UNTAP_SELF.search(effect) or re.match(r"^untap (this|it)\b", effect, re.I):
            out.append({"kind": "untap", "target": "self", "cost_mana": cost_mana,
                        "cost_colors": _colors(cost),
                        "taps": taps, "repeatable": repeatable, "sac_self": sac_self,
                        "finite_cost": finite or conditional, "src": effect[:90]})
        u = UNTAP_TARGET.search(effect)
        if u:
            out.append({"kind": "untap", "target": (u.group("what") or "").strip() or "permanent",
                        "cost_mana": cost_mana, "cost_colors": _colors(cost),
                        "taps": taps, "repeatable": repeatable,
                        "sac_self": sac_self, "finite_cost": finite or conditional,
                        "src": effect[:90]})
        if SAC_OUTLET.search(cost):
            w = SAC_OUTLET.search(cost)
            out.append({"kind": "sac_outlet", "what": w.group("what").lower(),
                        "free": cost_mana == 0 and not taps,
                        # Woe Strider says "Sacrifice another creature", so it can
                        # never feed itself to its own outlet
                        "another": bool(re.search(r"sacrifice another", cost, re.I)),
                        "repeatable": repeatable, "src": cost[:60]})
        if DRAIN.search(effect):
            out.append({"kind": "drain", "cost_mana": cost_mana, "repeatable": repeatable})
        if TOKEN.search(effect):
            out.append({"kind": "token", "cost_mana": cost_mana, "repeatable": repeatable})
        bm = BLINK.search(effect)
        if bm:
            what = (bm.group("what") or "").strip().lower()
            # "~"/"it" means it only flickers itself; a granted ability flickers
            # whichever creature it was handed to
            if what in ("~", "it"):
                tgt = "creature" if granted else "self"
            else:
                tgt = re.sub(r"^(another |any number of )?target ", "", what).strip() or "permanent"
            out.append({"kind": "blink", "target": tgt, "cost_mana": cost_mana,
                        "repeatable": repeatable, "taps": taps, "finite_cost": finite,
                        "sac_self": sac_self})

    # static / triggered facts (not behind an activation cost)
    # triggered-on-entry effects that produce mana or untap lands: the payload a
    # blink loop actually needs (a card's separate tap ability does not count)
    for line in t.split("\n"):
        if not ETB_TRIGGER.search(line):
            continue
        cast_only = bool(re.search(r"if you cast (it|~)|if you('ve| have) cast", line, re.I))
        m = MANA_ADD.search(line)
        if m:
            etb_n, etb_c = _production(m.group(1))
            out.append({"kind": "etb_mana", "amount": etb_n,
                        "colors": etb_c, "repeatable": not cast_only,
                        "src": line[:90]})
        u = UNTAP_TARGET.search(line)
        if u and "land" in (u.group("what") or ""):
            # how MANY lands matters: untapping two lands can't pay for a
            # three-mana blink, so the loop would run backwards. And a cast-only
            # trigger (Zacama) never fires off a blink at all.
            out.append({"kind": "etb_untap_lands", "target": u.group("what").strip(),
                        "amount": _count(u.group(0)), "repeatable": not cast_only,
                        "src": line[:90]})

    for m in UNTAP_TARGET.finditer(t):
        what = (m.group("what") or "").strip()
        if not what or any(o["kind"] == "untap" and o.get("target") == what for o in out):
            continue
        out.append({"kind": "untap", "target": what, "cost_mana": 0, "taps": False,
                    "repeatable": False, "triggered": True, "src": m.group(0)[:80]})

    # keyword recursion is decisive and one-shot - check it BEFORE the general
    # "return ~ from your graveyard" pattern, which disturb/flashback also satisfy
    if RECUR_ONCE.search(t):
        out.append({"kind": "self_recur", "target": "once", "repeatable": False,
                    "cost_mana": None, "src": "one-shot recursion keyword"})
    elif RECUR_REPEATABLE.search(t):
        # what does bringing it back actually cost? A loop is only free if the
        # recursion is free; Necrosavant at {3}{B}{B} a go is a value engine, not a combo
        cost, rep, finite, condition = None, True, False, None
        for c2, e2, r2, _g in abilities(t):
            if RECUR_REPEATABLE.search(e2):
                cost = _mana_amount(c2)
                rep = r2 and not SAC_SELF.search(c2)
                if re.search(r"sacrifice a", c2, re.I):
                    rep = False        # pays another creature to come back
                # exiling cards from your graveyard to come back runs out
                finite = bool(FINITE_COST.search(c2))
                break
        for line in t.split("\n"):
            if not RECUR_REPEATABLE.search(line):
                continue
            # Recursion you can't ask for on demand isn't an engine: it fires only
            # when some other event happens ("When a Desert is put into a graveyard…",
            # "Ferocious — At the beginning of combat…").
            if _is_triggered(line):
                rep = False
            if OTHER_ETB.search(line):
                rep = False
            # A board-state condition is not the same as a trigger. Gravecrawler's
            # "as long as you control a Zombie" is trivially true in the deck that
            # wants it, so it stays an engine - but the condition is recorded so
            # it can be shown rather than hidden. "Activate only if you attacked"
            # is a genuine gate and does stop it.
            cm = re.search(r"(as long as you control [^.]{0,40}|"
                           r"if you control [^.]{0,40})", line, re.I)
            if cm:
                condition = cm.group(1).strip()
            if re.search(r"activate only if|only if you", line, re.I):
                rep = False
        if cost is None and re.search(r"cast ~ from your graveyard", t, re.I):
            # recasting it from the graveyard still costs its own mana value
            cost = _mana_amount(mana_cost)
        out.append({"kind": "self_recur", "target": "repeatable",
                    "repeatable": rep and not finite,
                    "finite_cost": finite, "cost_mana": cost,
                    "condition": condition,
                    # `detail` is what build_functions stores, and the condition is
                    # the useful thing to keep for this primitive
                    "target": condition or "repeatable",
                    "src": condition or "recurs itself repeatedly"})
    elif False:
        out.append({"kind": "self_recur", "target": "once", "repeatable": False,
                    "src": "one-shot recursion keyword"})
    if DEATH_TRIGGER.search(t):
        eff = "drain" if DRAIN.search(t) else ("token" if TOKEN.search(t) else "other")
        out.append({"kind": "death_trigger", "effect": eff})
    if ETB_TRIGGER.search(t):
        eff = "drain" if DRAIN.search(t) else ("token" if TOKEN.search(t) else "other")
        out.append({"kind": "etb_trigger", "effect": eff})
    if DRAIN.search(t) and not any(o["kind"] == "drain" for o in out):
        out.append({"kind": "drain", "cost_mana": 0, "repeatable": True})
    if DAMAGE_ANY.search(t):
        out.append({"kind": "damage", "src": "text"})
    # Work sentence by sentence: a 70-character lookbehind drags in unrelated
    # clauses (Zirda's companion text made its own reduction look narrow).
    for sentence in re.split(r"(?<=\.)\s+|\n", t):
        m = re.search(r"costs? \{?(?P<amt>\d+)\}? less to activate", sentence, re.I)
        if not m or not re.search(r"abilit(y|ies)", sentence, re.I):
            continue
        if NARROW_REDUCTION.search(sentence):
            scope = "narrow"
        elif re.search(r"\bpermanents?\b", sentence, re.I):
            scope = "permanent"
        elif re.search(r"\bartifacts?\b", sentence, re.I):
            scope = "artifact"
        elif re.search(r"\bcreatures?\b", sentence, re.I):
            scope = "creature"
        elif re.search(r"\blands?\b", sentence, re.I):
            scope = "land"
        elif re.search(r"abilities you activate|activated abilities", sentence, re.I):
            # Zirda's "Abilities you activate that aren't mana abilities cost {2}
            # less" names no card type because it covers every one of them. The
            # mana-ability exclusion doesn't matter here: an untap ability isn't a
            # mana ability, so the discount still applies to it.
            scope = "permanent"
        else:
            scope = "narrow"
        floor = bool(re.search(r"can't reduce .{0,40}less than one mana", sentence, re.I))
        out.append({"kind": "cost_reduce_ability", "amount": int(m.group("amt")),
                    "target": scope, "free": floor, "src": sentence.strip()[:70]})
        break
    cc = COST_REDUCE_CAST.search(t)
    if cc:
        out.append({"kind": "cost_reduce", "amount": int(cc.group(1))})
    if FREE_CAST.search(t):
        out.append({"kind": "free_cast"})
    if COPY_SPELL.search(t):
        out.append({"kind": "copy_spell"})
    if BLINK.search(t) and not any(o["kind"] == "blink" for o in out):
        out.append({"kind": "blink", "target": "self", "cost_mana": None,
                    "repeatable": False})
    if re.search(r"untaps? (itself|this (creature|artifact|permanent|land))", t, re.I) \
            and not any(o["kind"] == "untap" for o in out):
        out.append({"kind": "untap", "target": "self", "cost_mana": 0,
                    "taps": False, "repeatable": True, "src": "untaps itself"})

    # de-duplicate identical primitives
    seen, uniq = set(), []
    for o in out:
        key = (o["kind"], o.get("target"), o.get("amount"), o.get("what"), o.get("effect"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(o)
    return uniq

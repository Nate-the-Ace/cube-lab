# MTG Brewer

A local database of every Magic card ever printed, plus deckbuilding tools that
work from two independent signals: **what people play** (EDHREC) and **what cards
actually do** (parsed oracle text). Price is a dial, not the point.

## Run it

```
./refresh.sh          # download card data + rebuild the DB
python3 server.py     # http://127.0.0.1:8747
```

Three pages, one server: `/` is the full personal tool, `/cube` is **Cube Lab** —
the cube analysis alone, with nothing personal in it — and `/nights` tracks game
night results.

## Game nights

`/nights` keeps wins, losses, draws and byes per player per night, in
`data/game_nights.json`. That folder is gitignored, so the results never reach
the repo and nothing about them is exported to the published Cube Lab page.

A **bye is recorded but never counted.** It isn't a game anyone played, so
including it would quietly reward not playing — the same distortion that inflated
an earlier read of these numbers. Every rate divides by games actually played.
`Score%` counts a draw as half a win (Swiss convention) and is what the table
sorts by; `Win%` counts outright wins only.

Export and import round-trip the whole file, so a season can be archived or moved
between machines.

## Cube Lab as a file you can hand out

`build_static.py` freezes one cube into a single self-contained HTML file with no
server and no database behind it. The draft arithmetic is re-implemented in the
page, so the players / pack size / contention controls keep working.

```
python3 build_static.py                 # writes docs/index.html
python3 build_static.py "Some Cube"     # when more than one cube is loaded
```

The build has two halves. Exporting needs the 1.3 GB database; baking does not:

```
python3 build_static.py                 # export docs/cube_data.json, then bake
python3 build_static.py --from-data     # bake the committed blob, no database
```

`docs/index.html` is what GitHub Pages serves. `.github/workflows/pages.yml`
re-bakes and deploys it on every push to `static/template.html`, and weekly to
pick up price changes via `refresh_prices.py` (which reads Scryfall's bulk file
directly and needs no database either).

**CI cannot refresh the analysis.** Combos, pairs and composition come out of the
full database, and the cube list can't be fetched at all — every cube-list route
on Cube Cobra is `Disallow`ed in their robots.txt. When the cube changes, export
it here and commit `docs/cube_data.json`.

Pages on a private repo needs a paid plan, so the deploy job is skipped until the
repo is public; the build still runs and commits.

## Data sources

| source | what it gives | how |
|---|---|---|
| Scryfall bulk `default_cards` | every English printing (118,609) of every card (38,906) | `fetch.py` / `load.py` |
| Scryfall `prices.usd` | TCGPlayer market price per printing, daily | same file; `tcgplayer_id` links to the listing |
| EDHREC commander pages | 8,135 commanders, 2.1M card inclusion rates + synergy | `scrape_edhrec.py` / `load_edhrec.py` (~68 min) |
| EDHREC theme pages (435) | curated card pools per strategy ("voltron", "mill") | `scrape_edhrec.py themes` / `load_themes.py` |
| Scryfall Tagger | 236,187 functional card tags — what cards *do* | `fetch.py oracle_tags` / `load_tags.py` |
| Scryfall sets | 1,051 sets: full names, symbols, release dates | `load_sets.py` (one request) |
| Commander Spellbook | 110,355 known combos | `fetch_combos.py` / `load_combos.py` |
| our own parser | oracle text → typed effect primitives | `functions.py` / `build_functions.py` |

Scraping is rate-limited, cached and resumable. Commander Spellbook's paginated
API rate-limits bulk crawls, so we use their published static dump instead.

## The price dial

Price is a `price_sensitivity` slider from 0 to 1 wherever it applies, and every
budget field is optional:

- **0** — ignore price. Build the deck the commander actually plays; report what it costs.
- **0.5** (default) — balanced. Ranking is `play_rate / price ** sensitivity`.
- **1** — maximum staples per dollar. Buys more real cards, skews cheap.

Concretely, for one commander at $150: sensitivity 0 gets 47 real staples and 30
filler slots; sensitivity 0.5 gets 97 staples and 2 filler. With no budget at all,
that deck costs $484.

## Tabs

- **Search** — every filter lives in the table's header row, under the column it
  filters: card text under Card, type under Type (naming any non-land type keeps lands out,
  so there's no separate toggle for it), the colour pips under CI, a price ceiling
  under Cheapest, the set picker under Printing and the format under Legal.
  Filters apply as you use them (text boxes wait for you to stop typing), and only
  the table body re-renders, so nothing interrupts what you're typing.
- **Price a deck** — paste any list; totals, per-card cheapest printing, ban flags.
- **Swaps** — cards that appear in the same commanders' decks, weighted by overlap.
- **Cut picker** — name a card going in and the cards you'd consider cutting; ranks
  the cuts on five signals (unplayed by this commander, unplayed generally,
  redundant with the incoming card, type fit, money freed) with a price-weight dial.
- **Goal** — plain English ("commander damage win, $150") resolves to real EDHREC
  strategy pages, then lists the cards that *define* that plan, the commanders who
  play it, and the generic staples it still wants.
- **Combo finder** — see below.
- **Brew** — a full 99-card list for a commander at a given budget and dial setting.

## Cube

Import a cube (Cube Cobra id, a `.csv` export, a `.txt` list, or pasted text) and
the closed pool makes two things computable that aren't otherwise.

**Combos that are actually assemblable — with the emphasis on *actually*.** Every
one of the 110,355 known combos is checked against the list. But naming two cards
is not the same as needing only two cards: **52,768 of them also require something
unnamed**, like "a way to give it lifelink" or "a persist creature". Those
requirements are listed, and where one is a keyword the cube is checked for it.

This matters more than it sounds. The Pioneer cube appears to contain two known
combos; neither is assemblable. Boros Reckoner + Boros Charm needs lifelink from
somewhere and a damage source, and Woe Strider + The Great Henge needs a persist
creature — of which the cube has none.
The card-text analysis runs against the cube too, so it proposes interactions
specific to your pool.

**One card short** (last section, since it's consulted rarely). Searching for
three-plus card combos inside the cube returns
nothing — 7,004 combos touch the list but none of the larger ones are complete.
The useful question is what the cube is one card away from, so combos missing
exactly one piece are listed by the card that would finish them, ranked by how
many each unlocks. Cards illegal in the cube's format are excluded and counted
rather than shown, and combos that also need something unnamed are left out,
because adding a card wouldn't complete those either.

**Draft odds.** Two things must happen for you to get a card:

1. it has to be opened at all — with `players × rounds × pack_size` cards pulled
   from a cube of N, that's just the fraction of the cube used;
2. it has to survive the drafters between its pack's opener and you. Your seat is
   equally likely to be any distance d from that opener, so the model averages over
   d, with each drafter ahead of you taking it with probability
   `contention + (1 - contention) / cards_left`.

`contention` is a slider: 0 means nobody else wants the card, 1 means the first
person to see it takes it. For a 540-card cube, 8 players, 3×15: any one card is
66.7% likely to be opened and 30.9% likely to reach you at normal contention —
**20.6% overall**, so a two-piece combo lands about 4.2% of the time, or once every
~24 drafts.

Multi-piece odds treat the pieces as independent, which slightly overstates them
(the pieces compete for your picks), so read them as an upper bound.

**Colour lanes** report how deep each pair runs and how many of its cards you should
expect to draft — the signal that actually drives cube picks.

### Pairs worth trying

The point of the cube tab is finding ideas you haven't had, and the global combo
engine can't do that — every two-card infinite combo worth finding is already in a
database. Inside a closed 540-card pool a better question is answerable: **which
pairs work but nobody actually plays together?**

That's measured with **lift** — how many times more often two cards share a deck
than their individual popularity predicts. Lift of 1 is coincidence, two good
cards meeting. Lift of 40 means decks that play one go and find the other, which
is the signature of a real interaction. Results are damped by the evidence behind
them, because two obscure cards meeting in six decks is not a discovery.

**Every pair is labelled with why it co-occurs**, because half of them were the
mana base: a dual land shares decks with everything in its colours, so 6,777 of
13,449 pairs in this cube were a land meeting a spell. Those are hidden by
default and can be switched back on. The remaining labels — *typal*, *engine*,
*creature removal*, *card draw*, *archetype* — come from shared creature
subtypes, parsed functions, Scryfall's tags and shared EDHREC themes, in that
order of specificity. *general* means the two co-occur far more than chance with
no nameable link in the data, which is where the genuinely odd ideas hide.

Two earlier attempts are worth recording as dead ends. Pairing parsed functions
directly ("has a cost reducer" + "has a free cast") produced confident nonsense,
because most primitives describe the card itself: Embercleave costing less does
not discount anything else. Restricting to directional effects fixed the nonsense
but surfaced the trivial — untapping a dual land for one extra mana is not an
idea. The parsed functions now only annotate *why* a pair might work; they never
rank it.

**Every tactic and composition row explains itself.** A theme called "Dandan" or
"Cheerios" means nothing on its own, and EDHREC's own descriptions are SEO
boilerplate ("Popular Slivers EDH commanders"), so instead each row's ⓘ names the
cards *in your cube* with the highest synergy for it, ordered, with their types.

That turns out to be the best possible caveat: hovering "Phoenixes" on the Pioneer
cube lists Rekindling Phoenix, Flamewake Phoenix and Phoenix of Ash — a real
archetype. Hovering "Dandan" lists Lotus Cobra and five shocklands — so you can
see for yourself that the match is spurious rather than taking a warning on faith.

The composition rows do the same: each says what the parser looked for, whether it
came from rules text or Scryfall's Tagger, and names example cards so the count can
be checked rather than trusted.

**Still worth stating:** the archetype list is built from EDHREC theme data, which
is Commander-shaped, so on a Pioneer cube it reports set mechanics (morph, kicker,
foretell) as though they were archetypes. The colour lanes and the composition
breakdown are format-neutral and are the parts to trust.

## Card pickers

Every field that takes a card or commander name is an as-you-type picker: type one
character and choose from the list. Suggestions are prefix-first and then ranked by
how widely the card is played, so `s` offers Sol Ring before Swamp and `rhys`
offers Rhystic Study before Rhys the Redeemed. Each row shows the card's type and
price. ↑/↓ to move, Enter to choose, Esc to dismiss, or click.

Fields wired: search text, swap source, cut-picker's incoming card, cut-picker's
commander (shows the name, submits the slug), brew commander, and the goal box —
which suggests real EDHREC strategy names and preserves any budget already typed.

`/api/suggest?q=&kind=card|commander|theme` backs all of them.

## Explainers and card previews

Every column header, control label, stat tile and section heading carries an ⓘ
marker explaining what the number means — including the honest caveats, so
"novel", "odds" and "archetypes supported" each say in place what they do and
don't claim. The glossary is defined once in `GLOSSARY` and attached automatically
after each render, so tables that are rebuilt on every query stay annotated.
Hover, focus or click a marker; Esc dismisses. Clicking a marker inside a sortable
header does not sort it.

Hovering a card name or thumbnail anywhere shows the full card, large enough to
read, with set, rarity and price. It waits ~450ms first — without the delay,
dragging the cursor down a table flashes an image for every row you cross. Results
are cached per card, and double-faced cards show both sides.

## Everything is in here

All 1,051 sets are loaded — not just the tournament ones:

- **Un-sets** — Unglued, Unhinged, Unstable, Unsanctioned, Unfinity and the Mystery
  Booster playtest sets: 1,557 cards, always included in search and never filtered
  out. 190 of them are genuinely tournament-legal (Unfinity printed real cards
  alongside the acorn ones), so **Un-set origin and legality are separate badges**.
  Chaos Orb is legal nowhere without being an Un-card at all; Comet, Stellar Pup is
  an Un-card that's legal in nine formats.
- **Promos and one-offs** — 298 promo sets, the 99 gold-bordered World Championship
  memorabilia sets, masterpieces, From the Vault, Planechase, Archenemy, Vanguard,
  treasure chests, even the minigames.

**Search returns all of it, unfiltered.** Tokens (1,002), emblems (89), Secret
Lair art cards (2,534) and oversized planes/schemes/vanguard (416) share the table
with real cards and are included too — each one carries a badge saying what it is,
rather than being hidden behind a filter. The `kind` parameter still exists on the
API for callers that want one category.

To browse deliberately, the **Set** filter under the Printing column takes a
typeahead over all 1,051 sets (with symbols) or a bare three-letter code.

When a set or kind filter is on and the Format filter is also hiding results, the
page says so and how many — browsing Unstable with Format on Commander shows 6
cards, and a note that 243 more are being excluded.

## Set codes

Hovering a set code shows the set's symbol, full name, release date, card count and
type — `PLST` is not a useful label on its own. Every set code that appears on a
printing resolves, which the test suite checks so a hover can't come up empty.
`/api/set?code=m13` returns the same as JSON.

## Legality and colour names

Hovering any card shows its verdict in every format Scryfall tracks, led by the
short version — "Banned in Legacy, Commander, Duel, Oathbreaker, preDH, TLR;
restricted in Vintage, Old School" — because a ban is the part worth reading. The
grid lists the main formats plus **every** format the card is banned or restricted
in, however obscure. `/api/legality?name=` returns the same thing as JSON.

Colour identities are written as letters with the combination's name in
parentheses — `UB (Dimir)`, `BGUW (Witch-Maw)`, `WUBRG (Five-Color)` — in search
results, commander lists, the colour picker, cube lanes, typeahead hints and the
card preview. Guilds, shards, wedges and the four-colour nephilim names are all
covered, and lookup is order-independent so `BU` and `UB` both resolve to Dimir.

## List ordering

Anything you scan looking for one specific entry is alphabetical: the format
selects (all three of them), the combo-template list, the saved-cube list, and the
per-card legality grid. Formats show their real names rather than Scryfall's slugs
— "Pauper Commander", "Penny Dreadful", "preDH" — and keep their card counts.

Ranked output stays ranked, because there the order *is* the answer: typeahead
suggestions (most-played first), colour lanes, goal themes and cube tactics.

## Sorting

**The table headers are the sort control — there is no dropdown.** Click a header
to sort, click again to reverse. On the Search tab a second click on Cheapest gives
priciest first, and a second click on Printing switches from most-reprinted to
newest. Cells
carry a `data-sort` value when what they display isn't what they should sort by —
`$1.30`, `68%`, the signal bars in the cut picker, the novel/known badge — so
columns sort numerically rather than as text. Blanks and `—` always sink to the
bottom whichever way you sort.

The Search tab is paginated server-side, so its headers re-run the query instead
of reordering the visible page: sorting there covers every match, not the 60 on
screen. Objects with no mana value (tokens, art cards) sort last rather than
first, so a mana-value sort still starts with actual spells.

## How the goal engine works (no AI)

`goals.py` resolves a phrase to themes in three deterministic layers: a
hand-written alias table for how players phrase win conditions, exact/word-boundary
matches against the 435 real theme names, then token overlap. Each match reports
*why* it matched and with what weight.

Cards are then ranked by EDHREC **synergy**, not inclusion. Inclusion just
resurfaces Sol Ring and Command Tower for every goal; synergy is how much more a
theme plays a card than decks in general do, which is what "serves the goal"
actually means. Generic staples are returned in a separate list so they can't
crowd out the strategy cards.

## How the combo finder works, and how far to trust it

This is the only part that ignores popularity completely. `functions.py` parses
oracle text into typed primitives — `mana_add(amount, cost, taps)`, `untap(target,
cost)`, `sac_outlet(free)`, `self_recur(cost)`, `etb_mana`, `blink`, `drain` — and
`combo_finder.py` matches those against loop templates. A pair nobody has ever put
in a deck together scores exactly as well as a famous one.

Every candidate is then checked against the 110,355 Commander Spellbook combos.
**"Novel" means "not in that database". It does not mean verified, and it does not
mean good.** The parser reads text; it does not know the rules.

The honest quality measure is the **rediscovery rate**: how often a template's
candidates land on combos people already documented. A template that can't
rediscover known combos won't produce trustworthy new ones.

| template | candidates | rediscovery rate | verdict |
|---|---|---|---|
| `blink_engine` | 13 | **69.2%** | strong — nine of thirteen are documented combos |
| `cost_reduction_mana` | 27 | **18.5%** | good — rediscovers Basalt Monolith + Power Artifact *and* + Zirda |
| `infinite_mana` | 8 | **100%** | every candidate is a documented combo — see the caveat below |
| `sac_loop` / `sac_drain` | 1,386 | n/a | not combo finders — see below |

The sacrifice templates report **no** rediscovery rate on purpose. They find
repeatable value engines that cost mana every loop; a database of *infinite*
combos will never contain one, so scoring them against it would show a misleading
0%. Judge those by their per-loop cost instead.

### Targeting

Most of the precision came from reading targets properly, which a naive text
match gets badly wrong:

- **A target phrase is not one type.** "Untap target artifact creature" needs
  *both* — Voltaic Construct cannot untap Chromatic Orrery, an artifact that is
  not a creature. That pair was the top "novel" infinite-mana hit until the target
  model started requiring every named type, while "artifact **or** land" still
  accepts either.
- **Some targets a loop can never arrange.** A mana dork that just tapped for mana
  is not an attacking creature, so Najeela can never untap it.
- **A loop has to fund itself, and mana is fussier than a count.** Canopy Tactician
  taps for `{G}{G}{G}`; Pemmin's Aura untaps for `{U}`. Three green mana buys
  nothing. Modelling that properly meant five separate rules:
  coloured pips matched **with their counts** (one blue does not pay `{U}{U}`);
  *"Spend this mana only on costs that contain {X}"* funds nothing;
  *"This mana can't be spent to pay generic mana costs"* means Jegantha can pay a
  `{U}` untap but never a `{2}{U}` one;
  *"spend mana as though it were mana of any color"* exempts a card, which is how
  Chromatic Orrery legitimately pays `{U}` with colourless mana;
  and `Add {G} or {U}` is a **choice of one** mana, not two — counting both pips
  made every two-colour dork look like a two-mana source.
  Together with an ability that hands its own permanent to an opponent (Witch
  Engine), these took infinite mana from 135 candidates at 7.4% to **8 at 100%**.
- **Most "blinkers" only exile themselves.** "Exile this creature, then return it"
  cannot flicker a separate payload card, so Aethergeode Miner was never really a
  combo with Palinchron. Only an effect naming another target counts — except when
  the ability is *granted* in quotes to another permanent, which is precisely how
  Deadeye Navigator works. Enforcing this took blink from 83 candidates at 10.8%
  to **13 at 69.2%**.

**Read that 100% honestly.** `infinite_mana` now returns eight candidates and
every one is already in the combo database — the template has become a verifier
rather than a discoverer for this shape. That is the right trade: each rule was
added to kill a specific wrong answer, never to chase a number. Novel finds now
come from `cost_reduction_mana` (22 of 27) and `blink_engine` (4 of 13), and from
restricting any template to a cube.

### Three-card combos

A loop is an engine, not a kill, and the known database reflects that: **49,966 of
its combos are three cards and 46,794 are four**, against only 5,207 two-card ones.
Tick *add a winning payoff* and each engine gains a third card that converts it —
a mana sink for infinite mana, a drain trigger for infinite enter-the-battlefield
triggers. Known combos of any size are matched against a cube regardless of piece
count.

- **An ability word sits in front of the trigger.** "Ferocious — At the beginning
  of combat on your turn… return this card from your graveyard" is a triggered
  ability, but a `^when|^at the beginning` test never sees it, so Flamewake
  Phoenix read as free on-demand recursion. Strip the ability word first.
- **A board-state condition is not a gate.** Gravecrawler's "as long as you
  control a Zombie" is trivially true in the deck that wants it, so it stays an
  engine — but the condition is recorded and printed alongside the loop rather
  than dropped. "Activate only if you attacked this turn" genuinely does stop it.
- **"Sacrifice another creature" can never eat the outlet itself**, which is
  recorded so no template can pair a card with itself through it.

Getting even this far took modelling other things a naive text match gets wrong:
`{T}` is not a mana cost; a card that sacrifices itself can't loop; an untapper
that taps itself can't repeat; "discard a card" is a finite cost; disturb and
flashback recur exactly once; "if you cast it" ETBs don't fire off a blink; and
Vanguard cards aren't legal cards at all. Each of those was a wave of false
positives before it was fixed.

**Known weakness:** genuine two-card infinite sacrifice loops barely exist — only
four cards in the whole database recur themselves for zero mana, and most of those
are parser errors. That template is best read as a list of value engines.

## Tests

`./smoke_test.sh` — hits all 19 endpoints and fails on anything that isn't a clean 200.


`python3 test_suite.py` — 48 checks, each one locking in a specific bug that used
to produce a flood of wrong answers. Run it after touching `functions.py`; the
parser is where every false-positive wave came from, and the tests name the
offending card so a failure says what broke rather than just that something did.

## Schema

- `cards` — one row per `oracle_id`, with `price_usd` (cheapest paper printing,
  falling back to foil for the ~146 cards printed foil-only) denormalised on.
- `printings` — one row per printing; all prices live here.
- `legalities`, `edh_commanders`, `edh_inclusions`, `edh_avg_deck`,
  `edh_themes`, `edh_theme_cards`, `edh_theme_commanders`,
  `tags`, `card_tags`, `combos`, `combo_cards`, `card_functions`.

# Mobile coverflow for the draft page

2026-09-22

## Scope

`docs/draft.html` only (built from `ui/cube.html` / `cube.js` / `shared.css` via
`build_static.py --only p1p1`). Two tabs, both under `#p1Table` /
`#tab-p1p1` and the drill panel:

- **Pack 1 Pick 1** — the fan (`.hand.fan`, built by `p1DrawHand()`,
  [cube.js:696](../ui/cube.js#L696)) becomes a swipeable coverflow on mobile.
- **Signal drill** — the pack-under-study pile (`d.left`, rendered by
  `p1DrillView()`, [cube.js:1553](../ui/cube.js#L1553)) becomes a browse-only
  coverflow on mobile.

Out of scope: the desktop fan (untouched, no breakpoint change), `cube.html`'s
other tabs (Cube analysis, Propose a change), every other place `.stacks/.pile`
is used (drafted pool, shared-picks-from-link, drill's after-answer "what they
took" reveal) — those keep their current stacked-pile look everywhere.

Breakpoint: reuse the existing `max-width:560px` mobile query already used
elsewhere in `shared.css` (e.g. line 615, the 6-column pack grid).

## Why

Live-audited the current mobile fan in the browser pane at 375×812 before
designing this:

1. `.deckpile` ("N picks" HUD, [shared.css:282](../ui/shared.css#L282)) is
   absolute-positioned to the bottom of `.tabletop`. Desktop's 12-column pack
   grid is short enough that there's always slack below it before the
   deckpile's corner; mobile's 6-column grid is taller, so `.tabletop`'s
   content reaches the same bottom edge the deckpile sits against and the two
   collide — confirmed live, the pile visibly sits on top of the "cut into N
   packs, choose N more" text.
2. The fan's own leftmost 2-3 cards tuck in behind that same deckpile once the
   fan's card width shrinks to fit a narrow screen.
3. A 15-card fan squeezed into ~280px gives each buried card an ~18px sliver —
   below any threshold of being readable by art alone.

All three go away under a coverflow: (1) gets a direct CSS fix regardless,
(2)/(3) are inherent to the fan's "cram everything into one row" shape and
don't carry over to a browse-one-at-a-time model.

## Design

### Coverflow markup and activation

Both `p1DrawHand()` and `p1DrillView()` gain a
`matchMedia('(max-width:560px)').matches` check. When true, they render
`.hand.coverflow` (or drill's equivalent `.pile.coverflow`) instead of the
current fan/pile markup:

```html
<div class="hand coverflow">
  <div class="cfitem" data-group="...">…cardFace(c) markup, unchanged…</div>
  …
</div>
```

`cardFace()` itself is untouched — every `[data-pick]` element inside still
gets the same wiring block that already exists at the end of `p1DrawHand()`
([cube.js:739-757](../ui/cube.js#L739-L757)): click-to-zoom, double-click and
Enter to take, and `p1Swipe(el, card)`. That wiring is layout-agnostic (it
queries `hand.querySelectorAll('[data-pick]')`), so it needs no changes to
keep working inside `.cfitem` instead of a bare `.dcard` fan slot.

`p1LayoutHand()` ([cube.js:1024](../ui/cube.js#L1024)) currently computes
`--cw`/`--overlap` custom properties to shrink and overlap fan cards to fit
the container width. That math is fan-specific and must be skipped in
coverflow mode — coverflow cards get one fixed comfortable size (CSS-only, no
JS sizing needed) since they scroll instead of compressing.

### Browsing (scroll-snap + depth styling)

```css
.hand.coverflow{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;
  gap:0;padding:40px 45vw;-webkit-overflow-scrolling:touch}
.cfitem{scroll-snap-align:center;flex:0 0 auto;transition:transform .15s,opacity .15s}
.cfitem.focused{transform:scale(1);opacity:1;z-index:2}
.cfitem.near{transform:scale(.82);opacity:.6}
.cfitem:not(.focused):not(.near){transform:scale(.7);opacity:.35}
```

(padding of `45vw` on each side lets the first/last card reach center; exact
numbers get tuned against real card width during implementation, not fixed
here.)

A `scroll` listener on `.hand.coverflow`, rAF-throttled, finds the `.cfitem`
whose center is closest to the container's center and toggles
`.focused`/`.near` on it and its immediate neighbours. This is the only new
per-scroll JS — everything else is the class toggle driving CSS transitions,
not per-frame style writes.

Native scroll-snap gives momentum and settle-on-card for free, and this
mirrors the pattern the codebase already uses for the pack grid on touch
devices (`touch-action:pan-x`, [shared.css:658](../ui/shared.css#L658)) rather
than introducing a second, custom drag-physics implementation.

### Swipe-up-to-pick (Pack 1 Pick 1 only)

Nothing new to build here — `p1Swipe()` ([cube.js:972](../ui/cube.js#L972))
already implements exactly this: drag a card up past `SWIPE_TAKE` (64px) and
release to call `p1Take`, with `.willtake` visual feedback during the drag,
and it already tells a vertical pick-gesture apart from a horizontal/downward
scroll (lines 987-990) before calling `preventDefault`. Since it's wired
per-card already, it keeps working unchanged once cards live inside
`.cfitem` — no drill wiring, since `p1DrillView()`'s cards never get
`[data-pick]` treatment tying them to `p1Take`.

One check during implementation: `p1Take()` reads `$('#p1Deck').getBoundingClientRect()`
and every other `#p1Hand .dcard` to animate the "rest of the pack passes on"
effect ([cube.js:777-786](../ui/cube.js#L777-L786)) — this is container-agnostic
(just queries by class) so it should keep working, but verify the pass-off
animation still reads sensibly when most of the pack is scrolled out of the
viewport.

### Colour-sort groups (Pack 1 Pick 1)

Today, sorting by colour switches `p1DrawHand()` into grouped mode: cards
wrap in `.handgroup > .gcards` boxes with a `.glabel` footer per group
(cube.js:715-729). Boxing each group visually fights horizontal scroll-snap
(you'd be snapping between boxes, not cards). In coverflow mode, flatten this
back to one flat sequence of `.cfitem`s in the same sorted order, each
carrying `data-group="<label>"`. A single floating label sits above the
coverflow track; the same scroll listener that maintains `.focused` also
reads the focused item's `data-group` and updates that label's text — so the
grouping still reads as you swipe, without a boxed layout. `p1WireRuns()`
(the hover/focus run-raising behavior) is fan-only and isn't invoked in
coverflow mode.

### Signal drill

`p1DrillView()`'s `d.left` pile switches to the same `.hand.coverflow`
markup and CSS on mobile — browsing only, no swipe-up handler attached (there
is nothing to pick in the drill; the actual action there is tapping a lane
chip). No group labels either — the drill pack isn't sorted into colour runs.
The after-answer "what they took" pile (`d.taken`) and every other
`.stacks/.pile` instance in the app (drafted pool, shared-picks-from-link)
keep their current stacked look — out of scope.

### Deckpile fix

`.tabletop` gets a `padding-bottom` inside the existing
`@media (max-width:560px)` block, sized to clear `.deckpile`'s full footprint
(≈48px width, ~67px tall at its aspect ratio, plus its shadow and 14px bottom
offset — roughly 86px), so the pile always has empty space to sit in instead
of overlapping whatever content precedes it in flow.

## Non-goals

- No change to desktop layout or behavior.
- No change to `cube.html`'s other tabs.
- No change to the drafted-pool / shared-picks stack-pile displays.
- Not building a fallback path for browsers without `matchMedia` or touch
  events — this is a progressive layer over an already-working desktop fan,
  so a failure to activate just means the fan renders instead (same as today).

## Testing

- `python3 test_suite.py` (443 checks) after any `ui/` edit, per existing
  convention — must stay green.
- No automated responsive/mobile check exists in the suite today; this stays
  a manual pass. Rebuild with `python3 build_static.py --from-data --only p1p1
  -o docs/draft.html` after each change and re-verify live in the browser
  pane at a 375×812 viewport: pick flow (Pack 1 Pick 1, all sort orders
  including colour), signal drill browsing, and the deckpile clearance fix,
  each confirmed by screenshot rather than by reading the CSS.

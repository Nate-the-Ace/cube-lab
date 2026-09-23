# Mobile Coverflow for the Draft Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand fan with a swipeable coverflow on mobile (`≤560px`) in both Pack 1 Pick 1 and the signal drill, and fix the deckpile HUD overlapping content at that width.

**Architecture:** `p1DrawHand()` and `p1DrillView()` (both in `ui/cube.js`) gain a `matchMedia('(max-width:560px)')` branch that renders a `.hand.coverflow > .cftrack > .dcard...` structure instead of the fan/pile, reusing the existing `cardFace()` output and pick-wiring unchanged. A new shared helper, `p1WireCoverflow()`, drives a scroll-position-based `.focused`/`.near` class toggle for the coverflow visual depth and (for Pack 1 Pick 1's colour sort) a group-name label. Swipe-up-to-pick needs no new code — `p1Swipe()` ([cube.js:972](../ui/cube.js#L972)) is already wired per-card and already yields to horizontal motion. Desktop is untouched.

**Tech Stack:** Vanilla JS, hand-written CSS (no framework), `python3 test_suite.py` regression checks (grep-style string assertions against the built JS/CSS, the existing convention in this repo — there is no headless-browser test in this suite).

**User decisions (already made):**
- Scope: `docs/draft.html` only — Pack 1 Pick 1 and Signal Drill tabs. No change to `cube.html`'s other tabs or to any other `.stacks/.pile` usage (drafted pool, shared-picks-from-link, drill's after-answer "what they took" reveal).
- Coverflow on mobile only; desktop keeps the existing fan.
- Coverflow mechanics: native `scroll-snap` + JS-toggled depth classes (not a fully custom transform-driven drag).
- Swipe-up-to-pick commits immediately on release past threshold (already the existing `p1Swipe` behaviour — nothing to change).
- Pack 1 Pick 1's colour-sort groups show as a label above the focused card, updating as you swipe; Signal Drill has no groups.
- Signal Drill's pack coverflow is browse-only (no swipe-up-to-pick; nothing to pick there).
- Only Signal Drill's main pack pile (`d.left`) converts to coverflow — the after-answer "what they took" reveal pile stays a stack.
- Include the `.deckpile` mobile-overlap CSS fix found during the design's live audit, since it's the same real estate being touched.

**Note on task tooling:** this session has no native `TaskList`/`TaskCreate` tool available, so this plan's tasks are tracked only in this document and the co-located `2026-09-22-mobile-coverflow-draft-plan.md.tasks.json` file, not in a native task list.

---

## File Structure

- `ui/shared.css` — new `.hand.coverflow` / `.cftrack` / depth-class rules; `.deckpile` overlap fix; extend the existing `touch-action:pan-x` rule to coverflow cards. No new files — these live alongside the existing `.hand.fan` rules they replace on mobile.
- `ui/cube.js` — new `p1WireCoverflow(track, groups)` helper (generic, used by both tabs); mobile branch inside `p1DrawHand()`; mobile branch inside `p1DrillView()`. No new files — `cube.js` is already the single file for all draft-tab logic, and these are small additions to two existing functions plus one new small function beside them.
- `ui/cube.html` — no changes. Both `#p1Hand` and `#p1Drill` already have their entire contents replaced by JS on every render, so the coverflow markup (including the group-name label) is generated the same way the fan/pile markup already is.
- `test_suite.py` — one new `test_mobile_coverflow()` function (grep-style checks, matching the existing `test_hand_sort()` / `test_signal_drill()` convention), called from `main()`.

## Task 1: Fix the deckpile overlapping content on mobile

**Goal:** `.deckpile` never overlaps the pack-selection text or other flow content at `≤560px`.

**Files:**
- Modify: `ui/shared.css:614-617`

**Acceptance Criteria:**
- [ ] `.tabletop` reserves enough bottom padding at `≤560px` that `.deckpile` (48px wide, `1/1.396` aspect ratio, `bottom:14px`, plus its layered box-shadow) never overlaps preceding content.
- [ ] Desktop layout (`>560px`) is unaffected.

**Verify:** `python3 build_static.py --from-data --only p1p1 -o docs/draft.html` then load it in the browser pane at a 375×812 viewport, scroll to the pack-choosing screen, confirm "choose N more" text is fully clear of the "N picks" pile (screenshot).

**Steps:**

- [ ] **Step 1: Add the padding-bottom fix**

Current code at `ui/shared.css:614-617`:

```css
/* a phone cannot hold twelve across; six by six keeps the shape rectangular */
@media (max-width:560px){
  .boosters.spread{grid-template-columns:repeat(6,1fr);gap:6px;max-width:330px}
}
```

Replace with:

```css
/* a phone cannot hold twelve across; six by six keeps the shape rectangular */
@media (max-width:560px){
  .boosters.spread{grid-template-columns:repeat(6,1fr);gap:6px;max-width:330px}
  /* six rows here is taller than the twelve-across desktop grid ever gets, so
     the table's own height now reaches exactly as far as .deckpile's corner -
     which used to sit in slack the desktop grid never fills. Reserve that
     corner instead of overlapping whatever the table renders last. */
  .tabletop{padding-bottom:90px}
}
```

- [ ] **Step 2: Rebuild and check live**

```bash
python3 build_static.py --from-data --only p1p1 -o docs/draft.html
```

Open `docs/draft.html` in the browser pane at a 375×812 viewport. Screenshot the pack-choosing screen (before any pick) and confirm the "N picks" pile sits clear of the "cut into N packs, choose N more" text, with visible gap between them.

- [ ] **Step 3: Commit**

```bash
git add ui/shared.css
git commit -m "Give the deckpile room on a phone-width table"
```

---

## Task 2: Coverflow CSS foundation

**Goal:** The CSS for a coverflow layout exists (`.hand.coverflow`, `.cftrack`, depth classes, group label, touch handling) — inert until Task 3/4 render markup that uses it.

**Files:**
- Modify: `ui/shared.css` (insert after line 440, before the `/* click-to-zoom */` comment at line 442)
- Modify: `ui/shared.css:658` (extend the existing touch-action rule)

**Acceptance Criteria:**
- [ ] `.hand.coverflow` lays out a label above a horizontally-scrolling, snap-to-card track.
- [ ] A `.dcard` inside `.cftrack` has three visual states: `.focused` (full size), `.near` (adjacent, scaled down), and neither (further away, scaled down more and faded).
- [ ] Coverflow cards get the same `touch-action:pan-x` treatment the fan's cards already have on touch devices, so `p1Swipe`'s vertical gesture keeps working without the browser's own scroll handling competing for the touch.

**Verify:** `grep -c "cftrack" ui/shared.css` → at least 5 (the rules below); `python3 test_suite.py` still all-green (nothing else references these new classes yet, so this is purely additive).

**Steps:**

- [ ] **Step 1: Insert the coverflow CSS block**

Insert into `ui/shared.css` immediately after line 440 (`.hand.fan .dcard.flying,.hand.fan .dcard.passing-l,.hand.fan .dcard.passing-r{z-index:6}`) and before the `/* click-to-zoom, dismissed by clicking anywhere off the card */` comment:

```css

/* ── the hand, as a coverflow (mobile) ──
   A fan this narrow buries most of a pack under an unreadable sliver of its
   neighbours - measured live, fifteen cards in ~280px left each one about
   18px wide. Browsing one card at a time instead keeps every one legible.
   Scroll-snap gives the settle-on-a-card behaviour and momentum for free, so
   there is no drag physics to hand-roll here. Picking is still the swipe-up
   gesture below it - it is wired per card, not per layout, so it needs
   nothing new to keep working inside a coverflow. */
.hand.coverflow{display:flex;flex-direction:column;gap:6px}
.cflabel{text-align:center;font-size:11px;text-transform:uppercase;
  letter-spacing:.06em;color:var(--ink-dim);min-height:14px}
.cflabel:empty{visibility:hidden}
.cftrack{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;
  padding:20px 45vw 10px;-webkit-overflow-scrolling:touch}
.cftrack .dcard{flex:0 0 auto;width:150px;scroll-snap-align:center;
  transition:transform .15s ease,opacity .15s ease}
.cftrack .dcard.focused{transform:scale(1);opacity:1;z-index:2}
.cftrack .dcard.near{transform:scale(.82);opacity:.65}
.cftrack .dcard:not(.focused):not(.near){transform:scale(.7);opacity:.4}
```

- [ ] **Step 2: Extend the existing touch-action rule**

Current code at `ui/shared.css:658-660`:

```css
/* on a touch screen the hand is a surface you drag on, not one you scroll */
@media (hover:none){
  .hand.fan .dcard{touch-action:pan-x}
}
```

Replace with:

```css
/* on a touch screen the hand is a surface you drag on, not one you scroll */
@media (hover:none){
  .hand.fan .dcard,.cftrack .dcard{touch-action:pan-x}
}
```

- [ ] **Step 3: Verify additive-only**

```bash
grep -c "cftrack" ui/shared.css
python3 test_suite.py
```

Expected: `grep` reports at least 5; test suite prints "all green" (these rules aren't referenced by any markup yet, so nothing existing can break).

- [ ] **Step 4: Commit**

```bash
git add ui/shared.css
git commit -m "Add coverflow CSS for the mobile hand (unwired)"
```

---

## Task 3: Coverflow for Pack 1 Pick 1

**Goal:** On mobile, `p1DrawHand()` renders the pack as a coverflow instead of a fan; browsing works via native scroll, picking works via the existing swipe gesture, and colour-sort groups show as a label above the focused card.

**Files:**
- Modify: `ui/cube.js:696-758` (`p1DrawHand`)
- Modify: `ui/cube.js:1024-1029` (`p1LayoutHand`, add an early return)
- Modify: `ui/cube.js` (new function `p1WireCoverflow`, placed directly above `p1LayoutHand`)

**Acceptance Criteria:**
- [ ] At `≤560px`, `#p1Hand` renders `.hand.coverflow` with a `.cflabel` and a `.cftrack` of plain `cardFace()` cards — no `.handgroup` boxing, even when sorted by colour.
- [ ] At `>560px`, behaviour is byte-for-byte the same as before this change (fan, grouped runs, `p1LayoutHand` sizing).
- [ ] Swiping left/right on the coverflow browses the pack; the centered card is visually full-size, its neighbours smaller.
- [ ] Swiping a focused card up past the existing threshold still picks it (via the unmodified `p1Swipe`/`p1Take`).
- [ ] Sorting by colour on mobile shows a label above the focused card naming its group, and the label updates as you swipe to a card in a different group.
- [ ] `p1LayoutHand()` does nothing when `#p1Hand` is in coverflow mode (no fan CSS vars written to coverflow cards).

**Verify:** `python3 test_suite.py` all-green; live check in the browser pane at 375×812 — open a pack, confirm coverflow renders, scroll through it, swipe a card up to take it, switch sort to "colour" and confirm the group label appears and updates.

**Steps:**

- [ ] **Step 1: Add `p1WireCoverflow`**

Insert directly above `function p1LayoutHand() {` (currently at `ui/cube.js:1024`):

```js
/* Wires one coverflow track: as it scrolls, whichever card sits nearest the
   centre gets .focused, its immediate neighbours get .near, and (if `groups`
   was given - one label per card, same order as the track's children) the
   label above the track is updated to that card's group. Attaching the
   scroll listener is idempotent, since #p1Hand/#p1Drill are never replaced,
   only their contents - so this can safely be called on every render. */
function p1WireCoverflow(track, groups) {
  if (!track) return;
  const update = () => {
    const items = [...track.children];
    if (!items.length) return;
    const mid = track.scrollLeft + track.clientWidth / 2;
    let bestI = 0, bestD = Infinity;
    items.forEach((el, i) => {
      const d = Math.abs((el.offsetLeft + el.offsetWidth / 2) - mid);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    items.forEach((el, i) => {
      el.classList.toggle('focused', i === bestI);
      el.classList.toggle('near', Math.abs(i - bestI) === 1);
    });
    const label = track.parentElement.querySelector('.cflabel');
    if (label) label.textContent = groups ? (groups[bestI] || '') : '';
  };
  if (!track.dataset.cfWired) {
    track.dataset.cfWired = '1';
    let raf = null;
    track.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; update(); });
    }, {passive: true});
  }
  update();
}

```

- [ ] **Step 2: Branch `p1DrawHand` on the mobile breakpoint**

Current code at `ui/cube.js:709-734`:

```js
  p1SyncSortOptions();
  const sorter = P1_HAND_SORTS[P1_HAND_SORT] || {};
  const grouped = !!sorter.groupBy;
  p1DropRun();                   // the groups it pointed at are about to go
  hand.className = 'hand fan' + (grouped ? ' grouped' : '');
  const inOrder = p1SortedPack();
  if (grouped) {
    const groups = [];
    inOrder.forEach(c => {
      const k = sorter.groupBy(c);
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.cards.push(c);
      else groups.push({key: k, cards: [c]});
    });
    hand.innerHTML = groups.map(g => `<div class="handgroup">
      <div class="gcards">${g.cards.map(c => cardFace(c)).join('')}</div>
      <span class="gfoot"><span class="glabel"
        title="${esc(g.key)} — ${esc(sorter.does(g.key))}"
        ><b>${esc(g.key)}</b> <span>${g.cards.length}</span>
        <em>${esc(sorter.does(g.key))}</em></span></span>
    </div>`).join('');
  } else {
    hand.innerHTML = inOrder.map(c => cardFace(c)).join('');
  }
  if (grouped) p1WireRuns(hand);
  p1LayoutHand();
```

Replace with:

```js
  p1SyncSortOptions();
  const sorter = P1_HAND_SORTS[P1_HAND_SORT] || {};
  const grouped = !!sorter.groupBy;
  p1DropRun();                   // the groups it pointed at are about to go
  const inOrder = p1SortedPack();
  const mobile = matchMedia('(max-width:560px)').matches;
  if (mobile) {
    hand.className = 'hand coverflow';
    hand.innerHTML = `<div class="cflabel"></div>
      <div class="cftrack">${inOrder.map(c => cardFace(c)).join('')}</div>`;
    p1WireCoverflow(hand.querySelector('.cftrack'),
      grouped ? inOrder.map(c => sorter.groupBy(c)) : null);
  } else {
    hand.className = 'hand fan' + (grouped ? ' grouped' : '');
    if (grouped) {
      const groups = [];
      inOrder.forEach(c => {
        const k = sorter.groupBy(c);
        const last = groups[groups.length - 1];
        if (last && last.key === k) last.cards.push(c);
        else groups.push({key: k, cards: [c]});
      });
      hand.innerHTML = groups.map(g => `<div class="handgroup">
        <div class="gcards">${g.cards.map(c => cardFace(c)).join('')}</div>
        <span class="gfoot"><span class="glabel"
          title="${esc(g.key)} — ${esc(sorter.does(g.key))}"
          ><b>${esc(g.key)}</b> <span>${g.cards.length}</span>
          <em>${esc(sorter.does(g.key))}</em></span></span>
      </div>`).join('');
    } else {
      hand.innerHTML = inOrder.map(c => cardFace(c)).join('');
    }
    if (grouped) p1WireRuns(hand);
    p1LayoutHand();
  }
```

(Everything after this in `p1DrawHand` — `p1MarkBest()`, `p1MarkWanted()`, the pass-line clearing, and the `[data-pick]` wiring block that attaches click/dblclick/keydown/`p1Swipe` — is unchanged and runs regardless of branch, since it already targets `#p1Hand` generically.)

- [ ] **Step 3: Make `p1LayoutHand` a no-op in coverflow mode**

Current code at `ui/cube.js:1024-1029`:

```js
function p1LayoutHand() {
  p1MeasureTools();
  const hand = $('#p1Hand');
  const cards = [...hand.querySelectorAll('.dcard')];
  const n = cards.length;
  if (!n) return;
```

Replace with:

```js
function p1LayoutHand() {
  p1MeasureTools();
  const hand = $('#p1Hand');
  if (hand.classList.contains('coverflow')) return;   // no fan to size
  const cards = [...hand.querySelectorAll('.dcard')];
  const n = cards.length;
  if (!n) return;
```

(This is now a redundant safety net — the mobile branch in Step 2 no longer calls `p1LayoutHand()` at all — but it also protects the debounced `window.addEventListener('resize', ...)` handler at `cube.js:1175`, which calls `p1LayoutHand()` unconditionally and would otherwise run fan-sizing math against coverflow markup if the window is resized while a coverflow is showing.)

- [ ] **Step 4: Known limitation to note, not fix**

Resizing across the 560px breakpoint while a pack is already in hand does not swap fan ↔ coverflow markup live — `p1DrawHand()` only reruns on the next pick/sort/pack change, not on resize. This matches the spec's scope (a progressive breakpoint-activated layer, not a live-resize-reactive one) and is not a task requirement to fix. Do not add a resize-triggered `p1DrawHand()` call.

- [ ] **Step 5: Rebuild and check live**

```bash
python3 build_static.py --from-data --only p1p1 -o docs/draft.html
```

In the browser pane at 375×812: open a pack, confirm the coverflow (not the fan) renders; scroll left/right and confirm the centered card is full-size with neighbours smaller; swipe a focused card up past the threshold and confirm it's taken (flies to the deckpile, pack advances). Switch the sort dropdown to "colour", confirm the label above the coverflow shows a colour name and updates as you swipe across a group boundary. Then resize the browser pane to desktop width and confirm the fan (not coverflow) renders and looks unchanged from before this task.

- [ ] **Step 6: Run the full suite**

```bash
python3 test_suite.py
```

Expected: "all green" (this task doesn't yet add its own checks — Task 5 does — but must not break `test_hand_sort` or any other existing check).

- [ ] **Step 7: Commit**

```bash
git add ui/cube.js
git commit -m "Coverflow for Pack 1 Pick 1 on mobile"
```

---

## Task 4: Coverflow for the signal drill

**Goal:** On mobile, the drill's main pack pile (`d.left`) renders as a browse-only coverflow; the after-answer reveal pile and everything else in the drill are unchanged.

**Files:**
- Modify: `ui/cube.js:1591-1592` (inside `p1DrillView`)

**Acceptance Criteria:**
- [ ] At `≤560px`, the drill's `d.left` pack renders as `.hand.coverflow` (browsable, no group label, no pick gesture).
- [ ] At `>560px`, the drill's `d.left` pack renders exactly as before (`.stacks > .stack > .pile`).
- [ ] The after-answer "what they took" pile (`d.taken`) is unaffected at any width.
- [ ] Tapping a card in the drill's coverflow still opens the zoom preview (existing `p1Zoom` wiring); it does not pick anything (there is nothing to pick in the drill).

**Verify:** `python3 test_suite.py` all-green; live check at 375×812 — start a signal drill situation, confirm the pack browses as a coverflow, tap a card to confirm zoom still works, confirm no swipe-up-to-pick affordance appears.

**Steps:**

- [ ] **Step 1: Branch the pack-pile markup**

Current code at `ui/cube.js:1591-1592` (inside the `box.innerHTML` template in `p1DrillView`):

```js
    <div class="stacks"><div class="stack"><div class="pile">${
      d.left.map(c => cardFace(c)).join('')}</div></div></div>
```

Replace with:

```js
    ${matchMedia('(max-width:560px)').matches
      ? `<div class="hand coverflow"><div class="cflabel" hidden></div>
           <div class="cftrack">${d.left.map(c => cardFace(c)).join('')}</div></div>`
      : `<div class="stacks"><div class="stack"><div class="pile">${
           d.left.map(c => cardFace(c)).join('')}</div></div></div>`}
```

(The `.cflabel` is included but `hidden` — the drill has no groups, so `p1WireCoverflow` is called with `groups` as `null` in Step 2 and will leave the label empty; `hidden` keeps the CSS `:empty` rule from mattering either way.)

- [ ] **Step 2: Wire the coverflow after render**

Find this existing block right after `box.innerHTML = ...` is set in `p1DrillView` (`ui/cube.js:1615-1619`):

```js
  box.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.oracle);
    el.removeAttribute('data-pick');
    el.onclick = () => p1Zoom(card);
  });
```

Leave it unchanged (it already generically wires every card in the drill, including the coverflow's, to zoom-only — and already strips `data-pick` so `p1Swipe`-style picking never applies here). Immediately after that block, add:

```js
  const cfTrack = box.querySelector('.cftrack');
  if (cfTrack) p1WireCoverflow(cfTrack, null);
```

- [ ] **Step 3: Rebuild and check live**

```bash
python3 build_static.py --from-data --only p1p1 -o docs/draft.html
```

In the browser pane at 375×812: open Signal Drill, deal a new situation, confirm the pack renders as a coverflow (not a stacked pile), scroll through it, tap a card and confirm the zoom preview opens (not a pick). Resize to desktop width and confirm the drill's pack still renders as the original stacked pile.

- [ ] **Step 4: Run the full suite**

```bash
python3 test_suite.py
```

Expected: "all green".

- [ ] **Step 5: Commit**

```bash
git add ui/cube.js
git commit -m "Coverflow for the signal drill's pack on mobile"
```

---

## Task 5: Regression checks

**Goal:** `test_suite.py` locks in the coverflow markup/CSS/wiring added in Tasks 1-4, matching the existing grep-style convention (`test_hand_sort`, `test_signal_drill`).

**Files:**
- Modify: `test_suite.py` (new function `test_mobile_coverflow`, called from `main()`)

**Acceptance Criteria:**
- [ ] Checks confirm the coverflow CSS exists (`.hand.coverflow`, `.cftrack`, `.focused`/`.near` depth classes, the deckpile's mobile `padding-bottom`).
- [ ] Checks confirm `p1DrawHand` branches on `matchMedia('(max-width:560px)')` and that the mobile branch does not use `.handgroup`.
- [ ] Checks confirm `p1WireCoverflow` exists and is called from both `p1DrawHand` and `p1DrillView`.
- [ ] Checks confirm `p1LayoutHand` bails out early for coverflow.
- [ ] `python3 test_suite.py` reports "all green" including the new checks.

**Verify:** `python3 test_suite.py` → "all green", with the new checks' names visible in a `-v`-style read of the source (this suite doesn't have a `-v` flag; confirm by temporarily breaking one check's condition and re-running to see it appear under "failed", per the existing `check()` convention — then restore it).

**Steps:**

- [ ] **Step 1: Write the checks**

Add this function to `test_suite.py`, placed directly after `test_hand_sort()` (which ends at line 1310, right before `def test_english_faces():` at line 1312):

```python
def test_mobile_coverflow():
    print("mobile coverflow")
    here = os.path.dirname(os.path.abspath(__file__))
    js = open(os.path.join(here, "ui", "cube.js")).read()
    css = open(os.path.join(here, "ui", "shared.css")).read()

    check("the coverflow track scroll-snaps one card at a time",
          ".cftrack{display:flex;overflow-x:auto;scroll-snap-type:x mandatory" in css)
    check("a coverflow card has three depth states",
          ".cftrack .dcard.focused{" in css and ".cftrack .dcard.near{" in css
          and ".cftrack .dcard:not(.focused):not(.near){" in css)
    check("coverflow cards get the same touch handling the fan's already have",
          ".hand.fan .dcard,.cftrack .dcard{touch-action:pan-x}" in css)
    check("the deckpile gets room on a phone-width table",
          ".tabletop{padding-bottom:90px}" in css)

    check("the coverflow helper exists and is generic over its track",
          "function p1WireCoverflow(track, groups)" in js)
    check("the coverflow helper is wired once, not re-listened on every render",
          "if (!track.dataset.cfWired) {" in js)

    check("pack 1 pick 1 switches to a coverflow under the mobile breakpoint",
          "const mobile = matchMedia('(max-width:560px)').matches;" in js
          and "hand.className = 'hand coverflow';" in js)
    check("the mobile branch renders flat cards, not boxed runs",
          "p1WireCoverflow(hand.querySelector('.cftrack')," in js)
    check("the signal drill's pack coverflows too, browse-only",
          "if (cfTrack) p1WireCoverflow(cfTrack, null);" in js)

    check("the fan's own layout math steps aside for a coverflow hand",
          "if (hand.classList.contains('coverflow')) return;" in js)
```

- [ ] **Step 2: Register it in `main()`**

Current code at `test_suite.py:1584-1585`:

```python
    test_signal_drill()
    test_color_names()
```

Replace with:

```python
    test_signal_drill()
    test_mobile_coverflow()
    test_color_names()
```

- [ ] **Step 3: Run it**

```bash
python3 test_suite.py
```

Expected: "all green" (Tasks 1-4 already landed everything these checks look for).

- [ ] **Step 4: Confirm the checks actually check something**

Temporarily break one condition (e.g. change `"function p1WireCoverflow(track, groups)"` to `"function p1WireCoverflowXXX"` in the test file only), rerun `python3 test_suite.py`, confirm it now reports that check under "failed", then revert the edit.

- [ ] **Step 5: Commit**

```bash
git add test_suite.py
git commit -m "Lock in the mobile coverflow with regression checks"
```

---

## Task 6: Full mobile verification pass

**Goal:** Confirm the whole feature end-to-end in the browser pane, across both tabs and every affected state, with the same live-audit method used to find the original deckpile bug.

**Files:** none (verification only).

**Acceptance Criteria:**
- [ ] `python3 test_suite.py` → "all green".
- [ ] At 375×812: pack-choosing screen shows no deckpile/text overlap.
- [ ] At 375×812: Pack 1 Pick 1 coverflow browses correctly for at least two different sort orders, including "colour" (group label visible and updates across a boundary).
- [ ] At 375×812: swipe-up-to-pick works from the coverflow (card is taken, pack advances, deckpile count increments).
- [ ] At 375×812: Signal Drill's pack browses as a coverflow; tapping a card zooms it; answering a lane still works.
- [ ] At a desktop width (e.g. 1280px): both tabs render exactly as they did before this plan (fan, grouped runs, stacked drill pile) — screenshot-compared against the Task 0 (live-audit) baseline if still available, or re-verified fresh.

**Verify:** All boxes above checked by direct observation in the browser pane (screenshots), not by reading the code.

**Steps:**

- [ ] **Step 1: Run the full regression suite**

```bash
python3 test_suite.py
```

Expected: "all green".

- [ ] **Step 2: Rebuild the draft page**

```bash
python3 build_static.py --from-data --only p1p1 -o docs/draft.html
```

- [ ] **Step 3: Mobile pass (375×812)**

Walk through, screenshotting each: pack-choosing screen (deckpile clearance) → open a pack (coverflow renders, browse it) → switch sort to "colour" (group label appears, updates while swiping) → swipe a card up to pick it (taken, deckpile count increments, pack advances) → Signal Drill tab, deal a situation (pack coverflows, tap-to-zoom works, answer a lane).

- [ ] **Step 4: Desktop pass (≥860px)**

Resize to desktop width and re-check both tabs render as the original fan/grouped-runs/stacked-pile — no coverflow markup, no visual regressions.

- [ ] **Step 5: Commit if anything was adjusted during this pass**

If Step 3 or 4 surfaces an issue, fix it in the relevant file, re-run `python3 test_suite.py`, and commit that fix on its own:

```bash
git add -A
git commit -m "Fix <specific issue found in mobile verification>"
```

If nothing needed fixing, this task produces no commit of its own — it's a confirmation step.

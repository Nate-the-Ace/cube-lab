// Cube analysis. Shared by index.html's Cube tab and the standalone
// cube.html page.

/* ── cube ── */
const pct = v => (v == null ? '—' : (v * 100).toFixed(v < 0.01 ? 2 : 1) + '%');

let LOADED_CUBES = [];
async function loadCubes(selectId) {
  const cs = await (await fetch('/api/cubes')).json();
  cs.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  const sel = $('#cubeSel');
  sel.innerHTML = cs.length
    ? cs.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${c.n_cards})</option>`).join('')
    : '<option value="">no cubes imported yet</option>';
  if (selectId) sel.value = selectId;
  LOADED_CUBES = cs;
  syncRefreshButton(cs);
  return cs;
}

$('#cubePasteToggle').onclick = () => $('#cubePasteBox').classList.toggle('hidden');

async function importCube(payload) {
  $('#cubeImportOut').textContent = 'importing…';
  const d = await (await fetch('/api/cube/import', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  })).json();
  if (d.error) return $('#cubeImportOut').innerHTML = `<span class="badge bad">${esc(d.error)}</span>`;
  $('#cubeImportOut').innerHTML = `<span class="badge good">${d.n_cards} cards imported</span>` +
    (d.n_unresolved ? ` <span class="badge bad">${d.n_unresolved} names not recognised</span>
       <span class="mini">${d.unresolved.map(esc).join(', ')}</span>` : '');
  await loadCubes(d.id);
  runCube();
}
$('#cubeFile').onchange = async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const text = await f.text();
  // a Cube Cobra CSV export is handled server-side; so is a plain name-per-line list
  const base = f.name.replace(/\.[^.]+$/, '');
  const name = $('#cubeName').value.trim() || base;
  importCube({id: name, name, text});
};
$('#cubeImportPaste').onclick = () => {
  const name = $('#cubeName').value.trim() || 'my-cube';
  importCube({id: name, name, text: $('#cubeText').value});
};

// A theme name like "Dandan" or "Cheerios" means nothing on its own, and EDHREC's
// own descriptions are SEO boilerplate ("Popular Slivers EDH commanders"). The
// honest explanation is the cube's own cards: the ones whose synergy with this
// tactic is highest. It also exposes a bad match - if the list is all duals, the
// "tactic" is really just lands.
// Every card name on the page goes through here. A name rendered as bare text
// looks identical and silently has no preview, which is exactly how the near-miss
// and combo-template columns lost theirs.
const cardName = (n, oid) => n
  ? `<span ${oid ? `data-oracle="${esc(oid)}"` : `data-card="${esc(n)}"`}>${esc(n)}</span>`
  : '';
const cardNames = (list, sep) => (list || []).filter(Boolean)
  .map(n => cardName(n)).join(sep === undefined ? ', ' : sep);

// An odds number reads as a headline plus the range around it. Contention used
// to be a slider, which asked the reader to supply a parameter before the page
// would answer; the range says more and asks nothing.
function bandCell(b, mid, fmt) {
  const f = fmt || (v => pct(v));
  if (!b) return f(mid);
  return `${f(b.mid)}<div class="mini dim">${f(b.low)} · ${f(b.high)}</div>`;
}

function tacticBlurb(x) {
  const ex = (x.examples || []).slice(0, 6);   // the dropdown carries the full list
  if (!ex.length) return 'No representative cards for this tactic in your cube.';
  const lines = ex.map(e => {
    const type = (e.type_line || '').split(' \u2014')[0];
    const syn = (e.synergy >= 0 ? '+' : '') + (e.synergy || 0).toFixed(2);
    return '\u2022 ' + e.card_name + (type ? '  (' + type + ')' : '') + '  synergy ' + syn;
  });
  return 'The cards in YOUR cube that most define this tactic:\n\n'
    + lines.join('\n')
    + '\n\n' + x.cards_in_cube + ' cards in the cube serve it, and you should expect to '
    + 'draft about ' + x.expected_drafted + ' of them.'
    + '\n\nSynergy is how much more this strategy plays a card than decks in general do. '
    + 'If these look like a pile of lands rather than a strategy, the match is spurious.';
}

// "etb trigger" and "cheaper than mv" are jargon. Say what was looked for, then
// name cards from this cube so the count can be checked rather than trusted.
function functionBlurb(f) {
  const src = f.kind === 'tag'
    ? "Scryfall Tagger category - hand-curated by the community."
    : "Found by parsing the card's rules text.";
  // examples are card objects, not names — joining them raw printed [object Object]
  const names = (f.examples || []).map(c => (c && c.name) || c);
  const shown = names.slice(0, 8);
  const ex = names.length
    ? '\n\nIn your cube: ' + shown.join(', ')
      + (names.length > shown.length ? ` and ${names.length - shown.length} more` : '')
    : '';
  return (f.blurb || '') + '\n\n' + src + '\n\n' + f.n + ' cards in the cube do this.' + ex;
}

async function runCube() {
  const cube_id = $('#cubeSel').value;
  if (!cube_id) return;
  const p = new URLSearchParams({cube_id, players: $('#cubePlayers').value,
    pack_size: $('#cubePack').value, rounds: $('#cubeRounds').value,
    });
  $('#cubeOut').innerHTML = '<span class="dim">reading the cube…</span>';
  const [combos, tactics, syn, opp, bal, near] = await Promise.all([
    (await fetch('/api/cube/combos?' + p)).json(),
    (await fetch('/api/cube/tactics?' + p + '&need=6')).json(),
    (await fetch('/api/cube/synergies?' + p + '&limit=60'
      + ($('#synLands').checked ? '&include_lands=1' : ''))).json(),
    (await fetch('/api/cube/opportunities?' + p)).json(),
    (await fetch('/api/cube/balance?' + p)).json(),
    (await fetch('/api/cube/near-misses?' + p + '&limit=40')).json()
  ]);
  if (combos.error) return $('#cubeOut').innerHTML = `<span class="badge bad">${esc(combos.error)}</span>`;
  const s = combos.shape, one = combos.single_card;
  const band = combos.single_card_band;
  $('#cubeShape').innerHTML = `A ${s.players}-player draft with ${s.rounds}×${s.pack_size} packs
    uses <b>${s.cards_used}</b> of the cube's ${s.cube_size} cards and gives you
    <b>${s.picks_each}</b> picks, so any one card has a <b>${pct(one.p_opened)}</b> chance of
    being opened at all. Whether it then reaches your seat depends on how many other
    drafters want it: overall you end up with it
    <b>${band ? pct(band.low) : pct(one.p_you_get_it)}</b> of the time if nobody else is in your
    lane, <b>${pct(one.p_you_get_it)}</b> at normal competition, and
    <b>${band ? pct(band.high) : '—'}</b> if everyone first-picks it.
    ${s.oversubscribed ? '<span class="badge bad">more cards needed than the cube holds</span>' : ''}`;

  // What a combo needs beyond the cards it names, and whether the cube has it.
  const needsCell = c => {
    if (c.self_contained) return '<span class="badge good">nothing else</span>';
    const bits = (c.prereqs || []).map(p => `<div class="mini">• ${esc(p)}</div>`);
    (c.templates || []).forEach(tp => {
      if (!tp.checkable) {
        bits.push(`<div class="mini">• a ${esc(tp.template)} <span class="dim">(can't check automatically)</span></div>`);
      } else if (tp.found) {
        bits.push(`<div class="mini">• a ${esc(tp.template)} — <span class="badge good">cube has ${tp.found}</span> ${cardNames(tp.examples)}</div>`);
      } else {
        bits.push(`<div class="mini">• a ${esc(tp.template)} — <span class="badge bad">none in your cube</span></div>`);
      }
    });
    return `<span class="badge bad">needs ${c.n_extra} more</span>${bits.join('')}`;
  };

  const comboRows = (list, isCand) => list.map(c => `<tr>
      <td class="name">${(c.cards || []).map(n => cardName(n)).join(' <span class="dim">+</span> ')}
        ${isCand ? `<div class="dim">${esc(c.why || '')}</div>` : ''}</td>
      <td class="num" data-sort="${c.n_cards}">${c.n_cards}</td>
      <td class="num" data-sort="${c.p_draft}">${bandCell(c.p_draft_band, c.p_draft)}</td>
      <td class="num" data-sort="${c.drafts_to_hit ?? ''}">${c.drafts_to_hit ?? '—'}</td>
      <td class="dim">${esc((c.produces || []).filter(Boolean).join(', '))}</td>
      ${isCand ? `<td data-sort="${c.novel ? 0 : 1}">${c.novel
        ? '<span class="badge good">novel</span>' : '<span class="badge">known</span>'}</td>`
        : `<td data-sort="${c.self_contained ? 0 : c.n_extra}">${needsCell(c)}</td>`}
    </tr>`).join('');

  $('#cubeOut').innerHTML = `
    <div class="stats" style="margin-bottom:12px">
      <div class="stat"><b>${combos.known_self_contained}</b><span>combos you could actually assemble</span></div>
      <div class="stat"><b>${combos.known_needs_extra}</b><span>need a piece the cube may lack</span></div>
      <div class="stat"><b>${combos.candidates_total}</b><span>candidates from card text</span></div>
      <div class="stat"><b>${pct(one.p_you_get_it)}</b><span>odds on any one card</span></div>
      <div class="stat"><b>${(tactics.functions || []).length}</b><span>things the cube does</span></div>
      <div class="stat"><b>${syn && syn.total_pairs ? syn.total_pairs.toLocaleString() : 0}</b><span>pairs above chance</span></div>
    </div>

    <h3 class="sec">Combos that live entirely in this cube</h3>
    <p class="note">Known combos with at least one piece in your cube.
      <b>Naming two cards is not the same as needing only two cards</b> — nearly half of all combos
      also require something unnamed, like “a way to give it lifelink” or “a persist creature”.
      Those are listed under <b>Also needs</b>, and where the requirement is a keyword the cube is
      checked for it. “Drafts to hit” counts only the named cards, so it is optimistic for anything
      that isn't self-contained.
      ${combos.known_self_contained} of ${combos.known_total} need nothing beyond the cards named.</p>
    ${combos.known.length ? `<table><thead><tr><th data-filter="text">Combo</th><th class="num" data-filter="min">Pieces</th>
      <th class="num">Odds</th><th class="num">Drafts to hit</th><th data-filter="text">Produces</th>
      <th data-filter="text">Also needs</th></tr></thead>
      <tbody>${comboRows(combos.known, false)}</tbody></table>`
      : '<span class="dim">no known combos are fully contained in this cube</span>'}

    ${combos.candidates.length ? `
    <h3 class="sec">Interactions our own card-text analysis proposes</h3>
    <p class="note">Generated from what the cards do, not from decklists. “Novel” means it isn't in
      the 110,355-combo database — <b>not that it's verified to work</b>. Check these by hand.</p>
    <table><thead><tr><th>Interaction</th><th class="num">Pieces</th><th class="num">Odds</th>
      <th class="num">Drafts to hit</th><th>Produces</th><th>Status</th></tr></thead>
      <tbody>${comboRows(combos.candidates, true)}</tbody></table>` : ''}

    <h3 class="sec">Where the opportunity is</h3>
    <p class="note"><b>Depth</b> is a hard fact about your list: how many playable spells the lane
      holds. <b>Measured</b> is how the lane has actually performed at your table.
      <b>Opportunity</b> is the two multiplied — depth counts for nothing if the lane keeps losing.
      This used to be depth × EDHREC play rate, which ranked these ten lanes almost exactly
      backwards against your own results (Spearman −0.32): Boros came last on play rate and third
      on games won. Popularity in multiplayer Commander is not a claim about a Pioneer cube, so it
      is gone from the page.
      ${(opp && opp.has_local)
        ? `<b>Measured</b> is what this table has actually done with the lane, from the game-night
           records — the only signal here drawn from your own cube rather than someone else's format.
           It is also the smallest: a couple of dozen matches decides nothing on its own, so the
           match count sits beside every rate. A three-colour deck counts toward each of its pairs.`
        : `A third signal, what this table has actually done with each lane, appears here once
           game-night results are recorded.`}</p>
    <table><thead><tr><th data-filter="text">Lane</th><th class="num" data-filter="min">Spells</th>
      <th class="num">Opportunity</th>${opp && opp.has_local
        ? '<th class="num" data-filter="min">Measured</th><th class="num" data-filter="min">Matches</th>' : ''}</tr></thead><tbody>
      ${((opp && opp.lanes) || []).map(l => `<tr>
        <td class="name" data-sort="${esc(l.colors)}">${manaLabel(l.colors)}</td>
        <td class="num" data-sort="${l.spells}">${l.spells}</td>
        <td class="num" data-sort="${l.opportunity}">${l.opportunity.toLocaleString()}</td>
        ${opp && opp.has_local ? (l.local
          ? `<td class="num" data-sort="${l.local.score_pct}">${l.local.score_pct.toFixed(1)}%
               <div class="mini">${l.local.w}-${l.local.l}${l.local.d ? '-' + l.local.d : ''}</div></td>
             <td class="num" data-sort="${l.local.matches}">${l.local.matches}
               <div class="mini">${l.local.decks} deck${l.local.decks === 1 ? '' : 's'}</div></td>`
          : '<td class="num dim">—</td><td class="num dim">never drafted</td>') : ''}
      </tr>`).join('')}</tbody></table>

    <h3 class="sec">Colour lanes</h3>
    <p class="note">How cube drafting actually works: pick a pair and see how deep it runs.
      “Expect” is how many of that lane's cards should reach you across the whole draft.</p>
    <table><thead><tr><th data-filter="text">Lane</th><th class="num" data-filter="min">Cards</th>
      <th class="num">Mono</th><th class="num">Gold</th><th class="num" data-filter="min">Expect to draft</th></tr></thead><tbody>
      ${(tactics.lanes || []).map(l => `<tr>
        <td class="name" data-sort="${esc(l.colors)}">${manaLabel(l.colors)}</td>
        <td class="num" data-sort="${l.cards_in_cube}">${l.cards_in_cube}</td>
        <td class="num" data-sort="${l.mono}">${l.mono}</td>
        <td class="num" data-sort="${l.gold}">${l.gold}</td>
        <td class="num" data-sort="${l.expected_drafted}">${l.expected_drafted}</td>
      </tr>`).join('')}</tbody></table>

    <h3 class="sec">Pairs worth trying</h3>
    <p class="note">Card pairs in your cube that real decks play together far more often than their
      individual popularity predicts. <b>Lift</b> is how many times more often than chance —
      lift of 1 is coincidence, lift of 40 means decks that play one go and find the other.
      Ranked so well-evidenced pairings beat lucky small samples, because two obscure cards meeting
      in six decks is not a discovery. ${syn && syn.total_pairs ? syn.total_pairs.toLocaleString() : 0}
      pairs beat chance in this cube.
      <b>Mana base excluded:</b> dual lands share decks with everything in their colours, so half of
      all pairs were a land meeting a spell of the same colours — a fact about fixing, not an idea.
</p>
    <p class="note">${Object.entries((syn && syn.by_kind) || {}).map(([k, v]) =>
      `<span class="badge">${esc(k)} ${v.toLocaleString()}</span>`).join(' ')}</p>
    <table><thead><tr><th data-filter="text">Pair</th><th data-filter="pick">Type</th><th class="num" data-filter="min">Lift</th>
      <th class="num" data-filter="min">Decks together</th>
      <th data-filter="text">Why it might work</th></tr></thead><tbody>
      ${((syn && syn.pairs) || []).map(x => `<tr>
        <td class="name">${x.cards.map(c => cardName(c.name, c.oracle_id)).join(' <span class="dim">+</span> ')}
          <div class="dim">${manaDisc(x.colors, 14)} ${x.cards.map(c => esc((c.type_line||'').split(' —')[0])).join(' · ')}</div></td>
        <td data-sort="${esc(x.kind)}"><span class="badge kind-${esc(x.kind.replace(/[^a-z]+/g,''))}">${esc(x.kind)}</span></td>
        <td class="num" data-sort="${x.lift}">${x.lift}×</td>
        <td class="num" data-sort="${x.played_together}">${x.played_together.toLocaleString()}</td>
        <td class="dim">${x.hint ? esc(x.hint) : '<span class="dim">—</span>'}</td>
      </tr>`).join('')}</tbody></table>

    <h3 class="sec">Balance</h3>
    <p class="note">Counts only — no judgement attached, because judging a cube card needs a measure
      of cube power this project doesn't have. See the note below the table.</p>
    <div class="stats" style="margin-bottom:10px">
      ${Object.entries((bal && bal.by_colour) || {}).map(([k, v]) =>
        `<div class="stat"><b>${v}</b><span>${k === 'multicolour' ? 'multicolour'
          : k === 'C' ? 'colourless' : esc(ciName(k) || k)}</span></div>`).join('')}
    </div>
    <table><thead><tr><th>Mana value</th><th class="num">Cards</th><th>Share of spells</th></tr></thead><tbody>
      ${(() => { const c = (bal && bal.curve) || {};
        const tot = Object.values(c).reduce((a, b) => a + b, 0) || 1;
        return Object.entries(c).map(([mv, n]) => `<tr>
          <td class="name">${mv === '7' ? '7+' : esc(mv)}</td>
          <td class="num" data-sort="${n}">${n}</td>
          <td><span style="display:inline-block;height:9px;border-radius:2px;
            background:var(--accent);width:${Math.round(260 * n / tot)}px"></span>
            <span class="mini">${(100 * n / tot).toFixed(0)}%</span></td>
        </tr>`).join(''); })()}
    </tbody></table>
    <table style="margin-top:10px"><thead><tr><th>Card type</th><th class="num">Cards</th></tr></thead><tbody>
      ${Object.entries((bal && bal.by_type) || {}).map(([k, v]) => `<tr>
        <td class="name">${esc(k)}</td><td class="num" data-sort="${v}">${v}</td></tr>`).join('')}
    </tbody></table>
    <p class="note"><b>Replacement suggestions are switched off on purpose.</b> Picking what to cut
      needs a measure of how strong a card is <em>in cube</em>, and the only power data here is
      EDHREC play rate, which is inverted for this format: Collected Company sits in 373 Commander
      decks and Vandalblast in 838,149. Ranking your list that way recommends cutting the first for
      the second. The measure that would work is how many other cubes run each card — load cube
      lists and it turns on.</p>

    <h3 class="sec">What the cube is made of</h3>
    <p class="note">Measured from card text and Scryfall's function tags — format-neutral, unlike the
      theme data above.</p>
    <table><thead><tr><th data-filter="text">Does this</th><th class="num" data-filter="min">Cards</th><th data-filter="pick">Source</th></tr></thead><tbody>
      ${(tactics.functions || []).map(f => `<tr>
        <td class="name">
          <details class="cardlist">
            <summary>${esc(f.label)}</summary>
            <div class="cardgrid">${(f.examples || []).map(c =>
              `<span class="cardchip" data-oracle="${c.oracle_id}">${esc(c.name)}
               <span class="mini">${esc((c.type_line || '').split(' —')[0])}</span></span>`).join('')}</div>
          </details>${tipInline(f.label, functionBlurb(f))}</td>
        <td class="num" data-sort="${f.n}">${f.n}</td>
        <td class="dim">${f.kind === 'tag' ? 'Scryfall tag' : 'text parser'}</td>
      </tr>`).join('')}</tbody></table>

    <h3 class="sec">One card short</h3>
    <p class="note">No combo of three or more cards sits entirely inside this cube — that's the
      honest answer to searching for them. The useful answer is next door: these cards would each
      <em>complete</em> a combo whose every other piece you already have. Restricted to cards legal
      in ${esc(near.format || 'the format')}, since one you can't add isn't a suggestion${
        near.excluded_illegal ? ` — ${near.excluded_illegal} were dropped for that reason, including
        ${cardNames(near.illegal_examples)}` : ''}.
      Combos that also need something unnamed are left out, because adding a card wouldn't finish them.</p>
    ${(near.cards || []).length ? `<table><thead><tr><th data-filter="text">Add this</th><th data-filter="text">Type</th>
      <th class="num" data-filter="min">Completes</th><th data-filter="text">What it finishes</th></tr></thead><tbody>
      ${near.cards.map(c => `<tr>
        <td class="name" data-card="${esc(c.name)}">${esc(c.name)}</td>
        <td class="dim">${manaDisc(c.color_identity, 14)} ${esc((c.type_line || '').split(' —')[0])}</td>
        <td class="num" data-sort="${c.unlocks}">${c.unlocks}</td>
        <td class="dim">${c.combos.map(k => `<div class="mini">${k.n_cards}-card:
          ${cardNames(k.cards, ' + ')} <span class="dim">→ ${esc((k.produces || []).slice(0, 2).join(', '))}</span></div>`).join('')}</td>
      </tr>`).join('')}</tbody></table>`
      : '<span class="dim">nothing in the format would complete a combo here</span>'}
`;
  collapsibleSections('#cubeOut');
  sortable('#cubeOut');
  filterable('#cubeOut');
}
// Explicit user action only: this never fires on load, on a timer, or as part of
// analysis. See the note in cube.py about what we're doing and why.
$('#cubeRefresh').onclick = async () => {
  const id = $('#cubeSel').value;
  if (!id) return;
  const btn = $('#cubeRefresh');
  btn.disabled = true;
  btn.textContent = 'refreshing…';
  const d = await (await fetch('/api/cube/refresh', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({id})
  })).json();
  btn.disabled = false;
  btn.textContent = 'Refresh list';
  const box = $('#cubeShape');
  if (d.error) {
    box.innerHTML = `<span class="badge bad">${esc(d.error)}</span>`;
    return;
  }
  const changed = (d.added || []).length + (d.removed || []).length;
  box.innerHTML = changed
    ? `<span class="badge good">${d.n_cards} cards, ${changed} changed</span>
       ${(d.added || []).length ? `<div class="note"><b>added:</b> ${d.added.map(esc).join(', ')}</div>` : ''}
       ${(d.removed || []).length ? `<div class="note"><b>removed:</b> ${d.removed.map(esc).join(', ')}</div>` : ''}`
    : `<span class="badge good">${d.n_cards} cards, no changes since last time</span>`;
  await loadCubes(id);
  runCube();
};

// the button only means something for a cube that came from Cube Cobra
function syncRefreshButton(cubes) {
  const sel = $('#cubeSel').value;
  const c = (cubes || []).find(x => x.id === sel);
  const ok = !!(c && (c.source || '').startsWith('cubecobra:'));
  const btn = $('#cubeRefresh');
  btn.disabled = !ok;
  btn.title = ok ? "Re-pull this cube's list from Cube Cobra"
                 : 'This cube came from a file — re-import it to update';
}

$('#cubeDelete').onclick = async () => {
  const sel = $('#cubeSel');
  const id = sel.value;
  if (!id) return;
  const label = sel.options[sel.selectedIndex].textContent.trim();
  if (!confirm('Delete "' + label + '"?\n\nOnly the stored card list goes; re-import the file to get it back.')) return;
  const d = await (await fetch('/api/cube/delete', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})
  })).json();
  $('#cubeImportOut').innerHTML = d.error
    ? `<span class="badge bad">${esc(d.error)}</span>`
    : `<span class="badge good">deleted ${esc(d.name)}</span>`;
  await loadCubes();
  if ($('#cubeSel').value) runCube();
};

$('#secExpand').onclick = () => setAllSections(true);
$('#secCollapse').onclick = () => setAllSections(false);
$('#synLands').onchange = runCube;
$('#cubeGo').onclick = runCube;

// The draft controls re-run the analysis themselves; typing in them fires
// `input` per keystroke, hence the debounce.
let draftTimer = null;
$('#p1Players') && $('#p1Players').addEventListener('input', () => {
  if (P1_PACK.length) p1Render();
});
['#cubePlayers', '#cubePack', '#cubeRounds'].forEach(sel => {
  const el = $(sel);
  if (!el) return;
  el.addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(runCube, 350);
  });
});
$('#cubeSel').onchange = () => { syncRefreshButton(LOADED_CUBES); runCube(); };

/* ── pack 1 pick 1 ──
   Deal a pack from the cube, take your pick, then see what the numbers say.
   The point is the disagreement: the score deliberately contains no measure of
   raw card power (see pick_scores in cube.py), so where it is wrong it should
   be obviously wrong, and you should be able to see which component did it. */
let P1 = null, P1_PACK = [], P1_PICK = null, P1_REVEALED = false;
// what you have taken across the whole session, so the watchlist can grow with
// the draft instead of resetting every pack
let P1_TAKEN = [];
let P1_PACKNO = 0, P1_ANIMATING = false;
const p1Card = oid => (P1 && P1.cards || []).find(c => c.oracle_id === oid);

// the previews want this data on every tab, so it is fetched once at load
async function p1Data() {
  if (P1) return P1;
  const cube_id = $('#cubeSel').value || (LOADED_CUBES[0] || {}).id;
  P1 = await (await fetch('/api/cube/p1p1?' + new URLSearchParams({cube_id}))).json();
  return P1;
}

/* ── the table ──
   A pack is a hand of real cards; picks go face down into a deck; the rest slide
   off toward whoever we pass to. Three packs, passed left, right, left, which is
   how the table actually runs. */
const PASS = ['left', 'right', 'left'];
const passDir = () => PASS[(P1_PACKNO - 1) % PASS.length];

function cardFace(c, extra) {
  const cls = 'dcard' + (c.image ? '' : ' noimg') + (extra ? ' ' + extra : '');
  const face = c.image
    ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">
       <span class="nm">${esc(c.name)}</span>`
    : `<span>${esc(c.name)}</span>`;
  return `<div class="${cls}" data-oracle="${esc(c.oracle_id)}"
    data-pick="${esc(c.oracle_id)}" role="button" tabindex="0"
    aria-label="${esc(c.name)}">${face}</div>`;
}

function p1DrawHand() {
  const hand = $('#p1Hand');
  if (!P1_PACK.length) {
    hand.innerHTML = '<span class="dim">Press \u201cDeal a pack\u201d.</span>';
    return;
  }
  hand.className = 'hand fan';
  hand.innerHTML = P1_PACK.map(c => cardFace(c)).join('');
  p1LayoutHand();
  p1MarkBest();
  const dir = passDir();
  $('#p1PassL').textContent = dir === 'left' ? '\u2190 you pass this way' : '';
  $('#p1PassR').textContent = dir === 'right' ? 'you pass this way \u2192' : '';
  hand.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.pick);
    let clickTimer = null;
    el.onclick = () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => p1Zoom(card), 220);
    };
    el.ondblclick = e => {
      e.preventDefault();
      clearTimeout(clickTimer);          // the zoom never opens behind the pick
      hideCard();
      p1Take(el.dataset.pick, el);
    };
    el.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); p1Take(el.dataset.pick, el); }
      else if (e.key === ' ') { e.preventDefault(); p1Zoom(card); }
    };
  });
}

/* Taking a card: it flies to the deck, the rest of the pack leaves toward the
   seat we pass to, and only then does the table settle. The numbers are left
   alone until "Show the numbers" - the point of the tab is to pick first. */
function p1Take(oid, el) {
  if (P1_ANIMATING) return;
  const card = p1Card(oid);
  if (!card) return;
  P1_ANIMATING = true;
  p1Unzoom();
  P1_PICK = oid;
  if (!P1_TAKEN.some(c => c.oracle_id === oid)) P1_TAKEN.push(card);

  const deck = $('#p1Deck').getBoundingClientRect();
  const me = el.getBoundingClientRect();
  el.style.setProperty('--dx', (deck.left + deck.width / 2 - me.left - me.width / 2) + 'px');
  el.style.setProperty('--dy', (deck.top + deck.height / 2 - me.top - me.height / 2) + 'px');
  el.classList.add('flying');

  const cls = passDir() === 'left' ? 'passing-l' : 'passing-r';
  $('#p1Hand').querySelectorAll('.dcard').forEach(other => {
    if (other !== el) other.classList.add(cls);
  });

  const settle = () => {
    P1_ANIMATING = false;
    p1DeckFace();
    p1Tableau();                 // keep an open tableau in step with the deck
    p1Watchlist();
    $('#p1Reveal').disabled = false;
    $('#p1Hand').innerHTML =
      `<span class="dim">Took <b>${esc(card.name)}</b>. Deal the next pack, `
      + `or press \u201cShow the numbers\u201d to see what the pack was worth.</span>`;
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(settle, reduced ? 20 : 520);
}

/* Lay the pack out as ONE row whatever the pack size and screen width.

   A fixed overlap cannot do this: 15 cards at 132px need 1336px unoverlapped,
   so on any normal screen a wrapping fan breaks into three rows and stops
   looking like a hand. The step between cards is solved from the space actually
   available instead, and the cards narrow before the step goes below a third of
   a card - past that the art is unreadable and you are picking blind. */
/* Which card the numbers would take, GIVEN what is already in the deck.

   The pick score on its own is deck-blind: it ranks a card against the cube, not
   against the eleven cards you have drafted. So the pull toward what you already
   own is added on top, from the same lift pairs the watchlist uses. On an empty
   deck that term is zero and this is just the pick score - which is the right
   answer for a genuine pack 1 pick 1. */
function p1DeckFit(card) {
  if (!P1_TAKEN.length) return 0;
  const mine = new Set(P1_TAKEN.map(c => c.oracle_id));
  let pull = 0;
  (card.partners || []).forEach(p => { if (mine.has(p.oracle_id)) pull += p.lift || 0; });
  P1_TAKEN.forEach(t => {
    (t.partners || []).forEach(p => { if (p.oracle_id === card.oracle_id) pull += p.lift || 0; });
  });
  return pull;
}

const p1Total = c => c.score + 0.35 * p1DeckFit(c);

function p1MarkBest() {
  const hand = $('#p1Hand');
  const cards = [...hand.querySelectorAll('.dcard')];
  if (cards.length < 2) return;
  let bestEl = null, bestScore = -Infinity;
  cards.forEach(el => {
    const c = p1Card(el.dataset.oracle);
    if (!c) return;
    const t = p1Total(c);
    if (t > bestScore) { bestScore = t; bestEl = el; }
  });
  if (!bestEl) return;
  bestEl.classList.add('best');
  const fit = p1DeckFit(p1Card(bestEl.dataset.oracle));
  bestEl.insertAdjacentHTML('beforeend',
    `<span class="crown" title="${esc(P1_TAKEN.length
      ? 'What the numbers would take, counting how it pairs with your ' + P1_TAKEN.length
        + ' picked card' + (P1_TAKEN.length === 1 ? '' : 's')
        + (fit ? ' (pull ' + fit.toFixed(0) + ')' : ' (no pairs with them)')
      : 'What the numbers would take')}">\u2605</span>`);
}

/* What the preview says instead of a legality grid.

   A cube card is legal in whatever it is legal in and it makes no difference to
   a draft pick, so the space is better spent on the four things that DO bear on
   it: the colours' record at this table, what the card commits you to, what the
   cube wants beside it, and - once you have picks - whether it pairs with them.
   Each line is a fact with its number attached, not a verdict. */
function p1WhyLines(card) {
  const lines = [];
  const lanes = (P1 && P1.lane_pct) || {};
  const base = (P1 && P1.lane_baseline) || 50;
  const ci = card.color_identity || '';

  const fits = Object.entries(lanes).filter(([pair]) => [...ci].every(c => pair.includes(c)));
  if (fits.length) {
    const [bestPair, bestPct] = fits.sort((a, b) => b[1] - a[1])[0];
    const d = bestPct - base;
    lines.push([d >= 2 ? 'good' : d <= -2 ? 'bad' : '',
      `Best lane <b>${esc(ciName(bestPair))}</b> at <b>${bestPct}%</b> here`
      + ` — ${d >= 0 ? '+' : ''}${d.toFixed(1)} against your ${base}% average.`]);
  } else if (!ci) {
    lines.push(['good', 'Colourless, so it fits whatever you end up in.']);
  }

  const n = [...ci].length;
  lines.push([n <= 1 ? 'good' : n >= 3 ? 'bad' : '',
    card.is_land ? 'A land: it is the fixing, not a way of keeping options open.'
      : n === 0 ? 'Commits you to nothing.'
      : n === 1 ? 'One colour, so it closes almost nothing off.'
      : n === 2 ? 'Two colours — it picks your lane for you.'
      : `${n} colours, which rules out most of the ten lanes.`]);

  const ps = card.partners || [];
  lines.push([ps.length ? 'good' : 'bad', ps.length
    ? `${ps.length} cube card${ps.length === 1 ? '' : 's'} want to be beside it, led by `
      + ps.slice(0, 2).map(p => `<b>${esc(p.name)}</b> (${(p.lift || 0).toFixed(0)}\u00d7)`).join(' and ') + '.'
    : 'Nothing in the cube pairs with it above chance — you play it because it is good, not for what it combines with.']);

  if (P1_TAKEN.length && !$('#tab-p1p1').classList.contains('hidden')) {
    const mine = new Set(P1_TAKEN.map(c => c.oracle_id));
    const hits = ps.filter(p => mine.has(p.oracle_id));
    const back = P1_TAKEN.filter(t => (t.partners || []).some(p => p.oracle_id === card.oracle_id));
    const names = [...new Set(hits.map(h => h.name).concat(back.map(b => b.name)))];
    lines.push([names.length ? 'good' : '', names.length
      ? `Pairs with <b>${names.slice(0, 2).map(esc).join('</b> and <b>')}</b>, already in your deck.`
      : `No pair with any of your ${P1_TAKEN.length} picks.`]);
  }

  const onDraftTab = !$('#tab-p1p1').classList.contains('hidden');
  const inPack = onDraftTab && P1_PACK.some(c => c.oracle_id === card.oracle_id);
  if (inPack && P1_PACK.length > 1) {
    const ranked = P1_PACK.slice().sort((a, b) => p1Total(b) - p1Total(a));
    const rank = ranked.findIndex(c => c.oracle_id === card.oracle_id) + 1;
    const w = p1Wheel();
    const taken = w.players - 1;
    lines.push([rank === 1 ? 'good' : '',
      `Ranked <b>${rank}</b> of ${P1_PACK.length} in this pack`
      + (w.wheels
          ? rank <= taken ? ' — gone before it wheels.'
          : rank <= taken + 2 ? ' — close, it may not wheel.'
          : ' — should still be here on the wheel.'
          : '.')]);
  }
  return lines;
}

function CARD_NOTE(d) {
  const card = p1Card(d.oracle_id) || (P1 && (P1.cards || []).find(c => c.name === d.name));
  const lines = card
    ? p1WhyLines(card)
    : [['', `Not in the cube${d.type_line ? ' \u2014 ' + esc(d.type_line.split(' \u2014')[0]) : ''}.`]];
  return `<div class="whybox">${lines.map(([tone, text]) =>
    `<div class="whyline ${tone}">${text}</div>`).join('')}</div>`;
}

function p1LayoutHand() {
  const hand = $('#p1Hand');
  const cards = [...hand.querySelectorAll('.dcard')];
  const n = cards.length;
  if (!n) return;

  const cs = getComputedStyle(hand);
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const TILT = 7;
  const rad = TILT * Math.PI / 180;
  const tiltRoom = 2 * (132 * (1 - Math.cos(rad)) + 184 * Math.sin(rad));
  const room = Math.max(240, hand.clientWidth - pad - tiltRoom);
  let cw = 132;
  let step = n > 1 ? (room - cw) / (n - 1) : cw;
  if (step < cw * 0.34) {
    // shrink the cards until a third of each stays visible, then accept it
    cw = Math.max(74, room / (1 + (n - 1) * 0.34));
    step = n > 1 ? (room - cw) / (n - 1) : cw;
  }
  step = Math.min(step, cw + 8);

  const mid = (n - 1) / 2;
  cards.forEach((el, i) => {
    const d = mid ? (i - mid) / mid : 0;        // -1 at the left edge, +1 at the right
    el.style.setProperty('--cw', cw.toFixed(1) + 'px');
    el.style.setProperty('--overlap', (i ? step - cw : 0).toFixed(1) + 'px');
    el.style.setProperty('--tilt', (d * 7).toFixed(2) + 'deg');
    el.style.setProperty('--lift', (Math.abs(d) * Math.abs(d) * 16).toFixed(1) + 'px');
    el.style.zIndex = String(i + 1);
  });
}

let p1LayoutTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(p1LayoutTimer);
  p1LayoutTimer = setTimeout(p1LayoutHand, 120);
});

function p1TitleFace() {
  const t = $('#p1Title');
  if (!t) return;
  t.textContent = P1_PACKNO
    ? `Pack ${P1_PACKNO}, pick 1 \u2014 passing ${passDir()}`
    : 'Pack 1, pick 1';
}

/* A card big enough to actually read, over everything else. Clicking anywhere
   off the card closes it, as does Escape; taking the card from here is the same
   pick as double-clicking it in the hand. */
let P1_ZOOM = null;
function p1Zoom(card) {
  if (!card) return;
  p1Unzoom();
  hideCard();                            // the small hover preview gets out of the way
  const veil = document.createElement('div');
  veil.className = 'zoomveil';
  veil.innerHTML = `<figure>
      ${card.image
        ? `<img src="${esc(card.image)}" alt="${esc(card.name)}">`
        : `<div class="zname">${esc(card.name)}</div>`}
      <div class="zname">${esc(card.name)}</div>
      ${P1_PACK.some(c => c.oracle_id === card.oracle_id)
        ? `<button class="ztake">Take this card</button>
           <div class="zhint">or double-click it in the hand \u00b7 Esc to close</div>`
        : '<div class="zhint">Esc or click away to close</div>'}
    </figure>`;
  veil.addEventListener('click', e => {
    // only a click on the card itself is not a dismissal
    if (e.target.closest('.ztake')) {
      const el = $('#p1Hand').querySelector(`[data-pick="${CSS.escape(card.oracle_id)}"]`);
      p1Unzoom();
      if (el) p1Take(card.oracle_id, el);
      return;
    }
    if (!e.target.closest('img')) p1Unzoom();
  });
  document.body.appendChild(veil);
  P1_ZOOM = veil;
}
function p1Unzoom() {
  if (P1_ZOOM) { P1_ZOOM.remove(); P1_ZOOM = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') p1Unzoom(); });

function p1DeckFace() {
  const d = $('#p1Deck');
  d.innerHTML = `<b>${P1_TAKEN.length}</b><span>pick${P1_TAKEN.length === 1 ? '' : 's'}</span>`;
  $('#p1DeckHint').textContent = P1_TAKEN.length ? 'click to look' : 'picks go here';
}

function p1Tableau(toggle) {
  const box = $('#p1Tableau');
  if (!P1_TAKEN.length) { box.innerHTML = ''; box.dataset.open = '0'; return; }
  if (toggle) {
    if (box.dataset.open === '1') { box.dataset.open = '0'; box.innerHTML = ''; return; }
    box.dataset.open = '1';
  } else if (box.dataset.open !== '1') {
    return;                      // closed stays closed; this is just a refresh
  }
  box.innerHTML = `<h3 class="sec">Your picks so far</h3>
    <div class="tableau">${P1_TAKEN.map(c => cardFace(c)).join('')}</div>`;
  box.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.pick);
    el.removeAttribute('data-pick');
    el.onclick = () => p1Zoom(card);
  });
}

function p1Deal() {
  const size = Math.max(3, Math.min(30, parseInt($('#p1Size').value, 10) || 15));
  const pool = (P1.cards || []).slice();
  // a real pack is a random draw from the whole list, lands and all - filtering
  // them out would flatter the tool by removing the picks people argue about
  const pack = [];
  for (let i = 0; i < size && pool.length; i++) {
    pack.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  P1_PACK = pack;
  P1_PICK = null;
  P1_REVEALED = false;
  $('#p1Reveal').textContent = 'Show the numbers';
  P1_PACKNO += 1;
  p1TitleFace();
  $('#p1Reveal').disabled = true;
  $('#p1Out').innerHTML = '';
  p1DrawHand();
  p1DeckFace();
  p1Watchlist();
}

const p1Sign = v => (v > 0 ? '+' : '') + v.toFixed(1);

/* The wheel. With P players the pack you pass comes back after P picks, so a
   pack of N returns with N - P left. That is what makes a first pick hard: the
   question is not "which is best" but "which will still be here next time".

   The other drafters are modelled as playing PERFECTLY - each takes the best
   card left by this page's ranking. That is deliberately the worst case for
   you. Real tables are softer, so a card marked gone may well come back; a card
   marked "should wheel" is one you can pass with confidence. */
function p1Wheel() {
  const players = Math.max(2, Math.min(12, parseInt($('#p1Players').value, 10) || 8));
  const size = P1_PACK.length;
  return {players, size, wheels: size > players, left: Math.max(0, size - players)};
}

function p1Render() {
  if (!P1_PACK.length) return;
  const ranked = P1_PACK.slice().sort((a, b) => b.score - a.score);
  const rankOf = c => ranked.findIndex(x => x.oracle_id === c.oracle_id) + 1;
  const best = ranked[0];

  const head = P1_REVEALED
    ? (() => {
        const mine = P1_PACK.find(c => c.oracle_id === P1_PICK);
        const r = rankOf(mine);
        const agree = r === 1;
        return `<div class="note">You took <b>${esc(mine.name)}</b> —
          ${agree ? '<span class="badge good">the numbers agree</span>'
                  : `the numbers rank it <b>${r}</b> of ${P1_PACK.length}, behind
                     <b>${esc(best.name)}</b>`}.
          ${agree ? '' : `<br>That gap is <b>${(best.score - mine.score).toFixed(1)}</b> points,
             almost all of it ${p1Why(best, mine)}.`}</div>`;
      })()
    : `<div class="note">${P1_PICK ? 'Picked. Press “Show the numbers”.'
        : 'Click the card you would take.'}</div>`;

  const w = p1Wheel();
  // worst case: the other seats take the top-ranked cards before it returns
  const wheelCell = rank => {
    if (!w.wheels) return '<span class="dim">no wheel</span>';
    const taken = w.players - 1;
    if (rank <= taken) return '<span class="badge bad">gone</span>';
    if (rank <= taken + 2) return '<span class="badge warn">close</span>';
    return '<span class="badge good">should wheel</span>';
  };

  const rows = (P1_REVEALED ? ranked : P1_PACK).map(c => {
    const picked = c.oracle_id === P1_PICK;
    return `<tr class="${picked ? 'me' : ''}">
      ${P1_REVEALED ? `<td class="num">${rankOf(c)}</td>` : ''}
      <td class="name"><span data-oracle="${esc(c.oracle_id)}">${esc(c.name)}</span>
        ${picked ? ' <span class="badge">your pick</span>' : ''}
        <div class="mini dim">${esc((c.type_line || '').split(' —')[0])}</div></td>
      <td>${ciCell(c.color_identity)}</td>
      <td class="num">${c.cmc ?? '—'}</td>
      ${true ? `
        <td>${wheelCell(rankOf(c))}</td>
        <td class="num">${c.score.toFixed(1)}</td>
        <td class="num">${p1Sign(c.lane)}</td>
        <td class="num">${c.open.toFixed(0)}</td>
        <td class="num">${c.synergy.toFixed(0)}</td>`
      : ''}
    </tr>`;
  }).join('');

  if (!P1_REVEALED) { $('#p1Out').innerHTML = ''; return; }
  $('#p1Out').innerHTML = head + `<table><thead><tr>
      ${P1_REVEALED ? '<th class="num">#</th>' : ''}
      <th>Card</th><th>CI</th><th class="num">MV</th>
      ${P1_REVEALED
        ? `<th>Comes back?</th><th class="num">Pick score</th><th class="num">Lane record</th>
           <th class="num">Keeps options open</th><th class="num">Cube pull</th>`
        : '<th data-nosort></th>'}
    </tr></thead><tbody>${rows}</tbody></table>`
    + (P1_REVEALED ? `<p class="note">With <b>${w.players}</b> players, this pack comes back to you
        at pick ${w.players + 1}${w.wheels
          ? ` with <b>${w.left}</b> cards left in it` : ' — except it does not, because the pack runs out first'}.
        <b>Comes back?</b> assumes every other seat drafts perfectly — each takes the best card
        left by this ranking. That is the worst case on purpose: real tables are softer, so a card
        marked <span class="badge bad">gone</span> may still come back, while one marked
        <span class="badge good">should wheel</span> is safe to pass.</p>
      <p class="note"><b>Lane record</b> is the colours' record at your table against the
        ${P1.lane_baseline}% average — the only measured number here, and it rests on a few dozen
        matches. <b>Keeps options open</b> matters for this pick and no other.
        <b>Cube pull</b> is how much the rest of the cube wants to sit beside it.</p>` : '');

  if (P1_PICK) {
    const mine = P1_PACK.find(c => c.oracle_id === P1_PICK);
    $('#p1Out').insertAdjacentHTML('beforeend', p1Partners(mine));
  }

  sortable('#p1Out');
}

// What the pick opens up. A first pick is the start of a plan, so the useful
// follow-up is not "was that the best card" but "what does the rest of the cube
// want to put beside it" - the lift pairs answer exactly that.
function p1Partners(card) {
  if (!card) return '';
  const ps = card.partners || [];
  if (!ps.length) {
    return `<p class="note"><b>${esc(card.name)}</b> has no above-chance partners in the cube —
      it is a card you play because it is good, not because of what it combines with.</p>`;
  }
  return `<h3 class="sec">What ${esc(card.name)} opens up</h3>
    <p class="note">Cards the rest of the cube most wants beside this one, by
      <b>lift</b> — how much more often decks play the two together than their individual
      popularity predicts. Read it with the deck count: a huge lift over a handful of decks is
      an anecdote, not a plan. None of these are guaranteed to reach you; that is what the
      draft odds on the other tab are for.</p>
    <table><thead><tr><th>Then look for</th><th class="num">Lift</th>
      <th class="num">Decks together</th><th>Type</th><th>Why</th></tr></thead><tbody>
      ${ps.map(p => `<tr>
        <td class="name"><span data-oracle="${esc(p.oracle_id)}">${esc(p.name)}</span></td>
        <td class="num">${(p.lift || 0).toFixed(1)}×</td>
        <td class="num">${(p.played_together || 0).toLocaleString()}</td>
        <td><span class="badge">${esc(p.kind || '')}</span></td>
        <td class="dim">${p.hint ? esc(p.hint) : '—'}</td>
      </tr>`).join('')}</tbody></table>`;
}

// which component actually separated the two cards
function p1Why(best, mine) {
  const parts = [
    ['the colours’ record here', 2.0 * (best.lane - mine.lane)],
    ['how little it commits you', 0.35 * (best.open - mine.open)],
    ['how much the cube wants it', 0.35 * (best.synergy - mine.synergy)],
  ].sort((a, b) => b[1] - a[1]);
  return parts[0][0];
}

/* ── keep a look out for ──
   The running answer to "what should I be taking next". It is the union of the
   lift partners of everything you have taken, so it sharpens as the draft goes
   on: one pick gives you that card's partners, four picks give you the cards
   several of them point at, which is a far stronger signal than any single pair.
   Cards already taken drop off. */
// Not every high-lift pair is advice. Decks that play one cheap burn spell play
// the others, so lift happily reports Shock next to Lightning Strike - a true
// correlation and a useless suggestion. The pair KIND separates the two: some
// kinds describe an interaction, the rest only say "these are the same sort of
// card", which is a reason they share decks, not a reason to draft both.
const PAIR_WEIGHT = {
  engine: 1.0, archetype: 0.9, tutors: 0.9, typal: 0.8, tokens: 0.8,
  general: 0.5,
  // same-type and same-role pairings: redundancy, not synergy
  creatures: 0.2, instants: 0.2, sorceries: 0.2, 'creature removal': 0.2,
  'card draw': 0.2, enchantments: 0.2, artifacts: 0.2, planeswalkers: 0.2,
};
const pairWeight = k => (k in PAIR_WEIGHT ? PAIR_WEIGHT[k] : 0.5);

function p1Watchlist() {
  const box = $('#p1Watch');
  if (!box) return;
  if (!P1_TAKEN.length) {
    box.innerHTML = '<span class="dim">Take a card and this fills with what to watch for.</span>';
    return;
  }
  const taken = new Set(P1_TAKEN.map(c => c.oracle_id));
  const want = {};
  P1_TAKEN.forEach(mine => {
    (mine.partners || []).forEach(p => {
      if (taken.has(p.oracle_id)) return;
      const w = want[p.oracle_id] || (want[p.oracle_id] = {
        oracle_id: p.oracle_id, name: p.name, lift: 0, weighted: 0, decks: 0,
        from: [], kind: p.kind});
      // several of your picks pointing at the same card is the real signal, so
      // pulls are summed rather than maxed
      w.lift += p.lift || 0;
      w.weighted += (p.lift || 0) * pairWeight(p.kind);
      w.decks = Math.max(w.decks, p.played_together || 0);
      w.from.push(mine.name);
      if (pairWeight(p.kind) > pairWeight(w.kind)) w.kind = p.kind;
    });
  });

  // your colours so far, to say whether a card is even castable in this deck
  const mineColours = {};
  P1_TAKEN.forEach(c => [...(c.color_identity || '')].forEach(x => {
    mineColours[x] = (mineColours[x] || 0) + 1;
  }));
  const main = Object.entries(mineColours).sort((a, b) => b[1] - a[1])
    .slice(0, 2).map(x => x[0]).join('');

  const rows = Object.values(want)
    .sort((a, b) => b.weighted - a.weighted || b.from.length - a.from.length)
    .slice(0, 15);

  box.innerHTML = rows.length ? `<table><thead><tr>
      <th>Keep a look out for</th><th>Why it pairs</th><th class="num">Pulled by</th>
      <th class="num">Lift</th><th>Fits your colours</th><th>Because of</th></tr></thead><tbody>
      ${rows.map(w => {
        const card = p1Card(w.oracle_id) || {};
        const ci = card.color_identity || '';
        const castable = !ci || [...ci].every(x => main.includes(x));
        return `<tr>
          <td class="name"><span data-oracle="${esc(w.oracle_id)}">${esc(w.name)}</span>
            <div class="mini dim">${esc((card.type_line || '').split(' —')[0])}</div></td>
          <td><span class="badge">${esc(w.kind || 'general')}</span></td>
          <td class="num">${w.from.length}</td>
          <td class="num">${w.lift.toFixed(1)}×</td>
          <td>${ciCell(ci)} ${castable ? '<span class="badge good">yes</span>'
                                       : '<span class="badge">needs a splash</span>'}</td>
          <td class="dim mini">${w.from.map(esc).join(', ')}</td>
        </tr>`;
      }).join('')}</tbody></table>
      <p class="note">Ranked by lift weighted by <b>why it pairs</b>. Cards that merely share a
      type or a role are pushed down: decks that play one cheap burn spell play the others, so
      lift reports Shock beside Lightning Strike — true, and not a reason to draft both. Pairs
      that describe an actual interaction (engine, archetype, typal) rank above them.
      <b>Fits your colours</b> reads off the two colours you have most of so far —
      ${main ? `<b>${esc(main)}</b>` : 'nothing yet'} — and is the only thing here that knows
      what deck you are building. Nothing on this list is guaranteed to come round; it says
      what to take when it does.</p>`
    : '<span class="dim">Nothing in the cube pairs above chance with what you have taken.</span>';
  sortable('#p1Watch');
}

$('#p1Restart').onclick = () => {
  P1_TAKEN = [];
  P1_PACK = [];
  P1_PICK = null;
  P1_REVEALED = false;
  $('#p1Reveal').disabled = true;
  $('#p1Reveal').textContent = 'Show the numbers';
  P1_PACKNO = 0;
  p1TitleFace();
  $('#p1Out').innerHTML = '';
  $('#p1Tableau').innerHTML = '';
  $('#p1Tableau').dataset.open = '0';
  p1DrawHand();
  p1DeckFace();
  p1Watchlist();
};

$('#p1Deal').onclick = async () => {
  $('#p1Out').innerHTML = '<span class="dim">dealing…</span>';
  await p1Data();
  if (P1.error) return $('#p1Out').innerHTML = `<span class="badge bad">${esc(P1.error)}</span>`;
  p1Deal();
};
$('#p1Reveal').onclick = () => {
  P1_REVEALED = !P1_REVEALED;
  p1Render();
  $('#p1Reveal').textContent = P1_REVEALED ? 'Hide the numbers' : 'Show the numbers';
  if (P1_REVEALED) {
    const box = $('#p1Out');
    if (box.getBoundingClientRect().top > window.innerHeight - 120) {
      box.scrollIntoView({behavior: 'smooth', block: 'start'});
    }
  }
};
$('#p1Deck').onclick = () => p1Tableau(true);
$('#p1Deck').onkeydown = e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p1Tableau(true); }
};

/* ── propose a change ──
   Every add is a cut, so the tab answers whichever half you supply. Both
   directions hold the slot, which is what makes the answer a swap. */
const swapDelta = d => {
  const groups = Object.entries(d || {});
  if (!groups.length) return '<span class="badge good">changes nothing</span>';
  return groups.map(([g, moved]) => `<span class="mini">${esc(
    {by_colour: 'colours', curve: 'curve', by_type: 'types'}[g] || g)}: ${
    Object.entries(moved).map(([k, v]) => `${esc(k)} ${v > 0 ? '+' : ''}${v}`).join(', ')
  }</span>`).join('<br>');
};

async function swapRun(params) {
  $('#swapOut').innerHTML = '<span class="dim">thinking…</span>';
  const cube_id = $('#cubeSel').value || (LOADED_CUBES[0] || {}).id;
  const d = await (await fetch('/api/cube/propose?'
    + new URLSearchParams(Object.assign({cube_id}, params)))).json();
  if (d.error) return $('#swapOut').innerHTML = `<span class="badge bad">${esc(d.error)}</span>`;

  if (d.mode === 'cut') {
    $('#swapOut').innerHTML = `<p class="note">Putting <b>${esc(d.adding.name)}</b>
      (${esc(d.slot.colors || 'colourless')}, mana value ${d.slot.cmc}, ${esc(d.slot.type)}) in
      means taking one of these out. ${d.considered} cards in the cube fill that same slot,
      least-connected first.</p>
      <table><thead><tr><th data-filter="text">Least missed</th><th class="num">MV</th>
        <th class="num" data-filter="min">Cube connection</th><th class="num">Others doing its job</th>
        <th data-filter="text">Why it is least missed</th><th>Effect on the cube</th>
      </tr></thead><tbody>${d.candidates.map(c => `<tr>
        <td class="name"><span data-oracle="${esc(c.oracle_id)}">${esc(c.name)}</span>
          <div class="mini dim">${esc((c.type_line || '').split(' —')[0])}</div></td>
        <td class="num">${c.cmc ?? '—'}</td>
        <td class="num">${c.connected}</td>
        <td class="num">${c.others_doing_its_job || '—'}</td>
        <td class="dim">${c.why.length ? esc(c.why.join('; ')) : 'nothing stands out'}</td>
        <td>${swapDelta(c.delta)}</td>
      </tr>`).join('')}</tbody></table>`;
  } else {
    $('#swapOut').innerHTML = `<p class="note">Taking <b>${esc(d.removing.name)}</b> out leaves a
      ${esc(d.slot.colors || 'colourless')} slot at mana value ${d.slot.cmc}.
      ${d.considered ? `${d.considered} ${esc(d.format)}-legal cards fit it; these are the ones`
                     : `These are the ${esc(d.format)}-legal cards filling that slot that`}
      the rest of the cube pulls toward hardest.</p>
      <table><thead><tr><th data-filter="text">Put this in</th><th class="num">MV</th>
        <th class="num" data-filter="min">Cube pull</th><th class="num">Completes</th>
        <th data-filter="text">Because it pairs with</th><th>Effect on the cube</th>
      </tr></thead><tbody>${d.candidates.map(c => `<tr>
        <td class="name"><span data-oracle="${esc(c.oracle_id)}">${esc(c.name)}</span>
          <div class="mini dim">${esc((c.type_line || '').split(' —')[0])}</div></td>
        <td class="num">${c.cmc ?? '—'}</td>
        <td class="num">${c.pull}</td>
        <td class="num">${c.completes_combos || '—'}</td>
        <td class="dim mini">${(c.partners || []).filter(p => p.name)
          .map(p => (p.oracle_id ? `<span data-oracle="${esc(p.oracle_id)}">${esc(p.name)}</span>`
                                 : `<span data-card="${esc(p.name)}">${esc(p.name)}</span>`)
                    + (p.lift ? ` ${p.lift}×` : ''))
          .join(', ') || '—'}</td>
        <td>${swapDelta(c.delta)}</td>
      </tr>`).join('')}</tbody></table>`;
  }
  sortable('#swapOut');
  filterable('#swapOut');
}

$('#swapAddGo').onclick = () => {
  const v = $('#swapAdd').value.trim();
  if (v) swapRun({add: v});
};
$('#swapRemoveGo').onclick = () => {
  const v = $('#swapRemove').value.trim();
  if (v) swapRun({remove: v});
};
$('#swapAdd').onkeydown = e => { if (e.key === 'Enter') $('#swapAddGo').click(); };
$('#swapRemove').onkeydown = e => { if (e.key === 'Enter') $('#swapRemoveGo').click(); };
attachTypeahead('#swapAdd', 'card', () => {});
attachTypeahead('#swapRemove', 'card', () => {});

document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b));
  ['cube', 'p1p1', 'swap'].forEach(t => $('#tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
  explain();
});

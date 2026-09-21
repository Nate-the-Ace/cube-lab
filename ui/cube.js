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
      holds. <b>Measured</b> is how the lane has actually performed in recorded games.
      <b>Opportunity</b> is the two multiplied — depth counts for nothing if the lane keeps losing.
      This used to be depth × EDHREC play rate, which ranked these ten lanes almost exactly
      backwards against the cube's own results (Spearman −0.32): Boros came last on play rate and third
      on games won. Popularity in multiplayer Commander is not a claim about a Pioneer cube, so it
      is gone from the page.
      ${(opp && opp.has_local)
        ? `<b>Measured</b> is what this table has actually done with the lane, from the game-night
           records — the only signal here drawn from this cube rather than someone else's format.
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
$('#p1Share') && ($('#p1Share').onclick = async () => {
  p1WriteUrl();
  const url = location.href;
  const btn = $('#p1Share');
  const said = t => { btn.dataset.said = t; setTimeout(() => delete btn.dataset.said, 1400); };
  try {
    await navigator.clipboard.writeText(url);
    said('copied');
  } catch (e) {
    // clipboard needs a secure context, and this page is often opened from a file
    said('in the address bar');
  }
});

$('#p1Seed') && ($('#p1Seed').onchange = e => {
  const want = e.target.value.trim();
  if (!want || want.toLowerCase() === P1_SEED) return;
  $('#p1Restart').onclick();          // a different seed is a different cube cut
  p1SetSeed(want, true);              // the restart made its own; this one wins,
  p1CutCube();                        // and it locks the seats it was cut for
  p1Boosters();
  p1DrawHand();
});

$('#p1HandSort') && $('#p1HandSort').addEventListener('change', e => {
  P1_HAND_SORT = e.target.value;
  p1DrawHand();
});

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
   Draft the cube: take a card, the other seats take theirs, the packs move on.
   The point is the disagreement: the score deliberately contains no measure of
   raw card power (see pick_scores in cube.py), so where it is wrong it should
   be obviously wrong, and you should be able to see which component did it. */
let P1 = null, P1_PACK = [], P1_PICK = null;
const P1_NUM_KEY = 'p1-numbers-open';
// what you have taken across the whole session, so the watchlist can grow with
// the draft instead of resetting every pack
let P1_TAKEN = [];
let P1_PACKNO = 0, P1_ANIMATING = false;
let P1_PACKS = [], P1_PICKNO = 0;
// which of the three have been opened, in whatever order they were chosen
let P1_OPENED = new Set();
// the cube cut into 36 packs, which three are yours, and which the table used
let P1_ALL = [], P1_CHOSEN = [], P1_SPENT = new Set(), P1_ART = {};
let P1_PICK_LOG = [];          // each pick's place in the cube list, so a
                               // shared link resolves without replaying a draft
// every card this draft has already dealt, so no card is opened twice
let P1_USED = new Set();
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
    ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">`
    : `<span>${esc(c.name)}</span>`;
  return `<div class="${cls}" data-oracle="${esc(c.oracle_id)}"
    data-pick="${esc(c.oracle_id)}" role="button" tabindex="0"
    aria-label="${esc(c.name)}">${face}</div>`;
}

/* Ordering the pack in your hand.

   The pack arrives in the order it was opened and that is the honest default -
   a real pack has no order, and seeing it shuffled into a ranking every time
   would answer the question the tab exists to ask. Every other ordering is a
   way of reading the same fifteen cards: what the numbers would take, what
   fits what you already have, and the plain ones a person sorts by at a table.
   Sorting only ever reorders the RENDER; P1_PACK keeps the order it was dealt
   in, so "as dealt" always comes back. */
const CI_ORDER = 'WUBRG';
const ciRank = c => {
  const ci = c.color_identity || '';
  if (!ci) return 99;                       // colourless last
  if (ci.length > 1) return 90;             // gold after the mono colours
  return CI_ORDER.indexOf(ci[0]);
};

/* What each role is FOR, said in the hand rather than left to the label.

   The role names are short enough to be ambiguous at a glance - "Tokens" is a
   plan, not a card type - so each group says what it does for you underneath,
   above the rule that marks where it ends. */
const ROLE_DOES = {
  'Removal': 'answers what they played',
  'Creature': 'attacks, blocks, holds the board',
  'Land': 'fixes your colours and fuels the curve',
  'Card draw': 'refills your hand',
  'Tokens': 'makes bodies out of nothing',
  'Ramp': 'more mana, sooner',
  'Counterspell': 'stops it before it happens',
  'Planeswalker': 'value every turn it survives',
  'Instant': 'a trick, on their turn',
  'Sorcery': 'a one-shot effect, on yours',
  'Enchantment': 'an effect that stays on the table',
  'Artifact': 'colourless, and stays on the table',
  'Other': 'does its own thing',
};

// how many of this cube's cards each painter has, which is the line an artist
// run shows - the meta answer to "who is this pack by"
function p1ArtistCount(name) {
  if (!P1_ART_N) {
    P1_ART_N = {};
    ((P1 && P1.cards) || []).forEach(c => {
      if (c.artist) P1_ART_N[c.artist] = (P1_ART_N[c.artist] || 0) + 1;
    });
  }
  return P1_ART_N[name] || 0;
}
let P1_ART_N = null;

const P1_HAND_SORTS = {
  deal: {label: 'as dealt', by: null},
  score: {label: 'pick score', by: (a, b) => b.score - a.score},
  fit: {label: 'fit with your picks', by: (a, b) => p1DeckFit(b) - p1DeckFit(a)
        || b.score - a.score},
  colour: {label: 'colour', by: (a, b) => ciRank(a) - ciRank(b)
           || (a.cmc || 0) - (b.cmc || 0)},
  mv: {label: 'mana value', by: (a, b) => (a.cmc || 0) - (b.cmc || 0)},
  name: {label: 'name', by: (a, b) => a.name.localeCompare(b.name)},
  role: {label: 'what it does', by: (a, b) =>
         (a.role || 'Other').localeCompare(b.role || 'Other') || b.score - a.score,
         groupBy: c => c.role || 'Other',
         does: k => ROLE_DOES[k] || ROLE_DOES.Other},
  artist: {label: 'artist', by: (a, b) =>
           (a.artist || '').localeCompare(b.artist || '') || a.name.localeCompare(b.name),
           groupBy: c => c.artist || 'Unknown',
           does: k => {
             const n = p1ArtistCount(k);
             return n ? `${n} card${n === 1 ? '' : 's'} in this cube` : 'not in the cube';
           }},
};
let P1_HAND_SORT = 'deal';

/* Sorting by painter is only worth offering when it would actually gather
   something. Most packs are fifteen cards by fifteen different artists, and
   grouping gives you fifteen runs of one - the same fan, with names under it.
   So the option appears only when some painter has more than one card in the
   pack in your hand, and a pack that loses its last pair drops back to the
   order it was dealt in rather than staying on a sort that no longer groups. */
function p1ArtistPairs(pack) {
  const n = {};
  (pack || []).forEach(c => { if (c.artist) n[c.artist] = (n[c.artist] || 0) + 1; });
  return Object.values(n).some(v => v > 1);
}

function p1SyncSortOptions() {
  const sel = $('#p1HandSort');
  if (!sel) return;
  const opt = [...sel.options].find(o => o.value === 'artist');
  if (!opt) return;
  const worth = p1ArtistPairs(P1_PACK);
  opt.hidden = !worth;
  opt.disabled = !worth;
  if (!worth && P1_HAND_SORT === 'artist') P1_HAND_SORT = 'deal';
  sel.value = P1_HAND_SORT;
}

function p1SortedPack() {
  const s = P1_HAND_SORTS[P1_HAND_SORT];
  if (!s || !s.by) return P1_PACK.slice();
  // ties fall back to the dealt order rather than whatever sort() feels like
  const at = new Map(P1_PACK.map((c, i) => [c.oracle_id, i]));
  return P1_PACK.slice().sort((a, b) => s.by(a, b)
    || at.get(a.oracle_id) - at.get(b.oracle_id));
}

/* Which run is raised, latched rather than left to :hover.

   Two rules that CSS alone cannot hold at once: a run rises only when you point
   at its NAME - pointing at a card is for looking at that one card - but once it
   is up it has to stay up while you move onto its cards.

   Between the two there are gaps with nothing under the pointer: the cards have
   moved 26px clear of where they sat, the strip they left is covered by dimmed
   cards from other runs which are deliberately inert, and the name itself is a
   line of text with room above it. Leaving and re-entering fires mouseleave
   every time. So the latch does not ask what the pointer is OVER at all - it
   asks where the pointer IS, and holds the run while it is anywhere near the
   run's own cards and name. Nothing to cross, so nothing to fall through. */
const RUN_MARGIN = 56;
let P1_UP = null, P1_UP_MOVE = null;

function p1RunBox(g) {
  const parts = [...g.querySelectorAll('.dcard'), g.querySelector('.glabel')]
    .filter(Boolean).map(el => el.getBoundingClientRect());
  if (!parts.length) return null;
  return {
    left: Math.min(...parts.map(r => r.left)) - RUN_MARGIN,
    right: Math.max(...parts.map(r => r.right)) + RUN_MARGIN,
    top: Math.min(...parts.map(r => r.top)) - RUN_MARGIN,
    bottom: Math.max(...parts.map(r => r.bottom)) + RUN_MARGIN,
  };
}

function p1RaiseRun(g) {
  if (P1_UP === g) return;
  if (P1_UP) P1_UP.classList.remove('up');
  P1_UP = g;
  if (g) g.classList.add('up');
  if (g && !P1_UP_MOVE) {
    P1_UP_MOVE = e => {
      if (!P1_UP) return;
      const b = p1RunBox(P1_UP);
      if (!b) return;
      if (e.clientX < b.left || e.clientX > b.right
          || e.clientY < b.top || e.clientY > b.bottom) p1DropRun();
    };
    document.addEventListener('mousemove', P1_UP_MOVE);
  }
  if (!g) p1DropRun();
}

function p1DropRun() {
  if (P1_UP) P1_UP.classList.remove('up');
  P1_UP = null;
  if (P1_UP_MOVE) {
    document.removeEventListener('mousemove', P1_UP_MOVE);
    P1_UP_MOVE = null;
  }
}

/* Someone sent you their draft. The seed already put their packs on your table;
   this says what they took out of them, which is the part worth arguing about.
   It sits beside your own draft rather than replacing it - the point is to
   compare, and you cannot compare with only one pool on screen. */
function p1SharedPicks() {
  const box = $('#p1Shared');
  if (!box) return;
  const want = p1Link().picks;
  const cards = want.map(i => (P1 && P1.cards || [])[i]).filter(Boolean);
  if (!cards.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;

  const lanes = {};
  cards.forEach(c => [...(c.color_identity || 'C')].forEach(x => {
    lanes[x] = (lanes[x] || 0) + 1;
  }));
  const main = Object.entries(lanes).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(x => x[0]).join('');

  box.innerHTML = `<div class="row"><strong>From the link</strong>
      <span class="mini dim">${cards.length} pick${cards.length === 1 ? '' : 's'}
        from this seed${main ? ', mostly ' + esc(ciName(main)) : ''}</span>
      <span class="spacer"></span>
      <button id="p1ShareClear" class="mini">clear</button></div>
    <div class="stacks"><div class="stack"><div class="pile">${
      cards.map(c => cardFace(c)).join('')}</div></div></div>`;
  box.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.pick);
    el.removeAttribute('data-pick');
    el.onclick = () => p1Zoom(card);
  });
  $('#p1ShareClear').onclick = () => {
    p1Link().picks = [];
    p1WriteUrl();
    p1SharedPicks();
  };
}

function p1WireRuns(hand) {
  hand.querySelectorAll('.handgroup').forEach(g => {
    const label = g.querySelector('.glabel');
    if (!label) return;
    label.addEventListener('mouseenter', () => p1RaiseRun(g));
    label.addEventListener('focus', () => p1RaiseRun(g));
    label.addEventListener('blur', () => p1DropRun());
  });
}

function p1DrawHand() {
  const hand = $('#p1Hand');
  const sortWrap = $('#p1SortWrap');
  if (sortWrap) sortWrap.hidden = !P1_PACK.length;
  if (!P1_PACK.length) {
    const left = 3 - P1_CHOSEN.length;
    hand.innerHTML = `<span class="dim">${
      !P1_ALL.length ? 'Cutting the cube into packs\u2026'
      : left > 0
        ? `The cube, cut into ${P1_ALL.length} packs. Choose <b>${left}</b> more.`
        : ''}</span>`;
    return;
  }
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
        title="${esc(g.key)} \u2014 ${esc(sorter.does(g.key))}"
        ><b>${esc(g.key)}</b> <span>${g.cards.length}</span>
        <em>${esc(sorter.does(g.key))}</em></span></span>
    </div>`).join('');
  } else {
    hand.innerHTML = inOrder.map(c => cardFace(c)).join('');
  }
  if (grouped) p1WireRuns(hand);
  p1LayoutHand();
  p1MarkBest();
  p1MarkWanted();
  $('#p1PassL').textContent = '';
  $('#p1PassR').textContent = '';
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
    p1Swipe(el, card);
  });
}

/* Taking a card: it flies to the deck, the rest of the pack leaves toward the
   seat we pass to, and only then does the table settle. The numbers are left
   folded by default, because the point of the tab is to pick first. */
function p1Take(oid, el) {
  if (P1_ANIMATING) return;
  const card = p1Card(oid);
  if (!card) return;
  P1_ANIMATING = true;
  p1Unzoom();
  P1_PICK = oid;
  if (!P1_TAKEN.some(c => c.oracle_id === oid)) {
    P1_TAKEN.push(card);
    const at = (P1.cards || []).findIndex(c => c.oracle_id === oid);
    if (at >= 0) P1_PICK_LOG.push(at);
    p1WriteUrl();
  }

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
    $('#p1Hand').classList.remove('busy');
    p1Render();                  // ranks the pick against the pack it came from
    // only then does the card leave the pack, before the packs move on
    const held = P1_PACKS[0] || [];
    const at = held.findIndex(c => c.oracle_id === oid);
    if (at >= 0) held.splice(at, 1);
    p1DeckFace();
    p1Tableau();                 // keep an open tableau in step with the deck
    p1Watchlist();
    p1NextPack();
  };
  $('#p1Hand').classList.add('busy');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(settle, reduced ? 20 : 370);
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

/* A card off the want list has just been dealt to you. The star already says
   what the numbers would take; this says "and this is the one you were waiting
   for", which is a different claim and often a different card. It bounces once
   on arrival because the whole point is that you were not looking for it. */
function p1MarkWanted() {
  const hand = $('#p1Hand');
  if (!hand) return;
  const {rows} = p1Wanted();
  if (!rows.length) return;
  const rank = {};
  rows.forEach((w, i) => { rank[w.oracle_id] = {n: i + 1, w}; });
  hand.querySelectorAll('.dcard').forEach(el => {
    const hit = rank[el.dataset.oracle];
    if (!hit) return;
    el.classList.add('wanted');
    el.insertAdjacentHTML('beforeend',
      `<span class="wantmark" title="${esc('No. ' + hit.n + ' on your want list \u2014 '
        + hit.w.lift.toFixed(0) + '\u00d7 with ' + hit.w.from.slice(0, 2).join(', ')
        + (hit.w.castable ? '' : ', but you would have to splash for it'))}">\u25c6</span>`);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.animate([
      {transform: 'translateY(0)'},
      {transform: 'translateY(-14px)', offset: .3},
      {transform: 'translateY(0)', offset: .55},
      {transform: 'translateY(-6px)', offset: .75},
      {transform: 'translateY(0)'},
    ], {duration: 820, delay: 260 + (hit.n - 1) * 90, easing: 'cubic-bezier(.3,.6,.4,1)',
        composite: 'add'});
  });
}

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
      + ` — ${d >= 0 ? '+' : ''}${d.toFixed(1)} against the ${base}% cube average.`]);
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
    ? `${ps.length} cube card${ps.length === 1 ? ' wants' : 's want'} to be beside it, led by `
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

/* Swipe a card up to take it.

   Double-click has no equivalent on a phone, so the gesture is the pick: drag
   the card up and it follows your finger, let go past the line and it flies to
   the deck. Everything else about the card still works - a tap zooms it.

   The page must still scroll. The gesture only takes over once the finger has
   moved further up than sideways AND past a threshold, so a scroll that happens
   to start on a card is still a scroll. */
const SWIPE_TAKE = 64;            // how far up before the card is taken

function p1Swipe(el, card) {
  if (!('ontouchstart' in window)) return;
  let x0 = 0, y0 = 0, dy = 0, locked = false, active = false;

  el.addEventListener('touchstart', e => {
    if (P1_ANIMATING || e.touches.length !== 1) return;
    active = true; locked = false; dy = 0;
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, {passive: true});

  el.addEventListener('touchmove', e => {
    if (!active) return;
    const dx = e.touches[0].clientX - x0;
    dy = e.touches[0].clientY - y0;
    if (!locked) {
      if (dy > 6 || Math.abs(dx) > Math.abs(dy)) { active = false; return; }  // a scroll
      if (dy < -10) locked = true;
      else return;
    }
    e.preventDefault();                       // now it is a pick, not a scroll
    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px) scale(${1 + Math.min(0.08, -dy / 900)})`;
    el.style.zIndex = '20';
    el.classList.toggle('willtake', dy <= -SWIPE_TAKE);
  }, {passive: false});

  const release = () => {
    if (!active) return;
    active = false;
    el.classList.remove('willtake');
    el.style.transition = '';
    el.style.transform = '';
    el.style.zIndex = '';
    if (locked && dy <= -SWIPE_TAKE) p1Take(el.dataset.pick, el);
  };
  el.addEventListener('touchend', release, {passive: true});
  el.addEventListener('touchcancel', release, {passive: true});
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

  /* Sorted into runs, the fan spreads to fit the names.

     What you see of a run before the next covers it is n * step, so a run whose
     name is wider than that has nowhere to put it - which is why names were
     stacking onto a second line. Widening the gap between the cards gives every
     run the room its name needs, and the fan has that room to give: it is only
     as tight as it is because it defaults to filling the width.

     It cannot always be given. A pack of twelve one-card runs wants more width
     than the table has, and past a point the cards would be slivers - so the
     spread is capped, and whatever still does not fit stacks as before. */
  const runs = [...hand.querySelectorAll('.handgroup')];
  if (runs.length > 1) {
    const need = runs.map(g => {
      const label = g.querySelector('.glabel');
      const cnt = g.querySelectorAll('.dcard').length || 1;
      if (!label) return 0;
      label.style.width = 'max-content';
      return (label.getBoundingClientRect().width + 12) / cnt;
    });
    const want = Math.max(step, ...need);
    /* Widening is paid for out of the cards' own width, and that is a bad trade
       past a point: a full 15-card pack has no slack at all - measured, buying
       enough room for "Enchantment" beside "Instant" took the cards from 132px
       down to 82px and STILL left a name stacked. So the cards may not go below
       READABLE_CW, and the fan takes whatever spread is left over. Later in a
       pack, where there are eight or ten cards and the fan is not tight, that
       is usually the whole of it and nothing stacks. */
    const READABLE_CW = 112;
    if (want > step) {
      const maxStep = Math.min(cw + 8, (room - READABLE_CW) / (n - 1));
      step = Math.max(step, Math.min(want, maxStep));
      cw = Math.min(132, Math.max(READABLE_CW, room - (n - 1) * step));
      step = Math.min(step, cw + 8);
    }
  }

  const mid = (n - 1) / 2;
  cards.forEach((el, i) => {
    const d = mid ? (i - mid) / mid : 0;        // -1 at the left edge, +1 at the right
    el.style.setProperty('--cw', cw.toFixed(1) + 'px');
    el.style.setProperty('--overlap', (i ? step - cw : 0).toFixed(1) + 'px');
    el.style.setProperty('--tilt', (d * 7).toFixed(2) + 'deg');
    el.style.setProperty('--lift', (Math.abs(d) * Math.abs(d) * 16).toFixed(1) + 'px');
    el.style.zIndex = String(i + 1);
  });

  /* The group names follow the hand rather than sitting flat under it: each
     one takes the tilt and the drop of the point in the fan its cards are
     centred on, so the run of them traces the same curve the cards do. */
  hand.querySelectorAll('.handgroup').forEach(g => {
    const own = [...g.querySelectorAll('.dcard')];
    const mine = own.map(el => cards.indexOf(el));
    if (!mine.length) return;
    const centre = mine.reduce((a, b) => a + b, 0) / mine.length;
    const d = mid ? (centre - mid) / mid : 0;
    g.style.setProperty('--gtilt', (d * 7).toFixed(2) + 'deg');
    g.style.setProperty('--glift', (Math.abs(d) * Math.abs(d) * 16).toFixed(1) + 'px');

    /* Raising a run is not enough to read it: inside the run the cards still
       overlap each other by cw - step, so a five-card run went up as a stack of
       slivers. Each card also gets the sideways push that would separate them,
       spread about the run's centre so it grows in place. It only applies while
       the run is hovered, and the run is above the rest of the fan then, so
       reaching over its neighbours is free. */
    const spread = Math.max(0, cw - step + 6);
    const gmid = (own.length - 1) / 2;
    own.forEach((el, k) => {
      el.style.setProperty('--gdx', ((k - gmid) * spread).toFixed(1) + 'px');
    });

    /* The overlap that pulls a run's first card over the last card of the run
       before it moves onto the GROUP instead. Left on the card, it made the
       cards hang outside their own group's box, and the name centred under the
       box sat off to one side of the cards it names. */
    const first = own[0];
    if (cards.indexOf(first) > 0) {
      g.style.marginLeft = (step - cw).toFixed(1) + 'px';
      first.style.setProperty('--overlap', '0px');
    } else {
      g.style.marginLeft = '0px';
    }
  });

  p1PlaceRunNames(hand);
}

/* Where a run's name goes.

   A group's BOX is a whole card wide, but the cards overlap, so all you can see
   of a run before the next one covers it is `step` per card. Centring the name
   on the box put it over the run to the right, and two one-card runs - a box
   each, overlapping by cw - step - printed their names on top of each other:
   "Enchantment" straight through "Instant".

   So each name is centred on the part of its run you can actually SEE, and then
   any that still collide drop to a second line. Two lines is the limit: below
   that is the table. */
function p1PlaceRunNames(hand) {
  const gs = [...hand.querySelectorAll('.handgroup')];
  if (!gs.length) return;
  const box = gs.map(g => g.getBoundingClientRect());

  const placed = [];
  gs.forEach((g, i) => {
    const label = g.querySelector('.glabel');
    if (!label) return;
    // visible from this run's left edge to wherever the next run starts
    const visLeft = box[i].left;
    const visRight = i + 1 < gs.length ? box[i + 1].left : box[i].right;
    const centre = (visLeft + visRight) / 2 - box[i].left;

    label.style.left = '0px';
    label.style.right = 'auto';
    label.style.width = 'max-content';
    label.style.maxWidth = 'none';
    const w = label.getBoundingClientRect().width;
    label.style.left = (centre - w / 2).toFixed(1) + 'px';

    // two lines, and a name only drops to the second if the first is taken
    const left = box[i].left + centre - w / 2;
    const row = placed.some(p => p.row === 0 && left < p.right + 6
                                 && left + w > p.left - 6) ? 1 : 0;
    label.classList.toggle('lower', row === 1);
    placed.push({row, left, right: left + w});
  });
}

let p1LayoutTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(p1LayoutTimer);
  p1LayoutTimer = setTimeout(p1LayoutHand, 120);
});

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
      <div class="zfaces">${card.image
        ? `<img src="${esc(card.image)}" alt="${esc(card.name)}">`
        : `<div class="zname">${esc(card.name)}</div>`}</div>
      ${card.image ? '' : `<div class="zname">${esc(card.name)}</div>`}
      <div class="whybox zwhy">${p1WhyLines(card).map(([tone, text]) =>
        `<div class="whyline ${tone}">${text}</div>`).join('')}</div>
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

  if (card.oracle_id) {
    cardData(card.oracle_id, true).then(d => {
      if (P1_ZOOM !== veil || !d || !d.faces || d.faces.length < 2) return;
      const box = veil.querySelector('.zfaces');
      if (!box) return;
      box.classList.add('two');
      box.innerHTML = d.faces.map((u, i) =>
        `<img src="${esc(u)}" alt="${esc(d.name)} face ${i + 1}">`).join('');
    }).catch(() => {});
  }
}
function p1Unzoom() {
  if (P1_ZOOM) { P1_ZOOM.remove(); P1_ZOOM = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') p1Unzoom(); });

function p1DeckFace() {
  const d = $('#p1Deck');
  d.innerHTML = `<b>${P1_TAKEN.length}</b><span>pick${P1_TAKEN.length === 1 ? '' : 's'}</span>`;
}

/* ── your picks ──

   A drafted pool is read by column, the way it is laid out on a table: cards
   overlap so only the title bar of each shows, grouped by whatever you are
   thinking about. Colour and mana value are the two every deckbuilder sorts by;
   role is the one that answers "do I have enough removal". */
const P1_GROUPS = {
  colour: {label: 'Colour', of: c => {
    const ci = c.color_identity || '';
    return ci.length > 1 ? 'Multicolour' : ci ? ciName(ci) : 'Colourless';
  }, order: ['White', 'Blue', 'Black', 'Red', 'Green', 'Multicolour', 'Colourless']},
  mv: {label: 'Mana value', of: c => {
    const v = Math.round(c.cmc || 0);
    return v >= 6 ? '6+' : String(v);
  }, order: ['0', '1', '2', '3', '4', '5', '6+']},
  role: {label: 'Role', of: c => c.role || 'Other',
    order: ['Removal', 'Card draw', 'Ramp', 'Tokens', 'Counterspell', 'Creature',
            'Planeswalker', 'Instant', 'Sorcery', 'Enchantment', 'Artifact',
            'Land', 'Other']},
  score: {label: 'Pick score', of: c =>
    c.score >= 50 ? 'Top picks' : c.score >= 35 ? 'Solid' : 'Filler',
    order: ['Top picks', 'Solid', 'Filler']},
  /* Stacking your picks by who painted them says nothing about the draft, which
     is exactly why it is worth having. It is not in the menu until you go
     looking - type an artist's name into the find box, or the word "artist" -
     and the wrappers are the hint: every pack is a painting, credited. */
  artist: {label: 'Artist', egg: true, of: c => c.artist || 'Unknown', order: []},
};
let P1_GROUP_BY = 'colour', P1_EGG = false;

// 203 people painted this cube; 100 of them have exactly one card in it
function p1Artists() {
  return new Set(((P1 && P1.cards) || []).map(c => (c.artist || '').toLowerCase())
    .filter(Boolean));
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

  const g = P1_GROUPS[P1_GROUP_BY] || P1_GROUPS.colour;
  const groups = {};
  P1_TAKEN.forEach(c => { (groups[g.of(c)] = groups[g.of(c)] || []).push(c); });
  const names = g.order.filter(k => groups[k])
    .concat(Object.keys(groups).filter(k => !g.order.includes(k)).sort());

  box.innerHTML = `<h3 class="sec">Your picks
      <span class="count">${P1_TAKEN.length}</span></h3>
    <div class="row" style="margin-bottom:8px">
      <label class="seats">Sort by
        <select id="p1GroupBy">${Object.entries(P1_GROUPS)
          .filter(([k, v]) => !v.egg || P1_EGG || k === P1_GROUP_BY)
          .map(([k, v]) =>
            `<option value="${k}"${k === P1_GROUP_BY ? ' selected' : ''}>${esc(v.label)}</option>`
          ).join('')}</select>
      </label>
    </div>
    <div class="stacks">${names.map(name => {
      const cards = groups[name].slice().sort((a, b) => (a.cmc || 0) - (b.cmc || 0)
        || a.name.localeCompare(b.name));
      return `<div class="stack">
        <div class="stackhead">${esc(name)} <span>${cards.length}</span></div>
        <div class="pile">${cards.map(c => cardFace(c)).join('')}</div>
      </div>`;
    }).join('')}</div>`;

  $('#p1GroupBy').onchange = e => { P1_GROUP_BY = e.target.value; p1Tableau(); };
  box.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.pick);
    el.removeAttribute('data-pick');
    el.onclick = () => p1Zoom(card);
  });
}

/* ── a real draft, not a series of unrelated packs ──

   Every seat opens a pack. You pick, the other seats pick from theirs, and the
   packs all move one seat in the pass direction - so the pack you get next is
   your neighbour's, minus the card they just took, and the one you passed comes
   back to you `players` picks later with that many cards gone. That is what
   makes the wheel real rather than a label: it is the same pack.

   The other seats pick the best card left by the page's own ranking, which is
   the worst case for you and matches what the "Comes back?" column claims.
   Three rounds, passing left, right, left, and each round runs until the packs
   are empty. */
const PACK_SIZE = 15;

/* ── the seed ──

   Everything random about a draft comes from one short seed that lives in the
   URL: how the cube is cut, which spare packs the other seats open, which
   painting is on each wrapper. Two people who open the same link are handed the
   same 36 packs and can argue about the same pick afterwards, which is the only
   way this is any use before a cube night.

   mulberry32 because it is nine lines, has no state to carry between reloads,
   and the quality that matters here is "the same every time", not entropy. */
function p1Rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function p1SeedNumber(text) {
  let h = 2166136261 >>> 0;                    // FNV-1a, so the words are stable
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function p1NewSeed() {
  // short, typeable, and case-insensitive: these get read out loud
  return Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
}

let P1_SEED = '', P1_RAND = Math.random;
/* A seed on its own does not describe a draft. The other seats take their packs
   from the ones you did not choose, one draw each, so eight players and six
   players consume the sequence differently and hand you different cards from
   the same seed. A shared draft therefore carries its seat count, and once a
   seed is someone else's - typed in, or arrived in a link - the seat control
   locks: changing it would quietly make this a different draft under the same
   name. Restart for a draft of your own and the seats are yours again. */
let P1_SEED_FIXED = false;

function p1SetSeed(text, fixed) {
  P1_SEED = (text || p1NewSeed()).toLowerCase().slice(0, 24);
  P1_SEED_FIXED = !!fixed;
  P1_RAND = p1Rng(p1SeedNumber(P1_SEED));
  p1WriteUrl();
  const box = $('#p1Seed');
  if (box && box.value !== P1_SEED) box.value = P1_SEED;
  p1SeatsLock();
}

/* The link is the draft. Seed alone hands someone the same packs to draft; add
   your picks and they see what you took from them. A pick is its place in the
   cube list - three characters rather than a 36-character oracle id - and the
   cube list is the same for everyone, so reading them back is a lookup rather
   than a replay of somebody else's draft. */
function p1WriteUrl() {
  if (!P1_SEED) return;
  const q = new URLSearchParams();
  q.set('seed', P1_SEED);
  if (P1_CHOSEN.length) q.set('packs', P1_CHOSEN.join('.'));
  if (P1_PICK_LOG.length) q.set('picks', P1_PICK_LOG.join('.'));
  q.set('seats', String(p1Wheel().players));
  try {
    history.replaceState(null, '', location.pathname + '#p1p1&' + q.toString());
  } catch (e) { /* a file:// page cannot rewrite its own URL; the seed still works */ }
}

/* The link as it arrived, read once and kept.

   Writing the URL is the first thing a draft does - the seed has to be in the
   address bar before anything else happens - and that write reflects YOUR
   empty draft, so it wiped the picks the link came with before anything had
   looked at them. Read once, at the top, and keep the answer. */
let P1_LINK = null;

function p1Link() {
  if (!P1_LINK) P1_LINK = p1ReadUrl();
  return P1_LINK;
}

function p1ReadUrl() {
  const raw = (location.hash || '').replace(/^#/, '');
  const q = new URLSearchParams(raw.split('&').slice(1).join('&'));
  return {
    seed: q.get('seed') || '',
    packs: (q.get('packs') || '').split('.').filter(x => x !== '').map(Number),
    picks: (q.get('picks') || '').split('.').filter(x => x !== '').map(Number),
    seats: parseInt(q.get('seats'), 10) || 0,
  };
}

/* ── cutting the cube into packs ──

   540 cards is exactly 36 packs of 15, so the whole cube goes on the table at
   once and you choose which three are yours. That is the only honest way to let
   someone pick a pack: the packs have to exist before the choosing, or the
   "random" pack is just whatever was dealt after the fact.

   The seats you are drafting against take their packs from the ones you did not
   choose, so no card is opened twice and the cube is still a singleton pool. */
function p1CutCube() {
  if (!P1_SEED) p1SetSeed(p1Link().seed, !!p1Link().seed);
  const pool = (P1.cards || []).slice();
  for (let i = pool.length - 1; i > 0; i--) {          // Fisher-Yates
    const j = Math.floor(P1_RAND() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  P1_ALL = [];
  for (let i = 0; i + PACK_SIZE <= pool.length; i += PACK_SIZE) {
    P1_ALL.push(pool.slice(i, i + PACK_SIZE));
  }
  P1_CHOSEN = [];
  P1_SPENT = new Set();
  p1CutArt();
}

/* Real art on the wrappers.

   Scryfall serves an art crop of every printing at the same path as the normal
   image, so `/normal/` -> `/art_crop/` turns a card the page already knows about
   into a painting with no extra request. Each pack takes one at random from a
   card that is NOT inside it, so the wrapper never hints at its own contents,
   and carries the painting and the artist in its tooltip because that is what
   showing the crop asks of us. */
const artCrop = u => (u || '').replace('/normal/', '/art_crop/')
                              .replace('/large/', '/art_crop/');

function p1CutArt() {
  P1_ART = {};
  const pool = (P1 && P1.cards || []).filter(c => c.image);
  if (!pool.length) return;
  for (let i = pool.length - 1; i > 0; i--) {          // drawn without replacement,
    const j = Math.floor(P1_RAND() * (i + 1));         // so no two wrappers match
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  let at = 0;
  P1_ALL.forEach((pack, i) => {
    const inside = new Set(pack.map(c => c.oracle_id));
    while (at < pool.length && inside.has(pool[at].oracle_id)) at++;
    const c = pool[at++];
    if (!c) return;
    P1_ART[i] = {url: artCrop(c.image), name: c.name,
                 artist: c.artist || '', set: (c.set_code || '').toUpperCase()};
  });
}

function p1PackFace(i) {
  const a = P1_ART[i];
  if (!a) return {html: '', credit: ''};
  return {
    html: `<i class="packart" style="background-image:url(${esc(a.url)})"></i>`,
    credit: a.artist ? `${a.name} \u2014 art by ${a.artist}` : a.name,
  };
}

function p1StartRound(which) {
  const seats = p1Wheel().players;
  const mine = P1_ALL[which];
  if (!mine) return;

  // the other seats open packs you did not choose
  const spare = P1_ALL
    .map((pack, i) => ({pack, i}))
    .filter(x => !P1_CHOSEN.includes(x.i) && !P1_SPENT.has(x.i));
  P1_PACKS = [mine];
  for (let seat = 1; seat < seats && spare.length; seat++) {
    const take = spare.splice(Math.floor(P1_RAND() * spare.length), 1)[0];
    P1_SPENT.add(take.i);
    P1_PACKS.push(take.pack.slice());
  }

  P1_PACKNO = which;
  P1_OPENED.add(which);
  P1_PICKNO = 1;
  p1ShowPack(which);
}

/* The packs on the table.

   Before you have chosen, that is the whole cube - 36 sealed packs, pick any
   three. After that it is only your three, in the order you reach for them. */
/* The seat count is not a view option: it decides how many of the 36 packs the
   other players take, which of your cards wheel, and where the ring of chairs
   is. All of that is fixed the moment you claim your first pack, so the control
   locks then and only a restart re-opens it. */
function p1SeatsLock() {
  const sel = $('#p1Players');
  if (!sel) return;
  const locked = P1_CHOSEN.length > 0 || P1_SEED_FIXED;
  sel.disabled = locked;
  const label = sel.closest('.seats');
  if (label) label.classList.toggle('locked', locked);
  sel.title = !locked ? ''
    : P1_CHOSEN.length > 0
      ? 'Seats are set for this draft — restart to change them'
      : 'This seed was cut for ' + sel.value + ' players; changing that deals '
        + 'different cards — restart for a draft of your own';
}

/* Hovering a wrapper shows the painting whole, with the set it came from.

   The wrapper only shows a strip of the crop, and a set code is not a set, so
   the tooltip is where both get said properly: the full art, the card and its
   painter, then the set's own symbol, name and year - the last of which comes
   from the set lookup shared.js already caches, so hovering the same set twice
   costs one request in total. */
const PACK_HOVER_DELAY = 200;
let packTimer = null, packToken = 0;

function p1HidePackTip() {
  clearTimeout(packTimer);
  packToken++;
  const box = $('#packpop');
  if (box) box.classList.add('hidden');
}

function p1ShowPackTip(el) {
  const a = P1_ART[el.dataset.pack];
  const box = $('#packpop');
  if (!a || !box) return;
  clearTimeout(packTimer);
  const my = ++packToken;
  packTimer = setTimeout(async () => {
    if (my !== packToken) return;
    const code = (a.set || '').toLowerCase();
    box.innerHTML = `<img class="packart-full" src="${esc(a.url)}" alt="">
      <div class="packmeta">
        <b>${esc(a.name)}</b>
        ${a.artist ? `<span class="by">art by ${esc(a.artist)}</span>` : ''}
        <span class="setline" data-code="${esc(code)}">${esc(a.set || '')}</span>
      </div>`;
    box.classList.remove('hidden');
    p1PlacePackTip(el, box);
    // you have just read a painter's name off a wrapper; that is the whole
    // thought behind stacking your picks by painter, so it stops hiding
    if (a.artist) P1_EGG = true;

    const d = code && await setData(code);
    if (my !== packToken || !d || d.error) return;
    const line = box.querySelector('.setline');
    if (!line) return;
    line.innerHTML = `${setSymbol(d.code)}
      ${esc(d.name)} <span class="code">${esc(d.code.toUpperCase())}</span>
      ${d.released_at ? `<span class="code">${esc(String(d.released_at).slice(0, 4))}</span>` : ''}`;
    p1PlacePackTip(el, box);
  }, PACK_HOVER_DELAY);
}

function p1PlacePackTip(el, box) {
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  let left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2),
                      window.innerWidth - b.width - 8);
  let top = r.bottom + 8;
  if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 8);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}

function p1Boosters() {
  p1SeatsLock();
  // innerHTML below replaces every wrapper, and a removed element never fires
  // mouseleave - so the tooltip has to be closed here or it hangs around,
  // pointing at a pack that no longer exists
  p1HidePackTip();
  const box = $('#p1Boosters');
  if (!box) return;
  if (!P1_ALL.length) { box.innerHTML = ''; return; }

  const choosing = P1_CHOSEN.length < 3;
  const open = P1_PACK.length > 0;
  box.className = 'boosters' + (choosing ? ' spread' : '');

  const show = choosing ? P1_ALL.map((_, i) => i)
    : P1_CHOSEN.slice().sort((a, b) => a - b);
  box.innerHTML = show.map(i => {
    let state, label;
    if (choosing) {
      state = P1_CHOSEN.includes(i) ? 'picked' : 'ready';
      label = state === 'picked' ? 'yours' : 'choose this one';
    } else {
      state = P1_OPENED.has(i) ? (i === P1_PACKNO && open ? 'open' : 'done')
        : open ? 'waiting' : 'ready';
      label = {done: 'drafted', open: 'in hand', waiting: 'sealed',
               ready: 'click to open'}[state];
    }
    const face = p1PackFace(i);
    const what = choosing ? 'A sealed pack' : 'Pack';
    return `<div class="booster ${state}" data-pack="${i}"
      ${state === 'ready' ? 'role="button" tabindex="0"' : 'aria-hidden="true"'}
      title="${what} \u2014 ${label}"
      aria-label="${what}, ${label}">${face.html}</div>`;
  }).join('');

  // The painting is part of choosing a pack. Once the draft is under way the
  // wrappers sit behind your hand as scenery, and a tooltip over the cards you
  // are picking from is in the way.
  if (choosing) box.querySelectorAll('.booster').forEach(el => {
    el.onmouseenter = () => p1ShowPackTip(el);
    el.onmouseleave = p1HidePackTip;
    el.onfocus = () => p1ShowPackTip(el);
    el.onblur = p1HidePackTip;
  });

  box.querySelectorAll('.booster.ready').forEach(el => {
    const i = parseInt(el.dataset.pack, 10);
    const go = async () => {
      if (choosing) {
        if (P1_CHOSEN.length >= 3 || P1_CHOSEN.includes(i)) return;
        P1_CHOSEN.push(i);
        p1WriteUrl();
        p1HidePackTip();
        // the third choice breaks up the cube, so remember where every pack was
        const was = P1_CHOSEN.length === 3 ? p1PackRects() : null;
        p1Boosters();
        p1DrawHand();
        if (was) p1CollectPacks(was);
        return;
      }
      if (P1_PACK.length) return;              // finish the pack in hand first
      p1HidePackTip();
      await p1Data();
      if (P1 && P1.error) {
        $('#p1Hand').innerHTML = `<span class="badge bad">${esc(P1.error)}</span>`;
        return;
      }
      p1StartRound(i);
    };
    el.onclick = go;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}

/* Cards are pulled out of the pack you opened.

   Three phases per card, which is what makes it read as pulling rather than
   appearing: it starts tucked INSIDE the wrapper (below the seam, hidden), rises
   up out of the top still small and edge-on, and only then travels to its place
   in the fan. They come one at a time, so the hand is drawn out card by card.

   The last keyframe is the card's own resting transform, read from the computed
   style, so the animation lands exactly where the fan put it rather than
   fighting the tilt and lift the layout assigned. */
/* The wrapper's face peels back before anything comes out: a copy of the front
   is laid over the pack, hinged at the top seam, and folded away from the
   viewer. It is a throwaway overlay rather than the pack itself, so nothing in
   the pack's own state depends on the animation finishing. */
/* ── breaking up the cube ──

   When the third pack is chosen the spread stops being 36 packs and becomes
   your three, which is a big enough change to be worth showing rather than
   cutting to. The chosen packs slide from where they sat in the cube to their
   place on the table; the rest leave - as many as there are other seats go to
   those players, and the remainder are simply not in this draft and drop away.

   The leavers are throwaway clones, so the real boosters are already correct
   before a single frame runs. */
function p1PackRects() {
  const out = {};
  document.querySelectorAll('#p1Boosters .booster').forEach(el => {
    out[el.dataset.pack] = el.getBoundingClientRect();
  });
  return out;
}

function p1CollectPacks(was) {
  const box = $('#p1Boosters');
  if (!box || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // the three you kept: slide from the cube to the table
  box.querySelectorAll('.booster').forEach(el => {
    const from = was[el.dataset.pack];
    if (!from) return;
    const to = el.getBoundingClientRect();
    if (!el.animate) return;
    el.animate([
      {transform: `translate(${(from.left - to.left).toFixed(1)}px, ${(from.top - to.top).toFixed(1)}px)`
        + ` scale(${(from.width / to.width).toFixed(3)})`},
      {transform: 'none'},
    ], {duration: 520, easing: 'cubic-bezier(.3,.9,.3,1)'});
  });

  /* The other seats sit around the table, so their packs go TO them: the ring
     is an ellipse around the tabletop with your chair at the bottom, and seat k
     gets the point one step round from you. Packs that are not in this draft at
     all do not fly anywhere - they simply are not here, so they fade. */
  const table = ($('#p1Table') || box).getBoundingClientRect();
  const cx = table.left + table.width / 2;
  const cy = table.top + table.height / 2;
  const rx = table.width * 0.46;
  const ry = table.height * 0.62;
  const players = p1Wheel().players;
  const seats = Math.max(0, players - 1);
  const seatAt = k => {
    const a = Math.PI / 2 + (2 * Math.PI * k) / players;   // your chair is at PI/2
    return {x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a)};
  };

  const leaving = Object.keys(was)
    .filter(k => !P1_CHOSEN.includes(parseInt(k, 10)))
    .sort((a, b) => was[a].left - was[b].left);

  leaving.forEach((key, n) => {
    const from = was[key];
    const ghost = document.createElement('div');
    ghost.className = 'booster packghost';
    ghost.innerHTML = p1PackFace(parseInt(key, 10)).html;   // it keeps its painting
    Object.assign(ghost.style, {
      left: from.left + 'px', top: from.top + 'px',
      width: from.width + 'px', height: from.height + 'px',
    });
    document.body.appendChild(ghost);

    let frames, opts;
    if (n < seats) {
      const seat = seatAt(n + 1);
      const dx = seat.x - (from.left + from.width / 2);
      const dy = seat.y - (from.top + from.height / 2);
      const tilt = (seat.x - cx) / rx * 14;            // lean toward the chair
      frames = [
        {transform: 'none', opacity: 1},
        {transform: `translate(${(dx * 0.6).toFixed(0)}px, ${(dy * 0.6).toFixed(0)}px) scale(.8)`,
         opacity: 1, offset: 0.55},
        {transform: `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) scale(.62) rotate(${tilt.toFixed(1)}deg)`,
         opacity: .85},
      ];
      opts = {duration: 640, delay: 40 + n * 45, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards'};
    } else {
      frames = [
        {transform: 'none', opacity: 1},
        {transform: 'scale(.86)', opacity: 0},
      ];
      opts = {duration: 420, delay: 30 + n * 8, easing: 'ease-in', fill: 'forwards'};
    }
    const anim = ghost.animate(frames, opts);
    // a seated pack lingers a moment at its chair before it goes with the player
    const linger = n < seats ? 420 : 0;
    anim.finished
      .then(() => new Promise(r => setTimeout(r, linger)))
      .then(() => {
        if (!ghost.isConnected) return;
        if (!linger) { ghost.remove(); return; }
        const out = ghost.animate([{opacity: .85}, {opacity: 0}],
          {duration: 260, easing: 'ease-in', fill: 'forwards'});
        out.finished.then(() => ghost.remove()).catch(() => ghost.remove());
      })
      .catch(() => ghost.remove());
  });
}

function p1PeelPack(packNo) {
  const lit = $('#p1Boosters') && $('#p1Boosters').querySelector(`[data-pack="${packNo}"]`);
  if (lit) {
    lit.classList.add('justopened');
    setTimeout(() => lit.classList.remove('justopened'), 1400);
  }
  const src = $('#p1Boosters') && $('#p1Boosters').querySelector(`[data-pack="${packNo}"]`);
  if (!src || matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const r = src.getBoundingClientRect();
  const peel = document.createElement('div');
  peel.className = 'peel';
  Object.assign(peel.style, {
    left: r.left + 'px', top: r.top + 'px',
    width: r.width + 'px', height: r.height + 'px',
  });
  document.body.appendChild(peel);
  const anim = peel.animate([
    {transform: 'rotateX(0deg)', opacity: 1},
    {transform: 'rotateX(-58deg) translateY(-4px)', opacity: 1, offset: 0.45},
    {transform: 'rotateX(-128deg) translateY(-12px)', opacity: 0},
  ], {duration: 460, easing: 'cubic-bezier(.35,.05,.3,1)', fill: 'forwards'});
  anim.finished.then(() => peel.remove()).catch(() => peel.remove());
  return 260;                                  // how long to hold the cards back
}

function p1DealFrom(packNo, after) {
  const src = $('#p1Boosters') && $('#p1Boosters').querySelector(`[data-pack="${packNo}"]`);
  const cards = [...$('#p1Hand').querySelectorAll('.dcard')];
  if (!src || !cards.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!cards[0].animate) return;                 // no Web Animations: leave it be

  const from = src.getBoundingClientRect();
  const mouth = from.top + 6;                    // the torn seam
  const cx = from.left + from.width / 2;

  cards.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const dx = cx - (r.left + r.width / 2);
    const dy = mouth - (r.top + r.height / 2);
    const rest = getComputedStyle(el).transform;
    const at = (x, y, extra) => `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${extra}`;

    el.animate([
      // inside the wrapper, below the seam
      {transform: at(dx, dy + from.height * 0.42, 'scale(.22) rotate(0deg)'),
       opacity: 0, offset: 0},
      // clearing the seam, still edge-on
      {transform: at(dx, dy - 10, 'scale(.30) rotate(0deg)'),
       opacity: 1, offset: 0.30},
      // drawn clear of the pack before it flies
      {transform: at(dx, dy - from.height * 0.55, 'scale(.42) rotate(0deg)'),
       opacity: 1, offset: 0.46},
      {transform: rest === 'none' ? 'none' : rest, opacity: 1, offset: 1},
    ], {
      duration: 620,
      delay: (after || 0) + i * 55,
      easing: 'cubic-bezier(.25,.8,.3,1)',
      fill: 'backwards',                          // stays tucked away until its turn
    });
  });

  // the wrapper gives as each card is drawn out of it
  src.animate([
    {transform: 'none'}, {transform: 'translateY(-3px) rotate(-1.5deg)'},
    {transform: 'none'},
  ], {duration: 260 + cards.length * 55, delay: after || 0, easing: 'ease-in-out'});
}

function p1ShowPack(dealtFrom) {
  if ($('#p1WantPanel')) $('#p1WantPanel').hidden = false;
  P1_PACK = P1_PACKS[0] || [];
  P1_PICK = null;
  $('#p1Out').innerHTML = '';
  p1DrawHand();
  p1Boosters();
  if (dealtFrom) p1DealFrom(dealtFrom, p1PeelPack(dealtFrom));
  p1Render();
  p1DeckFace();
  p1Watchlist();
}

/* The other seats take the best card left, then every pack moves one seat. */
function p1PassPacks() {
  for (let seat = 1; seat < P1_PACKS.length; seat++) {
    const pack = P1_PACKS[seat];
    if (!pack.length) continue;
    let bestI = 0;
    for (let i = 1; i < pack.length; i++) {
      if (pack[i].score > pack[bestI].score) bestI = i;
    }
    pack.splice(bestI, 1);
  }
  const n = P1_PACKS.length;
  if (n > 1) {
    // passing left means your pack goes to the seat on your left, so you
    // receive the pack from your right - the array rotates the other way
    P1_PACKS = passDir() === 'left'
      ? P1_PACKS.slice(1).concat(P1_PACKS.slice(0, 1))
      : P1_PACKS.slice(-1).concat(P1_PACKS.slice(0, -1));
  }
}

/* Called once the pick animation has settled. */
function p1NextPack() {
  p1PassPacks();
  if ((P1_PACKS[0] || []).length) {
    P1_PICKNO += 1;
    p1ShowPack();
    return;
  }
  P1_PACK = [];
  p1Boosters();
  if (P1_OPENED.size < 3) {
    // a round boundary is a real pause at a table, so it takes a press
    $('#p1Hand').innerHTML = '';
    p1Boosters();
    return;
  }
  p1DraftOver();
}



/* ── what you could build ──

   Forty cards is 23 spells and 17 lands, so a pool is only a deck if a colour
   pair holds 23 playables. Everything in the pair's colours counts, colourless
   included, and the ratings say which pairs clear that bar and what they are
   worth: the table's record in those colours, how the picks pair up with each
   other, and whether the curve is a curve. */
const DECK_SPELLS = 23;

function p1DeckOptions() {
  const pool = P1_TAKEN;
  const lanes = (P1 && P1.lane_pct) || {};
  const base = (P1 && P1.lane_baseline) || 50;
  const ids = new Set(pool.map(c => c.oracle_id));

  const pairs = Object.keys(lanes).length ? Object.keys(lanes)
    : ['WU', 'WB', 'WR', 'WG', 'UB', 'UR', 'UG', 'BR', 'BG', 'RG'];

  return pairs.map(pair => {
    const fits = pool.filter(c => [...(c.color_identity || '')].every(x => pair.includes(x)));
    const spells = fits.filter(c => !c.is_land);
    const lands = fits.length - spells.length;
    const best = spells.slice().sort((a, b) => b.score - a.score).slice(0, DECK_SPELLS);
    const avg = best.length ? best.reduce((t, c) => t + c.score, 0) / best.length : 0;

    // how much the picks want each other, counted once per pair
    let links = 0, lift = 0;
    fits.forEach(c => (c.partners || []).forEach(pt => {
      if (ids.has(pt.oracle_id) && fits.some(f => f.oracle_id === pt.oracle_id)) {
        links += 1; lift += pt.lift || 0;
      }
    }));
    links = Math.round(links / 2); lift = lift / 2;

    const curve = {};
    spells.forEach(c => { const mv = Math.min(6, Math.round(c.cmc || 0)); curve[mv] = (curve[mv] || 0) + 1; });
    const cheap = (curve[1] || 0) + (curve[2] || 0) + (curve[3] || 0);

    const rate = lanes[pair];
    const short = Math.max(0, DECK_SPELLS - spells.length);
    return {
      pair, spells: spells.length, lands, short, avg, links, lift, curve, cheap,
      rate: rate == null ? null : rate,
      score: (spells.length >= DECK_SPELLS ? 40 : spells.length - DECK_SPELLS)
             + avg * 0.5 + (rate == null ? 0 : (rate - base) * 1.2) + lift * 0.05,
    };
  }).sort((a, b) => b.score - a.score);
}

/* ── the pool, once the draft is done ──

   Forty-five cards is too many to read as one spread, so the finished pool gets
   the same stacks the deck view uses, plus filters for the questions you
   actually ask of a pool: what is in these colours, what does this role look
   like, how does the curve sit. Nothing here is a deck yet - that is what the
   guidance underneath is for. */
let P1_FILTER = {colours: new Set(), role: '', q: ''};

function p1PoolCards() {
  const f = P1_FILTER;
  return P1_TAKEN.filter(c => {
    if (f.q && !c.name.toLowerCase().includes(f.q)
             && !(c.artist || '').toLowerCase().includes(f.q)) return false;
    if (f.role && (c.role || 'Other') !== f.role) return false;
    if (f.colours.size) {
      const ci = [...(c.color_identity || '')];
      // a card qualifies if it fits INSIDE the chosen colours, which is the
      // question a drafter asks: could this go in that deck
      if (!ci.length) return f.colours.has('C');
      if (!ci.every(x => f.colours.has(x))) return false;
    }
    return true;
  });
}

function p1PoolView() {
  const box = $('#p1Pool');
  if (!box) return;
  const cards = p1PoolCards();
  const g = P1_GROUPS[P1_GROUP_BY] || P1_GROUPS.colour;
  const groups = {};
  cards.forEach(c => { (groups[g.of(c)] = groups[g.of(c)] || []).push(c); });
  const names = g.order.filter(k => groups[k])
    .concat(Object.keys(groups).filter(k => !g.order.includes(k)).sort());
  const roles = [...new Set(P1_TAKEN.map(c => c.role || 'Other'))].sort();

  box.innerHTML = `
    <div class="poolbar">
      <span class="pips">${['W', 'U', 'B', 'R', 'G', 'C'].map(x =>
        `<span class="pip ${x}${P1_FILTER.colours.has(x) ? ' on' : ''}"
          data-col="${x}" role="button" tabindex="0" title="${esc(ciName(x === 'C' ? '' : x))}">${x}</span>`
      ).join('')}</span>
      <label class="seats">Role
        <select id="poolRole"><option value="">any</option>${roles.map(r =>
          `<option${r === P1_FILTER.role ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select>
      </label>
      <label class="seats">Stack by
        <select id="poolGroup">${Object.entries(P1_GROUPS)
          .filter(([k, v]) => !v.egg || P1_EGG || k === P1_GROUP_BY)
          .map(([k, v]) =>
            `<option value="${k}"${k === P1_GROUP_BY ? ' selected' : ''}>${esc(v.label)}</option>`
          ).join('')}</select>
      </label>
      <input id="poolQ" placeholder="find a card" value="${esc(P1_FILTER.q)}">
      <span class="spacer"></span>
      <span class="mini dim">${cards.length} of ${P1_TAKEN.length}</span>
      ${cards.length < P1_TAKEN.length ? '<button id="poolClear">clear</button>' : ''}
    </div>
    ${cards.length ? `<div class="stacks">${names.map(name => {
      const list = groups[name].slice().sort((a, b) => (a.cmc || 0) - (b.cmc || 0)
        || a.name.localeCompare(b.name));
      return `<div class="stack">
        <div class="stackhead">${esc(name)} <span>${list.length}</span></div>
        <div class="pile">${list.map(c => cardFace(c)).join('')}</div>
      </div>`;
    }).join('')}</div>` : '<p class="note">Nothing in the pool matches those filters.</p>'}`;

  box.querySelectorAll('[data-col]').forEach(el => {
    const flip = () => {
      const x = el.dataset.col;
      P1_FILTER.colours.has(x) ? P1_FILTER.colours.delete(x) : P1_FILTER.colours.add(x);
      p1PoolView();
    };
    el.onclick = flip;
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } };
  });
  $('#poolRole').onchange = e => { P1_FILTER.role = e.target.value; p1PoolView(); };
  $('#poolGroup').onchange = e => { P1_GROUP_BY = e.target.value; p1PoolView(); };
  let t = null;
  $('#poolQ').oninput = e => {
    clearTimeout(t);
    const v = e.target.value.trim().toLowerCase();
    t = setTimeout(() => {
      P1_FILTER.q = v;
      // naming a painter, or asking for one, opens the stacking nobody advertised
      if (v.length > 2 && (v === 'artist'
          || [...p1Artists()].some(a => a.includes(v)))) P1_EGG = true;
      p1PoolView();
    }, 200);
  };
  if ($('#poolClear')) $('#poolClear').onclick = () => {
    P1_FILTER = {colours: new Set(), role: '', q: ''};
    document.querySelectorAll('.deckrow.picked').forEach(r => r.classList.remove('picked'));
    p1PoolView();
  };
  box.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.pick);
    el.removeAttribute('data-pick');
    el.onclick = () => p1Zoom(card);
  });
}

/* What the pool is actually close to being, in words before numbers. */
function p1Guidance(decks) {
  const real = decks.filter(d => !d.short);
  const near = decks.filter(d => d.short && d.short <= 4);
  const best = decks[0];
  const bits = [];

  if (real.length) {
    const d = real[0];
    bits.push(`<b>${esc(ciName(d.pair))}</b> is a deck: ${d.spells} playables against the
      ${DECK_SPELLS} a 40-card list needs${d.rate == null ? ''
        : `, and those colours are ${d.rate}% in recorded games`}.`);
    if (d.links) bits.push(`${d.links} of those cards want to be beside each other.`);
    if (real.length > 1) {
      bits.push(`<b>${esc(ciName(real[1].pair))}</b> also gets there, with
        ${real[1].spells}.`);
    }
  } else if (near.length) {
    bits.push(`No pair reaches ${DECK_SPELLS} playables. The closest is
      <b>${esc(ciName(near[0].pair))}</b>, ${near[0].short} short — which in a real draft
      is what the last few picks and a splash are for.`);
  } else if (best) {
    bits.push(`This pool is spread thin: even ${esc(ciName(best.pair))}, the deepest pair,
      is ${best.short} playables short of a deck.`);
  }

  const curve = (real[0] || best || {}).curve || {};
  const cheap = (curve[1] || 0) + (curve[2] || 0);
  if (best && best.spells) {
    bits.push(cheap < 5
      ? `Watch the curve: only ${cheap} cards at one or two mana in that lane.`
      : `The curve holds up: ${cheap} cards at one or two mana.`);
  }
  return bits.join(' ');
}

function p1DraftOver() {
  const decks = p1DeckOptions();
  if ($('#p1WantPanel')) $('#p1WantPanel').hidden = true;

  $('#p1Hand').innerHTML = '';

  $('#p1Out').innerHTML = `
    <h3 class="sec">Your pool <span class="count">${P1_TAKEN.length}</span></h3>
    <div id="p1Pool"></div>

    <h3 class="sec">What you could build</h3>
    <p class="note">${p1Guidance(decks)}</p>
    <p class="note">A 40-card deck is <b>${DECK_SPELLS} spells</b> and 17 lands, so a pair is
      only a deck if it holds ${DECK_SPELLS} playables in its colours. <b>Record</b> is how that
      pair has done in recorded games; <b>pairs</b> counts your picks that want to be beside
      each other.</p>
    <div class="scroll"><table><thead><tr>
      <th>Deck</th><th class="num">Playables</th><th class="num">Short by</th>
      <th class="num">Avg pick score</th><th class="num">Pairs</th>
      <th class="num">Record</th><th>Curve 1-6</th>
    </tr></thead><tbody>${decks.map(d => `<tr class="deckrow" data-pair="${esc(d.pair)}"
      role="button" tabindex="0" title="Show the ${esc(ciName(d.pair))} cards in your pool">
      <td class="name">${ciCell(d.pair)} ${esc(ciName(d.pair))}</td>
      <td class="num">${d.spells}</td>
      <td class="num">${d.short ? `<span class="badge bad">${d.short}</span>` : '<span class="badge good">none</span>'}</td>
      <td class="num">${d.avg.toFixed(1)}</td>
      <td class="num">${d.links || '\u2014'}</td>
      <td class="num">${d.rate == null ? '\u2014' : d.rate + '%'}</td>
      <td class="mini">${[1, 2, 3, 4, 5, 6].map(mv => (d.curve[mv] || 0)).join(' \u00b7 ')}</td>
    </tr>`).join('')}</tbody></table></div>`;

  p1PoolView();
  sortable('#p1Out');

  // clicking a deck asks the pool to show exactly what that deck could play:
  // its two colours plus colourless, which any deck can cast
  $('#p1Out').querySelectorAll('.deckrow').forEach(row => {
    const show = () => {
      P1_FILTER.colours = new Set([...row.dataset.pair, 'C']);
      P1_FILTER.role = '';
      P1_FILTER.q = '';
      p1PoolView();
      $('#p1Out').querySelectorAll('.deckrow').forEach(r => r.classList.remove('picked'));
      row.classList.add('picked');
      $('#p1Pool').scrollIntoView({behavior: 'smooth', block: 'start'});
    };
    row.onclick = show;
    row.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } };
  });
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
  const size = P1_PACK.length || PACK_SIZE;
  return {players, size, wheels: size > players, left: Math.max(0, size - players)};
}

function p1Render() {
  if (!P1_PACK.length) return;
  const ranked = P1_PACK.slice().sort((a, b) => b.score - a.score);
  const rankOf = c => ranked.findIndex(x => x.oracle_id === c.oracle_id) + 1;
  const best = ranked[0];

  const head = P1_PICK
    ? (() => {
        const mine = P1_PACK.find(c => c.oracle_id === P1_PICK) || p1Card(P1_PICK);
        if (!mine) return '';
        const r = rankOf(mine);
        const agree = r === 1;
        return `<div class="note">You took <b>${esc(mine.name)}</b> —
          ${agree ? '<span class="badge good">the numbers agree</span>'
                  : `the numbers rank it <b>${r}</b> of ${P1_PACK.length}, behind
                     <b>${esc(best.name)}</b>`}.
          ${agree ? '' : `<br>That gap is <b>${(best.score - mine.score).toFixed(1)}</b> points,
             almost all of it ${p1Why(best, mine)}.`}</div>`;
      })()
    : '<div class="note">Double-click the card you would take.</div>';

  const w = p1Wheel();
  // worst case: the other seats take the top-ranked cards before it returns
  const wheelCell = rank => {
    if (!w.wheels) return '<span class="dim">no wheel</span>';
    const taken = w.players - 1;
    if (rank <= taken) return '<span class="badge bad">gone</span>';
    if (rank <= taken + 2) return '<span class="badge warn">close</span>';
    return '<span class="badge good">should wheel</span>';
  };

  const rows = ranked.map(c => {
    const picked = c.oracle_id === P1_PICK;
    return `<tr class="${picked ? 'me' : ''}">
      <td class="num">${rankOf(c)}</td>
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

  let open = false;
  try { open = localStorage.getItem(P1_NUM_KEY) === '1'; } catch (e) {}
  $('#p1Out').innerHTML = `<details class="numbers"${open ? ' open' : ''}>
      <summary>How the pack in your hand ranks</summary>` + head + `<table><thead><tr>
      <th class="num">#</th>
      <th>Card</th><th>CI</th><th class="num">MV</th>
      ${true
        ? `<th>Comes back?</th><th class="num">Pick score</th><th class="num">Lane record</th>
           <th class="num">Keeps options open</th><th class="num">Cube pull</th>`
        : '<th data-nosort></th>'}
    </tr></thead><tbody>${rows}</tbody></table>`
    + (true ? `<p class="note">With <b>${w.players}</b> players, this pack comes back to you
        at pick ${w.players + 1}${w.wheels
          ? ` with <b>${w.left}</b> cards left in it` : ' — except it does not, because the pack runs out first'}.
        <b>Comes back?</b> assumes every other seat drafts perfectly — each takes the best card
        left by this ranking. That is the worst case on purpose: real tables are softer, so a card
        marked <span class="badge bad">gone</span> may still come back, while one marked
        <span class="badge good">should wheel</span> is safe to pass.</p>
      <p class="note"><b>Lane record</b> is the colours' record in recorded games against the
        ${P1.lane_baseline}% average — the only measured number here, and it rests on a few dozen
        matches. <b>Keeps options open</b> matters for this pick and no other.
        <b>Cube pull</b> is how much the rest of the cube wants to sit beside it.</p>` : '')
    + '</details>';
  const det = $('#p1Out').querySelector('details');
  if (det) det.addEventListener('toggle', () => {
    try { localStorage.setItem(P1_NUM_KEY, det.open ? '1' : '0'); } catch (e) {}
  });

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

/* The ranked want list, shared by the "Most wanted" panel and the hand.

   It is NOT the same question the pack ranking answers. A pack's top card is
   the best card in it on its own merits; this is the card the rest of the cube
   most wants beside what you have already taken. They coincide only by luck,
   which is exactly why a wanted card turning up in a pack is worth pointing at
   rather than leaving for you to spot. */
function p1Wanted() {
  if (!P1_TAKEN.length) return {rows: [], main: ''};
  const taken = new Set(P1_TAKEN.map(c => c.oracle_id));
  const want = {};
  P1_TAKEN.forEach(mine => {
    (mine.partners || []).forEach(p => {
      if (taken.has(p.oracle_id)) return;
      const w = want[p.oracle_id] || (want[p.oracle_id] = {
        oracle_id: p.oracle_id, name: p.name, lift: 0, weighted: 0, from: [], kind: p.kind});
      w.lift += p.lift || 0;
      w.weighted += (p.lift || 0) * pairWeight(p.kind);
      w.from.push(mine.name);
      if (pairWeight(p.kind) > pairWeight(w.kind)) w.kind = p.kind;
    });
  });

  // your colours so far, so a card you cannot cast is not the thing you want most
  const mineColours = {};
  P1_TAKEN.forEach(c => [...(c.color_identity || '')].forEach(x => {
    mineColours[x] = (mineColours[x] || 0) + 1;
  }));
  const main = Object.entries(mineColours).sort((a, b) => b[1] - a[1])
    .slice(0, 2).map(x => x[0]).join('');

  const rows = Object.values(want).map(w => {
    const card = p1Card(w.oracle_id) || {};
    const ci = card.color_identity || '';
    const castable = !ci || [...ci].every(x => main.includes(x));
    // several of your picks agreeing counts for more than one loud pair, and a
    // card you cannot cast is worth wanting less
    w.desire = w.weighted * (1 + 0.5 * (w.from.length - 1)) * (castable ? 1 : 0.45);
    w.card = card;
    w.castable = castable;
    return w;
  }).sort((a, b) => b.desire - a.desire).slice(0, 5);

  return {rows, main};
}

function p1Watchlist() {
  const box = $('#p1Watch');
  if (!box) return;
  const {rows, main} = p1Wanted();
  if (!rows.length) {
    box.innerHTML = '<span class="dim">Take a card and this fills with what to watch for.</span>';
    return;
  }
  const top = rows[0] ? rows[0].desire : 1;
  box.innerHTML = `<div class="wants">${rows.map((w, i) => `
      <figure class="want${w.castable ? '' : ' offcolour'}">
        <div class="wantcard">${cardFace(w.card.oracle_id ? w.card : {name: w.name})}
          <span class="rank">${i + 1}</span></div>
        <figcaption>
          ${w.card.image ? '' : `<b>${esc(w.name)}</b>`}
          <span class="bar"><i style="width:${Math.round(100 * w.desire / top)}%"></i></span>
          <span class="why">${esc(w.kind || 'general')} \u00b7 ${w.lift.toFixed(0)}\u00d7
            with ${w.from.slice(0, 2).map(esc).join(', ')}${w.from.length > 2
              ? ' +' + (w.from.length - 2) : ''}</span>
          ${w.castable ? '' : '<span class="why">needs a splash</span>'}
        </figcaption>
      </figure>`).join('')}</div>
    <p class="note">The five cards the rest of the cube most wants beside what you have taken,
      by lift weighted toward pairs that describe an actual interaction rather than a shared
      type. Several of your picks agreeing counts for more than one loud pair, and anything
      outside <b>${main ? esc(main) : 'your colours'}</b> is wanted less because you would have
      to splash for it. None of it is guaranteed to come round; it says what to take when it does.</p>`;

  box.querySelectorAll('[data-pick]').forEach(el => {
    const card = p1Card(el.dataset.oracle);
    el.removeAttribute('data-pick');
    if (card) el.onclick = () => p1Zoom(card);
  });
}

$('#p1Restart').onclick = () => {
  P1_TAKEN = [];
  P1_PACK = [];
  P1_PICK = null;
  P1_PACKNO = 0;
  P1_PACKS = [];
  P1_PICKNO = 0;
  P1_USED = new Set();
  P1_OPENED = new Set();
  if ($('#p1WantPanel')) $('#p1WantPanel').hidden = false;
  P1_PICK_LOG = [];
  p1SetSeed(p1NewSeed());        // a restart is a different draft
  p1CutCube();                   // a fresh cut, so the packs differ
  $('#p1Out').innerHTML = '';
  $('#p1Tableau').innerHTML = '';
  $('#p1Tableau').dataset.open = '0';
  p1DrawHand();
  p1Boosters();
  p1DeckFace();
  p1Watchlist();
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

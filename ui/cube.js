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
$('#cubeContVal') && $('#cubeCont').addEventListener('input', () => {
  const v = parseFloat($('#cubeCont').value);
  $('#cubeContVal').textContent = v < 0.15 ? 'uncontested' : v < 0.3 ? 'mild'
    : v < 0.5 ? 'normal' : v < 0.7 ? 'contested' : 'everyone wants it';
});

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
    contention: $('#cubeCont').value});
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
  $('#cubeShape').innerHTML = `A ${s.players}-player draft with ${s.rounds}×${s.pack_size} packs
    uses <b>${s.cards_used}</b> of the cube's ${s.cube_size} cards and gives you
    <b>${s.picks_each}</b> picks. Any one card you want has a
    <b>${pct(one.p_opened)}</b> chance of being opened and, once opened, a
    <b>${pct(one.p_reaches_you)}</b> chance of reaching your seat before someone takes it —
    <b>${pct(one.p_you_get_it)}</b> overall.
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
      <td class="num" data-sort="${c.p_draft}">${pct(c.p_draft)}</td>
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
      <div class="stat"><b>${(tactics.tactics || []).length}</b><span>archetypes supported</span></div>
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
    <p class="note">Three signals, and they are not equally trustworthy. <b>Depth</b> is a hard fact
      about your list. <b>Power</b> is the average EDHREC play rate of the lane's twenty best spells —
      a proxy, since that data is multiplayer Commander, so it says "these cards are strong" far
      better than "this archetype is strong"; EDHREC archetype data is deliberately not used here.
      ${(opp && opp.has_local)
        ? `<b>Measured</b> is what this table has actually done with the lane, from the game-night
           records — the only signal here drawn from your own cube rather than someone else's format.
           It is also the smallest: a couple of dozen matches decides nothing on its own, so the
           match count sits beside every rate. A three-colour deck counts toward each of its pairs.`
        : `A third signal, what this table has actually done with each lane, appears here once
           game-night results are recorded.`}</p>
    <table><thead><tr><th data-filter="text">Lane</th><th class="num" data-filter="min">Spells</th><th class="num">Power</th>
      <th class="num">Opportunity</th>${opp && opp.has_local
        ? '<th class="num" data-filter="min">Measured</th><th class="num" data-filter="min">Matches</th>' : ''}</tr></thead><tbody>
      ${((opp && opp.lanes) || []).map(l => `<tr>
        <td class="name" data-sort="${esc(l.colors)}">${manaLabel(l.colors)}</td>
        <td class="num" data-sort="${l.spells}">${l.spells}</td>
        <td class="num" data-sort="${l.top20_power}">${(l.top20_power/1000).toFixed(0)}k</td>
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
      <th class="num" data-filter="min">Decks together</th><th class="num" data-filter="max">$</th>
      <th data-filter="text">Why it might work</th></tr></thead><tbody>
      ${((syn && syn.pairs) || []).map(x => `<tr>
        <td class="name">${x.cards.map(c => cardName(c.name, c.oracle_id)).join(' <span class="dim">+</span> ')}
          <div class="dim">${manaDisc(x.colors, 14)} ${x.cards.map(c => esc((c.type_line||'').split(' —')[0])).join(' · ')}</div></td>
        <td data-sort="${esc(x.kind)}"><span class="badge kind-${esc(x.kind.replace(/[^a-z]+/g,''))}">${esc(x.kind)}</span></td>
        <td class="num" data-sort="${x.lift}">${x.lift}×</td>
        <td class="num" data-sort="${x.played_together}">${x.played_together.toLocaleString()}</td>
        <td class="num" data-sort="${x.total_price}">${money(x.total_price)}</td>
        <td class="dim">${x.hint ? esc(x.hint) : '<span class="dim">—</span>'}</td>
      </tr>`).join('')}</tbody></table>

    <h3 class="sec">Tactics this cube supports</h3>
    <p class="note">Ranked by depth weighted by how strongly those cards belong to the strategy.
      <b>Read this list with suspicion:</b> the theme data comes from EDHREC and is Commander-shaped,
      so it happily reports set mechanics (morph, kicker, foretell) as though they were archetypes.
      The colour lanes above and the composition below are the trustworthy signals; this table is
      “the cube holds this many cards that do this kind of thing”, nothing stronger.</p>
    <table><thead><tr><th data-filter="text">Tactic</th><th class="num" data-filter="min">Cards in cube</th>
      <th class="num" data-filter="min">Expect to draft</th><th class="num" data-filter="min">Support</th>
      <th class="num" data-filter="min">P(draft ${tactics.need}+)</th></tr></thead><tbody>
      ${(tactics.tactics || []).map(x => `<tr>
        <td class="name">
          <details class="cardlist">
            <summary>${esc(x.name)}</summary>
            <div class="cardgrid">${(x.examples || []).map(c =>
              `<span class="cardchip" data-oracle="${c.oracle_id}">${esc(c.card_name)}
               <span class="mini">${c.synergy >= 0 ? '+' : ''}${(c.synergy || 0).toFixed(2)}</span></span>`).join('')}</div>
          </details>${tipInline(x.name, tacticBlurb(x))}</td>
        <td class="num" data-sort="${x.cards_in_cube}">${x.cards_in_cube}</td>
        <td class="num" data-sort="${x.expected_drafted}">${x.expected_drafted}</td>
        <td class="num" data-sort="${x.support}">${x.support}</td>
        <td class="num" data-sort="${x.p_draft_enough}">${pct(x.p_draft_enough)}</td>
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
      <th class="num" data-filter="max">$</th><th class="num" data-filter="min">Completes</th><th data-filter="text">What it finishes</th></tr></thead><tbody>
      ${near.cards.map(c => `<tr>
        <td class="name" data-card="${esc(c.name)}">${esc(c.name)}</td>
        <td class="dim">${manaDisc(c.color_identity, 14)} ${esc((c.type_line || '').split(' —')[0])}</td>
        <td class="num" data-sort="${c.price_usd ?? ''}">${money(c.price_usd)}</td>
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
$('#cubeSel').onchange = () => { syncRefreshButton(LOADED_CUBES); runCube(); };

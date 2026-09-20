// Game-night tracker. Local only: the results file sits in data/, which is
// gitignored, so nothing here reaches the published Cube Lab page.
//
// Every write posts the change and takes the server's recomputed summary back as
// the single source of truth, rather than patching a local copy - the totals are
// cheap and a divergence between what you see and what is stored is not worth
// the saved round trip.

let DOC = {players: [], nights: [], totals: {}};
let EDITING = null;   // the night id being replaced, or null for a new one

const nightsApi = (what, body) =>
  fetch('/api/nights/' + what, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body || {})
  }).then(r => r.json());

const pctCell = v => v == null ? '<span class="dim">—</span>' : v.toFixed(1) + '%';

function renderStandings() {
  const rows = DOC.players;
  if (!rows.length) {
    $('#standings').innerHTML =
      '<span class="dim">No players yet — add some below, then record a night.</span>';
    $('#totals').textContent = '';
    return;
  }
  const best = Math.max(1, ...rows.map(r => r.score_pct || 0));
  $('#standings').innerHTML = `<table><thead><tr>
      <th>Player</th><th class="num">Nights</th><th class="num">W</th><th class="num">L</th>
      <th class="num">D</th><th class="num">Byes</th><th class="num">Games</th>
      <th class="num">Win%</th><th class="num">Score%</th><th data-nosort></th>
    </tr></thead><tbody>${rows.map(r => `<tr>
      <td class="name">${esc(r.name)}</td>
      <td class="num">${r.nights}</td>
      <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.d}</td>
      <td class="num">${r.byes || '<span class="dim">—</span>'}</td>
      <td class="num">${r.games}</td>
      <td class="num">${pctCell(r.win_pct)}</td>
      <td class="num">${pctCell(r.score_pct)}</td>
      <td><span class="bar" style="width:${Math.round(90 * (r.score_pct || 0) / best)}px"></span></td>
    </tr>`).join('')}</tbody></table>`;
  const t = DOC.totals || {};
  $('#totals').textContent =
    `${t.players} players · ${t.nights} nights · ${t.results_recorded} results` +
    (t.byes ? ` · ${t.byes} byes (not counted)` : '');
  sortable('#standings');
}

function renderPlayers() {
  $('#players').innerHTML = DOC.players.length
    ? `<table><thead><tr><th>Player</th><th class="num">Games</th><th data-nosort></th></tr></thead>
       <tbody>${DOC.players.map(p => `<tr>
         <td class="name">${esc(p.name)}</td><td class="num">${p.games}</td>
         <td><button data-drop="${esc(p.id)}">Remove</button></td></tr>`).join('')}</tbody></table>`
    : '<span class="dim">Nobody yet.</span>';
  $('#players').querySelectorAll('[data-drop]').forEach(b => {
    b.onclick = async () => {
      const p = DOC.players.find(x => x.id === b.dataset.drop);
      if (!confirm(`Remove ${p ? p.name : 'this player'} and every result recorded for them?`)) return;
      DOC = await nightsApi('remove-player', {id: b.dataset.drop});
      renderAll();
    };
  });
}

function renderEntry() {
  if (!DOC.players.length) {
    $('#entry').innerHTML = '<span class="dim">Add players first.</span>';
    return;
  }
  const prior = EDITING ? (DOC.nights.find(n => n.id === EDITING) || {}).results || {} : {};
  $('#entry').innerHTML = DOC.players.map(p => {
    const r = prior[p.id] || {};
    return `<div class="pcard" data-pid="${esc(p.id)}">
      <div class="who">${esc(p.name)}</div>
      <div class="fields">
        ${['w', 'l', 'd', 'b'].map(k => `<label>${{w: 'Win', l: 'Loss', d: 'Draw', b: 'Bye'}[k]}
          <input type="number" min="0" step="1" data-k="${k}" value="${r[k] || 0}"></label>`).join('')}
      </div></div>`;
  }).join('');
  // a card with nothing but byes is visually stood down, so a night's actual
  // players read at a glance
  $('#entry').querySelectorAll('.pcard input').forEach(i => {
    i.oninput = () => {
      const card = i.closest('.pcard');
      const vals = [...card.querySelectorAll('input')].map(x => +x.value || 0);
      card.classList.toggle('bye', vals[0] + vals[1] + vals[2] === 0 && vals[3] > 0);
    };
    i.dispatchEvent(new Event('input'));
  });
}

function renderNights() {
  $('#nights').innerHTML = DOC.nights.length
    ? `<table><thead><tr><th>Date</th><th>Format</th><th>Played</th><th class="num">Results</th>
         <th>Note</th><th data-nosort></th></tr></thead>
       <tbody>${[...DOC.nights].reverse().map(n => {
         const named = Object.entries(n.results).map(([pid, r]) => {
           const p = DOC.players.find(x => x.id === pid);
           const label = p ? p.name : pid;
           const played = r.w + r.l + r.d;
           return {label, played, bye: r.b, txt: played
             ? `${esc(label)} ${r.w}-${r.l}${r.d ? '-' + r.d : ''}`
             : `${esc(label)} <span class="dim">bye</span>`};
         });
         return `<tr>
           <td class="name">${esc(n.date)}</td>
           <td>${esc(n.format) || '<span class="dim">—</span>'}</td>
           <td class="mini">${named.map(x => x.txt).join(' · ') || '<span class="dim">nothing recorded</span>'}</td>
           <td class="num">${named.reduce((a, x) => a + x.played, 0)}</td>
           <td class="mini dim">${esc(n.note)}</td>
           <td><button data-edit="${esc(n.id)}">Edit</button>
               <button data-del="${esc(n.id)}">Delete</button></td></tr>`;
       }).join('')}</tbody></table>`
    : '<span class="dim">No nights recorded yet.</span>';

  $('#nights').querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = () => {
      const n = DOC.nights.find(x => x.id === b.dataset.edit);
      if (!n) return;
      EDITING = n.id;
      $('#nDate').value = n.date;
      $('#nFormat').value = n.format || '';
      $('#nNote').value = n.note || '';
      $('#editing').textContent = `editing ${n.date} — saving replaces it`;
      renderEntry();
      $('#nDate').scrollIntoView({behavior: 'smooth', block: 'center'});
    };
  });
  $('#nights').querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Delete this night?')) return;
      DOC = await nightsApi('remove-night', {id: b.dataset.del});
      if (EDITING === b.dataset.del) clearEntry();
      renderAll();
    };
  });
  sortable('#nights');
}

function clearEntry() {
  EDITING = null;
  $('#editing').textContent = '';
  $('#nFormat').value = '';
  $('#nNote').value = '';
  $('#nDate').value = new Date().toISOString().slice(0, 10);
  renderEntry();
}

function renderAll() {
  renderStandings();
  renderPlayers();
  renderNights();
  renderEntry();
  explain();
}

async function boot() {
  DOC = await (await fetch('/api/nights')).json();
  $('#meta').textContent = 'stored locally, never published';
  clearEntry();
  renderAll();

  $('#addPlayer').onclick = async () => {
    const name = $('#newPlayer').value.trim();
    if (!name) return;
    const res = await nightsApi('add-player', {name});
    if (res.error) return alert(res.error);
    DOC = res;
    $('#newPlayer').value = '';
    renderAll();
  };
  $('#newPlayer').onkeydown = e => { if (e.key === 'Enter') $('#addPlayer').click(); };

  $('#saveNight').onclick = async () => {
    const results = {};
    $('#entry').querySelectorAll('.pcard').forEach(card => {
      const r = {};
      card.querySelectorAll('input').forEach(i => { r[i.dataset.k] = +i.value || 0; });
      if (r.w || r.l || r.d || r.b) results[card.dataset.pid] = r;
    });
    if (!Object.keys(results).length) return alert('Nothing recorded for anyone.');
    const night = {id: EDITING, date: $('#nDate').value,
                   format: $('#nFormat').value, note: $('#nNote').value, results};
    const res = await nightsApi('set-night', {night});
    if (res.error) return alert(res.error);
    DOC = res;
    const was = EDITING;
    clearEntry();
    renderAll();
    $('#saveMsg').textContent = was ? 'night replaced' : 'night saved';
    setTimeout(() => { $('#saveMsg').textContent = ''; }, 2500);
  };
  $('#clearNight').onclick = () => { clearEntry(); renderAll(); };

  $('#exportBtn').onclick = () => {
    const doc = {players: DOC.players.map(p => ({id: p.id, name: p.name})),
                 nights: DOC.nights};
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 1)],
                                          {type: 'application/json'}));
    a.download = 'game_nights.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('#importBtn').onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (!file) return;
      let doc;
      try {
        doc = JSON.parse(await file.text());
      } catch (e) {
        return alert("That file isn't JSON: " + e.message);
      }
      if (!Array.isArray(doc.players) || !Array.isArray(doc.nights))
        return alert('That file has no players/nights in it.');
      if (!confirm(`Replace everything with ${doc.players.length} players and `
                   + `${doc.nights.length} nights?`)) return;
      DOC = await nightsApi('replace', {doc});
      clearEntry();
      renderAll();
    };
    inp.click();
  };
}

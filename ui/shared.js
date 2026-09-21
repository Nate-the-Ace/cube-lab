// Shared front-end helpers. Loaded by both index.html and cube.html — edit
// here rather than in either page, or they drift.


const $ = s => document.querySelector(s);
const money = v => v == null ? '—' : '$' + Number(v).toFixed(2);
const esc = s => (s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const tcgLink = id => id ? `<a href="https://www.tcgplayer.com/product/${id}" target="_blank" rel="noopener">TCG</a>` : '<span class="dim">—</span>';
const pipHtml = ci => [...(ci || 'C')].map(c => `<span class="pip ${c}" style="width:auto;height:auto;border:0;background:none">${c}</span>`).join('');

// Guilds, shards, wedges and the four-colour names, keyed by sorted letters so any
// input order resolves. Mirrors COLOR_NAMES in mtgdb.py.
const COLOR_NAMES = {
  '': 'Colorless', 'C': 'Colorless',
  'W': 'White', 'U': 'Blue', 'B': 'Black', 'R': 'Red', 'G': 'Green',
  'UW': 'Azorius', 'BU': 'Dimir', 'BR': 'Rakdos', 'GR': 'Gruul', 'GW': 'Selesnya',
  'BW': 'Orzhov', 'RU': 'Izzet', 'BG': 'Golgari', 'RW': 'Boros', 'GU': 'Simic',
  'BUW': 'Esper', 'BRU': 'Grixis', 'BGR': 'Jund', 'GRW': 'Naya', 'GUW': 'Bant',
  'BGW': 'Abzan', 'RUW': 'Jeskai', 'BGU': 'Sultai', 'BRW': 'Mardu', 'GRU': 'Temur',
  'BRUW': 'Yore-Tiller', 'BGRU': 'Glint-Eye', 'BGRW': 'Dune-Brood',
  'GRUW': 'Ink-Treader', 'BGUW': 'Witch-Maw',
  'BGRUW': 'Five-Color',
};
const ciLetters = ci => [...(ci || '').toUpperCase()].filter(c => 'WUBRG'.includes(c));
function ciName(ci) {
  const L = ciLetters(ci);
  if (!L.length) return 'Colorless';
  return COLOR_NAMES[L.slice().sort().join('')] || null;
}
// "UB" -> "UB (Dimir)"
function ciLabel(ci) {
  const L = ciLetters(ci);
  if (!L.length) return 'C (Colorless)';
  const n = ciName(ci);
  return n ? `${L.join('')} (${n})` : L.join('');
}
// pips followed by the combo's name, for table cells
// Un-set origin and tournament legality are separate facts: Unfinity printed 190
// cards that are genuinely legal, and Chaos Orb is legal nowhere without being an
// Un-card at all.
const KIND_LABEL = {token: 'token', emblem: 'emblem', art: 'art card',
                    oversized: 'oversized'};

function cardFlags(r) {
  let out = '';
  // tokens, emblems, Secret Lair art cards and oversized planes share the table
  // with real cards; everything is searchable, so label what isn't a real card
  if (r.kind && r.kind !== 'card') {
    out += ` <span class="badge" title="Not a playable card">${esc(KIND_LABEL[r.kind] || r.kind)}</span>`;
  }
  if (r.is_funny) out += ' <span class="badge" title="Printed in an Un-set (Unglued, Unhinged, Unstable, Unsanctioned, Unfinity or a playtest set). Always included in search.">Un</span>';
  if (r.tournament_legal === 0) out += ' <span class="badge bad" title="Not legal in any format">legal nowhere</span>';
  return out;
}

// ── colour identity as one icon ──
// A colour combination reads better as a single disc cut into equal wedges than
// as a row of separate symbols: you take in "this is the Dimir lane" at a glance
// without counting pips. The individual mana symbols are still available on
// hover, because the wedges alone don't tell you WHICH colours if you're new to
// the shorthand.
const MANA_SVG = c => `https://svgs.scryfall.io/card-symbols/${c}.svg`;
const MANA_FILL = {W: '#fffbd5', U: '#0e68ab', B: '#2b2117', R: '#d3202a',
                   G: '#00733e', C: '#cac5c0'};

function wedgePath(i, n, cx, cy, r) {
  if (n === 1) return null;                      // a whole circle, drawn separately
  const a0 = (-90 + (360 / n) * i) * Math.PI / 180;
  const a1 = (-90 + (360 / n) * (i + 1)) * Math.PI / 180;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = (360 / n) > 180 ? 1 : 0;
  return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} ` +
         `A${r},${r} 0 ${large},1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`;
}

function manaIcons(colors) {
  const L = ciLetters(colors);
  const list = L.length ? L : ['C'];
  return list.map(c => `<img class="mana" src="${MANA_SVG(c)}" alt="${c}">`).join('');
}

// one disc, split equally, hoverable for the individual symbols
function manaDisc(colors, size) {
  const L = ciLetters(colors);
  const list = L.length ? L : ['C'];
  const s = size || 18, r = s / 2, c = r;
  const body = list.length === 1
    ? `<circle cx="${c}" cy="${c}" r="${r - 0.5}" fill="${MANA_FILL[list[0]] || '#cac5c0'}"/>`
    : list.map((col, i) =>
        `<path d="${wedgePath(i, list.length, c, c, r - 0.5)}" fill="${MANA_FILL[col] || '#cac5c0'}"/>`
      ).join('');
  const name = ciName(colors);
  return `<span class="manadisc" data-mana="${esc(list.join(''))}"
      aria-label="${esc(name || list.join(''))}" tabindex="0">
      <svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" aria-hidden="true">
        ${body}<circle cx="${c}" cy="${c}" r="${r - 0.5}" fill="none"
        stroke="rgba(0,0,0,.45)" stroke-width="1"/>
      </svg></span>`;
}

// the disc followed by the combination's name
function manaLabel(colors) {
  const n = ciName(colors);
  return `<span class="manaset">${manaDisc(colors)}` +
         `${n ? `<span class="dim">${esc(n)}</span>` : ''}</span>`;
}

function ciCell(ci) {
  const n = ciName(ci);
  return `${pipHtml(ci)}${n ? ` <span class="dim">(${esc(n)})</span>` : ''}`;
}

/* theme */
$('#themeBtn').onclick = () => {
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('theme', r.dataset.theme); } catch (e) {}
};
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}

async function loadStats() {
  const s = await (await fetch('/api/stats')).json();
  $('#meta').textContent = `${Number(s.n_cards).toLocaleString()} cards · ${Number(s.n_printings).toLocaleString()} printings · prices ${String(s.scryfall_updated_at).slice(0,10)}`;
}

/* ── typeahead ──
   Attach an as-you-type picker to a text input. Suggestions come from the DB and
   are prefix-first, most-played-first, so one character is usually enough to pick
   the card you meant. Keyboard: ↑/↓ to move, Enter to choose, Esc to dismiss. */
function attachTypeahead(sel, kind, onPick, opts) {
  const input = $(sel);
  if (!input) return;
  opts = opts || {};
  const wrap = document.createElement('span');
  wrap.className = 'ta-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);
  const menu = document.createElement('div');
  menu.className = 'ta-menu hidden';
  menu.setAttribute('role', 'listbox');
  wrap.appendChild(menu);

  let items = [], active = -1, seq = 0, lastQuery = null;

  const close = () => { menu.classList.add('hidden'); active = -1; };
  const render = () => {
    if (!items.length) {
      menu.innerHTML = '<div class="ta-empty">no match</div>';
      menu.classList.remove('hidden');
      return;
    }
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    menu.innerHTML = items.map((it, i) => {
      const host = kind === 'commander' || kind === 'card' || kind === 'cube'
        ? (UUID.test(String(it.value || '')) ? ` data-oracle="${esc(it.value)}"`
                                             : ` data-card="${esc(it.label)}"`)
        : '';
      return `
      <div class="ta-item" role="option" data-i="${i}" aria-selected="${i === active}"${host}>
        ${it.icon ? `<img class="ta-icon" src="${esc(it.icon)}" alt="">` : ''}
        <b>${esc(it.label)}</b>
        <span class="h">${esc(it.hint || '')}</span>
        ${it.price_usd != null ? `<span class="p">${money(it.price_usd)}</span>` : ''}
      </div>`;
    }).join('');
    menu.classList.remove('hidden');
    [...menu.querySelectorAll('.ta-item')].forEach(el => {
      el.onmousedown = e => { e.preventDefault(); choose(+el.dataset.i); };
      el.onmouseenter = () => { active = +el.dataset.i; mark(); };
    });
  };
  const mark = () => [...menu.querySelectorAll('.ta-item')].forEach(
    (el, i) => el.setAttribute('aria-selected', i === active));
  const choose = i => {
    const it = items[i];
    if (!it) return;
    input.value = it.label;
    close();
    if (onPick) onPick(it);
  };

  let timer = null;
  const query = () => {
    const q = input.value.trim();
    if (q.length < 1) { items = []; close(); return; }
    if (q === lastQuery) return;
    lastQuery = q;
    const my = ++seq;
    fetch('/api/suggest?' + new URLSearchParams({q, kind, limit: opts.limit || 12}))
      .then(r => r.json())
      .then(d => {
        if (my !== seq) return;          // a newer keystroke already won
        items = d;
        active = items.length ? 0 : -1;
        render();
      }).catch(() => {});
  };

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(query, 110); });
  input.addEventListener('focus', () => { if (items.length) render(); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    const open = !menu.classList.contains('hidden');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) { lastQuery = null; query(); return; }
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(items.length, 1);
      mark();
      const el = menu.querySelector(`[data-i="${active}"]`);
      if (el) el.scrollIntoView({block: 'nearest'});
    } else if (e.key === 'Enter') {
      if (open && active >= 0) { e.preventDefault(); choose(active); }
    } else if (e.key === 'Escape') {
      close();
    }
  });
}

/* ── card preview ──
   Hover a card name or thumbnail and the full card appears, large enough to read.
   Deliberately delayed: without it, dragging the cursor down a table flashes an
   image for every row you cross. */
const CARD_HOVER_DELAY = 450;
const cardCache = new Map();
let cardTimer = null, cardToken = 0;

async function cardData(key, byId) {
    const cacheKey = (byId ? 'id:' : 'n:') + key;
    if (cardCache.has(cacheKey)) return cardCache.get(cacheKey);
    const p = new URLSearchParams(byId ? {oracle_id: key} : {name: key});
    const d = await (await fetch('/api/card-image?' + p)).json().catch(() => null);
    cardCache.set(cacheKey, d);
    return d;
}

// Formats worth showing on a hover card. Anything the card is banned or
// restricted in is always added, however obscure - that is the whole point.
const LEGAL_SHOW = ['Brawl', 'Commander', 'Legacy', 'Modern', 'Pauper',
                    'Pioneer', 'Standard', 'Vintage'];

function legalityBlock(L) {
    if (!L) return '';
    const head = `<div class="legal-head ${L.any_restriction ? 'bad' : 'ok'}">${esc(L.headline)}</div>`;
    const shown = L.formats.filter(f => LEGAL_SHOW.includes(f.label)
        || f.status === 'banned' || f.status === 'restricted');
    return head + `<div class="legal-grid">${shown.map(f => `
        <div><span>${esc(f.label)}</span>
        <span class="lg-${f.status}">${f.status === 'legal' ? 'legal'
            : f.status === 'not_legal' ? '—' : esc(f.status_label.toLowerCase())}</span></div>`).join('')}</div>`;
}

function placeCardPop(x, y) {
    const box = $('#cardpop');
    const w = box.offsetWidth || 300, h = box.offsetHeight || 420;
    let left = x + 20, top = y - h / 2;
    if (left + w > window.innerWidth - 10) left = x - w - 20;     // flip to the left
    if (left < 10) left = 10;
    top = Math.min(Math.max(10, top), window.innerHeight - h - 10);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
}

function hideCard() {
    clearTimeout(cardTimer);
    cardToken++;
    $('#cardpop').classList.add('hidden');
}

function showCardFor(el, x, y) {
    const name = el.dataset.card || el.dataset.cardName;
    const oid = el.dataset.oracle;
    if (!name && !oid) return;
    clearTimeout(cardTimer);
    const my = ++cardToken;
    cardTimer = setTimeout(async () => {
        const d = await cardData(oid || name, !!oid);
        if (my !== cardToken || !d || d.error) return;
        const box = $('#cardpop');
        const imgs = d.faces && d.faces.length ? d.faces : (d.image ? [d.image] : []);
        const flags = (d.is_funny ? '<span class="badge">Un-set</span> ' : '')
            + (d.tournament_legal === 0 ? '<span class="badge bad">legal nowhere</span>' : '');
        box.innerHTML = (imgs.length
            ? imgs.map(u => `<img src="${esc(u)}" alt="${esc(d.name)}">`).join('') +
              `<div class="meta"><span data-set="${esc(d.set_code || '')}">${esc((d.set_code || '').toUpperCase())} ${esc(d.rarity || '')}</span>
               <span>${esc(ciLabel(d.color_identity))}</span>
               <span>${money(d.price_usd)}</span></div>`
            : `<div class="fallback"><b>${esc(d.name)}</b>${esc(d.mana_cost || '')}
               <div>${esc(d.type_line || '')}</div>
               <div class="rules">${esc(d.oracle_text || '')}</div>
               <div class="meta"><span>no image</span><span>${money(d.price_usd)}</span></div></div>`)
            + (flags ? `<div class="legal-head">${flags}</div>` : '')
            + (typeof CARD_NOTE === 'function'
                 ? (CARD_NOTE(d) || legalityBlock(d.legality))
                 : legalityBlock(d.legality));
        box.classList.remove('hidden');
        placeCardPop(x, y);
    }, CARD_HOVER_DELAY);
}

let cardHost = null;

function hostFor(target) {
    const el = target.closest && target.closest('[data-card], [data-oracle], img.thumb');
    if (!el) return null;
    if (el.matches('img.thumb') && !el.dataset.card && !el.dataset.oracle) {
        const row = el.closest('tr');
        return (row && row.querySelector('[data-card], [data-oracle]')) || null;
    }
    return el;
}

document.addEventListener('mouseover', e => {
    const el = hostFor(e.target);
    if (!el || el === cardHost) return;   // moving within the same card, not a new one
    cardHost = el;
    showCardFor(el, e.clientX, e.clientY);
});
document.addEventListener('mouseout', e => {
    if (!cardHost) return;
    // mouseout also fires when the pointer moves onto a CHILD of the same cell,
    // which would cancel the preview the instant it was about to appear
    const to = e.relatedTarget;
    if (to && cardHost.contains(to)) return;
    if (hostFor(to || document.body) === cardHost) return;
    cardHost = null;
    hideCard();
});
document.addEventListener('mousemove', e => {
    const box = $('#cardpop');
    if (!box.classList.contains('hidden')) placeCardPop(e.clientX, e.clientY);
});
window.addEventListener('scroll', hideCard, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard(); });

/* ── collapsible result sections ──
   The cube page runs long, so each heading folds. State is kept per section in
   localStorage: the whole block is rebuilt on every analysis, so anything held
   only in the DOM would be thrown away the moment you re-ran it. */
const SEC_KEY = 'cube-open-sections';
const SEC_DEFAULT_OPEN = ['where-the-opportunity-is', 'pairs-worth-trying'];

function readOpenSections() {
  try {
    const raw = localStorage.getItem(SEC_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set(SEC_DEFAULT_OPEN);
}
function writeOpenSections(set) {
  try { localStorage.setItem(SEC_KEY, JSON.stringify([...set])); } catch (e) {}
}

function collapsibleSections(scope) {
  const root = document.querySelector(scope);
  if (!root) return;
  const open = readOpenSections();
  [...root.querySelectorAll('h3.sec')].forEach(h => {
    if (h.closest('details.sec-block')) return;          // already wrapped
    const key = h.textContent.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const det = document.createElement('details');
    det.className = 'sec-block';
    det.dataset.sec = key;
    const sum = document.createElement('summary');
    h.parentNode.insertBefore(det, h);
    sum.appendChild(h);
    det.appendChild(sum);
    // everything up to the next heading belongs to this section
    let n = det.nextSibling;
    while (n && !(n.nodeType === 1 && n.matches && n.matches('h3.sec'))) {
      const next = n.nextSibling;
      det.appendChild(n);
      n = next;
    }
    // a row count on the summary, so a folded section still says how much is in it
    const rows = det.querySelectorAll('tbody tr').length;
    if (rows) {
      const c = document.createElement('span');
      c.className = 'sec-count';
      c.textContent = rows + (rows === 1 ? ' row' : ' rows');
      sum.appendChild(c);
    }
    det.open = open.has(key);
    det.addEventListener('toggle', () => {
      const cur = readOpenSections();
      det.open ? cur.add(key) : cur.delete(key);
      writeOpenSections(cur);
    });
  });
}

function setAllSections(state) {
  const keys = new Set();
  document.querySelectorAll('#cubeOut details.sec-block').forEach(d => {
    d.open = state;
    if (state) keys.add(d.dataset.sec);
  });
  writeOpenSections(keys);
}

/* ── colour disc hover: show which colours the wedges are ── */
function showMana(el) {
  const cols = [...(el.dataset.mana || '')];
  if (!cols.length) return;
  const box = $('#manapop');
  const name = ciName(cols.join(''));
  box.innerHTML = cols.map(c => `<img src="${MANA_SVG(c)}" alt="${c}">`).join('')
    + (name ? `<b>${esc(name)}</b>` : '');
  box.classList.remove('hidden');
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  let left = Math.min(Math.max(8, r.left - 6), window.innerWidth - b.width - 8);
  let top = r.bottom + 6;
  if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}
const hideMana = () => $('#manapop').classList.add('hidden');
document.addEventListener('mouseover', e => {
  const el = e.target.closest('.manadisc');
  if (el) showMana(el);
});
document.addEventListener('mouseout', e => { if (e.target.closest('.manadisc')) hideMana(); });
document.addEventListener('focusin', e => {
  const el = e.target.closest('.manadisc'); if (el) showMana(el);
});
document.addEventListener('focusout', e => { if (e.target.closest('.manadisc')) hideMana(); });
window.addEventListener('scroll', hideMana, true);

/* ── set symbols, as a font ──

   Scryfall serves the symbols as SVGs from svgs.scryfall.io, a different host
   from the card images, and it is not reliably reachable - it answered nothing
   here and drew a broken image on the page. Keyrune is the same symbols as a
   webfont, loaded from a CDN, so a symbol is a glyph rather than a request that
   can fail on its own.

   Keyrune by Andrew Gioia (keyrune.andrewgioia.com), font under OFL-1.1. The
   list below is which set codes it has a glyph for, read out of its stylesheet
   - a class it does not define renders nothing at all, and silently, so the
   page has to know before it asks. Promo sets are prefixed p and carry no
   symbol of their own; they wear their parent set's, which is the same code
   without the p. Regenerate with:
     curl -s https://cdn.jsdelivr.net/npm/keyrune@3.19.0/css/keyrune.css \
       | grep -o '\.ss-[a-z0-9]*:before' | sed 's/[^-]*-//;s/:before//' | sort -u
*/
const KEYRUNE = new Set(`
  10e 1e 2e 2ed 2u 2x2 2xm 30a 3e 3ed 40k 4ed 5dn 5ed 6ed 7ed 8ed 9ed a25 acr aer afc
  afr akh akr ala all ann apc arb arc arn ath atq avr azorius bbd bcore bfz big blb
  blc bng bok boros bot br brb brc bro brr btd c13 c14 c15 c16 c17 c18 c19 c20 c21
  cc1 cc2 chk chr clb clu cm1 cm2 cma cmc cmd cmm cmr cn2 cns con csp dd2 ddc ddd dde
  ddf ddg ddh ddi ddj ddk ddl ddm ddn ddo ddp ddq ddr dds ddt ddu dft dgm dimir dis
  dka dkm dmc dmr dmu dom dpa drb drc drk dsc dsk dst dtk duels dvk e01 e02 ea1 ecc
  ecl eld ema emn eoc eoe eos eve evg exo exp fca fdc fdn fem fic fin fra frf fut gk1
  gk2 gn2 gn3 gnt golgari gpt grn gruul gs1 gtc h09 h17 ha1 hbg hml hob hoc hop hou
  htr htr17 ice ice2 iko ima inr inv isd izzet j20 j21 j22 j25 j25a jmp jou jud khc
  khm kld klr ktk lcc lci lea leb leg lgn lrw ltc ltr m10 m11 m12 m13 m14 m15 m19 m20
  m21 m3c mar mat mb1 mb2 mbs md1 me1 me2 me3 me4 med mh1 mh2 mh3 mic mid mir mkc mkm
  mm2 mm3 mma mmq moc modo mom mor mp1 mp2 mps mrd msc msh mul ncc nec nem neo nms
  nph ody ogw om1 omb onc one ons ori orzhov otc otj otp p02 papac parl parl2 parl3
  past pbook pc2 pca pcy pd2 pd3 pdep pdrc peuro pfnm pgru pheart pidw pio pip plc
  pleaf pls pm2 pma pmei pmodo pmps pmpu pmtg1 pmtg2 po2 por psalvat05 psalvat11
  psega psld psum ptg ptk ptsa pxbox pz1 pz2 pza rakdos rav ren rex rin rix rna roe
  rtr rvr s00 s99 scd scg selesnya shm simic sir sis sld sld2 slu snc soa soc soi sok
  som sos spe spg spm ss1 ss2 ss3 sta sth stx td2 tdc tdm thb ths tla tle tmc tmp tmt
  tor tpr tsp tsr uds ugl ulg uma una und unf unh usg ust v09 v0x v10 v11 v12 v13 v14
  v15 v16 v17 van vis vma voc vow w16 w17 war who woc woe wot wth wwk x2ps x4ea xcle
  xdnd xduels xice xkld xlcu xln xmods xren xrin xssm y22 y23 y24 y25 y26 yblb ybro
  ydft ydmu ydsk yeoe ylci ymid ymkm yneo yone yotj ysnc ytdm ywoe zen znc zne znr
`.trim().split(/\s+/));

function setSymbol(code) {
    const c = (code || '').toLowerCase();
    if (!c) return '';
    // an exact match first, then the parent set a promo code hangs off
    const hit = KEYRUNE.has(c) ? c
        : (c[0] === 'p' && KEYRUNE.has(c.slice(1))) ? c.slice(1) : '';
    return hit ? `<i class="ss ss-${hit}" aria-hidden="true"></i>` : '';
}

/* An <img> that fails to load leaves a broken-image glyph, which reads as a bug
   in the page rather than a missing picture. Take it out instead, and let the
   caller re-measure whatever it was sitting in. */
function dropOnError(img, then) {
    if (!img) return;
    const gone = () => { img.remove(); if (then) then(); };
    img.onerror = gone;
    if (img.complete && !img.naturalWidth) gone();
}

/* ── set symbols ──
   A three-letter set code tells you nothing on its own, so hovering one shows the
   set's real name and symbol. Shorter delay than the card preview: it's a small
   popup and you're usually checking one specific code. */
const SET_HOVER_DELAY = 250;
const setCache = new Map();
let setTimer = null, setToken = 0, setHost = null;

async function setData(code) {
    const key = code.toLowerCase();
    if (setCache.has(key)) return setCache.get(key);
    const d = await fetch('/api/set?code=' + encodeURIComponent(code))
        .then(r => r.json()).catch(() => null);
    setCache.set(key, d);
    return d;
}

function hideSet() {
    clearTimeout(setTimer);
    setToken++;
    setHost = null;
    $('#setpop').classList.add('hidden');
}

function showSet(el) {
    const code = el.dataset.set;
    if (!code) return;
    clearTimeout(setTimer);
    const my = ++setToken;
    setTimer = setTimeout(async () => {
        const d = await setData(code);
        if (my !== setToken || !d || d.error) return;
        const box = $('#setpop');
        const facts = [
            d.released_at ? `released ${esc(d.released_at)}` : null,
            d.card_count ? `${d.card_count.toLocaleString()} cards` : null,
            d.set_type_label ? esc(d.set_type_label) : null,
            d.parent_name ? `part of ${esc(d.parent_name)}` : null,
        ].filter(Boolean);
        box.innerHTML = `<div class="row1">
              ${setSymbol(d.code)}
              <span><b>${esc(d.name)}</b><span class="code">${esc(d.code)}</span></span>
            </div>
            <div class="facts">${facts.join('<br>')}</div>`;
        box.classList.remove('hidden');
        const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
        let left = Math.min(Math.max(8, r.left - 6), window.innerWidth - b.width - 8);
        let top = r.bottom + 6;
        if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
        box.style.left = left + 'px';
        box.style.top = top + 'px';
    }, SET_HOVER_DELAY);
}

document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-set]');
    if (!el || el === setHost) return;
    setHost = el;
    showSet(el);
});
document.addEventListener('mouseout', e => {
    if (!setHost) return;
    const to = e.relatedTarget;
    if (to && setHost.contains(to)) return;      // moving onto a child, not away
    hideSet();
});
window.addEventListener('scroll', hideSet, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideSet(); });

/* ── explainers ──
   One glossary, attached automatically wherever a matching label or column header
   is rendered. Tables are rebuilt on every query, so this runs after each render
   rather than being written into the markup. */
const GLOSSARY = {
  // ─ prices and the dial ─
  'price': ['Price', 'Cheapest paper printing, TCGPlayer market price, refreshed daily.'],
  '$': ['Price', 'Cheapest paper printing, TCGPlayer market price, refreshed daily.'],
  'unit': ['Unit price', 'Cheapest printing of this card, per copy.'],
  'line': ['Line total', 'Unit price × quantity.'],
  'how much price matters': ['Price sensitivity', 'A dial, not a mode. At 0 price is ignored and cards are ranked purely by how often they are played. At 1 they are ranked by play rate per dollar, which buys more staples but skews cheap. Ranking is play_rate ÷ price^sensitivity.'],
  'price weight': ['Price weight', 'How much "this card is expensive" counts toward cutting it. Turn it down and cuts are decided on deck quality alone.'],
  'budget $': ['Budget', 'Leave it blank for no ceiling — the deck gets built as it is actually played and you are told what it costs.'],
  'max per card $': ['Per-card ceiling', 'Refuses any single card above this price, even if the total budget could absorb it.'],
  'bare minimum': ['Baseline cost', 'What the cheapest legal card for every slot would cost. Anything above this is upgrades.'],
  // ─ popularity ─
  'played': ['Play rate', "Share of this commander's EDHREC decks that run the card. 53% means about half of them."],
  'decks': ['Deck count', 'How many decks EDHREC has recorded.'],
  'synergy': ['Synergy', 'How much MORE a strategy plays a card than decks in general do. This is what "serves the plan" means — ranking by raw play rate just resurfaces Sol Ring for every goal.'],
  'real staples': ['Staples', 'Cards this commander genuinely plays, as opposed to filler bought to fill a slot.'],
  'filler': ['Filler', 'A slot the budget could not afford a played card for, filled with the cheapest legal option.'],
  'overlap': ['Overlap', "How strongly two cards share commanders: for every commander running your card, its other staples score by how often they're played."],
  // ─ cut picker ─
  'measured': ['Measured here', 'How this lane has actually performed in recorded games, from the game-night records: wins plus half a draw each, over matches played. The only signal on this page taken from this cube rather than someone else\u2019s format \u2014 and the smallest, so read it with the match count beside it. A three-colour deck counts toward each of its pairs.'],
  // pack 1 pick 1, and proposing a change
  'deck': ['Possible deck', 'A colour pair you could build from the cards you drafted. Everything that fits inside those colours counts, colourless included.'],
  'playables': ['Playables', 'Non-land cards in your pool that fit inside this pair\u2019s colours. A 40-card deck needs 23 of them alongside 17 lands.'],
  'short by': ['Short by', 'How many playables this pair still needs to reach 23. Zero means you could actually register the deck; anything else means you would be filling slots with cards that do not belong.'],
  'avg pick score': ['Average pick score', 'The mean score of the best 23 playables in this pair. It carries the same warning as everywhere else on this page: it contains no measure of raw card power.'],
  'pairs': ['Pairs among your picks', 'How many of the cards you drafted in these colours want to be beside each other, from the lift pairs. This is the number that separates a pile of good cards from a deck.'],
  'record': ['Record in recorded games', 'How this colour pair has actually performed in the recorded game nights. Blank where you have never drafted it.'],
  'curve 1-6': ['Mana curve', 'How many playables cost 1, 2, 3, 4, 5 and 6+. A deck that is all fours and fives loses to one that is not, whatever the individual cards are worth.'],
  'comes back?': ['Comes back on the wheel?', 'With P players, the pack you pass returns after P picks, so a pack of N cards comes back with N \u2212 P left. The question a first pick really asks is not \u201cwhich is best\u201d but \u201cwhich will still be here next time\u201d. This assumes the other drafters take the cards ranked highest on this page \u2014 they do not share that ranking, so read it as which cards are OBVIOUS, which is most of what wheeling turns on.'],
  'pick score': ['Pick score', 'The components to the right, weighted. It contains NO measure of raw card power \u2014 nothing on this page measures that \u2014 so a dull card in a winning lane will outrank a bomb in a losing one. Treat it as an argument, not a verdict.'],
  'lane record': ['Lane record', 'How this card\u2019s colours have actually performed in recorded games, against the average of all ten lanes. The only measured component, and the smallest sample: a few dozen matches per lane.'],
  'keeps options open': ['Keeps options open', 'How little the card commits you. Colourless closes nothing, mono-colour closes little, gold closes most of the ten lanes. This matters for a first pick and is meaningless by the third. Lands score low here: a land is the fixing, not a way of keeping your spells\u2019 options open.'],
  'cube pull': ['Cube pull', 'How hard the rest of the cube wants to be in a deck with this card, summed over its above-chance lift pairs. Summed rather than averaged, because a card six cube cards want is a better bet than one wanted intensely by a single card that may never reach you.'],
  'then look for': ['Then look for', 'The cards the cube most wants beside the one you just took, by lift. None are guaranteed to reach you \u2014 that is what the draft odds are for.'],
  'keep a look out for': ['Keep a look out for', 'The running answer to \u201cwhat should I take next\u201d: the union of the lift partners of everything you have taken so far, minus what you already have. It sharpens as the draft goes on.'],
  'why it pairs': ['Why it pairs', 'What kind of pair this is, which decides how much it counts. Kinds that only mean \u201cthe same sort of card\u201d (instants, creatures, creature removal, card draw) are pushed down: decks that play one cheap burn spell play the others, which is true and is not a reason to draft both. Kinds that describe an interaction (engine, archetype, typal, tokens) rank above them.'],
  'pulled by': ['Pulled by', 'How many of the cards you have already taken point at this one. Several picks agreeing is a far stronger signal than any single pair.'],
  'fits your colours': ['Fits your colours', 'Whether the card is castable in the two colours you have most of so far. The only thing on this list that knows what deck you are actually building.'],
  'because of': ['Because of', 'Which of your picks put this card on the list.'],
  'least missed': ['Least missed', 'Ranked by how little the rest of the cube is connected to the card, NOT by how weak it is \u2014 nothing here measures card power. It will happily suggest cutting something that is simply good on its own. Lowest connection first.'],
  'cube connection': ['Cube connection', 'How much the rest of the cube wants to be in a deck with this card, summed over its above-chance lift pairs. A low number means losing it costs the cube few interactions; it does not mean the card is bad.'],
  'others doing its job': ['Others doing its job', 'How many other cards in the cube serve the same function, read from card text and Scryfall tags. A high number means the cube would not notice the loss.'],
  'why it is least missed': ['Why it is least missed', 'The reasons behind the ranking, in plain terms. \u201cNothing stands out\u201d means the card is a normal member of a crowded slot.'],
  'effect on the cube': ['Effect on the cube', 'What the swap does to colour, curve and type counts. Usually nothing: both directions hold the slot \u2014 same colours, same card type, within a mana value \u2014 so the proposal is a swap and not a quiet change to the cube\u2019s shape.'],
  'put this in': ['Put this in', 'Format-legal cards outside the cube that fill the slot being emptied, ranked by how hard the rest of the cube pulls toward them.'],
  'because it pairs with': ['Because it pairs with', 'The cards already in your cube that most want this one, with the lift between them.'],
  // game-night tracker
  'w': ['Wins', 'Matches won.'],
  'l': ['Losses', 'Matches lost.'],
  'd': ['Draws', 'Matches that ended level. Counted as half a win in Score%, and not at all in Win%.'],
  'byes': ['Byes', 'Rounds sat out because the table had an odd number of players. Recorded so a night adds up, but kept out of every rate below — a bye is not a match anyone played, and counting it would reward not playing.'],
  'matches': ['Matches played', 'Wins plus losses plus draws. The unit is the match, not the game: a round is a best-of-three, so a 0-2 round is one loss here, not two. Byes are excluded.'],
  'nights': ['Nights', 'Game nights this player has a result recorded for.'],
  'win%': ['Win rate', 'Matches won outright as a share of matches played. Draws count against it; byes are excluded.'],
  'score%': ['Match score', 'Wins plus half a draw each, as a share of matches played — the usual Swiss convention, and the column the table sorts by.'],
  'score': ['Cut score', 'Weighted blend of the five signals to the right. Higher means safer to cut.'],
  'unplayed here': ['Unplayed by this commander', "How rarely this commander's decks run the card. Rarely played, safe to cut."],
  'unpopular': ['Unplayed generally', 'How rarely anyone runs the card, across every commander.'],
  'redundant': ['Redundant', 'How much the card duplicates the job of the card going in — measured from shared rules-text vocabulary.'],
  'type fit': ['Type fit', 'Whether cutting it keeps the deck\'s type balance, since the incoming card is the same type.'],
  'frees $': ['Money freed', 'How much of the budget cutting this card returns.'],
  // ─ combos ─
  'status': ['Novel or known', 'Whether this interaction appears in the 110,355-combo Commander Spellbook database.<span class="warn">"Novel" means "not in that database" — NOT that it is verified to work. The parser reads card text; it does not know the rules.</span>'],
  'novel': ['Not in the combo database', 'Generated from card text and not matched to any known combo. A lead to check by hand, not a verified combo.'],
  'known': ['Already documented', 'This interaction is in the Commander Spellbook database.'],
  'rediscovery rate': ['Rediscovery rate', 'How often this template\'s candidates land on combos people already documented. It is the honest quality measure: a template that cannot re-find known combos cannot be trusted on new ones.<span class="warn">Shown as n/a for the sacrifice templates — they find bounded engines that cost mana each loop, which by definition never appear in a database of infinite combos.</span>'],
  'candidates': ['Candidates', 'Interactions generated by matching parsed card text against loop shapes. Popularity is never an input, so a pair nobody has played scores the same as a famous one.'],
  'already known': ['Already known', 'Candidates that turned out to be combos already in the database — the ones that prove the template works.'],
  'what it does': ['Mechanism', 'The loop as the analysis understands it, with the mana or cost accounting that makes it work.'],
  'add a winning payoff': ['Payoffs', 'A two-card loop is an engine, not a kill. This attaches a third card that converts it into a win — a mana sink for infinite mana, a drain trigger for infinite enter-the-battlefield triggers. Commander Spellbook is mostly 3- and 4-card entries for exactly this reason: 49,966 of its combos are three cards, against only 5,207 two-card ones.'],
  'interaction shape': ['Template', 'The loop shape being searched for. Each has a measured reliability; blink engine and cost-reduction mana are the trustworthy ones, the sacrifice templates are noisy.'],
  // ─ cube and draft ─
  'pieces': ['Pieces', 'How many separate cards the combo needs. More pieces, much longer odds.'],
  'mana value': ['Mana value', "The cube's curve, counting spells only — lands have no mana value and would flatten it."],
  'share of spells': ['Share', 'What fraction of the non-land cards sit at this mana value.'],
  'card type': ['Card type', 'How the list splits across card types. Nothing here says what the split should be; it is a description, not a target.'],
  'power': ['Power', "Average EDHREC play rate of this lane's twenty best spells — a proxy for raw card quality. It comes from multiplayer Commander, so it transfers loosely: it says \"these cards are strong\" much better than it says \"this strategy is strong\". EDHREC archetype data is not used anywhere in the cube analysis."],
  'opportunity': ['Opportunity', 'Depth times the quality of what sits in the lane. It is a ranking, not a score with units.'],
  "you've drafted": ['Times drafted', 'How many recorded decks contained both colours of this lane, including three-colour decks that happen to span it.'],
  'spells': ['Spells', 'Non-land cards in the cube that fit inside this lane. Lands are excluded because fixing serves every lane.'],
  'type': ['Type', 'In the pairs table: why these two keep sharing decks. <b>typal</b> — same creature type. <b>engine</b> — one card does something the other wants. <b>creature removal / card draw / tokens</b> — both do the same job. <b>archetype</b> — both belong to the same strategy. <b>general</b> — they co-occur far more than chance but the link isn\'t named in the data, which is where the odd ideas hide. <b>mana base / land + spell</b> — fixing, hidden by default.<br><br>Elsewhere: the card\'s printed type line.'],
  'include mana base in pairs': ['Include the mana base', 'Adds back pairs where one or both cards are lands. They are excluded by default because duals share decks with everything in their colours: half of all pairs in this cube are a land meeting a spell, which tells you about fixing rather than about an interaction.'],
  'lift': ['Lift', 'How many times more often these two cards appear in the same deck than their individual popularity would predict. Lift of 1 is coincidence — two good cards meeting. Lift of 40 means decks that play one specifically go and find the other, which is the signature of a real interaction rather than two strong cards coexisting.'],
  'decks together': ['Shared decks', 'How many commanders\' decks run both cards. This is the evidence behind the lift: a pairing proven across hundreds of decks is worth more than two obscure cards meeting in six, and the ranking accounts for that.'],
  'pairs above chance': ['Pairs above chance', 'Pairs in your cube that appear together more than their individual popularity predicts.'],
  'why it might work': ['Mechanism', 'A guess from the parsed rules text at what the two cards are doing for each other. Annotation only — it never affects the ranking, and a blank just means the parser could not name the link, not that there is none.'],
  'pair': ['Pair', 'Two cards from your cube. Hover either name to read the card.'],
  'drafts to hit': ['Drafts to hit', 'How many drafts you would expect to need before all the pieces come to you. Simply 1 ÷ odds.'],
  'odds': ['Draft odds', 'The chance you draft every piece in one draft, shown as a headline plus its range. Two things have to happen: the card has to be opened at the table at all (fixed by pod size and pack count), and it has to survive the drafters between its opener and your seat. That second part depends on how much everyone else wants it, so the number is given three ways: the large figure is a normal amount of competition, and the pair beneath it is uncontested (nobody else in your lane) first, then contested (everyone first-picks it).<span class="warn">Pieces are treated as independent, which slightly overstates it — they compete for your own picks and for pack space. Read it as an upper bound.</span>'],
  'p(draft': ['Chance of drafting enough', 'The chance you draft at least the number of cards the tactic needs, shown with its range — the large figure at normal competition, then uncontested and contested beneath. A broad archetype holds up even when contested; a thin one only works when nobody else is in your lane, which is what the spread tells you.'],
  'odds on any one card': ['Per-card odds', 'Chance you end up with one specific cube card: it has to be opened at all, then survive the drafters between its pack\'s opener and your seat.'],
  'players': ['Players', 'Seats at the table. More seats means more cards opened but more competition for each one \u2014 and on Pack 1 Pick 1 it sets the wheel, since the pack returns to you after this many picks. On a phone, swipe a card up to take it.'],
  'pack size': ['Pack size', 'Cards per pack. Bigger packs mean a card has to survive fewer picks before it wheels back to you.'],
  'packs each': ['Packs per player', 'How many packs each drafter opens over the draft.'],
  'cards in cube': ['Cards in cube', 'How many cards in your list serve this tactic.'],
  'expect to draft': ['Expected count', 'How many of these cards should actually reach you across the whole draft. More interpretable than a probability of clearing some arbitrary threshold.'],
  'support': ['Support', 'Depth weighted by how strongly those cards belong to the strategy. Raw counts just favour whatever is most numerous.'],
  'lane': ['Colour lane', 'A colour pair. This is how cube drafting actually works — pick a lane and see how deep it runs.'],
  'deck total': ['Deck total', 'Sum of the cheapest printing of every card in the list.'],
  'per card': ['Average per card', 'Deck total divided by the number of cards.'],
  'not legal': ['Illegal cards', 'Cards banned or not legal in the chosen format.'],
  'unmatched': ['Unmatched names', "Lines that didn't resolve to a card — usually a typo or a name too new for the current data snapshot."],
  '#': ['Quantity', 'How many copies the list asks for.'],
  'cut this': ['Recommended cut', 'The highest-scoring candidate — the safest card to remove for the one coming in.'],
  'cut': ['Candidate', 'A card you said you would consider cutting.'],
  'why': ['Reasoning', 'The signals behind this score, in plain terms.'],
  'budget': ['Budget', 'The ceiling you set. Blank means no limit.'],
  'no budget set': ['No budget', 'Nothing was capped, so this is what the deck actually costs as played.'],
  'the shortlist, all in': ['Shortlist cost', 'What every card shown here would cost together — not a deck, just the shortlist.'],
  'not in the combo db': ['Not in the database', 'Candidates with no match in Commander Spellbook.<span class="warn">Unverified leads, not confirmed combos.</span>'],
  'combo': ['Combo', 'Every piece is in your cube, so it can actually be drafted.'],
  'interaction': ['Interaction', 'Proposed from card text alone. Verify before trusting it.'],
  'tactic': ['Tactic — click to list the cards', 'A strategy the cube holds cards for. Expanding a row shows every card in your cube that serves it, ordered by synergy: how much more this strategy plays a card than decks in general do.'],
  'p': ['Probability', 'Chance of drafting at least the stated number of cards for this tactic.'],
  'source': ['Source', 'Whether this came from the rules-text parser or from Scryfall\'s function tags.'],
  'colours': ['Colour pair', 'The two colours that define this lane.'],
  'commanders that play this plan': ['Commanders for this plan', 'Commanders whose EDHREC decks most often run this strategy, with what each one costs.'],
  'cards that define the plan': ['Strategy cards', 'Ranked by synergy — how much MORE this strategy plays them than decks in general do. These are the cards that make the deck what it is.'],
  'generic staples it still wants': ['Generic staples', 'Cards almost every deck runs. Kept in their own list so they cannot crowd out the strategy cards above.'],
  'combos that live entirely in this cube': ['Assemblable combos', 'Known combos where every piece is in your cube list, so they can actually be drafted.'],
  'interactions our own card-text analysis proposes': ['Generated interactions', 'Found by parsing card text, not from decklists.<span class="warn">Not verified — check each one against the actual rules.</span>'],
  'tactics this cube supports': ['Tactics', 'Strategies the cube has depth for.<span class="warn">Theme data is Commander-shaped and will report set mechanics as archetypes. Trust the lanes and composition more.</span>'],
  'what the cube is made of': ['Composition', 'Counted from parsed card text and Scryfall function tags. Format-neutral, so it describes any cube honestly.'],
  'colour lanes': ['Colour lanes', 'Depth per colour pair — the signal that actually drives cube picks.'],
  'mono': ['Mono-coloured', 'Cards of a single colour inside this pair, so they are playable in other lanes too.'],
  'gold': ['Gold cards', 'Multicolour cards locked to this exact pair.'],
  'things the cube does': ['Things the cube does', 'How many distinct effects the cube has six or more cards for, read from card text and Scryfall\u2019s function tags. This replaced a count of EDHREC themes, which on a Pioneer cube reported Dandan and Planechase as archetypes.'],
  'does this': ['Function — click to list the cards', 'What the card does, read from its rules text by the parser or taken from Scryfall\'s function tags. Format-neutral, unlike the theme data.'],
  'combos you could actually assemble': ['Self-contained combos', 'Known combos that need nothing beyond the cards they name, with every one of those cards in your cube.'],
  'need a piece the cube may lack': ['Incomplete combos', 'Combos whose named cards are all in your cube but which also require something unnamed — "a way to give it lifelink", "a persist creature". Where that requirement is a keyword, the cube is checked for it.'],
  'add this': ['Missing piece', 'A card that is not in your cube but whose combo partners all are. Adding it completes the combo outright.'],
  'completes': ['Combos completed', 'How many combos this one card would finish. A card that completes several is worth more than one that finishes a single obscure line.'],
  'what it finishes': ['The combos', 'The full combo each addition would complete, and what it produces. Every other card listed is already in your cube.'],
  'also needs': ['Also needs', 'What the combo requires beyond the cards it names. Commander Spellbook records these separately from the card list, which is why a "two-card combo" can still be unassemblable: 52,768 of its 110,355 entries carry one.'],
  // ─ search and general ─
  'colour identity fits': ['Colour identity', 'Returns cards that fit INSIDE the identity you pick, i.e. cards legal in that commander\'s deck — not only cards that are exactly those colours.'],
  'legal': ['Legality', 'The card\'s status in the format chosen in this column\'s filter. Pick “any format” to stop filtering by legality at all. Hover a card name to see every format at once, with bans and restrictions called out.'],
  'ci': ['Colour identity', 'Every mana symbol on the card, including in its rules text. This is what decides which commanders can run it.'],
  'mv': ['Mana value', 'Total cost of the card, formerly "converted mana cost".'],
  'format': ['Format', 'Restricts results to cards legal in that format.'],
  'printing': ['Printing', 'The set and rarity of the cheapest printing. Hover the set code for the set\'s full name, symbol and release date. Click to sort by most reprinted, again for newest.'],
  'role': ['Role', 'Support jobs detected in the card\'s rules text: ramp, draw, removal, board wipe.'],
  'produces': ['Result', 'What the combo actually does once assembled.'],
  'matching cards': ['Matches', 'Total cards matching your filters, across every page.'],
  'what should the deck do?': ['Goal', 'Plain English. It resolves to real EDHREC strategy pages through an alias table — no AI, and it tells you what it matched and why.'],
  'commander (optional, sharpens it)': ['Commander context', "Naming a commander lets the ranking use how often that commander's decks actually run each card, which is the strongest signal available."],
  'commander': ['Commander', 'Start typing and pick from the list. Suggestions are ordered by how many decks EDHREC has for each one.'],
  'text / name': ['Search text', 'Matches card names, rules text and type lines. Type a few letters and pick a specific card from the list, or press Enter to search the text of every card.'],
  'type line': ['Type line', 'Filters on the card\'s printed type: Creature, Instant, Artifact, or something narrower like Goblin. Naming any non-land type also keeps lands out of the results.'],
  'max $': ['Price ceiling', 'Optional. Leave it empty and price is not a filter at all.'],
  'max $ per card': ['Price ceiling', 'Optional. Hides cards above this price so a cheap pool can be browsed on its own.'],
  'set': ['Set', 'As a column: which set the cheapest printing comes from — hover the code for the full name, symbol and release date. As a filter: restrict results to one set. Type a name and pick from the list, or just enter the three-letter code. All 1,051 sets are here, every promo run and one-off included.'],
  'avg price, page': ['Average price', 'Mean price of the cards on this page only, not of all matches.'],
  'card': ['Card', 'Click the name to open it on Scryfall.'],
  'expensive card': ['Card to replace', 'The card you cannot afford or do not own. Suggestions are ranked by how often they appear alongside the same commanders.'],
  'budget cap $': ['Replacement ceiling', 'Only suggests alternatives at or below this price.'],
  'card going in': ['Incoming card', 'The card you want to add. Everything else is ranked by how safe it is to cut to make room for it.'],
  'treat as a full decklist': ['Whole-deck mode', 'Reads the box as a decklist rather than a few candidate names, and leaves lands and the commander out of the cuts.'],
  'colour identity': ['Colour identity', 'Restricts results to cards playable in that identity. Use the letters WUBRG, e.g. UB for Dimir.'],
  'hide known combos': ['Hide known combos', 'Shows only candidates that are not already in the Commander Spellbook database. The rediscovery rate above is still measured over all candidates.'],
  'refresh list': ['Refresh from Cube Cobra', "Re-pulls this cube's list so the analysis matches the live cube, and shows you exactly what changed.<span class=\"warn\">Cube Cobra's robots.txt asks automated clients to stay off the routes that serve cube lists — the reason they give is server cost. This fires only when you press it, never automatically, one request, with a cooldown. If you'd rather not, the site's own download button plus the file importer does the same job.</span>"],
  'delete selected cube': ['Delete cube', 'Removes the stored card list for the cube currently selected above. Nothing else is touched, and re-importing the file brings it straight back.'],
  'your cubes': ['Saved cubes', 'Cubes you have imported. They persist, so you can re-analyse one any time.'],
  'cube cobra id': ['Cube Cobra id', 'The short id from the cube\'s URL, e.g. cubecobra.com/cube/list/modovintage → modovintage.'],
  'save as': ['Cube name', 'What to call this cube locally.'],
  'or a file': ['Import a file', 'A Cube Cobra CSV export (the maybeboard is ignored) or a plain list with one card name per line.'],
  'cheapest': ['Cheapest printing', "The lowest market price across every paper printing of this card, from Scryfall's daily TCGPlayer data. Foil-only cards fall back to their foil price and are marked. Click to sort cheapest first, click again for priciest."],
};

function tipMarkup(key) {
  return `<span class="tip" tabindex="0" role="button" aria-label="Explain" data-tip="${esc(key)}">i</span>`;
}

// For explanations built from data rather than written into the glossary. `body`
// is plain text; blank lines and newlines survive into the popup.
function tipInline(title, body) {
  return '<span class="tip" tabindex="0" role="button" aria-label="Explain"'
    + ' data-tip-title="' + esc(title) + '"'
    + ' data-tip-body="' + esc(body) + '">i</span>';
}

// Attach a marker to any label, header, stat caption or badge whose text matches
// a glossary entry. Safe to run repeatedly - it skips anything already decorated.
function explain(scope) {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return;
  const candidates = [...root.querySelectorAll('th, label, .stat span, h3.sec')];
  candidates.forEach(el => {
    if (el.querySelector('.tip')) return;
    // A <th> that only contains a <label> reads as the same text as that label,
    // so both matched and both got a marker. Always annotate the innermost one.
    if (candidates.some(other => other !== el && el.contains(other))) return;
    const key = el.textContent.trim().toLowerCase().replace(/\s+/g, ' ')
      .replace(/\s*\(.*$/, '').replace(/[:*]$/, '');
    let entry = GLOSSARY[key];
    if (!entry) {
      // stat captions read like "known combos in the cube"; headers may carry units
      const alt = Object.keys(GLOSSARY).find(k => k.length > 3 && key.startsWith(k));
      entry = alt ? GLOSSARY[alt] : null;
      if (entry) el.dataset.tipKey = alt;
    }
    if (!entry) return;
    const markup = tipMarkup(el.dataset.tipKey || key);
    // A <label> here is a column flexbox (caption above control), so appending to
    // the label puts the marker on its own row. Attach it to the caption text.
    if (el.tagName === 'LABEL') {
      const textNode = [...el.childNodes].find(
        n => n.nodeType === 3 && n.textContent.trim());
      if (textNode) {
        const holder = document.createElement('span');
        holder.className = 'lbl';
        el.insertBefore(holder, textNode);
        holder.appendChild(textNode);
        holder.insertAdjacentHTML('beforeend', markup);
        return;
      }
    }
    el.insertAdjacentHTML('beforeend', markup);
  });
}

const tipbox = () => $('#tipbox');
function showTip(el) {
  let title, body;
  if (el.dataset.tipTitle) {                 // built from data, not the glossary
    title = el.dataset.tipTitle;
    body = esc(el.dataset.tipBody || '').replace(/\n/g, '<br>');
  } else {
    const entry = GLOSSARY[el.dataset.tip];
    if (!entry) return;
    title = entry[0];
    body = entry[1];
  }
  const box = tipbox();
  box.innerHTML = `<b>${esc(title)}</b>${body}`;
  box.classList.remove('hidden');
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  let left = Math.min(Math.max(8, r.left - 8), window.innerWidth - b.width - 8);
  let top = r.bottom + 8;
  if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 8);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
}
const hideTip = () => tipbox().classList.add('hidden');

// delegated, so it keeps working through every re-render
document.addEventListener('mouseover', e => {
  const t = e.target.closest('.tip');
  if (t) showTip(t);
});
document.addEventListener('mouseout', e => { if (e.target.closest('.tip')) hideTip(); });
document.addEventListener('focusin', e => { const t = e.target.closest('.tip'); if (t) showTip(t); });
document.addEventListener('focusout', e => { if (e.target.closest('.tip')) hideTip(); });
document.addEventListener('click', e => {
  const t = e.target.closest('.tip');
  if (!t) return hideTip();
  e.preventDefault();
  e.stopPropagation();          // a tip inside a sortable header must not sort it
  tipbox().classList.contains('hidden') ? showTip(t) : hideTip();
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
window.addEventListener('scroll', hideTip, true);

/* ── sortable tables ──
   Click a header to sort the rendered rows. Cells carry data-sort when what they
   display isn't what they should sort by ("$1.30", "68%", "—"). Blank and "—"
   always sink to the bottom, whichever direction you sort. */
function cellValue(row, i) {
  const cell = row.cells[i];
  if (!cell) return null;
  const raw = cell.dataset.sort;
  if (raw !== undefined) {
    if (raw === '' || raw === 'null') return null;
    const n = parseFloat(raw);
    return isNaN(n) ? raw.toLowerCase() : n;
  }
  const txt = cell.textContent.trim();
  if (!txt || txt === '—') return null;
  // strip the units a number can wear here: $ 1,234.5 % \u00d7 and a leading +
  const bare = txt.replace(/[$,%\s\u00d7x]/gi, '');
  const n = parseFloat(bare);
  if (!isNaN(n) && /^[-+]?\d*\.?\d+$/.test(bare)) return n;
  return txt.toLowerCase();
}

// The search table is paginated server-side, so its sort has to survive the
// re-render that answering a click causes.
// The table headers ARE the sort control: there is no dropdown. `key` is what the
// server gets, `col`/`dir` drive the arrow on the header.
let SEARCH_SORT = {col: 'price', dir: 'asc', key: 'price'};

function sortable(scope) {
  explain(scope);          // headers are rebuilt on every query, so re-decorate
  document.querySelectorAll(scope + ' table').forEach(tb => {
    const head = tb.tHead && tb.tHead.rows[0];
    if (!head || !tb.tBodies[0]) return;
    [...head.cells].forEach((th, i) => {
      if ('nosort' in th.dataset) return;
      if (!th.textContent.trim()) return;
      th.classList.add('sortable');
      // restore the marker after a re-render
      if (th.dataset.serverSort && th.dataset.serverSort === SEARCH_SORT.col) {
        th.dataset.dir = SEARCH_SORT.dir;
        th.classList.add('sorted');
      }
      th.onclick = () => {
        // a header wired to a server sort re-queries, so sorting covers every
        // page of results rather than just the rows on screen
        if (th.dataset.serverSort) {
          // a second click on the same header switches to its alternate sort
          // (priciest first, or newest printing) where the server offers one
          const col = th.dataset.serverSort, alt = th.dataset.serverSortAlt;
          const dir = (SEARCH_SORT.col === col && SEARCH_SORT.dir === 'asc' && alt)
            ? 'desc' : 'asc';
          SEARCH_SORT = {col, dir, key: (dir === 'desc' && alt) ? alt : col};
          return runSearch(0);
        }
        const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
        [...head.cells].forEach(c => { delete c.dataset.dir; c.classList.remove('sorted'); });
        th.dataset.dir = dir;
        th.classList.add('sorted');
        const body = tb.tBodies[0];
        const rows = [...body.rows];
        rows.sort((a, b) => {
          const A = cellValue(a, i), B = cellValue(b, i);
          if (A === null && B === null) return 0;
          if (A === null) return 1;            // blanks last, always
          if (B === null) return -1;
          const num = typeof A === 'number' && typeof B === 'number';
          const c = num ? A - B : String(A).localeCompare(String(B));
          return dir === 'asc' ? c : -c;
        });
        rows.forEach(r => body.appendChild(r));
      };
    });
  });
}

/* ── in-table filters ──
   The filters ARE the header, the same way the headers are the sort control.
   A column opts in with data-filter on its <th>:

     text   substring match on the cell, as you type
     pick   a dropdown built from the values actually present in the column
     min    numeric floor ("at least")
     max    numeric ceiling ("at most")

   These tables are rendered from data already in the page, so filtering is row
   visibility - no re-query, and it works identically on the published snapshot
   where there is no server to re-query. */
function filterable(scope) {
  document.querySelectorAll(scope + ' table').forEach(tb => {
    const head = tb.tHead && tb.tHead.rows[0], body = tb.tBodies[0];
    if (!head || !body) return;
    const cols = [...head.cells];
    if (!cols.some(th => th.dataset.filter)) return;
    if (tb.tHead.querySelector('tr.filters')) return;      // already built

    const row = tb.tHead.insertRow(-1);
    row.className = 'filters';
    const controls = [];

    cols.forEach((th, i) => {
      const cell = row.insertCell(-1);
      cell.dataset.nosort = '';
      const kind = th.dataset.filter;
      if (!kind) return;
      const clean = th.cloneNode(true);
      clean.querySelectorAll('.tip').forEach(t => t.remove());
      const label = clean.textContent.trim().replace(/\s+/g, ' ');

      let use = kind;
      if (kind === 'pick') {
        const distinct = new Set([...body.rows]
          .map(r => ((r.cells[i] || {}).textContent || '').trim().replace(/\s+/g, ' ')));
        // a column with a value per row is a text box, not a menu - but it still
        // gets a filter, rather than silently getting none
        if (distinct.size > 40) use = 'text';
      }
      if (use === 'pick') {
        const sel = document.createElement('select');
        const seen = [...new Set([...body.rows]
          .map(r => (r.cells[i] || {}).textContent || '')
          .map(t => t.trim().replace(/\s+/g, ' ')).filter(Boolean))].sort();
        sel.innerHTML = '<option value="">any</option>'
          + seen.map(v => `<option>${esc(v)}</option>`).join('');
        cell.appendChild(sel);
        controls.push({i, kind: use, el: sel});
      } else {
        const inp = document.createElement('input');
        inp.type = use === 'text' ? 'text' : 'number';
        inp.placeholder = use === 'min' ? 'min' : use === 'max' ? 'max'
          : label.toLowerCase().slice(0, 14);
        if (use !== 'text') inp.step = 'any';
        cell.appendChild(inp);
        controls.push({i, kind: use, el: inp});
      }
    });

    // a count of what the filters are hiding, so an empty table is never a mystery
    const note = document.createElement('div');
    note.className = 'mini dim filter-note';
    note.hidden = true;
    tb.parentNode.insertBefore(note, tb.nextSibling);

    const numeric = txt => {
      const n = parseFloat(String(txt).replace(/[$,%\s]/g, '').replace(/,/g, ''));
      return isNaN(n) ? null : n;
    };
    const apply = () => {
      const active = controls.filter(c => String(c.el.value).trim() !== '');
      let hidden = 0;
      [...body.rows].forEach(r => {
        const show = active.every(c => {
          const txt = ((r.cells[c.i] || {}).textContent || '').trim();
          const v = String(c.el.value).trim();
          if (c.kind === 'text') return txt.toLowerCase().includes(v.toLowerCase());
          if (c.kind === 'pick') return txt.replace(/\s+/g, ' ') === v;
          const n = numeric(txt);
          if (n === null) return false;
          return c.kind === 'min' ? n >= parseFloat(v) : n <= parseFloat(v);
        });
        r.hidden = !show;
        if (!show) hidden++;
      });
      note.hidden = !hidden;
      note.textContent = hidden
        ? `${hidden.toLocaleString()} row${hidden === 1 ? '' : 's'} hidden by the filters above`
        : '';
    };

    let t = null;
    controls.forEach(c => {
      const go = () => {
        clearTimeout(t);
        // typing debounces; a dropdown answers at once
        t = setTimeout(apply, c.kind === 'pick' ? 0 : 200);
      };
      c.el.addEventListener('input', go);
      c.el.addEventListener('change', go);
    });
  });
}

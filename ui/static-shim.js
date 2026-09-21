// Answer the cube page's API calls from data baked into the file.
//
// The page is ui/cube.html unchanged - same shared.js, same cube.js - so every
// feature it has locally it has here: card previews, set symbols, sortable
// tables, tooltips, lane picks. Only the transport differs. window.fetch is
// wrapped, /api/* routes are served from UI_DATA, and anything else falls
// through to the real network.
//
// Draft-dependent numbers are the one thing that cannot be frozen: they move
// with the sliders. They are recomputed here from the same arithmetic as
// cube.py, so a change to that file has to be mirrored in draftOdds() below.
(function () {
  const D = window.UI_DATA;
  if (!D) return;

  /* ---- cube.py's draft maths, kept in step with p_single_card ---------- */
  function draftShape(n, players, pack, rounds) {
    const used = players * rounds * pack;
    return {cube_size: n, players, pack_size: pack, rounds, cards_used: used,
            picks_each: rounds * pack,
            fraction_of_cube_seen_by_table: n ? Math.min(1, used / n) : 0,
            oversubscribed: used > n};
  }
  function draftOdds(n, players, pack, rounds, contention) {
    const shape = draftShape(n, players, pack, rounds);
    const opened = shape.fraction_of_cube_seen_by_table;
    let total = 0;
    for (let d = 0; d < players; d++) {
      let survive = 1;
      for (let j = 0; j < d; j++) {
        const left = Math.max(1, pack - j);
        survive *= Math.max(0, 1 - (contention + (1 - contention) / left));
      }
      total += survive;
    }
    const reaches = total / players;
    return {shape, p_opened: opened, p_reaches_you: reaches,
            p_you_get_it: opened * reaches};
  }
  // binomial tail, via log-gamma so a 150-card tactic doesn't overflow
  const lnFact = n => { let t = 0; for (let i = 2; i <= n; i++) t += Math.log(i); return t; };
  function atLeastK(n, k, p) {
    if (n <= 0) return 0;
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let tot = 0;
    for (let i = k; i <= n; i++) {
      tot += Math.exp(lnFact(n) - lnFact(i) - lnFact(n - i)
                      + i * Math.log(p) + (n - i) * Math.log(1 - p));
    }
    return Math.min(1, tot);
  }

  // Mirrors cube.py's BAND: every odds number is reported at three contention
  // levels rather than one the reader has to choose.
  const BAND = {low: 0.0, mid: 0.35, high: 0.8};
  const bandOf = fn => {
    const out = {};
    for (const k in BAND) out[k] = fn(BAND[k]);
    return out;
  };

  const num = (qs, k, dflt) => {
    const v = parseFloat(qs.get(k));
    return Number.isFinite(v) ? v : dflt;
  };
  function settings(qs) {
    return {
      players: num(qs, 'players', 8), pack: num(qs, 'pack_size', 15),
      rounds: num(qs, 'rounds', 3), contention: num(qs, 'contention', 0.35),
    };
  }

  /* ---- the routes ------------------------------------------------------ */
  const clone = v => JSON.parse(JSON.stringify(v));

  const ROUTES = {
    '/api/cubes': () => D.cubes,
    '/api/stats': () => D.stats,

    '/api/cube/balance': () => D.balance,
    '/api/cube/p1p1': () => D.p1p1,

    // Remove-a-card was precomputed at export time: it needs the whole Pioneer
    // pool and the deck data behind lift, neither of which is in the page.
    // Add-a-card is computed here instead, because it only needs the incoming
    // card's slot - and that comes from Scryfall - plus numbers each cube card
    // already carries.
    '/api/cube/propose': qs => {
      const remove = (qs.get('remove') || '').trim();
      if (remove) {
        const me = findCard(remove);
        if (!me) return {error: 'no card called "' + remove + '"'};
        const list = (D.replacements || {})[me.oracle_id];
        if (!list) return {error: me.name + ' is not in the cube'};
        return {
          mode: 'add', format: 'pioneer',
          removing: cardRow(me), slot: slotOf(me), considered: null,
          candidates: list.map(c => ({
            oracle_id: c.o, name: c.n, cmc: c.c, type_line: c.t,
            pull: c.p, completes_combos: c.k,
            partners: (c.w || []).map(n => ({name: n})),
            delta: {},          // every precomputed swap holds the slot
          })),
        };
      }
      return null;             // the add direction is async; handled below
    },
    '/api/cube/near-misses': () => D.near_misses,

    '/api/cube/opportunities': qs => {
      const s = settings(qs), o = draftOdds(D.opportunities.cube_size, s.players, s.pack, s.rounds, s.contention);
      const out = clone(D.opportunities);
      out.per_card_odds = round4(o.p_you_get_it);
      out.lanes.forEach(l => { l.expected_drafted = round1(l.cards_in_cube * o.p_you_get_it); });
      return out;
    },

    '/api/cube/synergies': qs => {
      const s = settings(qs), o = draftOdds(D.synergies.cube_size, s.players, s.pack, s.rounds, s.contention);
      const out = clone(D.synergies);
      out.per_card_odds = round4(o.p_you_get_it);
      out.pairs.forEach(p => {
        p.p_draft_both = round4(Math.pow(o.p_you_get_it, 2));
        p.p_both_band = bandOf(c => round4(Math.pow(
          draftOdds(D.synergies.cube_size, s.players, s.pack, s.rounds, c).p_you_get_it, 2)));
      });
      return out;
    },

    '/api/cube/tactics': qs => {
      const s = settings(qs), o = draftOdds(D.tactics.cube_size, s.players, s.pack, s.rounds, s.contention);
      const out = clone(D.tactics);
      const need = out.need || 6;
      out.per_card = round4(o.p_you_get_it);
      out.shape = o.shape;
      out.contention = s.contention;
      out.tactics.forEach(t => {
        t.expected_drafted = round1(t.cards_in_cube * o.p_you_get_it);
        t.p_draft_enough = round4(atLeastK(t.cards_in_cube, need, o.p_you_get_it));
        t.p_enough_band = bandOf(c => round4(atLeastK(t.cards_in_cube, need,
          draftOdds(D.tactics.cube_size, s.players, s.pack, s.rounds, c).p_you_get_it)));
      });
      (out.lanes || []).forEach(l => {
        l.expected_drafted = round1(l.cards_in_cube * o.p_you_get_it);
      });
      return out;
    },

    '/api/cube/combos': qs => {
      const s = settings(qs), o = draftOdds(D.combos.cube_size, s.players, s.pack, s.rounds, s.contention);
      const out = clone(D.combos);
      out.single_card = {p_opened: o.p_opened, p_reaches_you: o.p_reaches_you,
                         p_you_get_it: o.p_you_get_it};
      out.single_card_band = bandOf(c => round4(
        draftOdds(D.combos.cube_size, s.players, s.pack, s.rounds, c).p_you_get_it));
      out.shape = o.shape;
      out.contention = s.contention;
      [].concat(out.known || [], out.candidates || []).forEach(c => {
        const pieces = c.n_cards || (c.cards || []).length || 2;
        const p = Math.pow(o.p_you_get_it, pieces);
        c.p_draft = round4(p);
        c.drafts_to_hit = p > 0 ? round1(1 / p) : null;
        c.p_draft_band = bandOf(x => round4(Math.pow(
          draftOdds(D.combos.cube_size, s.players, s.pack, s.rounds, x).p_you_get_it, pieces)));
      });
      return out;
    },

    '/api/cube/picks': qs => {
      const s = settings(qs), o = draftOdds(D.opportunities.cube_size, s.players, s.pack, s.rounds, s.contention);
      const lane = (qs.get('colors') || '').toUpperCase();
      const key = Object.keys(D.picks).find(k => sameColors(k, lane));
      const rows = clone(D.picks[key] || []);
      rows.forEach(r => { r.p_reaches_you = round4(o.p_you_get_it); });
      return rows;
    },
  };

  const BROAD = t => {
    t = (t || '').split(' \u2014')[0];
    for (const k of ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker',
                     'Instant', 'Sorcery', 'Battle'])
      if (t.includes(k)) return k;
    return 'Other';
  };
  const ciOf = c => [...((c.color_identity) || '')]
    .filter(x => 'WUBRG'.includes(x)).join('');
  const slotOf = c => ({colors: ciOf(c), cmc: c.cmc || 0, type: BROAD(c.type_line)});
  const cardRow = c => ({oracle_id: c.oracle_id, name: c.name,
                         color_identity: ciOf(c), cmc: c.cmc, type_line: c.type_line});
  const findCard = name => (D.p1p1.cards || []).find(
    c => c.name.toLowerCase() === name.toLowerCase())
    || (D.p1p1.cards || []).find(c => c.name.toLowerCase().startsWith(name.toLowerCase()));

  // Add-a-card: look the newcomer up on Scryfall for its slot, then rank the
  // cube cards that fill the same slot by how little the cube is connected to
  // them - the same ordering cube.py uses.
  async function proposeCut(name) {
    const inCube = findCard(name);
    if (inCube) return {error: inCube.name + ' is already in the cube'};
    const c = await sfJson('https://api.scryfall.com/cards/named?fuzzy='
                           + encodeURIComponent(name));
    if (!c) return {error: 'no card called "' + name + '"'};
    const incoming = {oracle_id: c.oracle_id, name: c.name, cmc: c.cmc,
                      type_line: c.type_line,
                      color_identity: (c.color_identity || []).join('')};
    const slot = slotOf(incoming);
    const cands = (D.p1p1.cards || []).filter(x =>
      ciOf(x) === slot.colors && BROAD(x.type_line) === slot.type
      && Math.abs((x.cmc || 0) - slot.cmc) <= 1);
    cands.sort((a, b) => (a.connected || 0) - (b.connected || 0)
                      || (b.redundancy || 0) - (a.redundancy || 0));
    return {
      mode: 'cut', adding: cardRow(incoming), slot, considered: cands.length,
      candidates: cands.slice(0, 12).map(x => ({
        oracle_id: x.oracle_id, name: x.name, cmc: x.cmc, type_line: x.type_line,
        connected: x.connected || 0, others_doing_its_job: x.redundancy || 0,
        why: [
          !x.connected ? 'nothing in the cube pairs with it above chance'
            : x.connected < 20 ? 'only loosely connected to the rest of the cube' : null,
          (x.redundancy || 0) >= 20
            ? x.redundancy + ' other cards already do its job' : null,
          (x.lane || 0) < -3 ? 'its colours are underperforming in recorded games' : null,
        ].filter(Boolean),
        delta: {},             // same colours, same type, within a mana value
      })),
    };
  }

  const round1 = v => Math.round(v * 10) / 10;
  const round4 = v => Math.round(v * 10000) / 10000;
  const sameColors = (a, b) =>
    [...(a || '')].sort().join('') === [...(b || '')].sort().join('');

  // Writes need a server. Say so plainly rather than failing silently - the
  // page shows the message in the same place it shows a server error.
  const READ_ONLY = {'/api/cube/import': 1, '/api/cube/refresh': 1, '/api/cube/delete': 1};

  /* ---- Scryfall answers the lookups that aren't cube data -------------- */
  // Formats the local tool reports, in its order, so the hover card reads the
  // same here as it does locally.
  const FORMATS = [
    ['alchemy', 'Alchemy'], ['brawl', 'Brawl'], ['commander', 'Commander'],
    ['duel', 'Duel Commander'], ['explorer', 'Explorer'], ['future', 'Future Standard'],
    ['gladiator', 'Gladiator'], ['historic', 'Historic'], ['legacy', 'Legacy'],
    ['modern', 'Modern'], ['oathbreaker', 'Oathbreaker'], ['oldschool', 'Old School'],
    ['pauper', 'Pauper'], ['paupercommander', 'Pauper Commander'], ['penny', 'Penny Dreadful'],
    ['pioneer', 'Pioneer'], ['predh', 'Pre-EDH'], ['premodern', 'Premodern'],
    ['standard', 'Standard'], ['standardbrawl', 'Standard Brawl'], ['timeless', 'Timeless'],
    ['vintage', 'Vintage'],
  ];
  const STATUS_LABEL = {legal: 'Legal', not_legal: 'Not legal',
                        banned: 'Banned', restricted: 'Restricted'};

  function legalityOf(card) {
    const L = card.legalities || {};
    const formats = FORMATS.map(([key, label]) => {
      const status = L[key] || 'not_legal';
      return {format: key, label, status, status_label: STATUS_LABEL[status] || status};
    });
    const legal = formats.filter(f => f.status === 'legal').length;
    const restricted = formats.filter(f => f.status === 'banned' || f.status === 'restricted');
    return {
      headline: restricted.length
        ? `${restricted[0].status_label} in ${restricted.map(f => f.label).join(', ')}`
        : `Legal in ${legal} format${legal === 1 ? '' : 's'}`,
      any_restriction: restricted.length > 0,
      formats,
    };
  }

  const NOT_A_CARD = '-layout:art_series -is:token -is:emblem -is:oversized';

  const big = u => (u || '').replace('/normal/', '/large/');

  function asCard(c) {
    const faces = (c.card_faces || [])
      .map(f => big((f.image_uris || {}).large || (f.image_uris || {}).normal))
      .filter(Boolean);
    const own = c.image_uris || {};
    const prices = c.prices || {};
    const usd = prices.usd || prices.usd_foil || prices.usd_etched;
    return {
      name: c.name, oracle_id: c.oracle_id,
      image: big(own.large || own.normal) || faces[0] || null,
      faces: faces.length > 1 ? faces : null,
      legality: legalityOf(c),
      type_line: c.type_line, mana_cost: c.mana_cost,
      color_identity: (c.color_identity || []).join(''),
      is_funny: c.set_type === 'funny' ? 1 : 0,
      tournament_legal: Object.values(c.legalities || {})
        .some(v => v === 'legal' || v === 'restricted') ? 1 : 0,
      oracle_text: c.oracle_text
        || (c.card_faces || []).map(f => f.oracle_text).filter(Boolean).join('\n//\n'),
      price_usd: usd ? parseFloat(usd) : null,
      set_code: c.set, rarity: c.rarity,
      scryfall_uri: c.scryfall_uri,
      tcgplayer_id: c.tcgplayer_id || null,
    };
  }

  async function sfJson(url) {
    const r = await realFetch(url);
    return r.ok ? r.json() : null;
  }

  async function scryfall(path, qs) {
    if (path === '/api/card-image') {
      // The page looks cards up by oracle_id wherever it has one, which is most
      // of the time - a name-only shim silently showed nothing.
      const oid = qs.get('oracle_id'), name = qs.get('name') || '';
      let c = null;
      if (oid) {
        // Order by price and the cheapest print of a card is often not a card:
        // an art series print (a painting on the front, the artist's signature
        // on the back) or the token version. Both carry the name and render as
        // a double-faced card with no rules text, so exclude them by layout.
        const j = await sfJson('https://api.scryfall.com/cards/search?order=usd&dir=asc&q='
                               + encodeURIComponent('oracleid:' + oid + ' ' + NOT_A_CARD));
        c = j && (j.data || [])[0];
      }
      if (!c && name) {
        c = await sfJson('https://api.scryfall.com/cards/named?fuzzy='
                         + encodeURIComponent(name));
      }
      return c ? asCard(c) : {error: 'not found'};
    }
    if (path === '/api/legality') {
      const oid = qs.get('oracle_id');
      const j = oid && await sfJson('https://api.scryfall.com/cards/search?q='
                                    + encodeURIComponent('oracleid:' + oid + ' ' + NOT_A_CARD));
      const c = j && (j.data || [])[0];
      return c ? legalityOf(c) : {error: 'not found'};
    }
    if (path === '/api/set') {
      const code = (qs.get('code') || '').toLowerCase();
      const s = await sfJson('https://api.scryfall.com/sets/' + encodeURIComponent(code));
      if (!s) return {error: 'unknown set code'};
      return {code: s.code, name: s.name, set_type: s.set_type,
              released_at: s.released_at, icon_svg_uri: s.icon_svg_uri,
              icon: s.icon_svg_uri, card_count: s.card_count};
    }
    if (path === '/api/suggest') {
      const q = (qs.get('q') || '').trim().toLowerCase();
      const limit = parseInt(qs.get('limit'), 10) || 12;
      if (!q) return [];
      const mine = (D.p1p1.cards || [])
        .filter(c => c.name.toLowerCase().includes(q))
        .sort((a, b) => (a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
                     || a.name.localeCompare(b.name))
        .slice(0, limit)
        .map(c => ({label: c.name, value: c.oracle_id,
                    hint: (c.type_line || '').split(' \u2014')[0]}));
      if (mine.length >= limit || q.length < 2) return mine;

      const j = await sfJson('https://api.scryfall.com/cards/autocomplete?q='
                             + encodeURIComponent(q));
      const have = new Set(mine.map(m => m.label.toLowerCase()));
      const rest = ((j || {}).data || [])
        .filter(n => !have.has(n.toLowerCase()))
        .slice(0, limit - mine.length)
        .map(name => ({label: name, value: name, hint: 'not in the cube'}));
      return mine.concat(rest);
    }
    return null;
  }

  const realFetch = window.fetch.bind(window);
  const reply = body => new Response(JSON.stringify(body),
    {status: 200, headers: {'Content-Type': 'application/json'}});

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith('/api/')) return realFetch(input, init);
    const u = new URL(url, location.origin);
    const path = u.pathname, qs = u.searchParams;

    if (READ_ONLY[path]) {
      return reply({error: 'This is a published snapshot of the cube — importing, '
                         + 'refreshing and deleting need the full tool running locally.'});
    }
    if (path === '/api/cube/propose' && (qs.get('add') || '').trim()) {
      return reply(await proposeCut(qs.get('add').trim()));
    }
    if (ROUTES[path]) {
      const r = ROUTES[path](qs);
      if (r !== null) return reply(r);
    }
    const live = await scryfall(path, qs);
    if (live) return reply(live);
    return reply({error: 'not available in the published page: ' + path});
  };
})();

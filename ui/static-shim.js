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
      out.pairs.forEach(p => { p.p_draft_both = round4(Math.pow(o.p_you_get_it, 2)); });
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
      out.shape = o.shape;
      out.contention = s.contention;
      [].concat(out.known || [], out.candidates || []).forEach(c => {
        const p = Math.pow(o.p_you_get_it, c.n_cards || (c.cards || []).length || 2);
        c.p_draft = round4(p);
        c.drafts_to_hit = p > 0 ? round1(1 / p) : null;
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

  const round1 = v => Math.round(v * 10) / 10;
  const round4 = v => Math.round(v * 10000) / 10000;
  const sameColors = (a, b) =>
    [...(a || '')].sort().join('') === [...(b || '')].sort().join('');

  // Writes need a server. Say so plainly rather than failing silently - the
  // page shows the message in the same place it shows a server error.
  const READ_ONLY = {'/api/cube/import': 1, '/api/cube/refresh': 1, '/api/cube/delete': 1};

  /* ---- Scryfall answers the three lookups that aren't cube data -------- */
  async function scryfall(path, qs) {
    if (path === '/api/card-image') {
      const name = qs.get('name') || '';
      const r = await realFetch('https://api.scryfall.com/cards/named?fuzzy='
                                + encodeURIComponent(name));
      if (!r.ok) return {error: 'not found'};
      const c = await r.json();
      const face = (c.image_uris ? c : (c.card_faces || [])[0]) || {};
      const img = (face.image_uris || {});
      return {name: c.name, image: img.normal || img.large || img.small,
              scryfall_uri: c.scryfall_uri, type_line: c.type_line,
              mana_cost: c.mana_cost, oracle_text: c.oracle_text};
    }
    if (path === '/api/set') {
      const code = (qs.get('code') || '').toLowerCase();
      const r = await realFetch('https://api.scryfall.com/sets/' + encodeURIComponent(code));
      if (!r.ok) return {error: 'unknown set code'};
      const s = await r.json();
      return {code: s.code, name: s.name, set_type: s.set_type,
              released_at: s.released_at, icon_svg_uri: s.icon_svg_uri,
              card_count: s.card_count};
    }
    if (path === '/api/suggest') {
      const q = qs.get('q') || '';
      if (q.length < 2) return [];
      const r = await realFetch('https://api.scryfall.com/cards/autocomplete?q='
                                + encodeURIComponent(q));
      if (!r.ok) return [];
      const j = await r.json();
      return (j.data || []).map(name => ({name}));
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
    if (ROUTES[path]) return reply(ROUTES[path](qs));
    const live = await scryfall(path, qs);
    if (live) return reply(live);
    return reply({error: 'not available in the published page: ' + path});
  };
})();

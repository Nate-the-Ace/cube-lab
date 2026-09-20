#!/usr/bin/env python3
"""Load the EDHREC cache into the SQLite DB (additive - does not touch card tables).

Tables:
  edh_commanders  one row per commander page
  edh_inclusions  commander x card: how many decks run it, and EDHREC's synergy score
  edh_avg_deck    the average 100-card list per commander
Rollups onto `cards`: edh_decks (total decks running the card) and edh_rank.
"""
import gzip, json, os, sqlite3, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "edhrec")
DB = os.path.join(HERE, "data", "mtg.sqlite")

SCHEMA = """
DROP TABLE IF EXISTS edh_commanders;
DROP TABLE IF EXISTS edh_inclusions;
DROP TABLE IF EXISTS edh_avg_deck;

CREATE TABLE edh_commanders (
  slug TEXT PRIMARY KEY,
  name TEXT,
  oracle_id TEXT,
  color_identity TEXT,
  num_decks INTEGER,          -- decks EDHREC has for this commander
  budget_counts TEXT,
  bracket_counts TEXT,
  tag_counts TEXT,
  cheap_usd REAL              -- price of the commander itself
);

CREATE TABLE edh_inclusions (
  slug TEXT,
  oracle_id TEXT,
  card_name TEXT,
  tag TEXT,                   -- creatures / instants / highsynergycards / ...
  num_decks INTEGER,          -- decks of THIS commander running the card
  potential_decks INTEGER,
  inclusion_rate REAL,        -- num_decks / potential_decks
  synergy REAL,               -- EDHREC's synergy score
  PRIMARY KEY (slug, oracle_id, tag)
);

CREATE TABLE edh_avg_deck (
  slug TEXT,
  oracle_id TEXT,
  card_name TEXT,
  qty INTEGER,
  section TEXT,
  PRIMARY KEY (slug, card_name, section)
);
"""

INDEXES = """
CREATE INDEX idx_inc_oracle ON edh_inclusions(oracle_id);
CREATE INDEX idx_inc_slug ON edh_inclusions(slug, inclusion_rate DESC);
CREATE INDEX idx_inc_syn ON edh_inclusions(oracle_id, synergy DESC);
CREATE INDEX idx_avg_slug ON edh_avg_deck(slug);
CREATE INDEX idx_cmd_decks ON edh_commanders(num_decks DESC);
"""


def walk_cache(kind):
    root = os.path.join(CACHE, kind)
    for dirpath, _, files in os.walk(root):
        for fn in files:
            if fn.endswith(".json.gz"):
                yield fn[:-len(".json.gz")], os.path.join(dirpath, fn)


def load_doc(path):
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def main():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    cur = con.cursor()

    # EDHREC card ids are Scryfall PRINTING ids -> map to our oracle ids.
    print_to_oracle = dict(cur.execute("select id, oracle_id from printings"))
    name_to_oracle = {}
    for name, oid in cur.execute("select name, oracle_id from cards"):
        name_to_oracle.setdefault(name.lower(), oid)
        if " // " in name:                       # EDHREC often uses the front face alone
            name_to_oracle.setdefault(name.split(" // ")[0].lower(), oid)
    card_price = dict(cur.execute("select oracle_id, price_usd from cards"))
    card_ci = dict(cur.execute("select oracle_id, color_identity from cards"))

    def resolve(cv):
        oid = print_to_oracle.get(cv.get("id"))
        if oid:
            return oid
        return name_to_oracle.get((cv.get("name") or "").lower())

    cmd_rows, inc_rows, deck_rows = [], [], []
    unresolved = set()
    n_cmd = 0

    for slug, path in walk_cache("commanders"):
        doc = load_doc(path)
        if not doc:
            continue
        n_cmd += 1
        cardlists = ((doc.get("container") or {}).get("json_dict") or {}).get("cardlists") or []
        cmd_card = ((doc.get("container") or {}).get("json_dict") or {}).get("card") or {}
        cmd_oid = print_to_oracle.get(cmd_card.get("id")) or name_to_oracle.get(
            (cmd_card.get("name") or "").lower())
        total_decks = 0
        seen = set()
        for cl in cardlists:
            tag = cl.get("tag") or ""
            for cv in cl.get("cardviews") or []:
                oid = resolve(cv)
                if not oid:
                    unresolved.add(cv.get("name"))
                    continue
                pot = cv.get("potential_decks") or 0
                nd = cv.get("num_decks") or 0
                total_decks = max(total_decks, pot)
                key = (slug, oid, tag)
                if key in seen:
                    continue
                seen.add(key)
                inc_rows.append((slug, oid, cv.get("name"), tag, nd, pot,
                                 (float(nd) / pot) if pot else None, cv.get("synergy")))
        cmd_rows.append((
            slug, cmd_card.get("name") or slug.replace("-", " ").title(), cmd_oid,
            card_ci.get(cmd_oid), total_decks,
            json.dumps(doc.get("budget_counts") or {}),
            json.dumps(doc.get("bracket_counts") or {}),
            json.dumps(doc.get("tag_counts") or {}),
            card_price.get(cmd_oid),
        ))

    for slug, path in walk_cache("average-decks"):
        doc = load_doc(path)
        if not doc:
            continue
        deck = doc.get("deck") or {}
        cards = deck.get("cards") or {}
        for section, entries in cards.items():
            for entry in entries:
                if isinstance(entry, list) and len(entry) >= 2:
                    name, qty = entry[0], entry[1]
                elif isinstance(entry, str):
                    name, qty = entry, 1
                else:
                    continue
                oid = name_to_oracle.get(str(name).lower())
                deck_rows.append((slug, oid, name, qty, section))
        for name in deck.get("commander") or []:
            deck_rows.append((slug, name_to_oracle.get(str(name).lower()), name, 1, "Commander"))

    cur.executemany("INSERT OR REPLACE INTO edh_commanders VALUES (?,?,?,?,?,?,?,?,?)", cmd_rows)
    cur.executemany("INSERT OR REPLACE INTO edh_inclusions VALUES (?,?,?,?,?,?,?,?)", inc_rows)
    cur.executemany("INSERT OR REPLACE INTO edh_avg_deck VALUES (?,?,?,?,?)", deck_rows)
    con.executescript(INDEXES)

    # rollups onto cards
    for col, ddl in (("edh_decks", "INTEGER"), ("edh_commanders_n", "INTEGER"),
                     ("edh_top_synergy", "REAL"), ("edh_rank", "INTEGER")):
        try:
            cur.execute("ALTER TABLE cards ADD COLUMN %s %s" % (col, ddl))
        except sqlite3.OperationalError:
            pass
    cur.execute("update cards set edh_decks=null, edh_commanders_n=null, edh_top_synergy=null, edh_rank=null")
    cur.execute("""
      with agg as (
        select oracle_id,
               sum(num_decks) decks,
               count(distinct slug) cmds,
               max(synergy) syn
        from (select distinct slug, oracle_id, num_decks, synergy from edh_inclusions)
        group by oracle_id)
      update cards set
        edh_decks = (select decks from agg where agg.oracle_id = cards.oracle_id),
        edh_commanders_n = (select cmds from agg where agg.oracle_id = cards.oracle_id),
        edh_top_synergy = (select syn from agg where agg.oracle_id = cards.oracle_id)
    """)
    cur.execute("""
      with r as (select oracle_id, row_number() over (order by edh_decks desc) rn
                 from cards where edh_decks is not null)
      update cards set edh_rank = (select rn from r where r.oracle_id = cards.oracle_id)
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cards_edh ON cards(edh_decks DESC)")
    cur.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", [
        ("edhrec_loaded_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
        ("edhrec_commanders", str(len(cmd_rows))),
        ("edhrec_inclusions", str(len(inc_rows))),
    ])
    con.commit()
    print("commander pages: %d   inclusion rows: %d   avg-deck rows: %d   unresolved names: %d"
          % (n_cmd, len(inc_rows), len(deck_rows), len(unresolved)))
    if unresolved:
        print("  sample unresolved:", sorted(x for x in unresolved if x)[:8])
    con.close()


if __name__ == "__main__":
    main()

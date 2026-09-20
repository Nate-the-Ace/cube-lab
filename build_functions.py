#!/usr/bin/env python3
"""Run the oracle-text parser over every card and store the primitives.

This materialises the function layer so combo search is a SQL join rather than a
full re-parse. Rebuild it whenever functions.py changes.
"""
import json, os, sqlite3, time

import functions as F

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "mtg.sqlite")

SCHEMA = """
DROP TABLE IF EXISTS card_functions;
CREATE TABLE card_functions (
  oracle_id TEXT, kind TEXT, detail TEXT,
  amount INTEGER, net INTEGER, cost_mana INTEGER,
  taps INTEGER, repeatable INTEGER, free INTEGER, sac_self INTEGER, finite_cost INTEGER,
  colors TEXT,        -- mana produced
  cost_colors TEXT,   -- coloured pips the cost demands
  restricted INTEGER, -- "spend this mana only on ..."
  any_color INTEGER,  -- "spend mana as though it were mana of any color"
  no_generic INTEGER  -- "this mana can't be spent to pay generic mana costs"
);
"""
INDEXES = """
CREATE INDEX idx_cf_kind ON card_functions(kind);
CREATE INDEX idx_cf_oracle ON card_functions(oracle_id);
CREATE INDEX idx_cf_kind_net ON card_functions(kind, net);
"""


def main():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    rows = con.execute("""select oracle_id, name, type_line, oracle_text, mana_cost
                          from cards where oracle_text is not null""").fetchall()
    out = []
    t0 = time.time()
    for i, (oid, name, tl, text, mc) in enumerate(rows, 1):
        for p in F.analyse(name, tl, text, mc):
            out.append((
                oid, p["kind"],
                p.get("target") or p.get("what") or p.get("effect") or p.get("colors") or "",
                p.get("amount"), p.get("net"), p.get("cost_mana"),
                int(bool(p.get("taps"))), int(bool(p.get("repeatable"))), int(bool(p.get("free"))),
                int(bool(p.get("sac_self"))), int(bool(p.get("finite_cost"))),
                p.get("colors") or "", p.get("cost_colors") or "",
                int(bool(p.get("restricted"))), int(bool(p.get("any_color"))),
                int(bool(p.get("no_generic"))),
            ))
        if i % 10000 == 0:
            print("%d/%d cards  %.0fs" % (i, len(rows), time.time() - t0), flush=True)
    con.executemany("INSERT INTO card_functions VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", out)
    con.executescript(INDEXES)
    con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)",
                ("functions_built_at", time.strftime("%Y-%m-%dT%H:%M:%S")))
    con.commit()
    print("cards: %d   primitives: %d   %.0fs" % (len(rows), len(out), time.time() - t0))
    for kind, n in con.execute("select kind, count(*) from card_functions group by kind order by 2 desc"):
        print("  %-16s %d" % (kind, n))
    con.close()


if __name__ == "__main__":
    main()

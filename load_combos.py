#!/usr/bin/env python3
"""Load the Commander Spellbook combos into the DB and index them by card set."""
import gzip, json, os, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "combos.jsonl.gz")
DB = os.path.join(HERE, "data", "mtg.sqlite")

SCHEMA = """
DROP TABLE IF EXISTS combos;
DROP TABLE IF EXISTS combo_cards;
CREATE TABLE combos (
  id TEXT PRIMARY KEY, n_cards INTEGER, produces TEXT, identity TEXT,
  popularity INTEGER, status TEXT, legal_commander INTEGER, bracket TEXT,
  card_names TEXT, card_key TEXT,
  notable_prereqs TEXT,   -- "you have a way to give it lifelink" etc.
  easy_prereqs TEXT,
  description TEXT,
  requires TEXT,          -- named templates, not specific cards
  n_extra INTEGER         -- how many things beyond the listed cards are needed
);
CREATE TABLE combo_cards (combo_id TEXT, oracle_id TEXT, PRIMARY KEY (combo_id, oracle_id));
"""
INDEXES = """
CREATE INDEX idx_combo_key ON combos(card_key);
CREATE INDEX idx_combo_cards_oracle ON combo_cards(oracle_id);
CREATE INDEX idx_combo_pop ON combos(popularity DESC);
CREATE INDEX idx_combo_extra ON combos(n_extra);
"""


def main():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    known = {r[0] for r in con.execute("select oracle_id from cards")}
    rows, links = [], []
    n = 0
    with gzip.open(SRC, "rt", encoding="utf-8") as f:
        for line in f:
            v = json.loads(line)
            n += 1
            oids = [o for o in (v.get("oracle_ids") or []) if o]
            key = "|".join(sorted(set(oids)))
            notable = (v.get("notable_prereqs") or "").strip()
            reqs = [x for x in (v.get("requires") or []) if x]
            # each line of notablePrerequisites is a separate thing you must have
            n_extra = len([ln for ln in notable.splitlines() if ln.strip()]) + len(reqs)
            rows.append((str(v.get("id")), len(oids),
                         json.dumps(v.get("produces") or []), v.get("identity"),
                         v.get("popularity"), v.get("status"),
                         1 if v.get("legal_commander") else 0, v.get("bracket"),
                         json.dumps(v.get("cards") or []), key,
                         notable, (v.get("easy_prereqs") or "").strip(),
                         (v.get("description") or "").strip(),
                         json.dumps(reqs), n_extra))
            for o in set(oids):
                if o in known:
                    links.append((str(v.get("id")), o))
    con.executemany("INSERT OR REPLACE INTO combos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.executemany("INSERT OR IGNORE INTO combo_cards VALUES (?,?)", links)
    con.executescript(INDEXES)
    con.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", [
        ("combos_loaded_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
        ("n_combos", str(len(rows)))])
    con.commit()
    print("combos: %d   combo-card links: %d" % (len(rows), len(links)))
    for p, c in con.execute("""select json_extract(produces,'$[0]') p, count(*) c
                               from combos group by p order by c desc limit 8"""):
        print("   %-38s %d" % (str(p)[:38], c))
    con.close()


if __name__ == "__main__":
    main()

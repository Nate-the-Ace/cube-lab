#!/usr/bin/env python3
"""Load EDHREC theme (tag) pages into the DB.

A theme page is a curated card pool for a strategy - "voltron", "aristocrats",
"landfall" - with inclusion rates, plus the commanders that play it. This is what
makes goal-driven deckbuilding possible without any language model: a goal phrase
resolves to a theme slug, and the theme carries a real, ranked card pool.
"""
import gzip, json, os, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "data", "edhrec", "tags")
DB = os.path.join(HERE, "data", "mtg.sqlite")

SCHEMA = """
DROP TABLE IF EXISTS edh_themes;
DROP TABLE IF EXISTS edh_theme_cards;
DROP TABLE IF EXISTS edh_theme_commanders;

CREATE TABLE edh_themes (
  slug TEXT PRIMARY KEY, name TEXT, n_cards INTEGER, n_commanders INTEGER, deck_pool INTEGER
);
CREATE TABLE edh_theme_cards (
  theme TEXT, oracle_id TEXT, card_name TEXT, tag TEXT,
  num_decks INTEGER, potential_decks INTEGER, inclusion_rate REAL, synergy REAL,
  PRIMARY KEY (theme, oracle_id, tag)
);
CREATE TABLE edh_theme_commanders (
  theme TEXT, oracle_id TEXT, name TEXT, cmd_slug TEXT,
  num_decks INTEGER, potential_decks INTEGER, share REAL,
  PRIMARY KEY (theme, cmd_slug)
);
"""
INDEXES = """
CREATE INDEX idx_tc_theme ON edh_theme_cards(theme, inclusion_rate DESC);
CREATE INDEX idx_tc_oracle ON edh_theme_cards(oracle_id);
CREATE INDEX idx_tcm_theme ON edh_theme_commanders(theme, num_decks DESC);
"""

COMMANDER_LISTS = {"topcommanders", "newcommanders"}


def main():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    cur = con.cursor()
    print_to_oracle = dict(cur.execute("select id, oracle_id from printings"))
    name_to_oracle = {}
    for name, oid in cur.execute("select name, oracle_id from cards"):
        name_to_oracle.setdefault(name.lower(), oid)
        if " // " in name:
            name_to_oracle.setdefault(name.split(" // ")[0].lower(), oid)

    def resolve(cv):
        return print_to_oracle.get(cv.get("id")) or name_to_oracle.get((cv.get("name") or "").lower())

    themes, cards, cmds = [], [], []
    for dirpath, _, files in os.walk(CACHE):
        for fn in files:
            if not fn.endswith(".json.gz"):
                continue
            slug = fn[:-len(".json.gz")]
            try:
                with gzip.open(os.path.join(dirpath, fn), "rt", encoding="utf-8") as f:
                    doc = json.load(f)
            except Exception:
                continue
            cardlists = ((doc.get("container") or {}).get("json_dict") or {}).get("cardlists") or []
            n_cards = n_cmd = 0
            pool = 0
            for cl in cardlists:
                tag = cl.get("tag") or ""
                for cv in cl.get("cardviews") or []:
                    oid = resolve(cv)
                    if not oid:
                        continue
                    nd, pot = cv.get("num_decks") or 0, cv.get("potential_decks") or 0
                    pool = max(pool, pot)
                    if tag in COMMANDER_LISTS:
                        cmds.append((slug, oid, cv.get("name"), cv.get("slug") or cv.get("sanitized"),
                                     nd, pot, (float(nd) / pot) if pot else None))
                        n_cmd += 1
                    else:
                        cards.append((slug, oid, cv.get("name"), tag, nd, pot,
                                      (float(nd) / pot) if pot else None, cv.get("synergy")))
                        n_cards += 1
            themes.append((slug, doc.get("header") or slug.replace("-", " ").title(),
                           n_cards, n_cmd, pool))

    cur.executemany("INSERT OR REPLACE INTO edh_themes VALUES (?,?,?,?,?)", themes)
    cur.executemany("INSERT OR REPLACE INTO edh_theme_cards VALUES (?,?,?,?,?,?,?,?)", cards)
    cur.executemany("INSERT OR REPLACE INTO edh_theme_commanders VALUES (?,?,?,?,?,?,?)", cmds)
    con.executescript(INDEXES)
    cur.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", [
        ("themes_loaded_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
        ("themes", str(len(themes))),
    ])
    con.commit()
    print("themes: %d   theme-card rows: %d   theme-commander rows: %d"
          % (len(themes), len(cards), len(cmds)))
    con.close()


if __name__ == "__main__":
    main()

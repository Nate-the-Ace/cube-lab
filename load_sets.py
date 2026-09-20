#!/usr/bin/env python3
"""Load Scryfall's set catalogue: code -> full name, symbol, release date.

One request for all ~1,050 sets, so this is cheap to re-run.
"""
import json, os, sqlite3, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "data", "mtg.sqlite")
URL = "https://api.scryfall.com/sets"
UA = {"User-Agent": "mtg-budget-research/0.1 (personal deckbuilding research)",
      "Accept": "application/json"}

SCHEMA = """
DROP TABLE IF EXISTS sets;
CREATE TABLE sets (
  code TEXT PRIMARY KEY, name TEXT, set_type TEXT, released_at TEXT,
  card_count INTEGER, icon_svg_uri TEXT, parent_set_code TEXT,
  digital INTEGER, scryfall_uri TEXT
);
"""


def main():
    req = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)["data"]
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    con.executemany("INSERT OR REPLACE INTO sets VALUES (?,?,?,?,?,?,?,?,?)", [
        (s.get("code"), s.get("name"), s.get("set_type"), s.get("released_at"),
         s.get("card_count"), s.get("icon_svg_uri"), s.get("parent_set_code"),
         int(bool(s.get("digital"))), s.get("scryfall_uri")) for s in data])
    con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)",
                ("sets_loaded_at", time.strftime("%Y-%m-%dT%H:%M:%S")))
    con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", ("n_sets", str(len(data))))
    con.commit()
    missing = con.execute("""select count(distinct set_code) from printings
                             where set_code not in (select code from sets)""").fetchone()[0]
    print("sets: %d   printing set codes with no catalogue entry: %d" % (len(data), missing))
    con.close()


if __name__ == "__main__":
    main()

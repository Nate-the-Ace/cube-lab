#!/usr/bin/env python3
"""Load Scryfall default_cards bulk JSONL into SQLite.

Two grains:
  printings  - one row per physical printing (prices live here)
  cards      - one row per oracle_id (the "card" as a rules object)
  legalities - (oracle_id, format) -> status
The cheapest paper printing of each card is denormalised onto `cards`.
"""
import gzip, json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "default_cards.jsonl.gz")
DB = os.path.join(HERE, "data", "mtg.sqlite")

SCHEMA = """
PRAGMA journal_mode=WAL;
DROP TABLE IF EXISTS printings;
DROP TABLE IF EXISTS cards;
DROP TABLE IF EXISTS legalities;
DROP TABLE IF EXISTS meta;

CREATE TABLE cards (
  oracle_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mana_cost TEXT,
  cmc REAL,
  type_line TEXT,
  oracle_text TEXT,
  colors TEXT,
  color_identity TEXT,
  color_identity_n INTEGER,
  keywords TEXT,
  produced_mana TEXT,
  layout TEXT,
  reserved INTEGER,
  game_changer INTEGER,
  card_faces TEXT,
  first_released TEXT,
  n_printings INTEGER,
  cheap_usd REAL,          -- cheapest nonfoil paper printing
  cheap_printing_id TEXT,
  cheap_any_usd REAL,      -- cheapest incl. foil/etched, for cards never printed nonfoil
  price_usd REAL,          -- what to actually charge: cheap_usd, else the foil price
  price_is_foil INTEGER,   -- 1 when the only price we have is a foil/etched one
  is_land INTEGER,
  is_creature INTEGER,
  is_funny INTEGER,         -- printed in an Un-set / playtest set (silver border, acorn)
  tournament_legal INTEGER, -- legal or restricted in at least one real format
  kind TEXT                 -- card | token | emblem | art | oversized
);

CREATE TABLE printings (
  id TEXT PRIMARY KEY,
  oracle_id TEXT,
  name TEXT,
  set_code TEXT,
  set_name TEXT,
  set_type TEXT,
  collector_number TEXT,
  rarity TEXT,
  released_at TEXT,
  lang TEXT,
  digital INTEGER,
  paper INTEGER,
  promo INTEGER,
  reprint INTEGER,
  oversized INTEGER,
  booster INTEGER,
  finishes TEXT,
  border_color TEXT,
  frame TEXT,
  full_art INTEGER,
  textless INTEGER,
  artist TEXT,
  tcgplayer_id INTEGER,
  scryfall_uri TEXT,
  image_uri TEXT,
  usd REAL,
  usd_foil REAL,
  usd_etched REAL,
  eur REAL
);

CREATE TABLE legalities (
  oracle_id TEXT,
  format TEXT,
  status TEXT,
  PRIMARY KEY (oracle_id, format)
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
"""

INDEXES = """
CREATE INDEX idx_print_oracle ON printings(oracle_id);
CREATE INDEX idx_print_set ON printings(set_code);
CREATE INDEX idx_print_usd ON printings(usd);
CREATE INDEX idx_print_tcg ON printings(tcgplayer_id);
CREATE INDEX idx_cards_name ON cards(name COLLATE NOCASE);
CREATE INDEX idx_cards_cheap ON cards(price_usd);
CREATE INDEX idx_cards_ci ON cards(color_identity);
CREATE INDEX idx_cards_funny ON cards(is_funny);
CREATE INDEX idx_cards_kind ON cards(kind);
CREATE INDEX idx_legal_fmt ON legalities(format, status);
"""


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def joinlist(v):
    return "".join(v) if v and all(len(x) == 1 for x in v) else (",".join(v) if v else "")


def main():
    if not os.path.exists(SRC):
        sys.exit("missing %s - run fetch.py first" % SRC)
    if os.path.exists(DB):
        os.remove(DB)
    for suf in ("-wal", "-shm"):
        p = DB + suf
        if os.path.exists(p):
            os.remove(p)
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)

    cards = {}          # oracle_id -> row dict
    legal_rows = []
    print_rows = []
    n = 0

    with gzip.open(SRC, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip().rstrip(",")
            if not line or line in "[]":
                continue
            c = json.loads(line)
            if c.get("object") != "card":
                continue
            n += 1
            oid = c.get("oracle_id")
            faces = c.get("card_faces")
            if not oid and faces:
                oid = faces[0].get("oracle_id")
            if not oid:
                continue
            games = c.get("games") or []
            paper = 1 if "paper" in games else 0
            prices = c.get("prices") or {}
            usd, usd_foil = num(prices.get("usd")), num(prices.get("usd_foil"))
            usd_etched = num(prices.get("usd_etched"))
            img = (c.get("image_uris") or {}).get("normal")
            if not img and faces:
                img = (faces[0].get("image_uris") or {}).get("normal")

            print_rows.append((
                c["id"], oid, c["name"], c.get("set"), c.get("set_name"), c.get("set_type"),
                c.get("collector_number"), c.get("rarity"), c.get("released_at"), c.get("lang"),
                int(bool(c.get("digital"))), paper, int(bool(c.get("promo"))),
                int(bool(c.get("reprint"))), int(bool(c.get("oversized"))),
                int(bool(c.get("booster"))), ",".join(c.get("finishes") or []),
                c.get("border_color"), c.get("frame"), int(bool(c.get("full_art"))),
                int(bool(c.get("textless"))), c.get("artist"), c.get("tcgplayer_id"),
                c.get("scryfall_uri"), img, usd, usd_foil, usd_etched, num(prices.get("eur")),
            ))

            # --- oracle grain -------------------------------------------------
            row = cards.get(oid)
            if row is None:
                mana = c.get("mana_cost")
                otext = c.get("oracle_text")
                tline = c.get("type_line") or ""
                if faces:
                    if not mana:
                        mana = " // ".join(fc.get("mana_cost") or "" for fc in faces).strip(" /")
                    if not otext:
                        otext = "\n//\n".join(fc.get("oracle_text") or "" for fc in faces)
                    if not tline:
                        tline = " // ".join(fc.get("type_line") or "" for fc in faces)
                ci = c.get("color_identity") or []
                row = cards[oid] = {
                    "oracle_id": oid, "name": c["name"], "mana_cost": mana,
                    "cmc": c.get("cmc"), "type_line": tline, "oracle_text": otext,
                    "colors": joinlist(c.get("colors") or []),
                    "color_identity": "".join(sorted(ci)) or "C",
                    "color_identity_n": len(ci),
                    "keywords": ",".join(c.get("keywords") or []),
                    "produced_mana": "".join(sorted(c.get("produced_mana") or [])),
                    "layout": c.get("layout"),
                    "reserved": int(bool(c.get("reserved"))),
                    "game_changer": int(bool(c.get("game_changer"))),
                    "card_faces": json.dumps(faces) if faces else None,
                    "first_released": c.get("released_at"),
                    "n_printings": 0,
                    "cheap_usd": None, "cheap_printing_id": None, "cheap_any_usd": None,
                    "price_usd": None, "price_is_foil": 0,
                    "is_land": int("Land" in tline),
                    "is_creature": int("Creature" in tline),
                    "is_funny": 0, "tournament_legal": 1,
                    # tokens, emblems, Secret Lair art cards and oversized
                    # planes/schemes share the table with real cards; without
                    # this, a search for "Goblin" is mostly token art
                    "kind": ("token" if c.get("layout") in ("token", "double_faced_token")
                             else "emblem" if c.get("layout") == "emblem"
                             else "art" if c.get("layout") in ("art_series", "front_card")
                             else "oversized" if c.get("layout") in ("planar", "scheme", "vanguard")
                             else "card"),
                }
                for fmt, status in (c.get("legalities") or {}).items():
                    legal_rows.append((oid, fmt, status))

            row["n_printings"] += 1
            if c.get("released_at") and (not row["first_released"] or c["released_at"] < row["first_released"]):
                row["first_released"] = c["released_at"]
            # price rollup: paper, non-digital, non-oversized printings only
            if paper and not c.get("digital") and not c.get("oversized"):
                if usd is not None and (row["cheap_usd"] is None or usd < row["cheap_usd"]):
                    row["cheap_usd"] = usd
                    row["cheap_printing_id"] = c["id"]
                any_p = [p for p in (usd, usd_foil, usd_etched) if p is not None]
                if any_p:
                    lo = min(any_p)
                    if row["cheap_any_usd"] is None or lo < row["cheap_any_usd"]:
                        row["cheap_any_usd"] = lo

            if len(print_rows) >= 20000:
                flush(con, print_rows)

    flush(con, print_rows)
    for row in cards.values():          # 146-odd cards exist only as foils; don't price them as null
        row["price_usd"] = row["cheap_usd"] if row["cheap_usd"] is not None else row["cheap_any_usd"]
        row["price_is_foil"] = int(row["cheap_usd"] is None and row["cheap_any_usd"] is not None)
        row["is_funny"] = 0             # both filled in below
        row["tournament_legal"] = 1

    cols = list(next(iter(cards.values())).keys())
    con.executemany(
        "INSERT INTO cards (%s) VALUES (%s)" % (",".join(cols), ",".join("?" * len(cols))),
        [tuple(r[c] for c in cols) for r in cards.values()])
    con.executemany("INSERT OR IGNORE INTO legalities VALUES (?,?,?)", legal_rows)
    src_meta = {}
    mp = SRC + ".meta.json"
    if os.path.exists(mp):
        src_meta = json.load(open(mp))
    con.executemany("INSERT INTO meta VALUES (?,?)", [
        ("source", "scryfall default_cards"),
        ("scryfall_updated_at", src_meta.get("updated_at", "")),
        ("n_printings", str(n)), ("n_cards", str(len(cards))),
    ])
    # Un-sets ARE included; these two flags just let you tell them apart.
    # They are different facts: Unfinity printed 190 cards that are genuinely
    # legal in Commander and Legacy, while Chaos Orb is legal nowhere without
    # being an Un-card at all.
    con.execute("""update cards set tournament_legal = 0 where oracle_id not in (
                     select distinct oracle_id from legalities
                     where status in ('legal','restricted'))""")
    try:            # needs the sets table, which load_sets.py fills
        con.execute("""update cards set is_funny = 1 where oracle_id in (
                         select distinct p.oracle_id from printings p
                         join sets s on s.code = p.set_code
                         where s.set_type = 'funny')""")
        con.execute("""update cards set is_funny = 1 where oracle_id in (
                         select distinct p.oracle_id from printings p
                         join sets s on s.code = p.set_code
                         join sets ps on ps.code = s.parent_set_code
                         where ps.set_type = 'funny')""")
    except sqlite3.OperationalError:
        pass
    con.executescript(INDEXES)
    con.commit()
    print("printings: %d   cards: %d   legality rows: %d" % (n, len(cards), len(legal_rows)))
    con.close()


def flush(con, rows):
    con.executemany("INSERT OR REPLACE INTO printings VALUES (%s)" % ",".join("?" * 29), rows)
    del rows[:]


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Load Scryfall Tagger oracle tags - what cards DO, independent of how often
anyone plays them. This is the layer that lets us reason about function rather
than popularity."""
import gzip, json, os, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "oracle_tags.jsonl.gz")
DB = os.path.join(HERE, "data", "mtg.sqlite")

SCHEMA = """
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS card_tags;
CREATE TABLE tags (
  slug TEXT PRIMARY KEY, label TEXT, description TEXT, n_cards INTEGER, parents TEXT
);
CREATE TABLE card_tags (
  oracle_id TEXT, tag TEXT, weight TEXT, PRIMARY KEY (oracle_id, tag)
);
"""
INDEXES = """
CREATE INDEX idx_ct_tag ON card_tags(tag);
CREATE INDEX idx_ct_oracle ON card_tags(oracle_id);
CREATE INDEX idx_tags_n ON tags(n_cards DESC);
"""


def main():
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    known = {r[0] for r in con.execute("select oracle_id from cards")}
    by_id = {}
    tag_rows, ct_rows = [], []
    with gzip.open(SRC, "rt", encoding="utf-8") as f:
        docs = []
        for line in f:
            line = line.strip().rstrip(",")
            if not line or line in "[]":
                continue
            d = json.loads(line)
            if d.get("object") == "tag":
                docs.append(d)
                by_id[d["id"]] = d.get("slug")
    for d in docs:
        taggings = d.get("taggings") or []
        tag_rows.append((d.get("slug"), d.get("label"), d.get("description"),
                         len(taggings), ",".join(by_id.get(p, "") for p in (d.get("parent_ids") or []))))
        for t in taggings:
            oid = t.get("oracle_id")
            if oid in known:
                ct_rows.append((oid, d.get("slug"), t.get("weight")))
    con.executemany("INSERT OR REPLACE INTO tags VALUES (?,?,?,?,?)", tag_rows)
    con.executemany("INSERT OR IGNORE INTO card_tags VALUES (?,?,?)", ct_rows)
    con.executescript(INDEXES)
    con.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", [
        ("tags_loaded_at", time.strftime("%Y-%m-%dT%H:%M:%S")),
        ("n_tags", str(len(tag_rows))), ("n_taggings", str(len(ct_rows)))])
    con.commit()
    print("tags: %d   card-tag rows: %d" % (len(tag_rows), len(ct_rows)))
    con.close()


if __name__ == "__main__":
    main()

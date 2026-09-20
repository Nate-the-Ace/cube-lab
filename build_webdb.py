#!/usr/bin/env python3
"""Build data/web.sqlite: the slice of the database a browser can carry.

The full database is 1.3 GB, most of it EDHREC's long tail and indexes we only
need server-side. A page served from GitHub Pages reads this file over HTTP range
requests (sql.js-httpvfs), so what matters is not just total size but how few
pages a typical query touches — hence the pruning below, and the indexes kept
deliberately narrow.

What gets cut, and why it's safe:
  legalities   only rows that say something other than "not_legal"; anything
               missing is not legal, which is what the UI already assumes.
  printings    the columns a listing needs. Scryfall image and page URLs are
               rebuilt from the printing id in the page, not stored.
  inclusions   the top N cards per commander by synergy. Synergy is what every
               ranking in the tool uses; the tail below it never surfaces.
  avg_deck     kept whole: it is the average decklist itself, ~78 rows per
               commander, with no tail to cut.
"""
import argparse, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "data", "mtg.sqlite")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "data", "web.sqlite"))
    ap.add_argument("--top", type=int, default=100,
                    help="cards kept per commander (default 100)")
    a = ap.parse_args()

    if os.path.exists(a.out):
        os.unlink(a.out)
    con = sqlite3.connect(a.out)
    con.execute("pragma page_size = 4096")   # sql.js-httpvfs reads whole pages
    con.execute("pragma journal_mode = off")
    con.execute("attach ? as src", (SRC,))

    steps = [
        ("sets",                 "create table sets as select * from src.sets"),
        ("cards",                "create table cards as select * from src.cards"),
        ("card_tags",            "create table card_tags as select * from src.card_tags"),
        ("tags",                 "create table tags as select * from src.tags"),
        ("card_functions",       "create table card_functions as select * from src.card_functions"),
        ("combos",               "create table combos as select * from src.combos"),
        ("combo_cards",          "create table combo_cards as select * from src.combo_cards"),
        ("edh_commanders",       "create table edh_commanders as select * from src.edh_commanders"),
        ("edh_themes",           "create table edh_themes as select * from src.edh_themes"),
        ("edh_theme_cards",      "create table edh_theme_cards as select * from src.edh_theme_cards"),
        ("edh_theme_commanders", "create table edh_theme_commanders as select * from src.edh_theme_commanders"),
        ("meta",                 "create table meta as select * from src.meta"),
        ("legalities", """create table legalities as
             select * from src.legalities where status <> 'not_legal'"""),
        ("printings", """create table printings as select
             id, oracle_id, set_code, collector_number, rarity, released_at,
             digital, promo, oversized, tcgplayer_id, usd, usd_foil
             from src.printings"""),
        ("edh_inclusions", """create table edh_inclusions as
             select slug, oracle_id, card_name, num_decks, potential_decks,
                    inclusion_rate, synergy from (
               select *, row_number() over (partition by slug order by synergy desc) rn
               from src.edh_inclusions) where rn <= %d""" % a.top),
        ("edh_avg_deck", "create table edh_avg_deck as select * from src.edh_avg_deck"),
    ]
    for name, sql in steps:
        con.execute(sql)
        n = con.execute("select count(*) from '%s'" % name).fetchone()[0]
        print("  %-22s %12s" % (name, format(n, ",")))

    # Narrow indexes only. Each one costs download size AND range-request
    # round trips, so index the lookups the pages actually make and nothing else.
    for sql in [
        "create index idx_cards_name on cards(name)",
        "create index idx_cards_oracle on cards(oracle_id)",
        "create index idx_pr_oracle on printings(oracle_id)",
        "create index idx_legal_oracle on legalities(oracle_id)",
        "create index idx_inc_slug on edh_inclusions(slug)",
        "create index idx_inc_oracle on edh_inclusions(oracle_id)",
        "create index idx_avg_slug on edh_avg_deck(slug)",
        "create index idx_cc_oracle on combo_cards(oracle_id)",
        "create index idx_cc_combo on combo_cards(combo_id)",
        "create index idx_ct_oracle on card_tags(oracle_id)",
        "create index idx_tc_oracle on edh_theme_cards(oracle_id)",
        "create index idx_tc_slug on edh_theme_cards(slug)",
        "create index idx_cf_oracle on card_functions(oracle_id)",
    ]:
        try:
            con.execute(sql)
        except sqlite3.OperationalError as e:
            print("  skipped index: %s (%s)" % (sql.split(" on ")[1], e))

    con.execute("detach src")
    con.commit()
    con.execute("vacuum")
    con.close()
    print("\n%s  %.0f MB" % (a.out, os.path.getsize(a.out) / 1e6))


if __name__ == "__main__":
    main()

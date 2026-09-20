#!/bin/sh
# Pull today's data and rebuild everything. Safe to run daily; scrapes are cached.
set -e
cd "$(dirname "$0")"

python3 fetch.py default_cards oracle_tags
python3 load.py                  # cards, printings, legalities, prices
python3 load_tags.py             # Scryfall Tagger: what cards do
python3 load_sets.py            # set codes -> full names and symbols

python3 fetch_combos.py          # Commander Spellbook bulk dump
python3 load_combos.py

python3 scrape_edhrec.py themes  # 435 strategy pages (~5 min)
python3 load_themes.py

python3 build_functions.py       # oracle text -> effect primitives

# The commander sweep is ~8,100 pages at 4 req/s (about an hour). Run it with:
#   python3 scrape_edhrec.py && python3 load_edhrec.py

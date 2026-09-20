#!/bin/sh
# Wait for the EDHREC commander sweep to finish, then load it and report.
cd "$(dirname "$0")"
while pgrep -f "scrape_edhrec.py$" >/dev/null 2>&1 || pgrep -f "scrape_edhrec\.py *$" >/dev/null 2>&1; do
  sleep 20
done
echo "sweep process ended $(date)"
tail -2 data/edhrec_scrape.log
python3 load_edhrec.py
echo "--- post-load counts ---"
sqlite3 data/mtg.sqlite "select (select count(*) from edh_commanders) commanders, (select count(*) from edh_inclusions) inclusions, (select count(*) from edh_avg_deck) avg_deck_rows;"

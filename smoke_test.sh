#!/bin/sh
# Hit every endpoint and report anything that isn't a clean 200.
# Usage: ./smoke_test.sh [port]   (server must already be running)
PORT="${1:-8747}"
BASE="http://127.0.0.1:$PORT"
fail=0

check() {
  code=$(curl -s -o /tmp/smoke.json -w "%{http_code}" -m 120 "$BASE$2")
  err=$(python3 -c "
import json
try:
    d = json.load(open('/tmp/smoke.json'))
    print('ERR:' + str(d.get('error'))[:60] if isinstance(d, dict) and d.get('error') else 'ok')
except Exception:
    print('BADJSON')
" 2>/dev/null)
  printf "  %-24s %s %s\n" "$1" "$code" "$err"
  [ "$code" = "200" ] && [ "$err" = "ok" ] || fail=$((fail + 1))
}

page() {
  code=$(curl -s -o /tmp/smoke.html -w "%{http_code}" -m 60 "$BASE$2")
  printf "  %-24s %s\n" "$1" "$code"
  [ "$code" = "200" ] || fail=$((fail + 1))
}

post() {
  code=$(curl -s -o /tmp/smoke.json -w "%{http_code}" -m 120 -X POST "$BASE$2" \
         -H 'Content-Type: application/json' -d "$3")
  printf "  %-24s %s\n" "$1" "$code"
  [ "$code" = "200" ] || fail=$((fail + 1))
}

# use whichever cube is loaded rather than a hard-coded id
CUBE=$(curl -s -m 30 "$BASE/api/cubes" | python3 -c "
import json,sys,urllib.parse
try:
    cs = json.load(sys.stdin)
    print(urllib.parse.quote(cs[0]['id']) if cs else '')
except Exception:
    print('')")

echo "GET:"
check stats          "/api/stats"
check formats        "/api/formats"
check search         "/api/search?q=draw&fmt=commander&limit=3"
check suggest-card   "/api/suggest?q=sol"
check suggest-cmdr   "/api/suggest?kind=commander&q=ab"
check suggest-theme  "/api/suggest?kind=theme&q=volt"
check card-image     "/api/card-image?name=Sol%20Ring"
check legality       "/api/legality?name=Black%20Lotus"
check set            "/api/set?code=m13"
check themes         "/api/themes?q=mill"
check goal           "/api/goal?goal=commander%20damage%20win&budget=150"
check commanders     "/api/commanders?limit=3"
check staples        "/api/staples?slug=abaddon-the-despoiler&limit=5"
check brew           "/api/brew?slug=abaddon-the-despoiler&budget=50"
check combos         "/api/combos?template=blink_engine&limit=5"
check combos-bounded "/api/combos?template=sac_loop&limit=3"
check cubes          "/api/cubes"
check cube-combos    "/api/cube/combos?cube_id=$CUBE"
check cube-tactics   "/api/cube/tactics?cube_id=$CUBE"

echo "POST:"
post price-deck "/api/price-deck" '{"deck":"1 Sol Ring"}'
post pick-cut   "/api/pick-cut"   '{"add":"Counterspell","candidates":["Cancel","Ponder"]}'

echo "PAGES:"
page  brewer        "/"
page  cube-lab      "/cube"

echo "GAME NIGHTS (read only - posting would leave junk in the standings):"
page  nights-page   "/nights"
check nights-api    "/api/nights"

echo
echo "failures: $fail"
exit $fail

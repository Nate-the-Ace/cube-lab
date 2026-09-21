#!/usr/bin/env python3
"""Bake the real cube page into one self-contained file.

    python3 build_static.py                 # re-export, then bake
    python3 build_static.py --from-data     # bake the committed data, no database
    python3 build_static.py --only p1p1 -o docs/draft.html    # the draft table alone

This publishes ui/cube.html itself - the same shared.css, shared.js and cube.js
the local tool serves - with static-shim.js standing in for the server. That is
deliberate: the earlier version of this script baked a hand-written page that
reimplemented a fraction of the UI, and everything not reimplemented was simply
missing from the published site. One page, two transports.

Exporting needs the 1.3 GB database. Baking does not, which is how CI rebuilds
the page: docs/ui_data.json is committed and the workflow re-runs only the bake.
"""
import argparse, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
UI = os.path.join(HERE, "ui")


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as f:
        return f.read()


def solo_p1p1(page):
    """The draft table as a page of its own.

    The other two tabs are HIDDEN rather than cut out. cube.js binds handlers to
    elements in all three at load time - `$('#secExpand').onclick` and friends
    are not null-guarded - so deleting the markup would throw before the draft
    ever drew a pack. Hiding costs a few KB of dead DOM and keeps this page the
    same code the full one runs, which is the whole point of baking the real UI.
    """
    page = page.replace("<title>Cube Lab</title>", "<title>Cube Draft</title>", 1)
    page = page.replace("<h1>Cube <span>Lab</span></h1>",
                        "<h1>Cube <span>Draft</span></h1>", 1)
    # This page stands alone: it goes to people who were handed the draft table,
    # not the tool it was cut from, so it links nowhere else.
    page = page.replace('<section id="tab-p1p1" class="hidden">',
                        '<section id="tab-p1p1">', 1)
    # The meta line counts every card Scryfall knows about, which on a page
    # about ONE cube reads as the cube's size and is off by two orders of
    # magnitude. The span goes with it, so nothing tries to fill it.
    page = page.replace('  <span class="meta" id="meta">loading\u2026</span>\n', "", 1)
    page = re.sub(r"  try \{\n    const s = await \(await fetch\('/api/stats'\)\)\.json\(\);"
                  r".*?\n  \}\n", "", page, count=1, flags=re.S)
    page = page.replace("<style>", """<style>
  /* draft table only: the analysis and swap tabs are loaded but not shown */
  .tabs, #tab-cube, #tab-swap { display: none !important; }
  #tab-p1p1 { display: block !important; }
""", 1)
    # boot without the cube analysis: it renders into a section nobody can see
    page = page.replace("  if (cubes.length) runCube();\n"
                        "  else $('#cubeOut').innerHTML =\n"
                        "    '<span class=\"dim\">No cube loaded yet \u2014 open \u201cImport or replace a cube\u201d above.</span>';",
                        "  if (!cubes.length) $('#p1Out').innerHTML =\n"
                        "    '<span class=\"dim\">No cube loaded.</span>';", 1)
    return page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cube", nargs="?", default=None)
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "docs", "index.html"))
    ap.add_argument("--data", default=os.path.join(HERE, "docs", "ui_data.json"))
    ap.add_argument("--from-data", action="store_true",
                    help="skip the export and bake the committed data")
    ap.add_argument("--only", choices=["p1p1"], default=None,
                    help="publish one tab as a page of its own")
    a = ap.parse_args()

    if not a.from_data:
        cmd = [sys.executable, os.path.join(HERE, "export_ui.py"), "-o", a.data]
        if a.cube:
            cmd.append(a.cube)
        subprocess.run(cmd, check=True)
    elif not os.path.exists(a.data):
        sys.exit("no %s to bake; run without --from-data on a machine with the database" % a.data)

    page = read(UI, "cube.html")

    # Inline the three assets the page links, in the order it linked them.
    page = page.replace('<link rel="stylesheet" href="/shared.css">',
                        "<style>\n%s\n</style>" % read(UI, "shared.css"), 1)

    data = read(a.data).replace("</", "<\\/")   # can't end the script block early
    scripts = (
        '<script id="uidata" type="application/json">%s</script>\n' % data
        + '<script>window.UI_DATA = JSON.parse(document.getElementById("uidata").textContent);</script>\n'
        + "<script>\n%s\n</script>\n" % read(UI, "static-shim.js")
        + "<script>\n%s\n</script>\n" % read(UI, "shared.js")
        + "<script>\n%s\n</script>\n" % read(UI, "cube.js")
    )
    # The shim has to be installed before shared.js or cube.js can call fetch,
    # and the data before the shim.
    page, n = re.subn(r'<script src="/shared\.js"></script>\s*<script src="/cube\.js"></script>',
                      scripts.replace("\\", "\\\\"), page, count=1)
    if n != 1:
        sys.exit("could not find the script tags in ui/cube.html to replace")

    # Nothing that needs a server should advertise itself on a published page:
    # the tracker link, and the controls that write to the database.
    page = page.replace('<a href="/nights" class="badge">Game Nights</a>', "", 1)
    hide = ("  /* published snapshot: anything that writes needs the local tool */\n"
            "  .importer, #cubeRefresh { display: none !important; }\n"
            "  label:has(> #cubeSel) { display: none !important; }\n")
    page = page.replace("<style>", "<style>\n" + hide, 1)

    if a.only == "p1p1":
        page = solo_p1p1(page)
    else:
        # the full page points at the draft table, which is a page of its own
        page = page.replace('<button id="themeBtn"',
                            '<a href="draft.html" class="badge">Draft table</a>\n  '
                            '<button id="themeBtn"', 1)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print("%s  %.0f KB" % (a.out, os.path.getsize(a.out) / 1024))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Bake the real cube page into one self-contained file.

    python3 build_static.py                 # re-export, then bake
    python3 build_static.py --from-data     # bake the committed data, no database

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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cube", nargs="?", default=None)
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "docs", "index.html"))
    ap.add_argument("--data", default=os.path.join(HERE, "docs", "ui_data.json"))
    ap.add_argument("--from-data", action="store_true",
                    help="skip the export and bake the committed data")
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

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print("%s  %.0f KB" % (a.out, os.path.getsize(a.out) / 1024))


if __name__ == "__main__":
    main()

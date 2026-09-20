#!/usr/bin/env python3
"""Bake one cube's analysis into a single self-contained HTML file.

The live tool answers from a 1.3 GB database behind a local server. A page you
can hand to someone has neither, so export_cube.py freezes everything that
doesn't depend on the draft settings and this script drops that blob into the
template. The draft arithmetic is re-implemented in the page, so the sliders
still work with nothing running behind them.

    python3 build_static.py <cube-id-or-name>      # re-export, then bake
    python3 build_static.py --from-data            # bake the committed blob

The export needs the 1.3 GB database, so only a machine that has one can do it.
Baking does not, which is how CI rebuilds the page: the blob is committed at
docs/cube_data.json and the workflow only re-runs the second half.
"""
import argparse, os, sys, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cube", nargs="?", default=None,
                    help="cube id or name; default is the only cube, if there is one")
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "docs", "index.html"))
    ap.add_argument("--template", default=os.path.join(HERE, "static", "template.html"))
    ap.add_argument("--data", default=os.path.join(HERE, "docs", "cube_data.json"),
                    help="where the exported blob is written and read")
    ap.add_argument("--from-data", action="store_true",
                    help="skip the export and bake the existing blob (no database needed)")
    a = ap.parse_args()

    if not a.from_data:
        cmd = [sys.executable, os.path.join(HERE, "export_cube.py"), "-o", a.data]
        if a.cube:
            cmd.append(a.cube)
        subprocess.run(cmd, check=True)
    elif not os.path.exists(a.data):
        sys.exit("no %s to bake; run without --from-data on a machine with the database" % a.data)

    with open(a.data, encoding="utf-8") as f:
        data = f.read()

    # The blob is embedded in a <script type="application/json"> block, so the
    # only sequence that could end it early is a literal "</script".
    data = data.replace("</", "<\\/")

    with open(a.template, encoding="utf-8") as f:
        tpl = f.read()
    if "__DATA__" not in tpl:
        sys.exit("template has no __DATA__ placeholder")
    page = tpl.replace("__DATA__", data)

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"{a.out}  {len(page)/1024:.0f} KB")


if __name__ == "__main__":
    main()

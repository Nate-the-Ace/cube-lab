#!/usr/bin/env python3
"""Bake one cube's analysis into a single self-contained HTML file.

The live tool answers from a 1.3 GB database behind a local server. A page you
can hand to someone has neither, so export_cube.py freezes everything that
doesn't depend on the draft settings and this script drops that blob into the
template. The draft arithmetic is re-implemented in the page, so the sliders
still work with nothing running behind them.

    python3 build_static.py <cube-id-or-name> [-o docs/index.html]

The output is a plain file: open it locally, or commit it to docs/ and let
GitHub Pages serve it.
"""
import argparse, json, os, sys, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cube", nargs="?", default=None,
                    help="cube id or name; default is the only cube, if there is one")
    ap.add_argument("-o", "--out", default=os.path.join(HERE, "docs", "index.html"))
    ap.add_argument("--template", default=os.path.join(HERE, "static", "template.html"))
    a = ap.parse_args()

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as t:
        blob = t.name
    cmd = [sys.executable, os.path.join(HERE, "export_cube.py"), "-o", blob]
    if a.cube:
        cmd.append(a.cube)
    subprocess.run(cmd, check=True)

    with open(blob, encoding="utf-8") as f:
        data = f.read()
    os.unlink(blob)

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

#!/usr/bin/env python3
"""Pulse library: add or update a book, or swap a single page.

All page images are converted to WebP (max 1600px wide) plus a 480px thumbnail
and written to assets/pulse/<slug>/. data/library.json is the single source of
truth that pulse.html renders.

Examples
  # add (or replace) a whole book; pages are used in the order given
  python3 scripts/add_book.py book --slug world-models --title "World Models" \
      --topic AI --blurb "AI that imagines what happens next." \
      --gist "Line one" "Line two" "Line three" \
      --pages p01.jpg p02.jpg --page-titles "What world models are" "How they learn"

  # swap one page for a fixed version (1-based page number), keep everything else
  python3 scripts/add_book.py replace --slug ai-agents --page 2 --image fixed.png [--title "New title"]

  # append a new page to an existing book
  python3 scripts/add_book.py append --slug physical-ai --image new.png --title "Humanoids vs hype" [--at 3]

  # list books
  python3 scripts/add_book.py list
Requires Pillow (pip install pillow).
"""
import argparse
import re, datetime, json, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "data", "library.json")
ASSETS = os.path.join(ROOT, "assets", "pulse")
TOPICS = ("AI", "Tech", "Macro")
MAX_W, THUMB_W = 1600, 480


def load():
    if os.path.exists(LIB):
        with open(LIB) as f:
            return json.load(f)
    return {"version": 1, "updated": None, "books": []}


def save(lib):
    lib["updated"] = datetime.date.today().isoformat()
    with open(LIB, "w") as f:
        json.dump(lib, f, indent=2, ensure_ascii=False)
        f.write("\n")


def convert(src, slug, name):
    """Write <name>.webp (<=1600w) and <name>-t.webp (480w). Returns (w, h)."""
    out = os.path.join(ASSETS, slug)
    os.makedirs(out, exist_ok=True)
    im = Image.open(src).convert("RGB")
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    im.save(os.path.join(out, name + ".webp"), "WEBP", quality=82, method=6)
    th = im.resize((THUMB_W, round(im.height * THUMB_W / im.width)), Image.LANCZOS)
    th.save(os.path.join(out, name + "-t.webp"), "WEBP", quality=78, method=6)
    return im.width, im.height


def page_entry(slug, idx, src, title):
    name = "p%02d" % idx
    w, h = convert(src, slug, name)
    return {"file": "assets/pulse/%s/%s.webp" % (slug, name),
            "thumb": "assets/pulse/%s/%s-t.webp" % (slug, name),
            "title": title, "w": w, "h": h,
            **({"kw": kw} if (kw := page_keywords(os.path.join(ASSETS, slug, name + ".webp"))) else {})}


def find(lib, slug):
    for b in lib["books"]:
        if b["id"] == slug:
            return b
    sys.exit("No book with slug %r" % slug)



def cmd_book(a):
    if a.topic not in TOPICS:
        sys.exit("topic must be one of %s" % (TOPICS,))
    if not 2 <= len(a.title.split()) <= 5 and len(a.title.split()) != 1:
        print("warning: titles read best at 2-5 words", file=sys.stderr)
    titles = a.page_titles or [""] * len(a.pages)
    if len(titles) != len(a.pages):
        sys.exit("--page-titles must match --pages")
    lib = load()
    old = next((b for b in lib["books"] if b["id"] == a.slug), None)
    book = {"id": a.slug, "title": a.title, "topic": a.topic, "blurb": a.blurb,
            "gist": a.gist, "added": (old or {}).get("added") or datetime.date.today().isoformat(),
            "pages": [page_entry(a.slug, i, s, t) for i, (s, t) in enumerate(zip(a.pages, titles), 1)]}
    for k in ("tagline", "vol", "start_here"):  # keep cover metadata when a book is rebuilt
        if old and k in old:
            book[k] = old[k]
    if old:
        book["updated"] = datetime.date.today().isoformat()
        lib["books"][lib["books"].index(old)] = book
    else:
        lib["books"].append(book)
    save(lib)
    print("saved %s (%d pages)" % (a.slug, len(book["pages"])))


def cmd_replace(a):
    lib = load(); b = find(lib, a.slug)
    if not 1 <= a.page <= len(b["pages"]):
        sys.exit("page out of range 1..%d" % len(b["pages"]))
    # overwrite the page's existing file name so the order in JSON is untouched
    p = page_entry(a.slug, int(os.path.basename(b["pages"][a.page - 1]["file"])[1:3]), a.image, a.title or b["pages"][a.page - 1]["title"])
    b["pages"][a.page - 1] = p
    b["updated"] = datetime.date.today().isoformat()
    save(lib); print("replaced %s page %d" % (a.slug, a.page))


def free_index(b):
    used = {int(os.path.basename(p["file"])[1:3]) for p in b["pages"]}
    i = 1
    while i in used:
        i += 1
    return i


def cmd_append(a):
    lib = load(); b = find(lib, a.slug)
    entry = page_entry(a.slug, free_index(b), a.image, a.title)  # file names are opaque; order lives in JSON
    if a.at:
        if not 1 <= a.at <= len(b["pages"]) + 1:
            sys.exit("--at out of range 1..%d" % (len(b["pages"]) + 1))
        b["pages"].insert(a.at - 1, entry)
    else:
        b["pages"].append(entry)
    b["updated"] = datetime.date.today().isoformat()
    save(lib); print("appended to %s -> %d pages" % (a.slug, len(b["pages"])))


def cmd_meta(a):
    lib = load(); b = find(lib, a.slug)
    if a.tagline is not None:
        b["tagline"] = a.tagline
    if a.vol is not None:
        b["vol"] = a.vol
    if a.start_here:
        for o in lib["books"]:
            o.pop("start_here", None)
        b["start_here"] = True
    save(lib); print("updated %s" % a.slug)


STOP = set("""a an the and or but if of to in on at by for with from as is are was were be been it its this that these those you your we our they their he she his her them not no yes do does did can could will would should may might than then so such what which who whom how why when where there here into out up down over under about after before more most less very just also only own same too all any each few other some own both again once per via vs""".split())


BLOCK = re.compile(r"bitcoin|crypto|btc|ethereum|ether|solana|satoshi|blockchain")  # never searchable


def page_keywords(path):
    """OCR a page into a compact keyword string for search (needs rapidocr-onnxruntime; optional)."""
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        return None
    global _OCR
    if "_OCR" not in globals():
        _OCR = RapidOCR()
    res, _ = _OCR(path)
    words, seen = [], set()
    for _, txt, _ in res or []:
        for w in re.findall(r"[a-z][a-z0-9'-]{2,}", txt.lower()):
            w = w.strip("'-")
            if len(w) > 2 and w not in STOP and w not in seen and not BLOCK.search(w):
                seen.add(w); words.append(w)
    return " ".join(words)


def cmd_index(a):
    """(Re)build page keywords used by the Pulse search box."""
    lib = load()
    for b in lib["books"]:
        if a.slug and b["id"] != a.slug:
            continue
        for p in b["pages"]:
            kw = page_keywords(os.path.join(ROOT, p["file"]))
            if kw is None:
                sys.exit("pip install rapidocr-onnxruntime to index page text")
            p["kw"] = kw
        print("indexed %s" % b["id"])
    save(lib)


def cmd_list(a):
    for b in load()["books"]:
        print("%-30s %-5s %2d pages  %s" % (b["id"], b["topic"], len(b["pages"]), b["title"]))


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sp = ap.add_subparsers(dest="cmd", required=True)
p = sp.add_parser("book"); p.set_defaults(fn=cmd_book)
p.add_argument("--slug", required=True); p.add_argument("--title", required=True)
p.add_argument("--topic", required=True); p.add_argument("--blurb", required=True)
p.add_argument("--gist", nargs=3, required=True); p.add_argument("--pages", nargs="+", required=True)
p.add_argument("--page-titles", nargs="+")
p = sp.add_parser("replace"); p.set_defaults(fn=cmd_replace)
p.add_argument("--slug", required=True); p.add_argument("--page", type=int, required=True)
p.add_argument("--image", required=True); p.add_argument("--title")
p = sp.add_parser("append"); p.set_defaults(fn=cmd_append)
p.add_argument("--slug", required=True); p.add_argument("--image", required=True); p.add_argument("--title", required=True)
p.add_argument("--at", type=int, help="insert as this 1-based drawn page instead of appending")
p = sp.add_parser("meta", help="set cover tagline / volume / the 'Start here' book"); p.set_defaults(fn=cmd_meta)
p.add_argument("--slug", required=True); p.add_argument("--tagline"); p.add_argument("--vol", type=int)
p.add_argument("--start-here", action="store_true")
p = sp.add_parser("index", help="OCR page text into search keywords"); p.set_defaults(fn=cmd_index)
p.add_argument("--slug")
p = sp.add_parser("list"); p.set_defaults(fn=cmd_list)
a = ap.parse_args(); a.fn(a)

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

  # add a finished book from its hand-in folder (library-entry.json + c01.. images + page-text.json + sources.md)
  python3 scripts/add_book.py entry --dir /path/to/books/starlink-v1

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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from topics import NAMES as TOPICS, canon  # one shared topic list (scripts/topics.py)
import build_shelf
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
    _, errs, warns = build_shelf.build()  # keep the light shelf list (data/shelf.json) in step
    for w in warns: print("warning:", w, file=sys.stderr)
    if errs:
        sys.exit("shelf.json NOT rebuilt:\n" + "\n".join(errs))


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


def page_entry(slug, idx, src, title, text=None):
    """text: the page's cleaned text (from the hand-in's page-text.json); when given, keywords come from it and no OCR runs."""
    name = "p%02d" % idx
    w, h = convert(src, slug, name)
    kw = keywords_from(" ".join(text)) if text else page_keywords(os.path.join(ASSETS, slug, name + ".webp"))
    return {"file": "assets/pulse/%s/%s.webp" % (slug, name),
            "thumb": "assets/pulse/%s/%s-t.webp" % (slug, name),
            "title": title, "w": w, "h": h,
            **({"kw": kw} if kw else {})}


def find(lib, slug):
    for b in lib["books"]:
        if b["id"] == slug:
            return b
    sys.exit("No book with slug %r" % slug)



def cmd_book(a):
    t = canon(a.topic)  # accepts "fintech", "AI", "frontier tech", ...
    if not t:
        sys.exit("topic must be one of %s (no fallback: add a new shelf in scripts/topics.py first)" % (TOPICS,))
    a.topic = t
    if not 2 <= len(a.title.split()) <= 5 and len(a.title.split()) != 1:
        print("warning: titles read best at 2-5 words", file=sys.stderr)
    titles = a.page_titles or [""] * len(a.pages)
    if len(titles) != len(a.pages):
        sys.exit("--page-titles must match --pages")
    if a.takeaways and len(a.takeaways) != len(a.pages):
        sys.exit("--takeaways must match --pages (use \"\" for a page without one); shown in the caption box under the page, never drawn on the card")
    lib = load()
    old = next((b for b in lib["books"] if b["id"] == a.slug), None)
    book = {"id": a.slug, "title": a.title, "topic": a.topic, "blurb": a.blurb,
            "gist": a.gist, **({"gist_lead": a.gist_lead} if a.gist_lead else {}), "added": (old or {}).get("added") or datetime.date.today().isoformat(),
            "added_at": (old or {}).get("added_at") or datetime.datetime.now().isoformat(timespec="minutes"),
            "pages": [page_entry(a.slug, i, s, t) for i, (s, t) in enumerate(zip(a.pages, titles), 1)]}
    for pg, tk in zip(book["pages"], a.takeaways or []):
        if tk.strip(): pg["takeaway"] = tk.strip()
    # recap: 1-3 plain lines that cover ALL pages; recap_pages records how many pages it was written for
    if a.recap:
        if not 1 <= len(a.recap) <= 4:
            sys.exit("--recap takes 1 to 4 lines")
        book["recap"] = a.recap
    elif old and old.get("recap") and old.get("recap_pages") == len(a.pages):
        book["recap"] = old["recap"]
    else:
        sys.exit("The 'You finished' recap must be (re)written whenever the pages change: pass --recap \"line\" [\"line\" [\"line\"]] covering ALL %d pages." % len(a.pages))
    book["recap_pages"] = len(a.pages)
    for k in ("tagline", "vol", "start_here", "sources"):  # keep cover metadata when a book is rebuilt
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
    save(lib); print("replaced %s page %d (check the book's recap still matches this page)" % (a.slug, a.page))


def free_index(b):
    used = {int(os.path.basename(p["file"])[1:3]) for p in b["pages"]}
    i = 1
    while i in used:
        i += 1
    return i


def cmd_append(a):
    lib = load(); b = find(lib, a.slug)
    if not a.recap or not 1 <= len(a.recap) <= 4:
        sys.exit("Adding a page changes the book: pass --recap with 1-3 plain lines covering ALL %d pages (the 'You finished' card)." % (len(b["pages"]) + 1))
    entry = page_entry(a.slug, free_index(b), a.image, a.title)  # file names are opaque; order lives in JSON
    if a.at:
        if not 1 <= a.at <= len(b["pages"]) + 1:
            sys.exit("--at out of range 1..%d" % (len(b["pages"]) + 1))
        b["pages"].insert(a.at - 1, entry)
    else:
        b["pages"].append(entry)
    b["updated"] = datetime.date.today().isoformat()
    b["recap"] = a.recap; b["recap_pages"] = len(b["pages"])
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


def _ocr_text(path):
    """Text printed on a page: tesseract (required) plus RapidOCR when installed, for better recall on hand lettering."""
    import subprocess, tempfile
    from PIL import Image, ImageOps
    im = ImageOps.grayscale(Image.open(path))
    im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    with tempfile.NamedTemporaryFile(suffix=".png") as f:
        im.save(f.name)
        try:
            txt = subprocess.run(["tesseract", f.name, "-", "--psm", "11"], capture_output=True, text=True, check=True).stdout
        except FileNotFoundError:
            sys.exit("install tesseract-ocr to index page text")
    try:
        from rapidocr_onnxruntime import RapidOCR
        global _OCR
        if "_OCR" not in globals():
            _OCR = RapidOCR()
        res, _ = _OCR(path)
        txt += "\n" + "\n".join(t for _, t, _ in res or [])
    except ImportError:
        pass
    return txt


def page_keywords(path):
    """OCR a page once at build time into a compact keyword string for search."""
    return keywords_from(_ocr_text(path))


def keywords_from(txt):
    words, seen = [], set()
    for w in re.findall(r"[a-z0-9][a-z0-9'$%.-]*[a-z0-9%]", txt.lower()):
        w = w.strip("'-.")
        if len(w) > 1 and not w.isdigit() and w not in STOP and w not in seen and re.search(r"[a-z]", w):
            if len(w) == 2 and not re.match(r"^(ai|us|uk|eu|ev|ok|io|qe|qt)$", w):
                continue
            seen.add(w); words.append(w)
    return " ".join(words)


def cmd_index(a):
    """(Re)build page keywords used by the Pulse search box."""
    lib = load()
    for b in lib["books"]:
        if a.slug and b["id"] != a.slug:
            continue
        for p in b["pages"]:
            p["kw"] = page_keywords(os.path.join(ROOT, p["file"]))
        print("indexed %s" % b["id"])
    save(lib)


URL_RE = re.compile(r"https?://[^\s)>\]]+")


def _host(url):
    from urllib.parse import urlparse
    return urlparse(url).netloc.lower().replace("www.", "")


def _fallback_label(url):
    """No title in sources.md: a clean site name, never a slice of the URL path."""
    from urllib.parse import urlparse, unquote
    host = _host(url); segs = [x for x in unquote(urlparse(url).path).split("/") if x]
    if host in ("x.com", "twitter.com") and segs: return "Post by @%s on X" % segs[0]
    return host


DATE_TAIL = re.compile(r",\s*(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?:\d{1,2},\s*)?)?\d{4}\s*$")


def _key_label(t):
    """A 'Key sources' line is written as a title: 'NASA – Moon lander update for 2028 missions, Oct 23, 2026 (cards 8, 10)'.
    Keep it as written (publisher – title), dropping only list markers, the (cards …) note and a trailing date."""
    t = re.sub(r"^\s*(?:[-*]|\d+\.)\s*", "", t.strip()); t = re.sub(r"\*\*|`", "", t)
    for _ in range(3): t = re.sub(r"\s*\([^()]*\)", "", t)
    t = re.sub(r"\s+", " ", t).strip(" ,;.:")
    t = DATE_TAIL.sub("", t).strip(" ,;:")
    t = re.sub(r"\s+[-\u2013\u2014]\s+", " \u2013 ", t)   # one separator style: "Publisher – title"
    return t if len(t) >= 3 and not URL_RE.search(t) else ""


def _clean_label(t):
    """Turn the text written just before a link into a short label. Handles the usual hand-in shapes:
      'SpaceX Q3 2026 earnings release, 8-K Exhibit 99.1 (cards 10-11)'   -> the text, minus the (…) note
      'Ars Technica, Eric Berger, "Latest estimate …" (Oct 22, 2026). …'  -> 'Ars Technica, Eric Berger: Latest estimate …'
      'Falcon 9 flies reused boosters far more than anyone: Space.com (…).' -> 'Space.com' (claim: source)
    Returns '' when nothing title-like is there (the caller then uses a clean site name)."""
    t = re.sub(r"^\s*(?:[-*]|\d+\.|c\d+\s*->)\s*", "", t.strip())
    t = re.sub(r"\*\*|`", "", t).replace("\u201c", '"').replace("\u201d", '"')
    t = re.sub(r'\s*\("[^)]*\)', "", t)                                   # ("quoted excerpt") notes
    qs = list(re.finditer(r',\s*"([^"]{4,})"', t))
    if qs:  # Publisher, "Article title"
        q = qs[-1]; pub = re.split(r"(?:[.;]|:)\s", t[:q.start()])[-1].strip(" ,")
        pub = re.split(r"\s(?:per|via|from)\s", pub)[-1].strip(" ,")  # "… per Ars Technica" -> "Ars Technica"
        lab = (pub + ": " if pub else "") + q.group(1).strip()
    else:
        for _ in range(3): t = re.sub(r"\s*\([^()]*\)", "", t)
        t = re.sub(r"\s+", " ", t).strip(" ,;.:-\u2013")
        parts = t.split(": ")
        if len(parts) > 1 and 2 < len(parts[-1]) <= 60 and '"' not in parts[-1]: lab = parts[-1].split(", ")[0]   # claim: Source
        else: lab = parts[0]
        if "; " in lab: lab = lab.split("; ")[-1]
        if len(lab) > 70 or '"' in lab: return ""   # a claim, not a title
    lab = re.sub(r"\s+", " ", lab).strip(" ,;.:-\u2013")
    if len(lab) > 90: lab = lab[:88].rsplit(" ", 1)[0].rstrip(" ,;:") + "\u2026"
    return lab if len(lab) >= 3 and not URL_RE.search(lab) else ""


def _sources(md, limit=14):
    """[{title, url}] for the end card, from a hand-in sources.md.
    1. A "Key sources" section, if there is one, is the list (in its order), labelled as written there
       ("NASA – Moon lander update for 2028 missions"; the publisher is never dropped).
    2. Otherwise every link in the file, in order. The label is the text written just before the link
       (e.g. 'SpaceX Q3 2026 earnings (SEC)'); with no text, a clean site name ('sec.gov', 'Post by @x on X')."""
    lines = open(md, encoding="utf-8").read().splitlines()
    key, i = [], next((n for n, l in enumerate(lines) if re.match(r"#+\s*key sources", l, re.I)), None)
    if i is not None:
        for l in lines[i + 1:]:
            if l.startswith("#"): break
            key.append(l)
    out, seen = [], set()
    key_mode = any(URL_RE.search(x) for x in key)
    for l in (key if key_mode else lines):
        pos = 0
        for m in URL_RE.finditer(l):
            url = m.group(0).rstrip(".,;")
            seg = l[pos:m.start()]; pos = m.end()
            seg = re.split(r"\s;\s|;\s*$", seg)[-1] if ";" in seg else seg  # "A link ; B title <url>" -> "B title"
            if url in seen: continue
            lab = _key_label(seg) if key_mode else ("" if _host(url) in ("x.com", "twitter.com") else _clean_label(seg))
            seen.add(url); out.append({"title": lab or _fallback_label(url), "url": url})
    return out[:limit]


def cmd_entry(a):
    """Add (or replace) a whole book from a hand-in folder: library-entry.json is the source of truth.
    Swapping in a restyled version keeps the same id, shelf, taxonomy, "added" date and reader links, e.g.
      python3 scripts/add_book.py entry --dir /path/to/books/starlink-v2 --slug how-starlink-works
    Page images left over from a longer old version are removed."""
    d = a.dir.rstrip("/")
    e = json.load(open(os.path.join(d, "library-entry.json")))
    topic = canon(e.get("topic") or e.get("shelf", ""))
    if not topic:
        sys.exit("library-entry.json topic %r is not a shelf (%s)" % (e.get("topic"), ", ".join(TOPICS)))
    slug = a.slug or e["id"]
    text = json.load(open(os.path.join(d, "page-text.json"))) if os.path.exists(os.path.join(d, "page-text.json")) else {}
    tks = json.load(open(os.path.join(d, "takeaways.json"))) if os.path.exists(os.path.join(d, "takeaways.json")) else {}
    lib = load(); old = next((b for b in lib["books"] if b["id"] == slug), None)
    pages, ptext = [], []
    for i, pg in enumerate(e["pages"], 1):
        stem = os.path.splitext(os.path.basename(pg["file"]))[0]  # c01
        src = next((os.path.join(d, stem + x) for x in (".png", ".webp", ".jpg") if os.path.exists(os.path.join(d, stem + x))), None)
        if not src: sys.exit("missing image for %s in %s" % (stem, d))
        lines = text.get(stem, [])
        if lines and isinstance(lines[0], list): lines = [x for part in lines for x in part]  # some hand-ins wrap each page's lines once more
        p = page_entry(slug, i, src, pg["title"], lines or None)
        tk = pg.get("takeaway") or (tks.get(stem) if isinstance(tks, dict) else None)
        if tk: p["takeaway"] = tk.strip()
        pages.append(p); ptext.append(lines)
    if not 1 <= len(e.get("recap", [])) <= 4: sys.exit("library-entry.json needs a 1-4 line recap")
    today = datetime.date.today().isoformat()
    book = {"id": slug, "title": e["title"], "topic": topic, "blurb": e["blurb"], "gist": e["gist"],
            "added": (old or {}).get("added") or today, "added_at": (old or {}).get("added_at") or datetime.datetime.now().isoformat(timespec="minutes"),
            "tagline": e.get("tagline") or (old or {}).get("tagline"), "pages": pages, "recap": e["recap"], "recap_pages": len(pages)}
    if e.get("gist_lead"): book["gist_lead"] = e["gist_lead"]
    if os.path.exists(os.path.join(d, "sources.md")): book["sources"] = _sources(os.path.join(d, "sources.md"))
    if old:  # drop page images the new version no longer has (p10.webp etc. when the new book is shorter)
        keep = {os.path.basename(p["file"]) for p in pages} | {os.path.basename(p["thumb"]) for p in pages if p.get("thumb")}
        adir = os.path.join(ROOT, "assets", "pulse", slug)
        for f in os.listdir(adir) if os.path.isdir(adir) else []:
            if re.fullmatch(r"p\d+(-t)?\.(webp|png|jpg)", f) and f not in keep: os.remove(os.path.join(adir, f))
        if old.get("added") and old["added"] != today: book["added"] = old["added"]; book["updated"] = today
        lib["books"][lib["books"].index(old)] = book
    else: lib["books"].append(book)
    # cleaned page text for "Ask the library" and deep search
    pt_path = os.path.join(ROOT, "data", "page-text.json")
    pt = json.load(open(pt_path)) if os.path.exists(pt_path) else {"version": 1, "pages": {}}
    pt.setdefault("pages", {})[slug] = ptext
    with open(pt_path, "w") as f: json.dump(pt, f, ensure_ascii=False, indent=1); f.write("\n")
    save(lib)
    print("saved %s: %s, %d pages, %d sources%s" % (slug, topic, len(pages), len(book.get("sources", [])), " (replaced)" if old else " (new)"))


def cmd_list(a):
    for b in load()["books"]:
        print("%-30s %-13s %2d pages  %s" % (b["id"], b["topic"], len(b["pages"]), b["title"]))


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
sp = ap.add_subparsers(dest="cmd", required=True)
p = sp.add_parser("book"); p.set_defaults(fn=cmd_book)
p.add_argument("--slug", required=True); p.add_argument("--title", required=True)
p.add_argument("--topic", required=True); p.add_argument("--blurb", required=True)
p.add_argument("--gist", nargs=3, required=True); p.add_argument("--takeaways", nargs="+", help="optional: one takeaway per page (pages[].takeaway), shown in the caption box under the page"); p.add_argument("--recap", nargs="+", help="1-3 plain lines recapping the WHOLE book (shown on the end card); required whenever the page set changes"); p.add_argument("--gist-lead", nargs=3, help="optional bold lead phrase for each gist line; must be the start of that line"); p.add_argument("--pages", nargs="+", required=True)
p.add_argument("--page-titles", nargs="+")
p = sp.add_parser("replace"); p.set_defaults(fn=cmd_replace)
p.add_argument("--slug", required=True); p.add_argument("--page", type=int, required=True)
p.add_argument("--image", required=True); p.add_argument("--title")
p = sp.add_parser("append"); p.set_defaults(fn=cmd_append)
p.add_argument("--slug", required=True); p.add_argument("--image", required=True); p.add_argument("--title", required=True)
p.add_argument("--recap", nargs="+", help="REQUIRED: 1-3 plain lines recapping the whole book including the new page"); p.add_argument("--at", type=int, help="insert as this 1-based drawn page instead of appending")
p = sp.add_parser("meta", help="set cover tagline / volume / the 'Start here' book"); p.set_defaults(fn=cmd_meta)
p.add_argument("--slug", required=True); p.add_argument("--tagline"); p.add_argument("--vol", type=int)
p.add_argument("--start-here", action="store_true")
p = sp.add_parser("index", help="OCR page text into search keywords"); p.set_defaults(fn=cmd_index)
p.add_argument("--slug")
p = sp.add_parser("entry", help="add a finished book from its hand-in folder"); p.set_defaults(fn=cmd_entry)
p.add_argument("--dir", required=True); p.add_argument("--slug", help="override the id in library-entry.json")
p = sp.add_parser("list"); p.set_defaults(fn=cmd_list)
a = ap.parse_args(); a.fn(a)

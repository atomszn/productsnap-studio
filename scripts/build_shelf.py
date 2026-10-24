#!/usr/bin/env python3
"""Build data/shelf.json: the light book list the Pulse shelf renders first (a few KB),
from data/library.json (full books, loaded later for the reader and deep search) +
data/taxonomy.json (sub-topics, tags, reader words) + data/page-text.json (word counts -> reading time).
Fails loudly on an unknown topic: there is no silent fallback to another shelf."""
import json, os, re, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from topics import TOPICS, NAMES, slug

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)
WPM = 170  # a careful high-school reader on picture cards


def load(p, default=None):
    return json.load(open(p)) if os.path.exists(p) else default


def cover_img(b, crop=None):
    """A small cover picture (320px wide) cut from the book's first page, so the shelf loads fast.
    crop (taxonomy.json books.<id>.cover = {"page": 1, "box": [x0, y0, x1, y1]} in page pixels) picks the
    book's own art instead of the top of page 1; aim for 4:3, the cover window's shape.
    Rebuilt when the page or the crop changes."""
    from PIL import Image
    pg = b["pages"][max(0, min(len(b["pages"]) - 1, (crop or {}).get("page", 1) - 1))]
    src = os.path.join(ROOT, pg["file"]); adir = os.path.join(ROOT, "assets", "pulse", b["id"])
    dst = os.path.join(adir, "cover.webp"); keyf = os.path.join(adir, "cover.key")
    if not os.path.exists(src): return pg.get("thumb") or pg["file"], pg["w"], pg["h"]
    key = json.dumps({"src": pg["file"], "box": (crop or {}).get("box")})
    stale = (not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src)
             or (open(keyf).read() if os.path.exists(keyf) else "") != key)
    if stale:
        im = Image.open(src).convert("RGB")
        if crop and crop.get("box"): im = im.crop(tuple(crop["box"]))
        w = 320; h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(dst, "WEBP", quality=72, method=6)
        with open(keyf, "w") as f: f.write(key)
    with Image.open(dst) as im: w, h = im.size
    return "assets/pulse/%s/cover.webp" % b["id"], w, h


def build(write=True):
    lib = load(D("library.json"))
    tax = load(D("taxonomy.json"), {"books": {}, "_subs": {}})
    text = (load(D("page-text.json"), {}) or {}).get("pages", {})
    errs, out = [], []
    for b in lib["books"]:
        if b["topic"] not in NAMES:
            errs.append("%s: unknown topic %r (allowed: %s)" % (b["id"], b["topic"], ", ".join(NAMES)))
            continue
        t = tax["books"].get(b["id"], {})
        words = sum(len(" ".join(l).split()) for l in text.get(b["id"], [])) + len(" ".join(b.get("gist", [])).split())
        if not text.get(b["id"]):  # no cleaned text yet: estimate from the page count
            words = 140 * len(b["pages"])
        p0 = b["pages"][0]; cv, cw, ch = cover_img(b, t.get("cover"))
        e = {"id": b["id"], "title": b["title"], "topic": b["topic"], "tagline": b.get("tagline") or b["blurb"],
             "blurb": b["blurb"], "gist": b["gist"], "added": b.get("added"), "added_at": b.get("added_at"),
             "n": len(b["pages"]), "minutes": max(3, round(words / WPM)),
             "thumb": cv, "tw": cw, "th": ch,
             "pt": [p["title"] for p in b["pages"]],
             "sub": t.get("sub"), "tags": t.get("tags", []), "aka": t.get("aka", [])}
        for k in ("updated", "start_here", "vol"):
            if b.get(k): e[k] = b[k]
        if t.get("sub") and t["sub"] not in tax["_subs"].get(b["topic"], []):
            errs.append("%s: sub-topic %r is not in taxonomy _subs[%s]" % (b["id"], t["sub"], b["topic"]))
        out.append(e)
    ids = {b["id"] for b in lib["books"]}
    warns = ["taxonomy _path: no book %r yet (skipped)" % k for k in tax.get("_path", []) if k not in ids]
    shelf = {"version": 1, "updated": lib.get("updated"),
             "topics": [dict(t, slug=slug(t["name"]), subs=tax["_subs"].get(t["name"], [])) for t in TOPICS],
             "path": [k for k in tax.get("_path", []) if k in ids], "popular": tax.get("_popular", []),
             "questions": tax.get("_questions", []), "books": out}
    if write and not errs:
        with open(D("shelf.json"), "w") as f:
            json.dump(shelf, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
    return shelf, errs, warns


if __name__ == "__main__":
    s, errs, warns = build()
    for w in warns: print("warning:", w)
    if errs:
        print("\n".join(errs)); sys.exit(1)
    print("shelf.json: %d books, %d bytes" % (len(s["books"]), os.path.getsize(D("shelf.json"))))

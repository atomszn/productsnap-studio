#!/usr/bin/env python3
"""Library sanity check (run before every publish).
- every book has a 1-4 line 'You finished' recap written for the CURRENT page count
- every book's topic is one of the shelves in scripts/topics.py (no silent fallback to another shelf)
- every book has a taxonomy entry with a known sub-topic; the Start-here path only names real books
- every page image exists; data/shelf.json is up to date with library.json + taxonomy.json"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
sys.path.insert(0, HERE)
from topics import NAMES
import build_shelf
L = json.load(open(os.path.join(ROOT, "data", "library.json")))["books"]
T = json.load(open(os.path.join(ROOT, "data", "taxonomy.json")))
bad = []
ids = {b["id"] for b in L}
for b in L:
    r = b.get("recap")
    if not r or not 1 <= len(r) <= 4 or not all(isinstance(x, str) and x.strip() for x in r):
        bad.append("%s: recap must be 1-4 non-empty lines" % b["id"])
    if b.get("recap_pages") != len(b["pages"]):
        bad.append("%s: recap_pages=%s but the book has %d pages; rewrite the recap (add_book.py --recap)" % (b["id"], b.get("recap_pages"), len(b["pages"])))
    if b.get("topic") not in NAMES:
        bad.append("%s: topic %r is not a shelf (%s)" % (b["id"], b.get("topic"), ", ".join(NAMES)))
    tx = T.get("books", {}).get(b["id"])
    if not tx: bad.append("%s: no entry in data/taxonomy.json (sub-topic, tags, aka)" % b["id"])
    elif tx.get("sub") not in T["_subs"].get(b.get("topic"), []):
        bad.append("%s: sub-topic %r is not one of %s" % (b["id"], tx.get("sub"), T["_subs"].get(b.get("topic"))))
    for p in b["pages"]:
        if not os.path.exists(os.path.join(ROOT, p["thumb"])): bad.append("%s: missing thumb %s" % (b["id"], p["thumb"]))
        if not os.path.exists(os.path.join(ROOT, p["file"])): bad.append("%s: missing image %s" % (b["id"], p["file"]))
for i in T.get("_path", []):
    if i not in ids: bad.append("taxonomy _path names %r, which is not in the library" % i)
shelf, errs, warns = build_shelf.build(write=False)
bad += errs
cur = json.load(open(os.path.join(ROOT, "data", "shelf.json"))) if os.path.exists(os.path.join(ROOT, "data", "shelf.json")) else None
if cur is None or json.dumps(cur.get("books"), sort_keys=True) != json.dumps(shelf["books"], sort_keys=True):
    bad.append("data/shelf.json is stale: run python3 scripts/build_shelf.py")
print("\n".join(bad) or "library OK: %d books on %d shelves, recaps match page counts, shelf.json current" % (len(L), len({b['topic'] for b in L})))
sys.exit(1 if bad else 0)

#!/usr/bin/env python3
"""Library sanity check (run before every publish): every book has a 1-3 line 'You finished' recap
that was written for the CURRENT page count (recap_pages == len(pages)), so it can never cover only some pages."""
import json, os, sys
L = json.load(open(os.path.join(os.path.dirname(__file__), "..", "data", "library.json")))["books"]
bad = []
for b in L:
    r = b.get("recap")
    if not r or not 1 <= len(r) <= 3 or not all(isinstance(x, str) and x.strip() for x in r):
        bad.append("%s: recap must be 1-3 non-empty lines" % b["id"])
    if b.get("recap_pages") != len(b["pages"]):
        bad.append("%s: recap_pages=%s but the book has %d pages; rewrite the recap (add_book.py --recap)" % (b["id"], b.get("recap_pages"), len(b["pages"])))
print("\n".join(bad) or "library OK: %d books, recaps match page counts" % len(L))
sys.exit(1 if bad else 0)

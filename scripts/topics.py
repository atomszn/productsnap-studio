"""Pulse shelves: the ONE list of topics. pulse.js, main.js (home teaser), add_book.py and
check_library.py all read it (the browser gets it through data/shelf.json). Order = shelf order.
Adding a shelf: add it here, add its colours + cloth weave in css/pulse.css (.t-<slug>), update DESIGN.md."""
import re
TOPICS = [
    {"name": "AI", "short": "AI", "desc": "How AI works, how to use it well, and where it goes wrong."},
    {"name": "Fintech", "short": "Fintech", "desc": "How money moves now: payments, rails and digital dollars."},
    {"name": "Macro", "short": "Macro", "desc": "Prices, rates, debt and the big economic picture."},
    {"name": "Frontier Tech", "short": "Frontier", "desc": "Rockets, satellites, robots, brain chips and new power."},
]
NAMES = tuple(t["name"] for t in TOPICS)


def slug(name):
    """Class-safe slug: "Frontier Tech" -> "frontier-tech"."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def canon(name):
    """Accept any case ("frontier tech", "FINTECH"); return the canonical name or None (never a silent fallback)."""
    m = {t.lower(): t for t in NAMES}
    m.update({slug(t): t for t in NAMES})
    return m.get((name or "").strip().lower())

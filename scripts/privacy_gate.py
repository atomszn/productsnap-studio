#!/usr/bin/env python3
"""Privacy gate for productsnap.studio (run before every publish; CI runs it on every PR).
Rules (owner, Nov 2026):
- Visible copy (HTML body text, alt/title/aria text, reader data JSON) uses the first name "Jeevan" only:
  no surname, email, degrees, age, years of experience, employer or resume. LinkedIn is the only contact.
- Search-only spots (<head> title/meta/OG, JSON-LD, llms.txt, context.json) may carry the full name, but never
  the employer, an email, an age, or a personal social profile other than LinkedIn (no X/Twitter handle).
Usage: python3 scripts/privacy_gate.py [site_root]   -> exit 1 on any flag."""
import re, sys, json, html, pathlib
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parent.parent)
EVERYWHERE = {
    r"\bOracle\b": "employer is never shown",
    r"\bInn?ova\b": "employer is never shown",
    r"\bKumar\b|kumar99": "old handle; never on the site",
    r"[A-Za-z0-9._%+-]+@(?!2x\b)[A-Za-z0-9.-]+\.(?:com|net|org|io|ai|edu|me)\b": "no email address",
    r"\b\d{2}\s*(?:years old|yrs old|-year-old)\b": "no age",
    r"(?<![A-Za-z0-9.-])(?:https?://)?(?:www\.)?(?:x|twitter)\.com/(?!intent/|share\b|[^\s\"'/]+/status/)[A-Za-z0-9_]{1,15}\b(?!/status)": "no personal X/Twitter profile link (post/status source links are fine)",
}
VISIBLE_ONLY = {
    r"\bKoppu\b": "surname only in search-only spots",
    r"\bMBA\b|\bmaster'?s degree\b": "no degrees",
    r"\b\d{1,2}\+?\s+years (?:of|in) (?:experience|tech|product)\b": "no years of experience",
    r"(?i)r[ée]sum[ée]": "no resume",
}
SKIP_DIRS = {".git", "node_modules", "scripts", ".github", "assets"}
def split_html(t):
    head = " ".join(re.findall(r"(?is)<head.*?</head>", t))
    ld = " ".join(re.findall(r'(?is)<script[^>]*application/ld\+json[^>]*>(.*?)</script>', t))
    body = re.sub(r"(?is)<head.*?</head>", " ", t)
    body = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", body)
    body = re.sub(r"(?is)<!--.*?-->", " ", body)
    attrs = " ".join(re.findall(r'(?i)\b(?:alt|title|aria-label|href)="([^"]*)"', body))
    body = re.sub(r"(?s)<[^>]+>", " ", body)
    return html.unescape(body + " " + attrs), head + " " + ld
def strings(o):
    if isinstance(o, str): yield o
    elif isinstance(o, dict):
        for v in o.values(): yield from strings(v)
    elif isinstance(o, list):
        for v in o: yield from strings(v)
hits, n = [], 0
def scan(name, text, rules):
    for pat, why in rules.items():
        for m in re.finditer(pat, text):
            s = text[max(0, m.start() - 40): m.end() + 40].replace("\n", " ").strip()
            hits.append(f"{name} | {why} | ...{s}...")
for p in sorted(root.rglob("*")):
    if not p.is_file() or SKIP_DIRS & set(p.relative_to(root).parts): continue
    rel = str(p.relative_to(root))
    if p.suffix == ".html":
        vis, search = split_html(p.read_text(errors="ignore")); n += 1
        scan(rel, vis, {**EVERYWHERE, **VISIBLE_ONLY}); scan(rel + " [search-only]", search, EVERYWHERE)
    elif p.suffix == ".json":
        n += 1; txt = " ".join(strings(json.loads(p.read_text(errors="ignore"))))
        if rel == "context.json": scan(rel + " [search-only]", txt, EVERYWHERE)
        else: scan(rel, txt, {**EVERYWHERE, **VISIBLE_ONLY})
    elif p.name in ("llms.txt", "robots.txt", "sitemap.xml"):
        n += 1; scan(rel + " [search-only]", p.read_text(errors="ignore"), EVERYWHERE)
for h in hits: print("FLAG", h)
print(f"{'OK' if not hits else 'FAIL'} privacy gate: {n} files scanned, {len(hits)} flags")
sys.exit(1 if hits else 0)

#!/usr/bin/env python3
"""Build per-book share pages (share/<slug>.html) with Open Graph tags and a 1200x630
cover image (assets/pulse/og/<slug>.png), so a shared Pulse link shows a pretty preview.

    python3 scripts/build_share.py [--base https://productsnap.studio/]

Needs Playwright + Chromium only to render the images (pass --no-images to skip).
A small local server is started automatically to render the real CSS covers."""
import argparse, html, json, os, subprocess, sys, time, socket

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser(); ap.add_argument("--base", default="https://productsnap.studio/")
ap.add_argument("--no-images", action="store_true"); a = ap.parse_args()
base = a.base.rstrip("/") + "/"
lib = json.load(open(os.path.join(ROOT, "data", "library.json")))
os.makedirs(os.path.join(ROOT, "share"), exist_ok=True)
os.makedirs(os.path.join(ROOT, "assets", "pulse", "og"), exist_ok=True)

TPL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>{title} — Pulse · ProductSnap Studio</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="description" content="{desc}" />
<meta name="robots" content="noindex, follow" />
<link rel="canonical" href="{base}pulse#book/{id}/1" />
<meta property="og:type" content="book" />
<meta property="og:site_name" content="ProductSnap Studio" />
<meta property="og:title" content="{title} — a Pulse sketch book" />
<meta property="og:description" content="{desc}" />
<meta property="og:url" content="{base}share/{id}.html" />
<meta property="og:image" content="{base}assets/pulse/og/{id}.png" />
<meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Cover of {title}: {tag}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="{title} — a Pulse sketch book" />
<meta name="twitter:description" content="{desc}" />
<meta name="twitter:image" content="{base}assets/pulse/og/{id}.png" />
<meta http-equiv="refresh" content="0; url=../pulse.html#book/{id}/1" />
<script>
  var m = location.search.match(/[?&]p=(\\d+)/);
  location.replace("../pulse.html#book/{id}/" + (m ? m[1] : 1));
</script>
</head><body><p><a href="../pulse.html#book/{id}/1">Open “{title}” on Pulse</a></p></body></html>
"""
for b in lib["books"]:
    tag = b.get("tagline") or b["blurb"]
    desc = (tag.rstrip(".") + ("" if tag.rstrip(".")[-1:] in "?!" else ".") + " " + " ".join(b.get("gist", [])))[:300]
    with open(os.path.join(ROOT, "share", b["id"] + ".html"), "w") as f:
        f.write(TPL.format(title=html.escape(b["title"]), tag=html.escape(tag), desc=html.escape(desc), id=b["id"], base=base))
print("wrote %d share pages" % len(lib["books"]))
if a.no_images:
    sys.exit(0)

from playwright.sync_api import sync_playwright
s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
srv = subprocess.Popen([sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(); pg = br.new_page(viewport={"width": 1200, "height": 630}); pg.add_init_script("localStorage.setItem('psnap-theme','light')")
        pg.goto("http://127.0.0.1:%d/pulse.html#topics" % port); pg.wait_for_selector(".cv")
        for b in lib["books"]:
            pg.evaluate("""(id) => {
              const src = document.querySelector('#shelves a[href^="#book/' + id + '/"] .cv');
              let st = document.getElementById('og-stage'); if (st) st.remove();
              st = document.createElement('div'); st.id = 'og-stage';
              st.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;gap:56px;padding:0 80px;background:var(--paper)';
              const c = src.cloneNode(true); c.querySelectorAll('.bk-newdot').forEach(n => n.remove());
              const w = document.createElement('div'); w.className = src.closest('a').className.replace('is-new','');
              w.style.cssText = 'width:330px;flex:none;transform:rotate(-2deg)'; c.style.animation = 'none'; w.append(c);
              const t = document.createElement('div');
              t.innerHTML = '<div style="font:600 30px var(--hand);color:var(--ink-soft)">Pulse · the sketch library</div>' +
                '<div style="font:600 64px/1.05 var(--serif);color:var(--ink);margin:14px 0 18px">' + src.querySelector('.cv-title').textContent + '</div>' +
                '<div style="font:30px/1.35 var(--hand-2);color:var(--ink-soft)">' + src.querySelector('.cv-tag').textContent + '</div>' +
                '<div style="font:600 22px var(--body);color:var(--ink-soft);margin-top:34px">productsnap.studio/pulse</div>';
              st.append(w, t); document.body.append(st);
              if (!document.getElementById('og-css')) { const k = document.createElement('style'); k.id = 'og-css';
                k.textContent = '#og-stage .cv{container-type:normal}#og-stage .cv-topic{font-size:17px}#og-stage .cv-title{font-size:40px}#og-stage .cv-tag{font-size:25px}#og-stage .cv-foot{font-size:14px}#og-stage .cv-vol{font-size:22px}#og-stage .cv-start{font-size:15px}';
                document.head.append(k); }
            }""", b["id"])
            pg.wait_for_timeout(120)
            pg.screenshot(path=os.path.join(ROOT, "assets", "pulse", "og", b["id"] + ".png"))
        br.close()
    for b in lib["books"]:  # shrink: palette PNG keeps it crisp and small
        from PIL import Image
        p = os.path.join(ROOT, "assets", "pulse", "og", b["id"] + ".png")
        Image.open(p).convert("RGB").quantize(colors=128, method=2).save(p, optimize=True)
    print("rendered %d og images" % len(lib["books"]))
finally:
    srv.terminate()

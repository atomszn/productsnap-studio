/* Pulse — the sketch library. Reads data/library.json (built by scripts/add_book.py).
   Page 1 of every book is the "60-second version"; the drawn pages follow, then an
   "Up next" card (not counted in page numbers).
   Deep links: #book/<id>/<page>  (1-based, counting the gist page). #topics opens Topics. */
(function () {
  "use strict";
  var TOPICS = { AI: "AI", Tech: "Tech", Fintech: "Fintech", Macro: "Macro" };
  var LS = { seen: "pulse_seen", opens: "pulse_opens", bm: "pulse_bm_", prog: "pulse_prog_", sound: "pulse_sound", saved: "pulse_saved", last: "pulse_last", lastX: "pulse_last_x" };
  var START = [["agent-vocabulary", "Agent Vocabulary"], ["ai-agents", "AI Agents"], ["stablecoin-rails", "Stablecoins"], ["mortgage-rates", "Mortgages"]];
  var ICONS = {
    "agent-vocabulary": "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6",
    "ai-agents": "M7 9h10v8H7zM12 5v4M9.5 12.5h.01M14.5 12.5h.01M10 15h4M5 12h2M17 12h2",
    "agent-native-infrastructure": "M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6zM12 14.5v2.5",
    "agent-swarms": "M12 5.5a2 2 0 1 0 0 .01M6 17a2 2 0 1 0 0 .01M18 17a2 2 0 1 0 0 .01M11 7.5 7 15M13 7.5l4 7.5M8 17h8",
    "ai-bottlenecks": "M7 4h10M7 20h10M8 4c0 5 8 5 8 8s-8 3-8 8M16 4c0 5-8 5-8 8s8 3 8 8",
    "ai-moats": "M4 20V10l3-2 3 2V7l2-2 2 2v3l3-2 3 2v10zM10 20v-4h4v4M3 21c3-1.5 15-1.5 18 0",
    "physical-ai": "M8 9h8v7H8zM10 12h.01M14 12h.01M12 6v3M6 20l2-4M18 20l-2-4M5 12H3M21 12h-2",
    "world-models": "M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16",
    "stablecoin-rails": "M5 4l-1 16M19 4l1 16M4.5 8h15M4.2 13h15.6M4 18h16",
    "tokenization": "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5",
    "mortgage-rates": "M4 11l8-6 8 6M6 10v10h12V10M10 20v-5h4v5",
    "debt-loop": "M17 7a7 7 0 1 0 2 5M17 3v4h-4",
    "stablecoin-economics": "M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16M12 7.5v9M14.6 9.4c-.6-.8-1.6-1.1-2.6-1.1-1.5 0-2.6.8-2.6 1.9 0 2.5 5.2 1.3 5.2 3.8 0 1.1-1.1 1.9-2.6 1.9-1.1 0-2.1-.4-2.7-1.2",
    "ai-ladder": "M8 3v18M16 3v18M8 7h8M8 12h8M8 17h8",
    "fintech-rails": "M3 10l9-6 9 6zM5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 20h17",
    "two-schools-economics": "M12 4v16M8 20h8M4 7h16M4 7l-2.5 6a2.5 2.5 0 0 0 5 0zM20 7l-2.5 6a2.5 2.5 0 0 0 5 0z",
    "dollar-gold-yen": "M12 4v16M15.5 7.5c-1-1.2-2.2-1.6-3.5-1.6-2 0-3.5 1-3.5 2.6 0 3.5 7.5 2 7.5 5.8 0 1.7-1.6 2.8-4 2.8-1.5 0-3-.5-4-1.7"
  };
  var SYN = {
    gpu: ["chip", "compute", "nvidia", "bottleneck"], chip: ["gpu", "compute"], compute: ["gpu", "chip"],
    power: ["energy", "electricity", "grid"], energy: ["power", "electricity", "grid"], electricity: ["power", "energy"],
    robot: ["physical", "humanoid", "robots"], humanoid: ["robot", "physical"],
    money: ["payments", "rails", "dollar"], payment: ["stablecoin", "rails", "checkout", "pay"], pay: ["payments", "checkout"],
    agent: ["agents", "swarm"], swarm: ["agents", "team"], bot: ["agent"], assistant: ["agent"],
    moat: ["moats", "switching", "defensible"], scarce: ["bottleneck", "shortage"], shortage: ["bottleneck", "scarce"],
    word: ["vocabulary", "glossary"], jargon: ["vocabulary", "glossary"], glossary: ["vocabulary"],
    asset: ["tokenization", "tokenized"], token: ["tokens", "tokenization"],
    simulate: ["world", "models"], simulation: ["world", "models"], security: ["permissions", "sandbox", "keys"], safe: ["safely", "permissions", "sandbox"],
    price: ["cheaper", "cost", "pricing"], pricing: ["cheaper", "cost", "price"], cost: ["cheaper", "price", "pricing"], cheap: ["cheaper", "cost"],
    mortgage: ["mortgages", "10-year", "yield", "home"], rate: ["rates", "mortgage", "yield", "fed"], fed: ["federal", "mortgage", "plumbing", "reserves"],
    home: ["mortgage", "house", "housing"], house: ["mortgage", "home", "housing"], housing: ["mortgage", "home"],
    debt: ["debt", "loop", "deficit", "interest"], deficit: ["debt"], inflation: ["debasement", "dollar", "cpi", "prices"],
    dollar: ["dollar", "debasement"], gold: ["gold"], yen: ["japan", "yen"], japan: ["yen"],
    bank: ["banks", "leverage", "deposits"], car: ["cars", "self-driving", "physical"], driving: ["cars", "physical"]
  };
  var HINTS = ["Try: robots", "Try: payments", "Try: AI pricing", "Try: mortgages", "Try: agents", "Try: the yen"];
  var STOP = ["the", "and", "are", "why", "what", "how", "does", "for", "with", "who", "can", "this", "that", "your", "you", "about", "into", "from", "is", "a", "an", "of", "to", "in", "on", "so", "do", "my", "me", "it"];
  var $ = function (id) { return document.getElementById(id); };
  var lib = null, topic = "All", query = "";
  /* The Shelf (spines) is the default view at every width; Topics is opt-in and never
     restored from storage. Only an explicit #topics link opens it. */
  var view = location.hash === "#topics" ? "topics" : "shelf";
  var cur = null, idx = 0, turning = false;
  var fromShelf = function () { return !!(history.state && history.state.pulseShelf); };
  var reduce = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var touch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (touch) document.documentElement.classList.add("touch");

  function ls(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { return null; }
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  /* ---------- saved pages: [{id, p}] newest first; p is 1-based like deep links ---------- */
  function saved() {
    var s = ls(LS.saved);
    if (!Array.isArray(s)) { // migrate the old one-bookmark-per-book keys
      s = [];
      try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf(LS.bm) === 0) { var p = ls(k); if (p) s.push({ id: k.slice(LS.bm.length), p: p }); localStorage.removeItem(k); } }); } catch (e) {}
      ls(LS.saved, s);
    }
    return s.filter(function (x) { return x && find(x.id); });
  }
  function isSaved(id, p) { return saved().some(function (x) { return x.id === id && x.p === p; }); }
  function setSaved(id, p, on) {
    var s = saved().filter(function (x) { return !(x.id === id && x.p === p); });
    if (on) s.unshift({ id: id, p: p });
    ls(LS.saved, s); savedBadge();
  }
  function savedFor(b) { return saved().filter(function (x) { return x.id === b.id; }).map(function (x) { return x.p; }).sort(function (a, c) { return a - c; }); }
  function pageLabel(b, p) { return p === 1 ? "The 60-second version" : b.pages[p - 2] ? b.pages[p - 2].title : "Page " + p; }
  function savedBadge() {
    var n = lib ? saved().length : 0, c = $("saved-count");
    if (!c) return;
    c.textContent = n; c.hidden = !n;
    $("saved-btn").setAttribute("aria-label", "Saved pages" + (n ? ", " + n : ", none yet"));
  }
  function renderSaved() {
    var list = $("saved-list"); list.innerHTML = "";
    var s = saved();
    $("saved-empty").hidden = !!s.length;
    s.forEach(function (x) {
      var b = find(x.id), li = el("li", "sv-item t-" + b.topic.toLowerCase());
      var a = el("a", "sv-link"); a.href = "#book/" + b.id + "/" + x.p;
      var pg = x.p >= 2 && b.pages[x.p - 2];
      if (pg) { var im = el("img", "sv-thumb"); im.src = pg.thumb || pg.file; im.alt = ""; im.loading = "lazy"; im.width = 56; im.height = Math.round(56 * pg.h / pg.w); a.appendChild(im); }
      else a.appendChild(el("span", "sv-thumb sv-gist", "60s"));
      var tx = el("span", "sv-text");
      tx.appendChild(el("span", "sv-book", b.title + " · p." + x.p));
      tx.appendChild(el("span", "sv-page", pageLabel(b, x.p)));
      a.appendChild(tx);
      a.onclick = function (e) { e.preventDefault(); closeSaved(true); history.pushState({ pulseShelf: true }, "", a.getAttribute("href")); route(); };
      li.appendChild(a);
      var rm = el("button", "sv-rm", "Remove"); rm.type = "button"; rm.setAttribute("aria-label", "Remove " + b.title + ", page " + x.p + " from Saved");
      rm.onclick = function () { setSaved(x.id, x.p, false); renderSaved(); renderShelves(); toast("Removed from Saved"); var f = $("saved-list").querySelector(".sv-rm") || $("saved-x"); f.focus(); };
      li.appendChild(rm);
      list.appendChild(li);
    });
  }
  function openSaved() { renderSaved(); $("saved").hidden = false; document.body.classList.add("reading"); onScrollTop(); $("saved-x").focus(); }
  function closeSaved(silent) { $("saved").hidden = true; document.body.classList.remove("reading"); onScrollTop(); if (!silent) $("saved-btn").focus(); }

  function toast(msg, ms) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, ms || 2400); }

  /* ---------- deterministic variety (seeded from the book id, stable across loads) ---------- */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rnd(s, k) { var x = hash(s + ":" + k); x = Math.imul(x ^ (x >>> 15), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
  /* "New" stamp: books from the latest drop only: added within 7 days AND within 2 days of the newest book,
     so a launch week doesn't stamp the whole shelf. */
  function freshSet() {
    if (lib._fresh) return lib._fresh;
    var B = lib.books, set = {}, max = B.reduce(function (m, b) { return b.added && b.added > m ? b.added : m; }, "");
    if (max) {
      var md = new Date(max + "T12:00:00");
      B.forEach(function (b) { if (!b.added) return; var d = new Date(b.added + "T12:00:00"); if (md - d <= 2 * 864e5 && Date.now() - d <= 7.5 * 864e5) set[b.id] = 1; });
    }
    return (lib._fresh = set);
  }
  function isFresh(b) { return !!freshSet()[b.id]; }
  function stamp(txt, cls) { var s = el("span", "stamp " + (cls || ""), txt); return s; }
  var kbdNav = false;
  addEventListener("keydown", function (e) { if (e.key === "Tab" || e.key === "Enter" || e.key === " " || e.key.indexOf("Arrow") === 0) { kbdNav = true; var c = document.getElementById("rd-close"); if (c) c.classList.remove("nofv"); } }, true);
  addEventListener("pointerdown", function () { kbdNav = false; }, true);
  var vtOK = function () { return typeof document.startViewTransition === "function" && !reduce(); };

  /* ---------- living shelf state ---------- */
  var lastSeen = ls(LS.seen);
  var opens = ls(LS.opens) || {};
  function isNew(b) { return lastSeen && (b.updated || b.added) > lastSeen; }
  function progress(b) { var p = ls(LS.prog + b.id) || 0; return Math.min(1, p / (b.pages.length + 1)); }

  /* ---------- search: titles, taglines, gists, page titles and page text (OCR keywords) ---------- */
  function norm(s) { return (s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 -]+/g, " "); }
  function stem(w) { return w.length > 4 ? w.replace(/(ies)$/, "y").replace(/(ing|ers|ed|es|s)$/, "") : w; }
  function words(s) { return norm(s).split(/[\s-]+/).filter(function (w) { return w.length > 1 && STOP.indexOf(w) < 0; }); }
  function near(a, b) { // optimal-string-alignment distance <= 1 (<= 2 for long words); swaps count once
    if (a === b) return true;
    var la = a.length, lb = b.length, max = Math.min(la, lb) >= 7 ? 2 : 1;
    if (Math.min(la, lb) < 4 || Math.abs(la - lb) > max) return false;
    var d = [], i, j;
    for (i = 0; i <= la; i++) { d[i] = [i]; }
    for (j = 0; j <= lb; j++) d[0][j] = j;
    for (i = 1; i <= la; i++) {
      var rowMin = Infinity;
      for (j = 1; j <= lb; j++) {
        var c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        if (d[i][j] < rowMin) rowMin = d[i][j];
      }
      if (rowMin > max) return false;
    }
    return d[la][lb] <= max;
  }
  function index(b) {
    if (b._ix) return b._ix;
    var bag = function (s) { var o = {}; words(s).forEach(function (w) { o[w] = 1; o[stem(w)] = 1; }); return Object.keys(o); };
    b._ix = { title: bag(b.title), tag: bag((b.tagline || "") + " " + b.blurb + " " + b.topic), gist: bag(b.gist.join(" ")),
      pages: b.pages.map(function (p) { return { t: bag(p.title), k: bag(p.kw || "") }; }),
      raw: norm([b.title, b.tagline, b.blurb, b.gist.join(" ")].concat(b.pages.map(function (p) { return p.title + " " + (p.kw || ""); })).join(" ")) };
    return b._ix;
  }
  function hitWord(list, t) { for (var i = 0; i < list.length; i++) { var w = list[i]; if (w === t || (t.length >= 4 && w.indexOf(t) === 0) || near(w, t)) return w; } return null; }
  function why(b, page, q) {
    var ix = index(b), g = terms(q), out = null;
    g.forEach(function (grp) { if (out) return; grp.forEach(function (t) {
      if (out) return;
      if (page >= 0) { var w = hitWord(ix.pages[page].t, t); if (w) { out = "page title says “" + w + "”"; return; } w = hitWord(ix.pages[page].k, t); if (w) { out = "the page mentions “" + w + "”"; return; } }
      var w2 = hitWord(ix.title, t) || hitWord(ix.tag, t); if (w2) { out = "it’s what the book is about"; return; }
      w2 = hitWord(ix.gist, t); if (w2) { out = "the 60-second version mentions “" + w2 + "”"; }
    }); });
    return out || "closest match";
  }
  function hits(list, t) { for (var i = 0; i < list.length; i++) { var w = list[i]; if (w === t || (t.length >= 4 && w.indexOf(t) === 0) || near(w, t)) return true; } return false; }
  function terms(q) {
    var out = [];
    words(q).forEach(function (w) {
      var s = stem(w), group = [w]; if (s !== w) group.push(s);
      var key = SYN[w] ? w : SYN[s] ? s : Object.keys(SYN).filter(function (k) { return near(k, w) || near(k, s); })[0];
      if (key && key !== w && key !== s) group.push(key);
      (key ? SYN[key] : []).forEach(function (x) { group.push(x); });
      out.push(group);
    });
    return out;
  }
  function score(b, groups) {
    var ix = index(b), s = 0, matched = 0, best = 0, page = -1;
    var pageScore = ix.pages.map(function () { return 0; });
    groups.forEach(function (g, gi) {
      var gs = 0;
      g.forEach(function (t, ti) {
        var w = ti === 0 ? 1 : 0.6; // synonyms count a bit less
        if (hits(ix.title, t)) gs = Math.max(gs, 8 * w);
        if (hits(ix.tag, t)) gs = Math.max(gs, 5 * w);
        if (hits(ix.gist, t)) gs = Math.max(gs, 4 * w);
        ix.pages.forEach(function (p, i) {
          var ps = hits(p.t, t) ? 4 * w : hits(p.k, t) ? 2 * w : 0;
          if (ps) { pageScore[i] += ps; gs = Math.max(gs, ps); }
        });
      });
      if (gs) matched++; s += gs;
    });
    pageScore.forEach(function (v, i) { if (v > best) { best = v; page = i; } });
    if (groups.length > 1 && matched < Math.ceil(groups.length / 2)) s = 0; // most words should match
    return { s: s, page: page };
  }
  function search(q) {
    var g = terms(q); if (!g.length) return [];
    // down-weight words that match almost every book (e.g. "ai"), like a tiny IDF
    var weights = g.map(function (grp) {
      var df = lib.books.filter(function (b) { return score(b, [grp]).s > 0; }).length;
      return df >= lib.books.length * 0.7 ? 0.2 : 1;
    });
    var ws = words(q), phrase = ws.length > 1 ? new RegExp("\\b" + ws.map(function (w) { return stem(w).replace(/[^a-z0-9]/g, ""); }).join("[a-z]*\\s+") ) : null;
    var res = lib.books.map(function (b) {
      var s = 0, page = -1, best = 0, matched = 0;
      g.forEach(function (grp, i) { var r = score(b, [grp]); if (r.s) { matched++; s += r.s * weights[i]; if (r.s * weights[i] > best) { best = r.s * weights[i]; page = r.page; } } });
      var strong = g.filter(function (_, i) { return weights[i] === 1; }).length;
      if (strong > 1 && matched < Math.ceil(g.length / 2)) s = 0;
      if (s && phrase && phrase.test(index(b).raw)) s += 12; // the whole phrase appears
      if (s && g.length > 1) { var all = score(b, g); if (all.page >= 0) page = all.page; }
      return { b: b, s: s, p: page };
    }).filter(function (r) { return r.s > 0; }).sort(function (a, b) { return b.s - a.s; });
    if (!res.length) return res;
    var top = res[0].s;
    return res.filter(function (r) { return r.s >= top * 0.4; }).slice(0, 6);
  }

  /* ---------- shelf ---------- */
  function tagline(b) { return b.tagline || b.blurb; }
  function decorate(a, b) {
    a.href = "#book/" + b.id + "/1";
    var pr = progress(b);
    a.removeAttribute("aria-label"); var sr = a.querySelector(".sr-desc") || el("span", "sr-only sr-desc"); sr.textContent = " — " + tagline(b) + ". " + (b.pages.length + 1) + " pages. " + readText(b) + (b.start_here ? ". Start here." : "") + (isFresh(b) || isNew(b) ? ". New." : ""); a.appendChild(sr);
    if (isNew(b)) a.classList.add("is-new");
    if ((opens[b.id] || 0) >= 3) a.classList.add("is-lean");
    if (b.start_here) a.classList.add("is-start");
    a.addEventListener("click", pullOut);
    a.setAttribute("aria-haspopup", "dialog");
    a.addEventListener("keydown", function (e) { if (e.key === " " && !e.repeat) { e.preventDefault(); a.click(); } });
  }
  /* Opening / closing a book. With View Transitions the clicked spine (or cover) morphs into the reader and
     back; without them (or with reduced motion) it's a short pull then a fade. Feature-detected, never UA-sniffed. */
  function withVT(src, dstFind, change) {
    if (!vtOK()) { change(); return; }
    var root = document.documentElement, ranges = 0;
    var tag = src && (src.classList.contains("sp") ? src.querySelector(".sp-body") : src.querySelector(".cv") || src);
    if (tag) tag.classList.add("vt-src");
    root.setAttribute("data-vt", "1");
    var t;
    try {
      t = document.startViewTransition(function () {
        if (tag) tag.classList.remove("vt-src");
        change();
        var d = dstFind && dstFind(); if (d) d.classList.add("vt-dst");
      });
    } catch (e) { if (tag) tag.classList.remove("vt-src"); root.removeAttribute("data-vt"); change(); return; }
    var done = function () { root.removeAttribute("data-vt"); [].forEach.call(document.querySelectorAll(".vt-dst,.vt-src"), function (n) { n.classList.remove("vt-dst"); n.classList.remove("vt-src"); }); };
    var quiet = function () {}; if (t.ready) t.ready.catch(quiet); if (t.updateCallbackDone) t.updateCallbackDone.catch(quiet); // a newer transition aborting this one is normal, not an error
    t.finished.then(done, done);
  }
  function pullOut(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    var a = e.currentTarget; e.preventDefault();
    if (a.classList.contains("pulling")) return;
    // push a history entry marked "opened from the shelf", so Back (or the Put-it-back button) returns in one step
    var go = function () { withVT(a, function () { return $("book"); }, function () { history.pushState({ pulseShelf: true }, "", a.getAttribute("href")); route(); }); };
    if (reduce()) return go();
    a.classList.add("pulling"); setTimeout(function () { a.classList.remove("pulling"); go(); }, vtOK() ? 110 : 160);
  }
  function bar(b, cls) { var pr = progress(b), w = el("span", cls); w.setAttribute("aria-hidden", "true"); var f = el("i"); f.style.width = Math.round(pr * 100) + "%"; w.appendChild(f); if (!pr) w.hidden = true; return w; }
  function coverArt(b, small) {
    var c = el("span", "cv t-" + b.topic.toLowerCase() + (small ? " cv-sm" : ""));
    c.setAttribute("aria-hidden", "true");
    c.appendChild(el("span", "cv-topic", b.topic));
    if (ICONS[b.id]) { var ic = document.createElementNS("http://www.w3.org/2000/svg", "svg"); ic.setAttribute("viewBox", "0 0 24 24"); ic.setAttribute("class", "cv-ico"); var pa = document.createElementNS("http://www.w3.org/2000/svg", "path"); pa.setAttribute("d", ICONS[b.id]); ic.appendChild(pa); c.appendChild(ic); }
    c.appendChild(el("span", "cv-title", b.title));
    c.appendChild(el("span", "cv-rule"));
    c.appendChild(el("span", "cv-tag", tagline(b)));
    var f = el("span", "cv-foot"); f.appendChild(el("span", "cv-vol", "Vol. " + (b.vol || 1))); f.appendChild(el("span", "cv-mark", "ProductSnap · Pulse")); c.appendChild(f);
    if (b.start_here) c.appendChild(el("span", "cv-start", "Start here"));
    if (isFresh(b) && !small) c.appendChild(stamp("New", "cv-stamp"));
    return c;
  }
  function cover(b, hitPage, reason) {
    var a = el("a", "bk t-" + b.topic.toLowerCase()); decorate(a, b);
    if (hitPage >= 0) a.href = "#book/" + b.id + "/" + (hitPage + 2);
    a.appendChild(coverArt(b));
    a.appendChild(bar(b, "bk-prog"));
    var meta = el("span", "bk-meta", (b.pages.length + 1) + " pages");
    var bm = savedFor(b); if (bm.length) meta.appendChild(el("span", "bk-bm", " · saved p." + bm.join(", ")));
    a.appendChild(meta);
    if (hitPage >= 0) a.appendChild(el("span", "bk-hit", "Opens at “" + b.pages[hitPage].title + "”"));
    if (reason) a.appendChild(el("span", "bk-why", "Why: " + reason));
    a.appendChild(a.querySelector(".sr-desc"));
    return a;
  }
  /* pencil ticks: one slanted tick per page, filled for pages already reached */
  function readOf(b) { var total = b.pages.length + 1; return Math.min(total, Math.round(progress(b) * total)); }
  function readText(b) { var n = readOf(b), t = b.pages.length + 1; return n ? "Read up to page " + n + " of " + t : "0 of " + t + " pages read"; } // ticks = furthest page reached, not the page you are on
  function ticks(b, cls) {
    var total = b.pages.length + 1, reached = readOf(b), w = el("span", cls);
    w.setAttribute("aria-hidden", "true");
    if (total > 8) { // long books: a slim hand-drawn bar instead of a crowd of tiny ticks
      w.classList.add("bar"); var f = el("b", "pb-fill"); f.style.width = Math.round(reached / total * 100) + "%"; w.appendChild(f); w.dataset.pct = Math.round(reached / total * 100);
    } else for (var i = 0; i < total; i++) w.appendChild(el("i", i < reached ? "on" : ""));
    if (!reached) w.hidden = true;
    return w;
  }
  function spine(b) {
    var a = el("a", "sp t-" + b.topic.toLowerCase()); decorate(a, b);
    a.style.setProperty("--h", (200 + Math.min(b.pages.length, 6) * 14) + "px");
    a.style.setProperty("--hv", (0.95 + rnd(b.id, "h") * 0.10).toFixed(3));
    a.dataset.pp = b.pages.length + 1;
    var body = el("span", "sp-body");
    if (b.start_here) body.appendChild(el("span", "sp-start", "Start here"));
    body.appendChild(el("span", "sp-topic", b.topic));
    body.appendChild(el("span", "sp-title", b.title));
    body.appendChild(el("span", "sp-vol", "Vol. " + (b.vol || 1)));
    body.appendChild(ticks(b, "sp-prog"));
    if (savedFor(b).length) { var mk = el("span", "sp-mark"); mk.setAttribute("aria-hidden", "true"); body.appendChild(mk); }
    if (isFresh(b)) body.appendChild(stamp("New", "sp-stamp"));
    a.appendChild(body); a.appendChild(a.querySelector(".sr-desc"));
    return a;
  }
  /* one paper tooltip for the whole shelf, positioned in JS: the shelf rows clip overflow, so a per-spine tip would be cut off */
  var tipEl = null, tipFor = null;
  function showTip(a) {
    var b = find((a.getAttribute("href").match(/^#book\/([a-z0-9-]+)/) || [])[1]); if (!b) return;
    if (!tipEl) { tipEl = el("div", "sp-tip"); tipEl.id = "sp-tip"; tipEl.setAttribute("aria-hidden", "true"); document.body.appendChild(tipEl); }
    tipEl.innerHTML = "";
    tipEl.appendChild(el("i", "tp-shadow"));
    var card = el("div", "tp-card");
    card.appendChild(el("b", null, b.title));
    card.appendChild(el("span", "tp-meta", "Vol. " + (b.vol || 1) + " · " + (b.pages.length + 1) + " pages"));
    card.appendChild(el("span", "tp-tag", tagline(b)));
    card.appendChild(el("span", "tp-read", readText(b)));
    var bm = savedFor(b); if (bm.length) card.appendChild(el("span", "bk-bm", "Saved · p." + bm.join(", ")));
    tipEl.appendChild(card); tipEl.appendChild(el("i", "tp-notch"));
    tipEl.className = "sp-tip t-" + b.topic.toLowerCase();
    tipFor = a; var body = a.querySelector(".sp-body") || a, r = a.getBoundingClientRect(), br = body.getBoundingClientRect();
    tipEl.style.visibility = "hidden"; tipEl.classList.add("on");
    var w = tipEl.offsetWidth, h = tipEl.offsetHeight, x = r.left + r.width / 2 - w / 2, top = Math.min(r.top, br.top) - h - 12, flip = false;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    if (top < 8) { top = Math.max(r.bottom, br.bottom) + 10; flip = true; }
    tipEl.style.left = Math.round(x) + "px"; tipEl.style.top = Math.round(top) + "px";
    tipEl.style.setProperty("--ax", Math.round(r.left + r.width / 2 - x) + "px");
    tipEl.classList.toggle("flip", flip); tipEl.style.visibility = "";
  }
  function hideTip(a) { if (tipEl && (!a || tipFor === a)) { tipEl.classList.remove("on"); tipFor = null; } }
  function wireTips() {
    var host = $("shelves"), canHover = window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)");
    host.addEventListener("pointerover", function (e) {
      if (e.pointerType !== "mouse" || !canHover.matches) return;
      var a = e.target.closest && e.target.closest("a.sp"); if (a && a !== tipFor) showTip(a);
    });
    host.addEventListener("pointerout", function (e) {
      var a = e.target.closest && e.target.closest("a.sp"); if (!a) return;
      if (e.relatedTarget && a.contains(e.relatedTarget)) return; hideTip(a);
    });
    host.addEventListener("focusin", function (e) { var a = e.target.closest && e.target.closest("a.sp"); if (a && a.matches(":focus-visible")) showTip(a); });
    host.addEventListener("focusout", function (e) { var a = e.target.closest && e.target.closest("a.sp"); if (a) hideTip(a); });
    var tipRaf = 0; // keep the tip glued to its book while the page scrolls (a keyboard focus scrolls the book into view); hide it if the book leaves the screen
    window.addEventListener("scroll", function () {
      if (!tipFor || tipRaf) return;
      tipRaf = requestAnimationFrame(function () { tipRaf = 0; if (!tipFor) return; var r = tipFor.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) hideTip(); else showTip(tipFor); });
    }, { passive: true });
  }
  var ICO = {
    shelf: '<path d="M3 20.5h18"/><path d="M5 20.5V8h3v12.5M9.5 20.5V5h3v15.5"/><path d="m14.6 20.5 2.6-11.4 2.8.7-2.6 11"/>',
    topics: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    All: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    AI: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    Tech: '<rect x="3.5" y="5" width="17" height="11" rx="1.5"/><path d="M2 19.5h20M10 8.5l-2 2 2 2M14 8.5l2 2-2 2"/>',
    Fintech: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14.5h4"/>',
    Macro: '<path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>'
  };
  function ico(k, cls) { return '<svg class="' + (cls || "ci") + '" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[k] || ICO.All) + '</svg>'; }
  var chipFx = null;
  function renderTabs() {
    var t = $("lib-tabs"); t.innerHTML = "";
    var g = el("div", "topictabs"); g.setAttribute("role", "group"); g.setAttribute("aria-label", "Filter by topic");
    ["All"].concat(Object.keys(TOPICS)).forEach(function (k) {
      var n = k === "All" ? lib.books.length : lib.books.filter(function (b) { return b.topic === k; }).length;
      if (!n) return;
      var btn = el("button", "chip" + (k !== "All" ? " c-" + k.toLowerCase() : ""));
      btn.innerHTML = ico(k) + '<span class="ck">' + k + '<span class="cn"> · ' + n + '</span></span>';
      btn.type = "button"; btn.setAttribute("aria-pressed", String(topic === k)); btn.dataset.topic = k;
      if (chipFx === k && topic === k) btn.classList.add("just");
      btn.onclick = function () { chipFx = k; topic = k; clearQuery(); renderTabs(); renderShelves(); chipFx = null; };
      g.appendChild(btn);
    });
    t.appendChild(g);
    var vh = $("lib-view"); vh.innerHTML = "";
    var v = el("div", "viewtog"); v.setAttribute("role", "group"); v.setAttribute("aria-label", "View");
    [["shelf", "Shelf"], ["topics", "Topics"]].forEach(function (p) {
      var b = el("button", "chip vt"); b.innerHTML = ico(p[0], "vi") + "<span>" + p[1] + "</span>";
      b.type = "button"; b.dataset.view = p[0]; b.setAttribute("aria-pressed", String(view === p[0]));
      b.onclick = function () { view = p[0]; clearQuery(); renderTabs(); renderShelves(); }; v.appendChild(b);
    });
    vh.appendChild(v);
  }
  function heroMeta() {
    var B = lib.books, pg = B.reduce(function (s, b) { return s + b.pages.length + 1; }, 0);
    var tp = Object.keys(TOPICS).filter(function (k) { return B.some(function (b) { return b.topic === k; }); }).length;
    $("lib-stats").innerHTML = "<b>" + B.length + "</b> books<i>·</i><b>" + tp + "</b> topics<i>·</i><b>" + pg + "</b> pages";
    var latest = B.slice().sort(function (a, b) { return (b.updated || b.added || "").localeCompare(a.updated || a.added || "") || (b.added_at || "").localeCompare(a.added_at || "") || B.indexOf(b) - B.indexOf(a); })[0];
    if (latest) {
      var d = new Date((latest.updated || latest.added) + "T12:00:00"), r = $("lib-ribbon");
      var fresh = (Date.now() - d) < 8 * 864e5;
      r.innerHTML = '<span class="rb-k">' + (fresh ? "This week’s pulse" : "Latest in the library") + '</span><span class="rb-t">Latest: <a href="#book/' + latest.id + '/1"></a> · ' + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + "</span>";
      r.querySelector("a").textContent = latest.title; r.hidden = false;
    }
  }
  /* Shelf tiers: books split across planks (7/6 for 13), varied widths/heights,
     one leaning spine per tier (left/right and position vary by row), sketch decor (bookend, flat stack, plant) placed per tier. */
  var DECOR = {
    end: '<svg viewBox="0 0 26 120" width="26" height="120"><path class="dc-end" d="M4 118V60c0-7 5-12 12-12h6v70z"/><path d="M8 70h10" stroke-opacity=".4"/></svg>',
    stack: '<svg viewBox="0 0 70 60" width="70" height="60"><rect class="dc-b1" x="4" y="44" width="60" height="14" rx="2"/><rect class="dc-b2" x="9" y="31" width="50" height="13" rx="2"/><rect class="dc-b3" x="2" y="20" width="56" height="11" rx="2"/><path d="M12 51h34M16 37h28M10 25h30" stroke-opacity=".45"/></svg>',
    plant: '<svg viewBox="0 0 56 110" width="56" height="110"><path class="dc-leaf" d="M28 66c-2-16-12-24-20-32 12 2 20 12 20 24 0-18 4-32 14-44-2 18-7 32-12 44 4-10 12-16 22-18-8 8-14 18-18 28"/><path class="dc-pot" d="M10 66h36l-5 42H15z"/><path d="M8 66h40"/></svg>',
    cup: '<svg viewBox="0 0 54 70" width="54" height="70"><path class="dc-cup" d="M6 30h32v26c0 7-5 12-12 12h-8c-7 0-12-5-12-12z"/><path d="M38 36h4c5 0 8 4 8 8s-3 8-8 8h-4"/><path d="M16 22c-3-4 3-7 0-12M26 22c-3-4 3-7 0-12" stroke-opacity=".5"/></svg>'
  };
  function deco(k, cls) { var d = el("span", "sp-decor dc-" + k + (cls ? " " + cls : "")); d.setAttribute("aria-hidden", "true"); d.innerHTML = DECOR[k].replace("<svg ", '<svg fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" '); return d; }
  var PHONE = window.matchMedia("(max-width:640px)");
  (PHONE.addEventListener ? PHONE.addEventListener.bind(PHONE, "change") : PHONE.addListener.bind(PHONE))(function () { if (lib && view === "shelf" && !query) renderShelves(); });
  function tiers(books) {
    var spineN = 0, n = books.length, cap = PHONE.matches ? 5 : 7, k = Math.max(1, Math.ceil(n / cap)), base = Math.floor(n / k), extra = n % k, wrap = el("div", "tiers"), from = 0;
    for (var t = 0; t < k; t++) {
      var cnt = base + (t < extra ? 1 : 0), part = books.slice(from, from + cnt); from += cnt; if (!part.length) break;
      var row = el("div", "shelf-row spines tier");
      if (t % 2 === 0) row.appendChild(deco("end"));
      else row.appendChild(deco("stack"));
      var leanAt = part.length > 2 ? (t % 3 === 0 ? part.length - 1 : t % 3 === 1 ? Math.max(1, part.length - 2) : 0) : -1;
      part.forEach(function (b, i) {
        var s = spine(b), L = b.title.length;
        s.style.setProperty("--swb", ((L > 22 ? 1.18 : L > 13 ? 1.05 : .92) * (0.96 + rnd(b.id, "w") * 0.08)).toFixed(3));
        s.style.setProperty("--i", spineN++);
        if (i === leanAt) s.classList.add(t % 2 === 0 ? "is-lean-left" : "is-lean-right");
        row.appendChild(s);
      });
      var plantHere = t === 0 || t === k - 1; /* a plant always sits on the first and the last plank, so phones (where the middle ones are dropped) keep one */
      if (t % 2 === 0) { row.appendChild(deco("stack", "sm")); row.appendChild(deco("plant")); }
      else { row.appendChild(deco(plantHere ? "plant" : "cup")); row.appendChild(deco("end", "flip")); }
      wrap.appendChild(row);
    }
    return wrap;
  }
  function shelfDecor() {
    var d = el("div", "sp-decor"); d.setAttribute("aria-hidden", "true");
    d.innerHTML = '<svg viewBox="0 0 150 120" width="150" height="120" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path class="dc-end" d="M6 118V62c0-6 4-10 10-10h4v66z"/>' +
      '<rect class="dc-b1" x="34" y="104" width="54" height="14" rx="2"/><rect class="dc-b2" x="38" y="92" width="46" height="12" rx="2"/><rect class="dc-b3" x="31" y="81" width="50" height="11" rx="2"/>' +
      '<path d="M40 98h30M44 86h24" stroke-opacity=".45"/>' +
      '<path class="dc-pot" d="M104 92h34l-4 26h-26z"/><path d="M102 92h38"/>' +
      '<path class="dc-leaf" d="M121 92c0-14-10-22-18-30 10 2 18 10 18 20 1-14 4-26 12-36-2 14-6 26-10 36 3-8 10-14 18-16-6 8-12 16-16 26"/></svg>';
    return d;
  }
  function suggest(h, lead) {
    h.appendChild(document.createTextNode(lead));
    ["robots", "payments"].forEach(function (w, i) {
      var b = el("button", "linkbtn", w); b.type = "button"; b.onclick = function () { $("ask-input").value = w; ask(w); };
      if (i) h.appendChild(document.createTextNode(" or ")); h.appendChild(b);
    });
    h.appendChild(document.createTextNode("."));
  }
  /* if a row is wider than the screen, drop its extras (plant, cup, small stack) from the right until it fits: rows never scroll sideways */
  function fitTiers() {
    [].forEach.call(document.querySelectorAll(".tier"), function (row) {
      [].forEach.call(row.querySelectorAll(".dc-off"), function (n) { n.classList.remove("dc-off"); });
      /* squeeze the small props first, the plant last; the last plank's plant is never dropped (a narrow phone eases the spines in instead) */
      var last = row === row.parentNode.lastChild;
      var extras = [].slice.call(row.querySelectorAll(".dc-cup,.dc-stack.sm,.dc-stack:not(.sm),.dc-plant")).filter(function (n) { return getComputedStyle(n).display !== "none" && !(last && n.classList.contains("dc-plant")); }).sort(function (a, b) { var r = function (n) { return n.classList.contains("dc-plant") ? 2 : n.classList.contains("dc-stack") && !n.classList.contains("sm") ? 1 : 0; }; return r(a) - r(b); });
      while (row.scrollWidth > row.clientWidth + 1 && extras.length) extras.shift().classList.add("dc-off");
      row.style.removeProperty("--fit"); /* still too wide on a very narrow phone: ease every spine in a little */
      for (var k = 0, f = 1; k < 4 && row.scrollWidth > row.clientWidth + 1; k++) { f = Math.max(.7, f * (row.clientWidth - 1) / row.scrollWidth); row.style.setProperty("--fit", f.toFixed(3)); }
    });
  }
  var fitT; window.addEventListener("resize", function () { clearTimeout(fitT); fitT = setTimeout(fitTiers, 120); });
  var introDone = false;
  function renderShelves() {
    var host = $("shelves"); host.innerHTML = "";
    host.classList.remove("intro");
    if (!introDone && !reduce() && view === "shelf" && !query) { introDone = true; host.classList.add("intro"); setTimeout(function () { host.classList.remove("intro"); }, 1500); }
    var h = $("ask-hint");
    if (query) {
      var res = search(query); h.innerHTML = "";
      if (!res.length) {
        suggest(h, "Nothing yet. Try ");
        var empty = el("div", "lib-empty");
        empty.innerHTML = '<svg class="em-art" viewBox="0 0 120 70" width="120" height="70" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 62h108"/><path d="M14 62V30l9-2v34M29 62V22h10v40"/><path d="M80 62 94 24l9 3-13 35" stroke-dasharray="3 4"/><circle cx="64" cy="40" r="11"/><path d="m72 48 9 9"/><path d="M60 38c1.5-3 6-3 7 0" stroke-opacity=".55"/></svg>';
        empty.appendChild(el("p", "em-h", "Nothing on that shelf yet"));
        empty.appendChild(el("p", "em-p", "No book matches “" + query + "”. Search reads titles, gists and the words on every page, so a shorter word often works."));
        var eb = el("button", "g-go em-btn", "Back to the shelf"); eb.type = "button"; eb.onclick = function () { clearQuery(); renderShelves(); blurSearch(); };
        empty.appendChild(eb);
        host.appendChild(empty); return;
      }
      h.appendChild(document.createTextNode(res.length + (res.length === 1 ? " book" : " books") + " for “" + query + "” · "));
      var clr = el("button", "linkbtn", "Clear"); clr.type = "button"; clr.onclick = function () { clearQuery(); renderShelves(); blurSearch(); };
      h.appendChild(clr);
      var s = el("section", "shelf"); s.appendChild(el("h2", "shelf-h", "Best matches"));
      var top = res[0], tp = top.p >= 0 ? top.b.pages[top.p] : null;
      var best = el("a", "best t-" + top.b.topic.toLowerCase()); best.href = "#book/" + top.b.id + "/" + (top.p + 2);
      best.onclick = function (e) { e.preventDefault(); history.pushState({ pulseShelf: true }, "", best.getAttribute("href")); route(); };
      if (tp) { var bi = el("img", "best-thumb"); bi.src = tp.thumb || tp.file; bi.alt = ""; bi.width = 64; bi.height = Math.round(64 * tp.h / tp.w); best.appendChild(bi); }
      var bt = el("span", "best-text");
      bt.appendChild(el("span", "best-k", "Best page"));
      bt.appendChild(el("span", "best-t", top.b.title + " · " + (tp ? tp.title : "The 60-second version")));
      bt.appendChild(el("span", "best-why", "Why: " + why(top.b, top.p, query)));
      best.appendChild(bt); best.appendChild(el("span", "best-go", "Open →"));
      host.appendChild(best);
      var row = el("div", "shelf-row covers"); res.forEach(function (r) { row.appendChild(cover(r.b, r.p, why(r.b, r.p, query))); });
      s.appendChild(row); host.appendChild(s); return;
    }
    if (topic === "All") { var cont = continueCard(); if (cont) host.appendChild(cont); host.appendChild(startRow()); }
    var trank = Object.keys(TOPICS), books = lib.books.filter(function (b) { return topic === "All" || b.topic === topic; })
      .map(function (b, i) { return [b, i]; }).sort(function (a, c) { return trank.indexOf(a[0].topic) - trank.indexOf(c[0].topic) || a[1] - c[1]; }).map(function (x) { return x[0]; }); /* shelf groups by topic (AI, Tech, Fintech, Macro); within a topic, library order */
    var groups = view === "topics"
      ? Object.keys(TOPICS).map(function (k) { return [k, books.filter(function (b) { return b.topic === k; })]; }).filter(function (g) { return g[1].length; })
      : [[topic === "All" ? "The shelf" : topic + " shelf", books]];
    groups.forEach(function (g) {
      var s = el("section", "shelf" + (TOPICS[g[0]] ? " t-" + g[0].toLowerCase() : ""));
      if (view === "shelf") { s.appendChild(el("h2", "shelf-h", g[0])); s.appendChild(tiers(g[1])); host.appendChild(s); return; }
      var sh = el("div", "shelf-head"); sh.appendChild(el("h2", "shelf-h", g[0]));
      var mini = el("span", "mini"); mini.setAttribute("aria-hidden", "true");
      g[1].forEach(function (b, mi) { var m = el("i"); m.style.height = Math.round(16 + rnd(b.id, "m") * 14) + "px"; m.style.setProperty("--d", mi * 24 + "ms"); mini.appendChild(m); });
      sh.appendChild(mini); s.appendChild(sh);
      var row = el("div", "shelf-row covers");
      g[1].forEach(function (b) { row.appendChild(cover(b)); });
      s.appendChild(row); host.appendChild(s);
    });
    fitTiers();
  }
  function continueCard() {
    var L = ls(LS.last); if (!L || !find(L.id) || ls(LS.lastX) === L.id + "/" + L.p) return null;
    var b = find(L.id), P = pages(b); if (L.p > P.length) return null;
    var w = el("div", "cont t-" + b.topic.toLowerCase()); w.setAttribute("role", "group"); w.setAttribute("aria-label", "Continue reading");
    var a = el("a", "cont-a"); a.href = "#book/" + b.id + "/" + L.p;
    a.onclick = function (e) { e.preventDefault(); history.pushState({ pulseShelf: true }, "", a.getAttribute("href")); route(); };
    a.appendChild(el("span", "cont-k", "Pick up where you left off"));
    a.appendChild(el("span", "cont-t", b.title + " · " + pageLabel(b, L.p)));
    a.appendChild(el("span", "cont-p", "Page " + L.p + " of " + P.length + " →"));
    var x = el("button", "rd-btn rd-ico cont-x"); x.type = "button"; x.setAttribute("aria-label", "Dismiss continue reading");
    x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.onclick = function () { ls(LS.lastX, L.id + "/" + L.p); w.remove(); var f = document.querySelector("#shelves a"); if (f) f.focus(); };
    w.appendChild(a); w.appendChild(x); return w;
  }
  function startRow() {
    var r = el("nav", "start-row"); r.setAttribute("aria-label", "Start here");
    r.appendChild(el("span", "start-k", "Start here"));
    START.forEach(function (st) {
      var b = find(st[0]); if (!b) return;
      var a = el("a", "start-a t-" + b.topic.toLowerCase(), st[1]); a.href = "#book/" + b.id + "/1"; a.setAttribute("aria-label", b.title);
      a.onclick = function (e) { e.preventDefault(); history.pushState({ pulseShelf: true }, "", a.getAttribute("href")); route(); };
      r.appendChild(a);
    });
    return r;
  }
  /* the search field only takes focus when the reader taps it (or presses "/" on a keyboard device); never as a side effect, so no phone keyboard pops up */
  /* touch: drop the on-screen keyboard. readonly-then-blur is the reliable way on Android, where blur() alone can leave the keyboard up */
  function dismissKbd(inp) {
    if (!touch || !inp) return;
    var was = inp.readOnly; inp.readOnly = true; inp.blur(); if (document.activeElement && document.activeElement !== document.body && document.activeElement.tagName === "INPUT") document.activeElement.blur();
    setTimeout(function () { inp.readOnly = was; }, 150);
  }
  function wireKbdDismiss() { // tapping anywhere else, or scrolling the results, also closes the keyboard
    var isText = function (e) { return e && e.tagName === "INPUT" && /^(text|search)$/.test(e.type); };
    document.addEventListener("pointerdown", function (e) { var a = document.activeElement; if (touch && isText(a) && e.target !== a && !(e.target.closest && e.target.closest("label"))) dismissKbd(a); }, true);
    document.addEventListener("touchmove", function () { var a = document.activeElement; if (touch && isText(a)) dismissKbd(a); }, { passive: true });
  }
  function blurSearch() { var i = $("ask-input"); if (document.activeElement === i) i.blur(); }
  function clearQuery() { query = ""; $("ask-input").value = ""; $("ask-hint").textContent = ""; }
  function ask(q) { query = q.trim(); topic = "All"; renderTabs(); renderShelves(); }
  function rotateHints() {
    var i = 0, inp = $("ask-input");
    setInterval(function () { if (document.activeElement === inp || inp.value || document.hidden) return; i = (i + 1) % HINTS.length; inp.placeholder = HINTS[i]; }, 2600);
  }

  /* ---------- delight: page-turn sound (off by default) + haptics ---------- */
  var actx = null;
  function soundOn() { return ls(LS.sound) === true; }
  function rustle() {
    if (!soundOn()) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var n = actx.sampleRate * 0.22, buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * (0.6 + 0.4 * Math.sin(t * 40)); }
      if (actx.state === "suspended" && actx.resume) actx.resume();
      var src = actx.createBufferSource(); src.buffer = buf;
      var f = actx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 0.6;
      var g = actx.createGain(); g.gain.setValueAtTime(0.0001, actx.currentTime); g.gain.linearRampToValueAtTime(0.12, actx.currentTime + 0.025); // soft attack: a rustle, never a click
      src.connect(f); f.connect(g); g.connect(actx.destination); src.start();
    } catch (e) {}
  }
  function haptic() { if (touch && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} } }

  /* ---------- reader ---------- */
  function pages(b) { return [{ gist: true }].concat(b.pages); }
  function find(id) { return lib.books.filter(function (b) { return b.id === id; })[0]; }
  function nextBook(b) {
    var order = [];
    Object.keys(TOPICS).forEach(function (k) { lib.books.forEach(function (x) { if (x.topic === k) order.push(x); }); });
    var i = order.indexOf(b); return order[(i + 1) % order.length];
  }
  /* "Pairs with": 2-3 related books by shared topic + rare shared words (document-frequency weighted) */
  function rawWords(b) {
    if (b._rw) return b._rw; var o = {};
    index(b).raw.split(/[\s-]+/).forEach(function (w) { if (w.length > 3 && STOP.indexOf(w) < 0) o[w] = 1; });
    return (b._rw = o);
  }
  var NEXT_DOOR = { AI: ["Fintech"], Fintech: ["Macro", "AI"], Macro: ["Fintech"], Tech: ["AI"] };
  function related(b, skip) {
    if (!lib._df) { lib._df = {}; lib.books.forEach(function (x) { Object.keys(rawWords(x)).forEach(function (w) { lib._df[w] = (lib._df[w] || 0) + 1; }); }); }
    var mine = rawWords(b), N = lib.books.length;
    var all = lib.books.filter(function (x) { return x !== b && x !== skip; }).map(function (x) {
      var th = rawWords(x), sc = 0;
      Object.keys(mine).forEach(function (w) { if (!th[w]) return; var df = lib._df[w]; if (df < 2 || df > N * 0.34) return; sc += 1 / df; });
      return { b: x, s: sc / Math.sqrt(Object.keys(th).length || 1) * 10, same: x.topic === b.topic };
    });
    var by = function (a, c) { return c.s - a.s || lib.books.indexOf(a.b) - lib.books.indexOf(c.b); };
    var same = all.filter(function (r) { return r.same; }).sort(by).slice(0, 3);
    var door = (NEXT_DOOR[b.topic] || []);
    var cross = all.filter(function (r) { return !r.same && door.indexOf(r.b.topic) >= 0; }).sort(by);
    return same.concat(cross.slice(0, Math.max(0, 3 - same.length)));
  }
  function pairsNode(b, skip) {
    var rel = related(b, skip); if (rel.length < 2) return null;
    var w = el("div", "pairs"); w.appendChild(el("p", "pairs-k", "Pairs with"));
    var ul = el("ul", "pairs-list");
    rel.forEach(function (r) {
      var li = el("li"), a = el("a", "nbr t-" + r.b.topic.toLowerCase()); a.href = "#book/" + r.b.id + "/1";
      a.setAttribute("aria-label", "Open " + r.b.title + " — " + tagline(r.b));
      a.appendChild(el("span", "nbr-sp"));
      var t = el("span", "nbr-tx"); t.appendChild(el("span", "nbr-t", r.b.title));
      t.appendChild(el("span", "nbr-why", (r.same ? "Same shelf · " : "Next door · ") + r.b.topic));
      a.appendChild(t); li.appendChild(a); ul.appendChild(li);
    });
    w.appendChild(ul); return w;
  }
  function endNode(b) {
    var n = nextBook(b), d = el("div", "pg pg-end");
    d.appendChild(el("p", "g-kicker", "You finished " + b.title));
    if (b.recap && b.recap.length) { // whole-book recap, written for the current page count (scripts/check_library.py enforces it)
      var rc = el("div", "recap"); rc.appendChild(el("p", "rc-k", "In short"));
      var rl = el("ul", "rc-list"); b.recap.forEach(function (x) { rl.appendChild(el("li", null, x)); }); rc.appendChild(rl); d.appendChild(rc);
    }
    var sameTopic = n.topic === b.topic;
    var nx = el("div", "end-next"), col = el("div", "end-col");
    var a = el("a", "end-cover"); a.href = "#book/" + n.id + "/1"; a.setAttribute("aria-label", "Open next book: " + n.title + " — " + tagline(n));
    a.appendChild(coverArt(n, true)); nx.appendChild(a);
    col.appendChild(el("p", "end-label", sameTopic ? "Up next" : "Next topic: " + n.topic));
    col.appendChild(el("p", "end-nt", n.title));
    var row = el("div", "end-actions");
    var open1 = el("a", "g-go", "Open book →"); open1.href = a.href; open1.setAttribute("aria-label", "Open " + n.title); row.appendChild(open1);
    var back = el("button", "linkbtn end-shelf", backTo().long); back.type = "button"; back.onclick = close; row.appendChild(back);
    col.appendChild(row); nx.appendChild(col); d.appendChild(nx);
    var pr = pairsNode(b, n); if (pr) d.appendChild(pr);
    if (b.sources && b.sources.length) {
      var sd = el("details", "end-sources"); sd.appendChild(el("summary", null, "Sources for this book (" + b.sources.length + ")"));
      var ul = el("ul"); b.sources.forEach(function (x) { var li = el("li"), l = el("a", null, x.title); l.href = x.url; l.target = "_blank"; l.rel = "noopener"; li.appendChild(l); ul.appendChild(li); });
      sd.appendChild(ul); d.appendChild(sd);
    }
    /* short phones: the card scrolls inside itself; a small sticky pill says "more below" until the bottom is reached */
    var more = el("span", "end-more"); more.setAttribute("aria-hidden", "true"); more.appendChild(el("span", "end-more-pill", "Scroll for more ↓")); d.appendChild(more);
    var upd = function () { d.classList.toggle("g-more", d.scrollHeight - d.scrollTop - d.clientHeight > 8); };
    d.addEventListener("scroll", upd, { passive: true }); requestAnimationFrame(upd); setTimeout(upd, 500); setTimeout(upd, 1200);
    return d;
  }
  function pageNode(b, i) {
    var P = pages(b);
    if (i >= P.length) return endNode(b);
    var p = P[i], d = el("div", "pg");
    if (p.gist) {
      d.classList.add("pg-gist");
      var sc = el("div", "g-scroll");
      sc.appendChild(el("p", "g-kicker", "The 60-second version"));
      sc.appendChild(el("h3", "g-title", b.title));
      sc.appendChild(el("p", "g-blurb", tagline(b)));
      var ol = el("ol", "g-list"); b.gist.forEach(function (g, gi) {
        var li = el("li"), ld = b.gist_lead && b.gist_lead[gi]; // a bold lead phrase makes each point scannable; the full sentence stays plain text everywhere else
        if (ld && g.indexOf(ld) === 0) { li.appendChild(el("strong", "g-lead", ld)); li.appendChild(document.createTextNode(g.slice(ld.length))); } else li.textContent = g;
        ol.appendChild(li);
      }); sc.appendChild(ol);
      d.appendChild(sc);
      /* the page-turn button lives outside the scrolling text, so it is always on screen, however short the phone */
      var ft = el("div", "g-foot"), go = el("button", "g-go", "Turn the page →"); go.type = "button"; go.onclick = function () { turn(1); }; ft.appendChild(go); d.appendChild(ft);
      var more = function () { d.classList.toggle("g-more", sc.scrollHeight - sc.scrollTop - sc.clientHeight > 3); };
      sc.addEventListener("scroll", more, { passive: true }); requestAnimationFrame(more); setTimeout(more, 400);
    } else {
      var btn = el("button", "pg-zoom"); btn.type = "button"; btn.setAttribute("aria-label", "Zoom into page: " + p.title);
      var img = el("img"); img.src = p.file; img.alt = "Sketch page from " + b.title + ": " + p.title + ". " + tagline(b) + "."; img.width = p.w; img.height = p.h; img.decoding = "async"; if (Math.abs(i - idx) > 1) img.loading = "lazy";
      btn.appendChild(img); btn.onclick = function () { zoom(p, b); }; d.appendChild(btn);
      /* taller than the screen: the sketch fits the card's width and scrolls inside it; a small "Scroll" pill says so */
      var more = function () { d.classList.toggle("g-more", btn.scrollHeight - btn.scrollTop - btn.clientHeight > 6); };
      btn.addEventListener("scroll", more, { passive: true }); img.addEventListener("load", more); requestAnimationFrame(more); setTimeout(more, 500);
      var nx = P[i + 1]; if (nx) { var pre = new Image(); pre.src = nx.file; }
    }
    d.appendChild(el("span", "pg-num", (i + 1) + " of " + P.length));
    return d;
  }
  function paint() {
    var P = pages(cur), end = idx >= P.length, host = $("page");
    host.innerHTML = ""; host.appendChild(pageNode(cur, idx));
    $("rd-progfill").style.width = Math.round((idx + 1) / P.length * 100) + "%"; $("rd-pagetitle").textContent = end ? "Finished — " + P.length + " pages" : P[idx].gist ? "The 60-second version" : P[idx].title;
    $("rd-prev").disabled = idx === 0; $("rd-next").disabled = end;
    $("rd-next").setAttribute("aria-label", idx === P.length - 1 ? "Finish the book" : "Next page");
    var dots = $("rd-dots"); dots.innerHTML = "";
    P.forEach(function (_, i) { var d = el("button", "dot" + (i === idx ? " on" : "")); d.type = "button"; d.setAttribute("aria-label", "Page " + (i + 1) + " of " + P.length); if (i === idx) d.setAttribute("aria-current", "page"); d.onclick = function () { go(i); }; dots.appendChild(d); });
    var on = !end && isSaved(cur.id, idx + 1);
    $("rd-bm").setAttribute("aria-pressed", String(on)); $("rd-bm-lbl").textContent = on ? "Saved" : "Save page"; $("rd-bm").disabled = end;
    $("rd-bm").setAttribute("aria-label", on ? "Page saved. Remove from Saved" : "Save this page");
    $("ribbon").hidden = !on;
    ["rd-stamps", "rd-stamps2"].forEach(function (id, k) {
      var st = $(id); st.innerHTML = "";
      if (k === 0 && isFresh(cur)) st.appendChild(stamp("New", "rd-stamp"));
      if (!end && idx > 0 && cur.pages[idx - 1].outlook) { var os = stamp("Outlook", "rd-stamp"); os.classList.add("is-ol"); st.appendChild(os); }
    });
    $("rd-pagerow").hidden = !$("rd-stamps2").childNodes.length;
    if (!end) ls(LS.last, { id: cur.id, p: idx + 1 });
    var pg = !end && idx > 0 ? cur.pages[idx - 1] : null, tk = pg && pg.takeaway;
    $("rd-take").hidden = !tk; if (tk) $("rd-take-t").textContent = tk;
    askReset();
    var reached = Math.min(idx + 1, P.length); if (reached > (ls(LS.prog + cur.id) || 0)) ls(LS.prog + cur.id, reached);
    var h = "#book/" + cur.id + "/" + Math.min(idx + 1, P.length);
    if (location.hash !== h) history.replaceState(history.state, "", h);
  }
  /* where "back" goes: the view the reader was opened from (or the last one chosen; Shelf by default) */
  function backTo() { return view === "topics" ? { long: "Back to topics", short: "Topics" } : { long: "Back to the shelf", short: "Shelf" }; }
  function setBackLabel() {
    var t = backTo(), c = $("rd-close");
    c.setAttribute("aria-label", t.long + " (Esc)"); c.title = t.long;
    c.querySelector(".cl-long").textContent = t.long; c.querySelector(".cl-short").textContent = t.short;
    var es = document.querySelector(".end-shelf"); if (es) es.textContent = t.long;
  }
  var libY = 0;
  /* history.back() lets the browser restore its own (clamped) scroll a moment later, so put ours back a few times */
  function jump(y) { window.scrollTo({ top: y, left: 0, behavior: "instant" }); }
  function restoreY(y) { jump(y); [0, 60, 200, 450].forEach(function (ms) { setTimeout(function () { if (!cur && !document.body.classList.contains("reading") && Math.abs((window.pageYOffset || 0) - y) > 2) jump(y); }, ms); }); }
  function open(id, n) {
    var b = find(id); if (!b) return false;
    var first = !cur || cur.id !== id;
    cur = b; idx = Math.max(0, Math.min((n || 1) - 1, b.pages.length));
    $("rd-title").textContent = b.title; $("rd-topic").textContent = b.topic;
    var vtOn = document.documentElement.hasAttribute("data-vt");
    $("reader").className = "reader t-" + b.topic.toLowerCase() + (first && !vtOn && !reduce() ? " rd-enter" : "");
    $("book").style.setProperty("--ar", (b.pages[0].w / b.pages[0].h).toFixed(4)); // the book takes its pages' shape
    $("reader").hidden = false; document.body.classList.add("reading");
    if (first) {
      askReset(); if (!$("rd-askp").hidden) { $("rd-askp").hidden = true; $("rd-ask").setAttribute("aria-expanded", "false"); $("rd-ask").setAttribute("aria-pressed", "false"); }
      opens[id] = (opens[id] || 0) + 1; ls(LS.opens, opens);
      var bk = $("book"); bk.classList.remove("opening"); void bk.offsetWidth; if (!reduce() && !vtOn) bk.classList.add("opening");
      setTimeout(function () { if (cur) { var cb = $("rd-close"); cb.classList.toggle("nofv", !kbdNav); cb.focus({ preventScroll: true }); } }, 30);
    }
    setBackLabel(); onScrollTop();
    paint(); return true;
  }
  function hideReader(was) {
    $("reader").hidden = true; document.body.classList.remove("reading"); cur = null;
    $("rd-askp").hidden = true; $("rd-ask").setAttribute("aria-expanded", "false"); $("rd-ask").setAttribute("aria-pressed", "false");
    renderShelves();
    restoreY(libY); /* same view, same scroll position as when the book was opened */
    var sp = document.querySelector('#shelves a:not(.cont-a)[href="#book/' + was.id + '/1"]'); if (sp) sp.focus({ preventScroll: true });
    onScrollTop();
  }
  function dstOf(was) { return function () { var a = document.querySelector('#shelves a:not(.cont-a)[href="#book/' + was.id + '/1"]'); return a && (a.querySelector(".sp-body") || a.querySelector(".cv")); }; }
  function close() {
    var was = cur; if (!was) return;
    withVT($("book"), dstOf(was), function () {
      hideReader(was);
      if (fromShelf()) history.back();
      else history.replaceState(null, "", location.pathname + location.search);
    });
  }
  function go(i) { if (i === idx || turning) return; if (Math.abs(i - idx) === 1) return turn(i - idx); idx = i; paint(); }
  function turn(dir) {
    var P = pages(cur), to = idx + dir;
    if (to < 0 || to > P.length || turning) return;
    rustle(); haptic();
    if (reduce()) { idx = to; paint(); return; }
    turning = true;
    var book = $("book"), leaf = el("div", "leaf " + (dir > 0 ? "fwd" : "back"));
    var front = el("div", "leaf-face front"), back = el("div", "leaf-face back");
    if (dir > 0) { front.appendChild(pageNode(cur, idx)); idx = to; paint(); }
    else { front.appendChild(pageNode(cur, to)); }
    leaf.appendChild(front); leaf.appendChild(back); leaf.appendChild(el("div", "leaf-shade"));
    leaf.setAttribute("aria-hidden", "true"); leaf.inert = true;
    book.appendChild(leaf);
    requestAnimationFrame(function () { requestAnimationFrame(function () { leaf.classList.add("go"); }); });
    setTimeout(function () { if (dir < 0) { idx = to; paint(); } leaf.remove(); turning = false; }, 620);
  }
  /* ---------- Ask about this page: retrieval only, over this page's cleaned text + the gist ---------- */
  var TEXT = null, textLoading = null;
  function loadText() {
    if (TEXT) return Promise.resolve(TEXT);
    if (!textLoading) textLoading = fetch("data/page-text.json").then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) { TEXT = d.pages || d; return TEXT; });
    return textLoading;
  }
  function pageLines(b, i) { // i = reader index; 0 = gist page
    if (i === 0) return [];
    var t = TEXT && TEXT[b.id]; return (t && t[i - 1]) || [];
  }
  function expand(q) { // core words weigh 2, synonyms 1
    var out = [], seen = {};
    var add = function (t, wt) { if (t.length > 1 && !(t in seen)) { seen[t] = 1; out.push({ t: t, w: wt }); } };
    words(q).forEach(function (w) { add(stem(w), 2); });
    words(q).forEach(function (w) { var s = stem(w); (SYN[w] || SYN[s] || []).forEach(function (x) { add(stem(norm(x)), 1); }); });
    return out;
  }
  function isHeading(l) { return /,\s*part\s*\d/i.test(l) || (!/[.?!:”"]$/.test(l) && l.length < 44); }
  function lineMatch(line, qs) { // score (core words weigh 2, synonyms 1) and how many distinct core words matched
    var ws = words(line).map(stem), s = 0, m = 0, terms = [];
    qs.forEach(function (q) { var t = q.t; if (ws.some(function (w) { return w === t || (t.length >= 4 && w.indexOf(t) === 0) || (t.length >= 5 && near(w, t)); })) { s += q.w; if (q.w === 2) { m++; terms.push(t); } } });
    return { s: s, m: m, terms: terms };
  }
  function lineScore(line, qs) { return lineMatch(line, qs).s; }
  function askRender(head, lines, src, honest) {
    var o = $("askp-out"); o.innerHTML = "";
    if (head) o.appendChild(el("p", "askp-lead", head));
    if (lines.length) { var ul = el("ul", "askp-lines"); lines.forEach(function (l) { var li = el("li", null, typeof l === "string" ? l : l.l); if (l.g) li.appendChild(el("span", "askp-tag", " · 60-second version")); ul.appendChild(li); }); o.appendChild(ul); }
    if (src) o.appendChild(el("p", "askp-src", src));
    if (honest) o.appendChild(el("p", "askp-miss", honest));
  }
  function askReset() { $("askp-out").innerHTML = ""; $("askp-in").value = ""; }
  /* a short, honest snippet: the line itself when it is short, else its first sentence(s), else a clean cut */
  function snip(l) {
    if (l.length <= 230) return l;
    var s = l.match(/^.{40,230}?[.!?](\s|$)/); if (s) return s[0].trim();
    var c = l.slice(0, 215), k = c.lastIndexOf(" "); return c.slice(0, k > 120 ? k : 215).replace(/[,;:\s]+$/, "") + "…";
  }
  /* search every book: gist lines, page takeaways and the cleaned page text, whole library, client-side only */
  function libHits(qs) {
    var all = [], coreN = qs.filter(function (q) { return q.w === 2; }).length, minM = coreN >= 2 ? Math.max(2, Math.ceil(coreN * 0.6)) : 1; // a stray shared word is not an answer
    var sc = function (l) { var r = lineMatch(l, qs); return r.m >= minM ? r.s : 0; };
    lib.books.forEach(function (b) {
      b.gist.forEach(function (l) { var s = sc(l); if (s >= 2) all.push({ l: l, s: s + 0.3, b: b, i: 0 }); });
      b.pages.forEach(function (pg, k) {
        if (pg.takeaway) { var s = sc(pg.takeaway); if (s >= 2) all.push({ l: pg.takeaway, s: s + 0.2, b: b, i: k + 1 }); }
        pageLines(b, k + 1).forEach(function (l) { if (l.length < 28 || isHeading(l)) return; var s = sc(l); if (s >= 2) all.push({ l: l, s: s - (l.length > 230 ? 0.4 : 0), b: b, i: k + 1 }); });
      });
    });
    all.sort(function (a, c) { return c.s - a.s || a.l.length - c.l.length; });
    var need = qs.filter(function (q) { return q.w === 2; }).length > 1 ? 4 : 2;
    var top = all.length ? Math.min(need, all[0].s) : need, out = [], seen = {};
    all.filter(function (c) { return c.s >= top; }).forEach(function (c) {
      var key = c.b.id + "/" + c.i, tx = snip(c.l);
      if (out.length >= 2 || seen[key] || out.some(function (o) { return o.t === tx; })) return;
      seen[key] = 1; out.push({ t: tx, b: c.b, i: c.i });
    });
    return out;
  }
  function grokHref(q) { return "https://grok.com/?q=" + encodeURIComponent(q + " Answer in 1-2 short bullets."); }
  function grokLink(q) { // small outside link under every answer, so a half-answer is never a dead end
    var a = el("a", "askp-from askp-grok2", "Ask Grok about this ↗"); a.target = "_blank"; a.rel = "noopener noreferrer"; a.href = grokHref(q);
    $("askp-out").appendChild(a);
  }
  function askLib(hits) {
    var o = $("askp-out"); o.innerHTML = "";
    o.appendChild(el("p", "askp-lead", "From the library:"));
    var ul = el("ul", "askp-lines askp-lib");
    hits.forEach(function (h) {
      var li = el("li"); li.appendChild(el("span", "askp-q", h.t));
      var a = el("a", "askp-from", "from " + h.b.title + " · " + (h.i === 0 ? "60-second version" : "page " + (h.i + 1)) + " →");
      a.href = "#book/" + h.b.id + "/" + (h.i + 1); li.appendChild(a); ul.appendChild(li);
    });
    o.appendChild(ul);
  }
  /* nothing in the library: say so plainly and offer an outside link (never an invented answer) */
  function askOutside(q) {
    var o = $("askp-out"); o.innerHTML = "";
    o.appendChild(el("p", "askp-miss", "Nothing in the library answers that yet, and I won’t guess."));
    var a = el("a", "rd-btn askp-grok", "Ask Grok about this ↗"); a.target = "_blank"; a.rel = "noopener noreferrer";
    a.href = grokHref(q);
    o.appendChild(a);
    o.appendChild(el("p", "askp-src", "Opens grok.com in a new tab. That is an outside site, not part of this library."));
  }
  function askPage(q) {
    q = (q || "").trim(); if (!q || !cur) return;
    var b = cur, i = idx;
    askRender("Looking…", []);
    loadText().then(function () {
      if (cur !== b || idx !== i) return;
      var qs = expand(q); if (!qs.length) { askRender("", [], "", "Try a few more words, like “who pays?” or “what is a sandbox?”"); return; }
      var cand = pageLines(b, i).filter(function (l) { return !isHeading(l); }).map(function (l) { return { l: l, s: lineScore(l, qs), g: false }; })
        .concat(b.gist.map(function (l) { return { l: l, s: lineScore(l, qs), g: true }; }));
      var best = cand.filter(function (c) { return c.s >= 2; }).sort(function (a, c) { return c.s - a.s || a.g - c.g; });
      var need = qs.filter(function (q) { return q.w === 2; }).length > 1 ? 4 : 2;
      var hit = best.filter(function (c) { return c.s >= Math.min(need, best.length ? best[0].s : need); }).slice(0, 3);
      var onPage = hit.length && (i === 0 || hit.some(function (c) { return !c.g; }));
      if (onPage) { askRender("From this page:", hit, ""); grokLink(q); return; }
      var lh = libHits(qs);
      if (lh.length) { askLib(lh); grokLink(q); return; }
      askOutside(q);
    }).catch(function () { askRender("", [], "", "The page text didn’t load. Check your connection and try again."); });
  }
  function explainSimply() {
    if (!cur) return; var b = cur, i = idx;
    loadText().then(function () {
      if (cur !== b || idx !== i) return;
      if (i === 0 || i >= pages(b).length) { askRender("In short:", [tagline(b)].concat(b.gist), ""); return; }
      var pg = b.pages[i - 1], tq = expand(pg.title + " " + (pg.takeaway || ""));
      var lines = pageLines(b, i).map(function (l, k) { return { l: l, s: lineScore(l, tq), k: k }; }).filter(function (c) { return c.s > 0 && c.l.length > 24 && !isHeading(c.l); })
        .sort(function (a, c) { return c.s - a.s || a.k - c.k; }).slice(0, 2).sort(function (a, c) { return a.k - c.k; }).map(function (c) { return c.l; });
      askRender("In short:", (pg.takeaway ? [pg.takeaway] : []).concat(lines), pg.takeaway ? "The first line is this page’s takeaway; the rest are quoted from the page." : "");
    }).catch(function () { askRender("", [], "", "The page text didn’t load. Check your connection and try again."); });
  }
  function toggleAsk(on) {
    var p = $("rd-askp"); on = on == null ? p.hidden : on;
    p.hidden = !on; $("rd-ask").setAttribute("aria-expanded", String(on)); $("rd-ask").setAttribute("aria-pressed", String(on));
    if (on) { loadText().catch(function () {}); askReset(); if (!touch && window.matchMedia && matchMedia("(hover:hover) and (pointer:fine)").matches) setTimeout(function () { $("askp-in").focus({ preventScroll: true }); }, 30); } // touch: never raise the keyboard until the reader taps the box
    else $("rd-ask").focus({ preventScroll: true });
  }
  var zoomFrom = null;
  function zoom(p, b) {
    var z = $("zoom"), img = $("zoom-img"); img.src = p.file; img.alt = "Sketch page from " + b.title + ": " + p.title + ". " + tagline(b) + ".";
    zoomFrom = document.activeElement;
    z.hidden = false; z.classList.remove("big"); z.scrollTop = 0; $("zoom-x").focus();
  }
  function unzoom() { $("zoom").hidden = true; if (zoomFrom && zoomFrom.focus) zoomFrom.focus(); }
  function share() {
    var n = Math.min(idx + 1, pages(cur).length);
    var base = location.href.replace(/[#?].*$/, "").replace(/pulse(\.html)?$/, "");
    var url = base + "share/" + cur.id + ".html" + (n > 1 ? "?p=" + n : "");
    var done = function () { toast("Link copied — opens on page " + n); };
    if (navigator.share && touch) { navigator.share({ title: cur.title + " — Pulse", text: tagline(cur), url: url }).catch(function () {}); return; }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url) ? done() : toast(url); });
    else fallbackCopy(url) ? done() : toast(url);
  }
  function fallbackCopy(t) { try { var ta = el("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); var ok = document.execCommand("copy"); ta.remove(); return ok; } catch (e) { return false; } }

  function route() {
    if (location.hash === "#topics") { if (cur) close(); if (view !== "topics") { view = "topics"; renderTabs(); renderShelves(); } return; }
    var m = location.hash.match(/^#book\/([a-z0-9-]+)(?:\/(\d+))?/);
    if (m) { if (!open(m[1], +m[2] || 1)) { history.replaceState(null, "", location.pathname); if (cur) close(); toast("That book isn’t on the shelf"); } }
    else if (cur) { var was = cur; withVT($("book"), dstOf(was), function () { hideReader(was); }); }
  }

  /* back-to-top pill: library view only, after about 1.5 screens of scrolling */
  var topTick = false;
  function onScrollTop() {
    var b = $("totop"); if (!b) return;
    if (!cur && !document.body.classList.contains("reading")) libY = window.pageYOffset || 0; /* remember where the library is scrolled, for the way back */
    var show = !cur && !document.body.classList.contains("reading") && $("saved").hidden && (window.pageYOffset || 0) > innerHeight * 1.5;
    if (show !== !b.hidden) { if (show) { b.hidden = false; requestAnimationFrame(function () { b.classList.add("on"); }); } else { b.classList.remove("on"); b.hidden = true; } }
  }
  function wire() {
    addEventListener("scroll", function () { if (!topTick) { topTick = true; requestAnimationFrame(function () { topTick = false; onScrollTop(); }); } }, { passive: true });
    addEventListener("resize", onScrollTop);
    $("totop").onclick = function () { window.scrollTo({ top: 0, behavior: reduce() ? "instant" : "smooth" }); };
    $("rd-prev").onclick = function () { turn(-1); };
    $("rd-next").onclick = function () { turn(1); };
    $("rd-close").onclick = close;
    $("rd-stage").addEventListener("click", function (e) { if (e.target === $("rd-stage")) close(); });
    $("reader").addEventListener("click", function (e) { if (e.target === $("reader")) close(); });
    var syncSound = function () { $("rd-sound").setAttribute("aria-pressed", String(soundOn())); };
    syncSound();
    $("rd-sound").onclick = function () { ls(LS.sound, !soundOn()); syncSound(); toast(soundOn() ? "Page-turn sound on" : "Sound off"); if (soundOn()) rustle(); };
    $("rd-bm").onclick = function () {
      var on = isSaved(cur.id, idx + 1);
      setSaved(cur.id, idx + 1, !on);
      if (on) toast("Removed from Saved"); else { toast("Saved", 1400); haptic(); var bm = $("rd-bm"); bm.classList.remove("pop"); void bm.offsetWidth; bm.classList.add("pop"); }
      paint();
    };
    $("rd-share").onclick = share;
    $("rd-ask").onclick = function () { toggleAsk(); };
    $("askp-x").onclick = function () { toggleAsk(false); };
    $("askp-form").onsubmit = function (e) { e.preventDefault(); askPage($("askp-in").value); dismissKbd($("askp-in")); };
    $("askp-simple").onclick = explainSimply;
    $("askp-in").addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); toggleAsk(false); } });
    $("rd-take-copy").onclick = function () {
      var n = Math.min(idx + 1, pages(cur).length), base = location.href.replace(/[#?].*$/, "").replace(/pulse(\.html)?$/, "");
      var t = $("rd-take-t").textContent + " — " + cur.title + ", Pulse: " + base + "share/" + cur.id + ".html?p=" + n;
      var done = function () { toast("Takeaway + link copied", 1600); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(done, function () { fallbackCopy(t) ? done() : toast(t); });
      else fallbackCopy(t) ? done() : toast(t);
    };
    $("zoom-x").onclick = unzoom;
    $("zoom").onclick = function (e) { if (e.target.id === "zoom-img") $("zoom").classList.toggle("big"); else if (e.target.id === "zoom") unzoom(); };
    $("saved-btn").onclick = openSaved;
    $("saved-x").onclick = function () { closeSaved(); };
    $("saved").onclick = function (e) { if (e.target.id === "saved") closeSaved(); };
    document.addEventListener("keydown", function (e) {
      if (!$("saved").hidden) {
        if (e.key === "Escape") { e.preventDefault(); closeSaved(); }
        else if (e.key === "Tab") { var f = [].slice.call($("saved").querySelectorAll("button,a[href]")), a = f[0], z = f[f.length - 1];
          if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
        return;
      }
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!$("zoom").hidden) { if (e.key === "Escape" || e.key === "z" || e.key === "Z") { e.preventDefault(); unzoom(); } return; }
      if (!cur) { if (e.key === "/") { e.preventDefault(); $("ask-input").focus(); } return; }
      if (e.key === "ArrowRight") turn(1);
      else if (e.key === "ArrowLeft") turn(-1);
      else if (e.key === "Home") { e.preventDefault(); go(0); }
      else if (e.key === "End") { e.preventDefault(); go(pages(cur).length - 1); }
      else if (e.key === "Escape") { if (!$("rd-askp").hidden) toggleAsk(false); else close(); }
      else if ((e.key === "z" || e.key === "Z") && idx > 0 && idx < pages(cur).length) zoom(cur.pages[idx - 1], cur);
      else if (e.key === "b" || e.key === "B") $("rd-bm").click();
      else if (e.key === "a" || e.key === "A") { e.preventDefault(); toggleAsk(); }
      else if (e.key === "Escape" && !$("rd-askp").hidden) { toggleAsk(false); }
      else if (e.key === "Tab") { // keep focus inside the reader
        var f = [].slice.call($("reader").querySelectorAll("button:not([disabled]),a[href]")).filter(function (x) { return x.offsetParent; });
        if (!f.length) return; var a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    });
    var sx = null, sy = null;
    $("rd-stage").addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    $("rd-stage").addEventListener("touchend", function (e) {
      if (sx == null) return; var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) turn(dx < 0 ? 1 : -1); sx = null;
    }, { passive: true });
    $("lib-ask").onsubmit = function (e) { e.preventDefault(); ask($("ask-input").value); dismissKbd($("ask-input")); };
    $("ask-input").addEventListener("search", function () { if (!this.value && touch) this.blur(); });
    var deb;
    $("ask-input").addEventListener("input", function () {
      var v = this.value; clearTimeout(deb);
      if (!v.trim()) { query = ""; $("ask-hint").textContent = ""; renderShelves(); return; }
      deb = setTimeout(function () { if (v.trim().length >= 2) ask(v); }, 220);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || !$("reader").hidden) return;
      var a = document.activeElement; if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      e.preventDefault(); $("ask-input").focus();
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", function (e) { if (e.state && e.state.pulseShelf) route(); });
  }

  function newBadge() {
    var n = lib.books.filter(isNew).length, b = $("lib-new");
    if (n) { b.hidden = false; b.textContent = n + " new since you last looked"; }
    ls(LS.seen, new Date().toISOString().slice(0, 10));
  }

  fetch("data/library.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) {
      lib = d; lib.books.forEach(function (b) { if (!TOPICS[b.topic]) b.topic = "Tech"; });
      wire(); wireTips(); wireKbdDismiss(); savedBadge(); renderTabs(); heroMeta(); renderShelves(); newBadge(); rotateHints();
      if (location.hash && location.hash !== "#topics") route();
    })
    .catch(function (e) { console.error("Pulse: library failed to load", e); $("shelves").innerHTML = '<p class="lib-loading">The library didn’t load. Refresh to try again.</p>'; });
})();

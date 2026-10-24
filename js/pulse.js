/* Pulse — the sketch library.
   Loads data/shelf.json first (a light list: titles, covers, reading time, page titles, sub-topics; built by
   scripts/build_shelf.py) so the shelf paints fast, then data/library.json (the full books) in the background
   for the reader and deep page search.
   Page 1 of every book is the 60-second "Summary"; drawn pages follow ("page N of M"); then the end card.
   Routes: (none) home · #shelf/<slug> one shelf · #book/<id>/<n> (n is 1-based and counts the Summary). #topics → home. */
(function () {
  "use strict";
  var TOPICS = [], TOP = {}; // the shelves, in order, from shelf.json: {name, short, desc, slug, subs}
  var LS = { seen: "pulse_seen", opens: "pulse_opens", bm: "pulse_bm_", prog: "pulse_prog_", sound: "pulse_sound", saved: "pulse_saved", last: "pulse_last", lastX: "pulse_last_x", done: "pulse_done", hideRead: "pulse_hide_read" };
  /* related words. A synonym never stands in for a word silently: results found only through one are labelled "related". */
  var SYN = {
    gpu: ["chip", "compute", "nvidia"], chip: ["gpu", "compute"], chips: ["gpu", "compute"], compute: ["gpu", "chip"], nvidia: ["gpu", "chip"],
    power: ["energy", "electricity", "grid"], energy: ["power", "electricity", "grid"], electricity: ["power", "energy"],
    nuclear: ["energy", "power", "electricity"], fusion: ["energy", "power"], solar: ["energy", "power"], battery: ["energy", "power"],
    robot: ["robots", "physical", "warehouse"], humanoid: ["robot", "physical"], optimus: ["robot", "humanoid"],
    rocket: ["rockets", "spacex", "starship", "booster", "launch"], rockets: ["rocket", "spacex", "starship"], spacex: ["rocket", "starship", "starlink", "falcon"],
    starship: ["spacex", "rocket"], launch: ["rocket", "launches"], booster: ["rocket", "falcon"], space: ["rocket", "satellite", "orbit"], nasa: ["moon", "rocket"],
    starlink: ["satellite", "internet", "spacex"], satellite: ["starlink", "orbit"], satellites: ["starlink", "orbit"], internet: ["starlink", "satellite"], orbit: ["satellite", "starlink"],
    elon: ["musk", "spacex", "starlink"], musk: ["elon", "spacex", "starlink"], tesla: ["elon", "musk", "robot"], robotaxi: ["robot", "physical"], waymo: ["robot", "physical"],
    neuralink: ["brain", "elon"],
    money: ["payments", "rails", "dollar"], payment: ["payments", "stablecoin", "rails", "checkout", "pay"], payments: ["payment", "rails", "stablecoin", "pay"], pay: ["payments", "checkout"],
    crypto: ["stablecoin", "tokenization", "blockchain"], bitcoin: ["crypto", "stablecoin", "blockchain"], blockchain: ["tokenization", "stablecoin"],
    agent: ["agents", "assistant"], bot: ["agent", "chatbot"], assistant: ["agent"], chatgpt: ["chatbot", "llm"],
    word: ["vocabulary", "glossary"], jargon: ["vocabulary", "glossary"],
    asset: ["tokenization", "tokenized"], token: ["tokens", "tokenization"],
    simulate: ["world", "simulation"], security: ["permissions", "sandbox", "privacy"], safe: ["safely", "permissions", "sandbox"],
    price: ["prices", "cost", "inflation"], cost: ["price", "prices"], cheap: ["cheaper", "cost"], expensive: ["inflation", "prices"],
    mortgage: ["mortgages", "yield", "home"], rate: ["rates", "mortgage", "yield", "fed"], fed: ["federal", "mortgage", "rates"],
    home: ["mortgage", "house", "housing"], house: ["mortgage", "home", "housing"], housing: ["mortgage", "home"],
    debt: ["deficit", "interest"], deficit: ["debt"], inflation: ["prices", "expensive", "cpi"],
    driving: ["robot", "physical"], car: ["robot", "physical"], cars: ["robot", "physical"],
    yen: ["japan"], japan: ["yen"], bank: ["banks", "deposits"], scam: ["deepfake", "fraud"], fake: ["deepfake", "scam"]
  };
  var HINTS = ["try \u201crockets\u201d", "try \u201cinflation\u201d", "try \u201cdeepfakes\u201d", "try \u201cstablecoins\u201d", "try \u201cStarlink\u201d", "try \u201cmortgages\u201d"];
  var STOP = ["the", "and", "are", "why", "what", "how", "does", "for", "with", "who", "can", "this", "that", "your", "you", "about", "into", "from", "is", "a", "an", "of", "to", "in", "on", "so", "do", "my", "me", "it"];
  var $ = function (id) { return document.getElementById(id); };
  var lib = null, query = "", libSlug = "", tSub = "All", tSort = "suggested";
  var cur = null, idx = 0, turning = false;
  var fromShelf = function () { return !!(history.state && history.state.pulseShelf); };
  var reduce = function () { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; };
  var touch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  if (touch) document.documentElement.classList.add("touch");
  /* class-safe topic names: "Frontier Tech" -> t-frontier-tech (the slug comes from shelf.json) */
  function tcls(name) { return "t-" + (TOP[name] ? TOP[name].slug : "none"); }
  function np(b) { return b.pages ? b.pages.length : b.n; } // drawn pages (the light list carries n before the full book loads)
  function titlesOf(b) { return b.pages ? b.pages.map(function (p) { return p.title; }) : (b.pt || []); }
  function booksOf(name) { return lib.books.filter(function (b) { return b.topic === name; }); }
  function mins(b) { return (b.minutes || Math.max(3, Math.round(np(b) * .5))) + " min"; }
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
    var seenK = {};
    return s.map(function (x) { var mv = x && moved(x.id); return mv && mv.to ? { id: mv.to, p: 1, t: x.t } : x; }).filter(function (x) { var k = x && x.id + "/" + x.p; if (!x || !find(x.id) || seenK[k]) return false; seenK[k] = 1; return true; });
  }
  function isSaved(id, p) { return saved().some(function (x) { return x.id === id && x.p === p; }); }
  function setSaved(id, p, on) {
    var s = saved().filter(function (x) { return !(x.id === id && x.p === p); });
    if (on) s.unshift({ id: id, p: p });
    ls(LS.saved, s); savedBadge();
  }
  function savedFor(b) { return saved().filter(function (x) { return x.id === b.id; }).map(function (x) { return x.p; }).sort(function (a, c) { return a - c; }); }
  function pageLabel(b, p) { var t = titlesOf(b); return p === 1 ? "Summary" : t[p - 2] || "page " + (p - 1); }
  function pageNum(b, p) { return p === 1 ? "Summary" : "page " + (p - 1) + " of " + np(b); } // one numbering everywhere: Summary, then page N of M (drawn pages)
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
      var b = find(x.id), li = el("li", "sv-item " + tcls(b.topic));
      var a = el("a", "sv-link"); a.href = "#book/" + b.id + "/" + x.p;
      var pg = x.p >= 2 && b.pages && b.pages[x.p - 2];
      if (pg) { var im = el("img", "sv-thumb"); im.src = pg.thumb || pg.file; im.alt = ""; im.loading = "lazy"; im.width = 56; im.height = Math.round(56 * pg.h / pg.w); a.appendChild(im); }
      else a.appendChild(el("span", "sv-thumb sv-gist", "Sum."));
      var tx = el("span", "sv-text");
      tx.appendChild(el("span", "sv-book", b.title + " · " + pageNum(b, x.p)));
      tx.appendChild(el("span", "sv-page", pageLabel(b, x.p)));
      a.appendChild(tx);
      a.onclick = function (e) { e.preventDefault(); closeSaved(true); history.pushState({ pulseShelf: true }, "", a.getAttribute("href")); route(); };
      li.appendChild(a);
      var rm = el("button", "sv-rm", "Remove"); rm.type = "button"; rm.setAttribute("aria-label", "Remove " + b.title + ", " + pageNum(b, x.p) + " from Saved");
      rm.onclick = function () { setSaved(x.id, x.p, false); renderSaved(); renderLib(); toast("Removed from Saved"); var f = $("saved-list").querySelector(".sv-rm") || $("saved-x"); f.focus(); };
      li.appendChild(rm);
      list.appendChild(li);
    });
  }
  function openSaved() { loadFull().then(renderSaved, function () {}); renderSaved(); $("saved").hidden = false; document.body.classList.add("reading"); onScrollTop(); $("saved-x").focus(); }
  function closeSaved(silent) { $("saved").hidden = true; document.body.classList.remove("reading"); onScrollTop(); if (!silent) $("saved-btn").focus(); }

  function toast(msg, ms) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, ms || 2400); }

  /* ---------- deterministic variety (seeded from the book id, stable across loads) ---------- */
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rnd(s, k) { var x = hash(s + ":" + k); x = Math.imul(x ^ (x >>> 15), 2246822507); x = Math.imul(x ^ (x >>> 13), 3266489909); x ^= x >>> 16; return (x >>> 0) / 4294967296; }
  /* "New": the latest batch only. Books added within 2 days of the newest one, and no more than 10 days ago, at most 6.
     The stamp goes away once you've opened the book (the "New this week" row still lists it). */
  function freshSet() {
    if (lib._fresh) return lib._fresh;
    var B = lib.books.filter(function (b) { return b.added; }), set = {}, n = 0;
    var max = B.reduce(function (m, b) { return b.added > m ? b.added : m; }, "");
    if (max) {
      var md = new Date(max + "T12:00:00");
      B.slice().sort(function (a, c) { return (c.added_at || c.added).localeCompare(a.added_at || a.added); }).forEach(function (b) {
        var d = new Date(b.added + "T12:00:00");
        if (n < 6 && md - d <= 2 * 864e5 && Date.now() - d <= 10.5 * 864e5) { set[b.id] = 1; n++; }
      });
    }
    return (lib._fresh = set);
  }
  function isFresh(b) { return !!freshSet()[b.id] && !opens[b.id]; }
  function stamp(txt, cls) { var s = el("span", "stamp " + (cls || ""), txt); return s; }
  var kbdNav = false;
  addEventListener("keydown", function (e) { if (e.key === "Tab" || e.key === "Enter" || e.key === " " || e.key.indexOf("Arrow") === 0) { kbdNav = true; var c = document.getElementById("rd-close"); if (c) c.classList.remove("nofv"); } }, true);
  addEventListener("pointerdown", function () { kbdNav = false; }, true);
  var vtOK = function () { return typeof document.startViewTransition === "function" && !reduce(); };
  /* ---------- living shelf state ---------- */
  var opens = ls(LS.opens) || {};
  function progress(b) { var p = ls(LS.prog + b.id) || 0; return isDone(b) ? 1 : Math.min(1, p / (np(b) + 1)); }
  function doneMap() { var d = ls(LS.done); return d && typeof d === "object" ? d : {}; }
  function isDone(b) { return !!doneMap()[b.id]; }
  function markDone(b) { var d = doneMap(); if (!d[b.id]) { d[b.id] = new Date().toISOString().slice(0, 10); ls(LS.done, d); } }
  /* ---------- search ----------
     Words are matched on what the books actually say: titles, taglines, blurbs, summaries, page titles, takeaways,
     plus each book's reader words (taxonomy "aka", e.g. "elon", "rocket") and its sub-topic and shelf.
     Typos are fixed ONLY against that real vocabulary, and the fix is shown ("Did you mean rocket?").
     The OCR'd words on the drawn pages count only on an exact (or long-prefix) match, never fuzzily,
     so "rocket" can no longer find "pocket", or "elon" find a misread "clon". */
  function norm(s) { return (s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9 -]+/g, " "); }
  function stem(w) { return w.length > 4 ? w.replace(/(ies)$/, "y").replace(/(ing|ers|ed|es|s)$/, "") : w; }
  function words(s) { return norm(s).split(/[\s-]+/).filter(function (w) { return w.length > 1 && STOP.indexOf(w) < 0; }); }
  function dist(a, b, max) { // optimal-string-alignment distance, gives up above max
    var la = a.length, lb = b.length; if (Math.abs(la - lb) > max) return max + 1;
    var d = [], i, j;
    for (i = 0; i <= la; i++) d[i] = [i];
    for (j = 0; j <= lb; j++) d[0][j] = j;
    for (i = 1; i <= la; i++) {
      var rowMin = Infinity;
      for (j = 1; j <= lb; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        if (d[i][j] < rowMin) rowMin = d[i][j];
      }
      if (rowMin > max) return max + 1;
    }
    return d[la][lb];
  }
  function near(a, b) { if (a === b) return true; var m = Math.min(a.length, b.length); if (m < 4) return false; var max = m >= 7 ? 2 : 1; return dist(a, b, max) <= max; }
  var VOC = null;
  function vocab() {
    if (VOC) return VOC; VOC = {};
    var add = function (s) { words(s).forEach(function (w) { VOC[w] = (VOC[w] || 0) + 1; }); };
    lib.books.forEach(function (b) {
      [b.title, b.tagline, b.blurb, (b.gist || []).join(" "), (b.aka || []).join(" "), (b.tags || []).join(" "), b.sub, b.topic].forEach(add);
      titlesOf(b).forEach(add);
      if (b.pages) b.pages.forEach(function (p) { if (p.takeaway) add(p.takeaway); });
    });
    TOPICS.forEach(function (t) { add(t.name); add(t.short); (t.subs || []).forEach(add); });
    Object.keys(SYN).forEach(function (k) { VOC[k] = VOC[k] || 1; });
    return VOC;
  }
  function fixWord(w) {
    var V = vocab(); if (V[w] || V[stem(w)] || SYN[w] || w.length < 5) return w; // short words are too easy to "fix" into another word (self -> sell)
    var keys = Object.keys(V), i;
    for (i = 0; i < keys.length; i++) if (keys[i].indexOf(w) === 0) return w; // a prefix of a real word: still typing
    var best = null, bd = 9, bf = 0, max = w.length >= 9 ? 2 : 1;
    keys.forEach(function (k) { if (k.length < 4) return; var d = dist(k, w, max); if (d <= max && (d < bd || (d === bd && V[k] > bf))) { best = k; bd = d; bf = V[k]; } });
    return best || w;
  }
  function index(b) {
    if (b._ix) return b._ix;
    var bag = function (s) { var o = {}; words(s).forEach(function (w) { o[w] = 1; o[stem(w)] = 1; }); return Object.keys(o); };
    var P = b.pages || (b.pt || []).map(function (t) { return { title: t }; });
    b._ix = { title: bag(b.title), aka: bag((b.aka || []).join(" ")), phr: (b.aka || []).map(norm),
      tag: bag([b.tagline, b.blurb, b.topic, b.sub, (b.tags || []).join(" ")].join(" ")), gist: bag((b.gist || []).join(" ")),
      pages: P.map(function (p) { return { t: bag(p.title + " " + (p.takeaway || "")), k: bag(p.kw || "") }; }),
      raw: norm([b.title, b.tagline, b.blurb, (b.gist || []).join(" "), (b.aka || []).join(" ")].concat(P.map(function (p) { return p.title + " " + (p.takeaway || ""); })).join(" ")) };
    return b._ix;
  }
  // 1 for an exact match, .8 for a prefix (4+ letters typed); OCR words only exact or a 5+ letter prefix
  function hits(list, t, ocr, exact) { var f = 0; for (var i = 0; i < list.length; i++) { var w = list[i]; if (w === t) return 1; if (!f && !exact && t.length >= (ocr ? 5 : 4) && w.indexOf(t) === 0) f = .8; } return f; } // exact: related words never prefix-match (power != powerful)
  function terms(q) {
    var out = [], fixed = [], any = false;
    words(q).forEach(function (w) {
      var f = fixWord(w); if (f !== w) any = true; fixed.push(f);
      var s = stem(f), g = [{ t: f, w: 1 }]; if (s !== f) g.push({ t: s, w: 1 });
      (SYN[f] || SYN[s] || []).forEach(function (x) { words(x).forEach(function (y) { if (y !== f && y !== s) g.push({ t: y, w: .6, syn: true }); }); });
      out.push(g);
    });
    return { groups: out, fixed: any ? fixed.join(" ") : null };
  }
  function scoreGroup(ix, g) {
    var best = 0, real = 0, pageS = ix.pages.map(function () { return 0; });
    g.forEach(function (x) {
      var e = !!x.syn, s = Math.max(8 * hits(ix.title, x.t, 0, e), 7 * hits(ix.aka, x.t, 0, e), 5 * hits(ix.tag, x.t, 0, e), 4 * hits(ix.gist, x.t, 0, e));
      ix.pages.forEach(function (p, i) { var ps = Math.max(4 * hits(p.t, x.t, 0, e), 1.5 * hits(p.k, x.t, true, e)); if (ps) { pageS[i] += ps * x.w; s = Math.max(s, ps); } });
      s *= x.w; if (s > best) best = s; if (s && !x.syn) real = Math.max(real, s);
    });
    return { s: best, real: real, pages: pageS };
  }
  /* returns {res:[{b, s, p, real}], fixed, related}: related = nothing matched the words themselves, only related words */
  function search(q) {
    var T = terms(q), G = T.groups; if (!G.length) return { res: [], fixed: null };
    var qn = norm(T.fixed || q).trim();
    var res = lib.books.map(function (b) {
      var ix = index(b), s = 0, real = 0, matched = 0, pages = ix.pages.map(function () { return 0; });
      G.forEach(function (g) { var r = scoreGroup(ix, g); if (r.s) { matched++; s += r.s; real += r.real; r.pages.forEach(function (v, i) { pages[i] += v; }); } });
      if (G.length > 1 && matched < Math.ceil(G.length * .6)) s = 0; // most words should match
      if (s && qn.indexOf(" ") > 0 && ix.phr.some(function (p) { return p === qn || p.indexOf(qn) >= 0; })) { s += 10; real += 10; } // a reader phrase like "elon musk" or "ai at school"
      if (s && G.length > 1 && ix.raw.indexOf(qn) >= 0) s += 8;
      var p = -1, bp = 2.9; pages.forEach(function (v, i) { if (v > bp) { bp = v; p = i; } });
      return { b: b, s: s, p: p, real: real };
    }).filter(function (r) { return r.s > 0; }).sort(function (a, c) { return c.real - a.real || c.s - a.s || lib.books.indexOf(a.b) - lib.books.indexOf(c.b); });
    if (!res.length) return { res: res, fixed: T.fixed };
    var related = !res.some(function (r) { return r.real > 0; }), top = res[0].s;
    if (!related) res = res.filter(function (r) { return r.real > 0 || r.s >= top * .5; });
    return { res: res.filter(function (r) { return r.s >= top * (related ? .5 : .3); }), fixed: T.fixed, related: related };
  }
  function why(b, page, q) {
    var ix = index(b), g = terms(q).groups, out = null;
    g.forEach(function (grp) { grp.forEach(function (x) {
      if (out) return;
      var pre = x.syn ? "related word \u201c" : "\u201c";
      if (hits(ix.title, x.t)) out = x.syn ? pre + x.t + "\u201d is in the title" : "it\u2019s in the title";
      else if (hits(ix.aka, x.t) || hits(ix.tag, x.t)) out = x.syn ? "it\u2019s about " + x.t : "it\u2019s what the book is about";
      else if (page >= 0 && hits(ix.pages[page].t, x.t)) out = "a page title says " + pre + x.t + "\u201d";
      else if (page >= 0 && hits(ix.pages[page].k, x.t, true)) out = "the page mentions " + pre + x.t + "\u201d";
      else if (hits(ix.gist, x.t)) out = "the summary mentions " + pre + x.t + "\u201d";
    }); });
    return out || "closest match";
  }
  /* ---------- covers and spines ---------- */
  function tagline(b) { return b.tagline || b.blurb; }
  function decorate(a, b) {
    a.href = "#book/" + b.id + "/1"; a.dataset.topic = b.topic; a.dataset.id = b.id;
    a.removeAttribute("aria-label"); var sr = a.querySelector(".sr-desc") || el("span", "sr-only sr-desc");
    sr.textContent = " \u2014 " + tagline(b) + ". " + b.topic + ". " + np(b) + " pages, about " + mins(b) + ". " + readText(b) + (isFresh(b) ? ". New." : ""); a.appendChild(sr);
    if ((opens[b.id] || 0) >= 3) a.classList.add("is-lean");
    a.addEventListener("click", pullOut);
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
    loadFull().catch(function () {});
    if (reduce()) return go();
    var bt = window.PulseSig && a.dataset.topic ? PulseSig.burst(a.querySelector(".sp-body,.cv") || a, a.dataset.topic) : 0; // the shelf's quick flourish
    a.classList.add("pulling"); setTimeout(function () { a.classList.remove("pulling"); go(); }, bt ? 200 : vtOK() ? 110 : 160);
  }
  function bar(b, cls) { var pr = progress(b), w = el("span", cls); w.setAttribute("aria-hidden", "true"); var f = el("i"); f.style.width = Math.round(pr * 100) + "%"; w.appendChild(f); if (!pr || isDone(b)) w.hidden = true; return w; }
  /* a cover: the shelf's cloth (each shelf has its own weave, so colour is never the only cue), the book's own first page as art,
     the reading time, and its state: New, read, or a progress bar */
  function coverArt(b, opt) {
    opt = opt || {};
    var c = el("span", "cv cloth " + tcls(b.topic) + (opt.small ? " cv-sm" : ""));
    c.setAttribute("aria-hidden", "true");
    var top = el("span", "cv-top"), tk = el("span", "cv-topic", TOP[b.topic].short); if (opt.step) tk.insertBefore(el("span", "cv-step", String(opt.step)), tk.firstChild); top.appendChild(tk); top.appendChild(el("span", "cv-title", b.title)); c.appendChild(top);
    var art = el("span", "cv-art"); var im = el("img"); im.src = b.thumb; im.alt = ""; im.width = b.tw; im.height = b.th; im.loading = opt.eager ? "eager" : "lazy"; if (opt.eager) im.setAttribute("fetchpriority", "high"); im.decoding = "async"; art.appendChild(im);
    art.appendChild(el("span", "cv-min", mins(b))); c.appendChild(art);
    if (!opt.small) c.appendChild(el("span", "cv-tag", tagline(b)));
    if (isDone(b)) c.appendChild(el("span", "cv-state is-read", "\u2713 Read"));
    else if (isFresh(b)) c.appendChild(el("span", "cv-state is-new", "New"));
    c.appendChild(bar(b, "cv-prog"));
    return c;
  }
  function cover(b, opt) {
    var a = el("a", "bk " + tcls(b.topic)); decorate(a, b);
    a.appendChild(coverArt(b, opt));
    a.appendChild(a.querySelector(".sr-desc"));
    return a;
  }
  /* pencil ticks: one slanted tick per page, filled for pages already reached */
  function readOf(b) { var total = np(b) + 1; return Math.min(total, Math.round(progress(b) * total)); }
  function readText(b) { if (isDone(b)) return "Finished"; var n = readOf(b), t = np(b), d = Math.min(t, Math.max(0, n - 1)); return d ? "Read to page " + d + " of " + t : n ? "Read the summary" : "Not started"; }
  function ticks(b, cls) {
    var total = np(b) + 1, reached = readOf(b), w = el("span", cls);
    w.setAttribute("aria-hidden", "true");
    if (total > 8) { w.classList.add("bar"); var f = el("b", "pb-fill"); f.style.width = Math.round(reached / total * 100) + "%"; w.appendChild(f); }
    else for (var i = 0; i < total; i++) w.appendChild(el("i", i < reached ? "on" : ""));
    if (!reached || isDone(b)) w.hidden = true;
    return w;
  }
  function spine(b) {
    var a = el("a", "sp " + tcls(b.topic)); decorate(a, b);
    a.style.setProperty("--h", (200 + Math.min(np(b), 6) * 14) + "px");
    a.style.setProperty("--hv", (0.95 + rnd(b.id, "h") * 0.10).toFixed(3));
    var L = b.title.length; a.style.setProperty("--swb", ((L > 22 ? 1.16 : L > 13 ? 1.04 : .94) * (0.97 + rnd(b.id, "w") * 0.06)).toFixed(3));
    var body = el("span", "sp-body cloth");
    body.appendChild(el("span", "sp-topic", TOP[b.topic].short));
    body.appendChild(el("span", "sp-title", b.title));
    body.appendChild(el("span", "sp-vol", mins(b)));
    body.appendChild(ticks(b, "sp-prog"));
    if (savedFor(b).length) { var mk = el("span", "sp-mark"); mk.setAttribute("aria-hidden", "true"); body.appendChild(mk); }
    if (isDone(b)) body.appendChild(el("span", "sp-ck", "\u2713"));
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
    card.appendChild(el("span", "tp-meta", TOP[b.topic].name + " · " + np(b) + " pages · " + mins(b)));
    card.appendChild(el("span", "tp-tag", tagline(b)));
    card.appendChild(el("span", "tp-read", readText(b)));
    var bm = savedFor(b); if (bm.length) card.appendChild(el("span", "bk-bm", "Saved · p." + bm.join(", ")));
    tipEl.appendChild(card); tipEl.appendChild(el("i", "tp-notch"));
    tipEl.className = "sp-tip " + tcls(b.topic);
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
    All: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    AI: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    Fintech: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 14.5h4"/>',
    Macro: '<path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/>',
    "Frontier Tech": '<path d="M14.5 4.5c3-1 5-1 5-1s0 2-1 5l-6.5 6.5-4-4z"/><path d="M8 11l-3 .5-2 2.5 4 .5M13 16l-.5 3-2.5 2-.5-4M15.5 8.5h.01"/><path d="M5 19c.5-1.5 1.5-2.5 3-3" stroke-dasharray="1.5 2"/>'
  };
  function ico(k, cls) { return '<svg class="' + (cls || "ci") + '" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICO[k] || ICO.All) + '</svg>'; }
  /* page dots: each has a 44x44 hit area (::after) that overlaps its neighbours on long books, so a tap goes to the dot nearest the finger */
  function nearestDot(e, i) {
    if (!e || !e.detail || e.clientX == null) return i; // keyboard activation: the focused dot
    var best = i, bd = Infinity;
    [].forEach.call(document.querySelectorAll("#rd-dots .dot"), function (d) { var r = d.getBoundingClientRect(), dx = Math.abs(r.left + r.width / 2 - e.clientX); if (dx < bd) { bd = dx; best = +d.dataset.i; } });
    return best;
  }
  /* ---------- the library: sticky search + chips, home rows, one page per shelf ---------- */
  function go2(hash) { // move between library views (home, a shelf) as real history entries
    if (location.hash === hash || (!hash && !location.hash)) { route(); return; }
    history.pushState(null, "", hash || location.pathname + location.search); route();
  }
  function renderTabs() {
    var t = $("lib-tabs"); t.innerHTML = "";
    var g = el("div", "topictabs"); g.setAttribute("role", "group"); g.setAttribute("aria-label", "Shelves");
    [{ name: "All", short: "All", slug: "" }].concat(TOPICS).forEach(function (k) {
      var n = k.slug ? booksOf(k.name).length : lib.books.length; if (!n) return;
      var btn = el("button", "chip" + (k.slug ? " c-" + k.slug : ""));
      btn.innerHTML = ico(k.name) + '<span class="ck">' + k.short + '</span>';
      btn.type = "button"; btn.setAttribute("aria-pressed", String(libSlug === k.slug)); btn.dataset.topic = k.name;
      btn.setAttribute("aria-label", k.slug ? k.name + " shelf, " + n + " books" : "All shelves, " + n + " books");
      btn.onclick = function () { if (query) clearQuery(); closeSearch(); go2(k.slug ? "#shelf/" + k.slug : ""); };
      g.appendChild(btn);
    });
    t.appendChild(g);
  }
  function heroMeta() {
    var B = lib.books, sh = TOPICS.filter(function (t) { return booksOf(t.name).length; }).length;
    var mm = B.map(function (b) { return b.minutes || 5; }).sort(function (a, c) { return a - c; }), med = mm[Math.floor(mm.length / 2)] || 5;
    $("lib-stats").innerHTML = "<b>" + B.length + "</b> books<i>\u00b7</i><b>" + sh + "</b> shelves<i>\u00b7</i>about <b>" + med + "</b> min each";
    $("ask-input").placeholder = "Search " + B.length + " books\u2026 " + HINTS[0];
  }
  var introDone = false;
  function renderLib() {
    var host = $("shelves"); host.innerHTML = "";
    renderTabs();
    var t = libSlug && TOPICS.filter(function (x) { return x.slug === libSlug; })[0];
    $("lib-hero").hidden = !!t;
    document.title = t ? t.name + " \u2014 Pulse \u2014 ProductSnap Studio" : "Pulse \u2014 ProductSnap Studio";
    host.classList.remove("intro");
    if (!introDone && !reduce()) { introDone = true; host.classList.add("intro"); setTimeout(function () { host.classList.remove("intro"); }, 1500); }
    if (t) renderTopic(host, t); else renderHome(host);
    wireRows(host);
    if (query || document.body.classList.contains("searching")) renderResults();
  }
  function renderHome(host) {
    var c = continueCard(); if (c) host.appendChild(c);
    var p = pathRow(); if (p) host.appendChild(p);
    var n = newRow(); if (n) host.appendChild(n);
    host.appendChild(el("h2", "lib-h", "The shelves"));
    TOPICS.forEach(function (t) { var bs = booksOf(t.name); if (bs.length) host.appendChild(shelfRow(t, bs)); });
  }
  function rowHead(h, sub, extra) {
    var hd = el("header", "rw-head"), tx = el("div"); tx.appendChild(h); if (sub) tx.appendChild(el("p", "rw-sub", sub)); hd.appendChild(tx);
    if (extra) hd.appendChild(extra); return hd;
  }
  /* a sideways row: the next item always peeks in, snaps on swipe, and has arrow buttons (mouse) + arrow keys (keyboard) */
  function swipeRow(label, items, cls) {
    var r = el("div", "row " + (cls || "")); r.setAttribute("role", "group"); r.setAttribute("aria-label", label);
    var pv = el("button", "row-btn row-prev"), nx = el("button", "row-btn row-next");
    pv.type = nx.type = "button"; pv.setAttribute("aria-label", "Scroll " + label + " back"); nx.setAttribute("aria-label", "Scroll " + label + " forward");
    pv.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
    nx.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
    pv.tabIndex = nx.tabIndex = -1; // keyboard users move with the arrow keys inside the row; the buttons are for mice
    var sc = el("div", "row-scroll"); items.forEach(function (x) { sc.appendChild(x); });
    r.appendChild(pv); r.appendChild(sc); r.appendChild(nx);
    return r;
  }
  function wireRows(host) {
    [].forEach.call(host.querySelectorAll(".row"), function (r) {
      var sc = r.querySelector(".row-scroll"), pv = r.querySelector(".row-prev"), nx = r.querySelector(".row-next");
      var upd = function () { var max = sc.scrollWidth - sc.clientWidth; r.classList.toggle("can-l", sc.scrollLeft > 4); r.classList.toggle("can-r", sc.scrollLeft < max - 4); };
      sc.addEventListener("scroll", function () { requestAnimationFrame(upd); }, { passive: true }); upd(); setTimeout(upd, 300);
      if (window.ResizeObserver) { var ro = new ResizeObserver(function () { requestAnimationFrame(upd); }); ro.observe(sc); if (sc.firstElementChild) ro.observe(sc.firstElementChild); }
      addEventListener("load", upd);
      var by = function (d) { sc.scrollBy({ left: d * Math.max(160, sc.clientWidth * .8), behavior: reduce() ? "auto" : "smooth" }); };
      pv.onclick = function () { by(-1); }; nx.onclick = function () { by(1); };
      sc.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
        var L = [].slice.call(sc.querySelectorAll("a")), i = L.indexOf(document.activeElement); if (i < 0) return;
        var j = e.key === "ArrowRight" ? Math.min(L.length - 1, i + 1) : e.key === "ArrowLeft" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : L.length - 1;
        e.preventDefault(); e.stopPropagation(); L[j].focus({ preventScroll: true }); L[j].scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduce() ? "auto" : "smooth" });
      });
    });
  }
  var ROW_MAX = 10;
  function shelfRow(t, bs) {
    var s = el("section", "shelf " + tcls(t.name)); s.setAttribute("aria-labelledby", "sh-" + t.slug);
    var h = el("h2", "sh-name"); h.id = "sh-" + t.slug; h.innerHTML = '<span class="sh-ico">' + ico(t.name) + "</span>"; h.appendChild(document.createTextNode(t.name));
    var read = bs.filter(isDone).length;
    var all = el("a", "sh-all"); all.href = "#shelf/" + t.slug; all.innerHTML = "See all " + bs.length + '<span class="sr-only"> ' + t.name + " books</span> \u2192";
    all.onclick = function (e) { e.preventDefault(); go2("#shelf/" + t.slug); };
    s.appendChild(rowHead(h, t.desc + (read ? " \u00b7 \u2713 " + read + " of " + bs.length + " read" : ""), all));
    var items = bs.slice(0, ROW_MAX).map(spine);
    if (bs.length > ROW_MAX) { var more = el("a", "row-more"); more.href = "#shelf/" + t.slug; more.innerHTML = "<b>+" + (bs.length - ROW_MAX) + " more</b><span>See all \u2192</span>"; more.onclick = all.onclick; items.push(more); }
    s.appendChild(swipeRow(t.name + " shelf", items, "spines"));
    s.appendChild(el("div", "plank"));
    return s;
  }
  function pathRow() {
    var P = (lib.path || []).map(find).filter(Boolean); if (P.length < 2) return null;
    var s = el("section", "path-sec"); s.setAttribute("aria-labelledby", "path-h");
    var h = el("h2", "rw-h", "New to Pulse? Start here"); h.id = "path-h";
    s.appendChild(rowHead(h, "One easy book from each shelf, in this order."));
    s.appendChild(swipeRow("Start here", P.map(function (b, i) { return cover(b, { step: i + 1, eager: i < 3 }); }), "covers path"));
    return s;
  }
  function newRow() {
    var F = freshSet(), B = lib.books.filter(function (b) { return F[b.id]; }); if (!B.length) return null;
    var s = el("section", "new-sec"); s.setAttribute("aria-labelledby", "new-h");
    var h = el("h2", "rw-h", "New this week"); h.id = "new-h";
    var un = B.filter(function (b) { return !opens[b.id]; }).length; if (un) { h.appendChild(document.createTextNode(" ")); h.appendChild(el("span", "nw", un + " new")); }
    var opened = TOPICS.filter(function (t) { var bs = booksOf(t.name); return bs.length && bs.every(function (b) { return F[b.id]; }); }).map(function (t) { return t.name; });
    s.appendChild(rowHead(h, opened.length ? "Fresh off the press: the " + opened.join(" and ") + " shelf opens." : "Fresh off the press."));
    s.appendChild(swipeRow("New this week", B.map(function (b) { return cover(b); }), "covers"));
    return s;
  }
  function continueCard() {
    var L = ls(LS.last); if (!L || !find(L.id) || ls(LS.lastX) === L.id + "/" + L.p) return null;
    var b = find(L.id); if (isDone(b) || L.p > np(b) + 1) return null;
    var w = el("div", "cont " + tcls(b.topic)); w.setAttribute("role", "group"); w.setAttribute("aria-label", "Continue reading");
    var a = el("a", "cont-a"); a.href = "#book/" + b.id + "/" + L.p;
    a.onclick = function (e) { e.preventDefault(); loadFull().then(function () { history.pushState({ pulseShelf: true }, "", a.getAttribute("href")); route(); }, function () {}); };
    a.appendChild(el("span", "cont-k", "Pick up where you left off"));
    a.appendChild(el("span", "cont-t", b.title));
    a.appendChild(el("span", "cont-p", (L.p === 1 ? "Summary" : "page " + (L.p - 1) + " of " + np(b))));
    var br = el("span", "cont-bar"); br.setAttribute("aria-hidden", "true"); var f = el("i"); f.style.width = Math.round(L.p / (np(b) + 1) * 100) + "%"; br.appendChild(f); a.appendChild(br);
    a.appendChild(el("span", "cont-go", "Resume \u2192"));
    var x = el("button", "rd-btn rd-ico cont-x"); x.type = "button"; x.setAttribute("aria-label", "Dismiss continue reading");
    x.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.onclick = function () { ls(LS.lastX, L.id + "/" + L.p); w.remove(); var f2 = document.querySelector("#shelves a"); if (f2) f2.focus(); };
    w.appendChild(a); w.appendChild(x); return w;
  }
  /* one shelf: header, sub-topic chips (shelves of 8+ books, sub-topics of 3+), order, and a hide-read switch */
  function renderTopic(host, t) {
    var all = booksOf(t.name), read = all.filter(isDone).length, total = all.reduce(function (s, b) { return s + (b.minutes || 5); }, 0);
    var hero = el("section", "tp-hero " + tcls(t.name));
    var back = el("a", "tp-back", "\u2190 All shelves"); back.href = location.pathname + location.search; back.onclick = function (e) { e.preventDefault(); go2(""); };
    hero.appendChild(back);
    var h = el("h1", "tp-name"); h.innerHTML = '<span class="tp-ico">' + ico(t.name) + "</span>"; h.appendChild(document.createTextNode(t.name)); hero.appendChild(h);
    hero.appendChild(el("p", "tp-desc", t.desc));
    hero.appendChild(el("p", "tp-stats", all.length + " books \u00b7 about " + total + " min in all \u00b7 " + (read ? "\u2713 " + read + " read" : "none read yet")));
    var pb = el("div", "tp-prog"); pb.setAttribute("role", "progressbar"); pb.setAttribute("aria-label", t.name + " shelf read"); pb.setAttribute("aria-valuemin", "0"); pb.setAttribute("aria-valuemax", String(all.length)); pb.setAttribute("aria-valuenow", String(read));
    var pf = el("i"); pf.style.width = Math.round(read / all.length * 100) + "%"; pb.appendChild(pf); hero.appendChild(pb);
    host.appendChild(hero);
    var ctl = el("div", "tp-ctl");
    var subs = all.length >= 8 ? (t.subs || []).filter(function (s) { return all.filter(function (b) { return b.sub === s; }).length >= 3; }) : [];
    if (subs.indexOf(tSub) < 0) tSub = "All";
    if (subs.length >= 2) {
      var sc = el("div", "subchips"); sc.setAttribute("role", "group"); sc.setAttribute("aria-label", t.name + " sub-topics");
      ["All"].concat(subs).forEach(function (s) {
        var n = s === "All" ? all.length : all.filter(function (b) { return b.sub === s; }).length;
        var c = el("button", "chip sub", s); c.appendChild(el("span", "cn", " " + n)); c.type = "button"; c.setAttribute("aria-pressed", String(tSub === s));
        c.onclick = function () { tSub = s; renderLib(); var f = document.querySelector('.subchips [aria-pressed="true"]'); if (f) f.focus(); };
        sc.appendChild(c);
      });
      ctl.appendChild(sc);
    }
    var row = el("div", "tp-row2");
    var seg = el("div", "seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Order");
    [["suggested", "Suggested"], ["newest", "Newest"], ["shortest", "Shortest"]].forEach(function (o) {
      var b = el("button", "seg-b", o[1]); b.type = "button"; b.setAttribute("aria-pressed", String(tSort === o[0]));
      b.onclick = function () { tSort = o[0]; renderLib(); var f = document.querySelector('.seg [aria-pressed="true"]'); if (f) f.focus(); };
      seg.appendChild(b);
    });
    row.appendChild(seg);
    var hide = !!ls(LS.hideRead), sw = el("button", "switch"); sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", String(hide));
    sw.innerHTML = '<span class="sw-t">Hide read</span><span class="sw-k" aria-hidden="true"><i></i></span>';
    sw.disabled = !read && !hide;
    sw.onclick = function () { ls(LS.hideRead, !hide); renderLib(); var f = document.querySelector(".tp-ctl .switch"); if (f) f.focus(); };
    row.appendChild(sw); ctl.appendChild(row); host.appendChild(ctl);
    var list = all.filter(function (b) { return tSub === "All" || b.sub === tSub; });
    var hidden = hide ? list.filter(isDone).length : 0; if (hide) list = list.filter(function (b) { return !isDone(b); });
    var order = lib.books;
    if (tSort === "newest") list.sort(function (a, c) { return (c.added_at || c.added || "").localeCompare(a.added_at || a.added || "") || order.indexOf(a) - order.indexOf(c); });
    else if (tSort === "shortest") list.sort(function (a, c) { return (a.minutes || 5) - (c.minutes || 5) || order.indexOf(a) - order.indexOf(c); });
    else list.sort(function (a, c) { return (lib.path.indexOf(c.id) >= 0) - (lib.path.indexOf(a.id) >= 0) || order.indexOf(a) - order.indexOf(c); }); // the Start-here book first, then the shelf's own order
    var grid = el("div", "tp-grid"); grid.setAttribute("aria-label", t.name + " books");
    list.forEach(function (b, i) { grid.appendChild(cover(b, { eager: i < 4 })); });
    host.appendChild(grid);
    if (!list.length) {
      var em = el("div", "lib-empty"); em.appendChild(el("p", "em-h", "You\u2019ve read every book here"));
      em.appendChild(el("p", "em-p", hidden + " finished " + (hidden === 1 ? "book is" : "books are") + " hidden. New ones land every week."));
      var sb = el("button", "g-go em-btn", "Show read books"); sb.type = "button"; sb.onclick = function () { ls(LS.hideRead, false); renderLib(); }; em.appendChild(sb);
      host.appendChild(em);
    } else if (hidden) host.appendChild(el("p", "tp-note", hidden + " read " + (hidden === 1 ? "book" : "books") + " hidden."));
  }

  /* ---------- search results: a sheet right under the sticky bar, sized to stay above the phone keyboard ---------- */
  var SHOW = 8, showAll = false;
  function chipBtn(txt, cls, fn) { var b = el("button", cls, txt); b.type = "button"; b.onclick = fn; return b; }
  function setQuery(v) { $("ask-input").value = v; query = v; showAll = false; syncClear(); renderResults(); }
  function suggestions(R, lead) {
    if (lead) R.appendChild(el("p", "s-k", lead));
    var kw = el("div", "kw"); (lib.popular || []).forEach(function (w) { kw.appendChild(chipBtn(w, "kw-b", function () { setQuery(w); })); }); R.appendChild(kw);
    if ((lib.questions || []).length) {
      R.appendChild(el("p", "s-k", "Questions people ask"));
      var qs = el("div", "kw q"); lib.questions.forEach(function (w) { qs.appendChild(chipBtn(w, "kw-b", function () { setQuery(w); })); }); R.appendChild(qs);
    }
  }
  function openBook(href) { return function (e) { e.preventDefault(); loadFull().then(function () { history.pushState({ pulseShelf: true }, "", href); route(); }, function () { toast("The book didn\u2019t load. Check your connection."); }); }; }
  function renderResults() {
    var R = $("lib-results"), H = $("ask-hint"); R.innerHTML = ""; H.innerHTML = ""; R.hidden = false;
    if (!query.trim()) { suggestions(R, "Popular searches"); fitResults(); return; }
    var r = search(query), res = r.res, q = r.fixed || query.trim();
    if (r.fixed) { // "Did you mean": only ever a word the books actually use
      H.appendChild(document.createTextNode("Did you mean "));
      H.appendChild(chipBtn(r.fixed, "linkbtn", function () { setQuery(r.fixed); }));
      H.appendChild(document.createTextNode("? Showing results for \u201c" + r.fixed + "\u201d. "));
    }
    if (!res.length) {
      H.appendChild(document.createTextNode("No books match \u201c" + query.trim() + "\u201d."));
      var em = el("div", "nores"); em.appendChild(el("p", "em-h", "Nothing on the shelves for that yet"));
      em.appendChild(el("p", "em-p", "Search reads titles, summaries and the words on every page. A shorter or more everyday word often works."));
      R.appendChild(em); suggestions(R, "Try one of these"); fitResults(); return;
    }
    var n = res.length, shown = showAll ? res : res.slice(0, SHOW);
    if (r.related) H.appendChild(document.createTextNode("No book mentions \u201c" + q + "\u201d yet. Related books: "));
    H.appendChild(document.createTextNode(n > shown.length ? "Showing " + shown.length + " of " + n + " books. " : n + (n === 1 ? " book." : " books.")));
    if (n > shown.length) { H.appendChild(document.createTextNode(" ")); H.appendChild(chipBtn("Show all " + n, "linkbtn", function () { showAll = true; renderResults(); })); }
    var top = shown[0];
    if (!r.related && top.p >= 0) { // the best single page, one tap away
      var tp = titlesOf(top.b)[top.p], best = el("a", "best " + tcls(top.b.topic)), href = "#book/" + top.b.id + "/" + (top.p + 2);
      best.href = href; best.onclick = openBook(href);
      var bi = el("img", "best-thumb"); bi.src = top.b.thumb; bi.alt = ""; bi.width = 52; bi.height = Math.round(52 * top.b.th / top.b.tw); best.appendChild(bi);
      var bt = el("span", "best-text"); bt.appendChild(el("span", "best-k", "Best page"));
      bt.appendChild(el("span", "best-t", top.b.title + " \u00b7 page " + (top.p + 1) + ": " + tp));
      bt.appendChild(el("span", "best-why", "Why: " + why(top.b, top.p, q))); best.appendChild(bt); best.appendChild(el("span", "best-go", "Open \u2192"));
      R.appendChild(best);
    }
    var ul = el("ul", "res-list"); ul.setAttribute("aria-label", "Books matching " + q);
    shown.forEach(function (x) {
      var li = el("li"), a = el("a", "res " + tcls(x.b.topic)), href = "#book/" + x.b.id + "/" + (x.p >= 0 ? x.p + 2 : 1); a.href = href; a.onclick = openBook(href);
      var im = el("img", "res-thumb"); im.src = x.b.thumb; im.alt = ""; im.loading = "lazy"; im.width = 48; im.height = Math.round(48 * x.b.th / x.b.tw); a.appendChild(im);
      var tx = el("span", "res-tx"); tx.appendChild(el("span", "res-t", x.b.title));
      tx.appendChild(el("span", "res-m", TOP[x.b.topic].name + " \u00b7 " + mins(x.b) + (isDone(x.b) ? " \u00b7 \u2713 read" : "")));
      tx.appendChild(el("span", "res-why", x.p >= 0 ? "Opens at page " + (x.p + 1) + ": " + titlesOf(x.b)[x.p] : "Why: " + why(x.b, x.p, q)));
      a.appendChild(tx); li.appendChild(a); ul.appendChild(li);
    });
    R.appendChild(ul);
    if (!lib._full) { R.appendChild(el("p", "s-note", "Searching titles and summaries\u2026 the words on every page are still loading.")); loadFull().then(function () { if (query) renderResults(); }, function () {}); }
    fitResults();
  }
  /* keep the results above the on-screen keyboard: the sheet never runs under it, it scrolls inside instead */
  function fitResults() {
    var R = $("lib-results"), vv = window.visualViewport; if (!R || R.hidden) return;
    var kbd = vv && vv.height < innerHeight * .8;
    if (!kbd) { R.style.maxHeight = ""; R.classList.remove("in-kbd"); return; }
    var top = R.getBoundingClientRect().top; R.style.maxHeight = Math.max(160, vv.height + vv.offsetTop - top - 8) + "px"; R.classList.add("in-kbd");
  }
  function syncClear() { $("ask-clear").hidden = !$("ask-input").value; }
  function openSearch() {
    if (document.body.classList.contains("searching")) return;
    document.body.classList.add("searching"); renderResults();
    // phones: bring the bar to the top of the screen so the results have the room above the keyboard
    if (touch) requestAnimationFrame(function () { var nv = document.querySelector("header.topnav-wrap"), y = $("bar-anchor").getBoundingClientRect().top + (window.pageYOffset || 0) - (nv ? nv.offsetHeight : 0); if (Math.abs((window.pageYOffset || 0) - y) > 2) window.scrollTo({ top: y, behavior: "instant" }); fitResults(); });
  }
  function closeSearch() { document.body.classList.remove("searching"); $("lib-results").hidden = true; $("lib-results").innerHTML = ""; $("ask-hint").textContent = ""; }
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
  function clearQuery() { query = ""; showAll = false; $("ask-input").value = ""; $("ask-hint").textContent = ""; syncClear(); }
  function ask(q) { query = q.trim(); showAll = false; openSearch(); renderResults(); }
  function rotateHints() {
    var i = 0, inp = $("ask-input");
    setInterval(function () { if (document.activeElement === inp || inp.value || document.hidden) return; i = (i + 1) % HINTS.length; inp.placeholder = "Search " + lib.books.length + " books\u2026 " + HINTS[i]; }, 3200);
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
  /* retired books: old links and saved pages land on the book that replaced them (library.json "moved") */
  function moved(id) { return lib && lib.moved && lib.moved[id]; }
  function find(id) { return lib.books.filter(function (b) { return b.id === id; })[0]; }
  /* a source with no title shows a clean site name ("sec.gov"), never the raw URL */
  function srcHost(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "Source"; } }
  /* shelves after this one in shelf order (Frontier Tech, AI, Fintech, Macro), wrapping round */
  function shelvesAfter(topic) { var N = TOPICS.map(function (t) { return t.name; }), i = N.indexOf(topic); return i < 0 ? N : N.slice(i + 1).concat(N.slice(0, i)); }
  /* "Up next": the next unread book on the same shelf (in the shelf's order), else the first unread one on the NEXT shelf in order, and so on */
  function nextBook(b) {
    var unread = function (x) { return x !== b && !isDone(x); };
    var same = booksOf(b.topic), i = same.indexOf(b);
    var n = same.slice(i + 1).concat(same.slice(0, i)).filter(unread)[0]; if (n) return n;
    var doors = shelvesAfter(b.topic);
    for (var k = 0; k < doors.length; k++) { n = booksOf(doors[k]).filter(unread)[0]; if (n) return n; }
    return null;
  }
  /* "Pairs with": 2-3 related books by shared topic + rare shared words (document-frequency weighted) */
  function rawWords(b) {
    if (b._rw) return b._rw; var o = {};
    index(b).raw.split(/[\s-]+/).forEach(function (w) { if (w.length > 3 && STOP.indexOf(w) < 0) o[w] = 1; });
    return (b._rw = o);
  }
  /* "next door" for Pairs with = the shelves either side in shelf order (wrapping) */
  function nextDoor(topic) { var N = TOPICS.map(function (t) { return t.name; }), i = N.indexOf(topic); return i < 0 ? [] : [N[(i + 1) % N.length], N[(i + N.length - 1) % N.length]]; }
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
    var door = nextDoor(b.topic);
    var cross = all.filter(function (r) { return !r.same && door.indexOf(r.b.topic) >= 0; }).sort(by);
    return same.concat(cross.slice(0, Math.max(0, 3 - same.length)));
  }
  function pairsNode(b, skip) {
    var rel = related(b, skip); if (rel.length < 2) return null;
    var w = el("div", "pairs"); w.appendChild(el("p", "pairs-k", "Pairs with"));
    var ul = el("ul", "pairs-list");
    rel.forEach(function (r) {
      var li = el("li"), a = el("a", "nbr cloth " + tcls(r.b.topic)); a.href = "#book/" + r.b.id + "/1";
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
    var st = el("span", "end-stamp", "Finished!"); st.setAttribute("aria-hidden", "true"); d.appendChild(st);
    var k = el("p", "g-kicker", "You finished "); k.appendChild(el("b", null, b.title)); d.appendChild(k);
    if (b.recap && b.recap.length) { // whole-book recap, written for the current page count (scripts/check_library.py enforces it)
      var rc = el("div", "recap"); rc.appendChild(el("p", "rc-k", "In short"));
      var rl = el("ul", "rc-list"); b.recap.forEach(function (x) { rl.appendChild(el("li", null, x)); }); rc.appendChild(rl); d.appendChild(rc);
    }
    var sh = booksOf(b.topic), rd = sh.filter(isDone).length, sp = el("div", "end-prog");
    sp.appendChild(el("span", "ep-t", TOP[b.topic].name + " shelf: " + rd + " of " + sh.length + " read"));
    var eb = el("span", "ep-bar"); eb.setAttribute("aria-hidden", "true"); var ef = el("i"); ef.style.width = Math.round(rd / sh.length * 100) + "%"; eb.appendChild(ef); sp.appendChild(eb);
    d.appendChild(sp);
    var nx = el("div", "end-next"), col = el("div", "end-col");
    if (n) {
      var a = el("a", "end-cover"); a.href = "#book/" + n.id + "/1"; a.setAttribute("aria-label", "Open next book: " + n.title + " \u2014 " + tagline(n));
      a.appendChild(coverArt(n, { small: true, eager: true })); nx.appendChild(a);
      col.appendChild(el("p", "end-label", n.topic === b.topic ? "Up next on this shelf" : "Next shelf: " + n.topic));
      col.appendChild(el("p", "end-nt", n.title));
      col.appendChild(el("p", "end-why", tagline(n) + " \u00b7 " + mins(n)));
    } else {
      col.appendChild(el("p", "end-label", "You\u2019ve read every book"));
      col.appendChild(el("p", "end-nt", "The whole library, done."));
      col.appendChild(el("p", "end-why", "New books land every week."));
    }
    var row = el("div", "end-actions");
    if (n) { var open1 = el("a", "g-go", "Open book \u2192"); open1.href = "#book/" + n.id + "/1"; open1.setAttribute("aria-label", "Open " + n.title); row.appendChild(open1); }
    var back = el("button", "linkbtn end-shelf", backTo().long); back.type = "button"; back.onclick = close; row.appendChild(back);
    col.appendChild(row); nx.appendChild(col); d.appendChild(nx);
    var pr = pairsNode(b, n); if (pr) d.appendChild(pr);
    if (b.sources && b.sources.length) {
      var sd = el("details", "end-sources"); sd.appendChild(el("summary", null, "Sources for this book (" + b.sources.length + ")"));
      var ul = el("ul"); b.sources.forEach(function (x) { var li = el("li"), l = el("a", null, x.title || srcHost(x.url)); l.href = x.url; l.target = "_blank"; l.rel = "noopener"; l.appendChild(el("span", "sr-only", " (opens in a new tab)")); li.appendChild(l); ul.appendChild(li); });
      sd.appendChild(ul); d.appendChild(sd);
    }
    /* short phones: the card scrolls inside itself; a small sticky pill says "more below" until the bottom is reached */
    var more = el("span", "end-more"); more.setAttribute("aria-hidden", "true"); more.appendChild(el("span", "end-more-pill", "Scroll for more \u2193")); d.appendChild(more);
    var upd = function () { d.classList.toggle("g-more", d.scrollHeight - d.scrollTop - d.clientHeight > 8); syncMore(d); };
    d.addEventListener("scroll", upd, { passive: true }); requestAnimationFrame(upd); setTimeout(upd, 500); setTimeout(upd, 1200);
    return d;
  }
  /* "Scroll for more" lives in the footer next to the counter, so it never covers a page's source line or takeaway */
  function syncMore(d) { var m = $("rd-more"); if (m && d && d.isConnected) m.hidden = !d.classList.contains("g-more"); }
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
      var more = function () { d.classList.toggle("g-more", sc.scrollHeight - sc.scrollTop - sc.clientHeight > 3); syncMore(d); };
      sc.addEventListener("scroll", more, { passive: true }); requestAnimationFrame(more); setTimeout(more, 400);
    } else {
      var btn = el("button", "pg-zoom"); btn.type = "button"; btn.setAttribute("aria-label", "Zoom into page: " + p.title);
      var img = el("img"); img.src = p.file; img.alt = "Sketch page from " + b.title + ": " + p.title + ". " + tagline(b) + "."; img.width = p.w; img.height = p.h; img.decoding = "async"; if (Math.abs(i - idx) > 1) img.loading = "lazy";
      btn.appendChild(img); btn.onclick = function () { if (Date.now() - askBlurAt < 800) { if ($("askp-in").value.trim() && !$("askp-out").textContent) askPage($("askp-in").value); return; } zoom(p, b); }; d.appendChild(btn); // a tap meant for Ask can land here after the keyboard drops
      /* taller than the screen: the sketch fits the card's width and scrolls inside it; a small "Scroll" pill says so */
      var more = function () { d.classList.toggle("g-more", btn.scrollHeight - btn.scrollTop - btn.clientHeight > 6); syncMore(d); };
      btn.addEventListener("scroll", more, { passive: true }); img.addEventListener("load", more); requestAnimationFrame(more); setTimeout(more, 500);
      var nx = P[i + 1]; if (nx) { var pre = new Image(); pre.src = nx.file; }
    }
    var pn = el("span", "pg-num", p.gist ? "Summary" : "page " + i + " of " + b.pages.length); pn.setAttribute("aria-hidden", "true"); d.appendChild(pn); // kept in the page for scripts; shown in the footer (#rd-count) so it never covers the art // drawn pages count on their own, so the number matches the art (gist = "Summary", end card has none)
    return d;
  }
  /* reserve the tallest caption once per book + screen size, so the card never moves between pages (re-measured once web fonts land) */
  function reserveTake(b, tk) {
    var tb = $("rd-take"), t = $("rd-take-t"), was = [tb.hidden, tb.className, t.textContent], mh = 0;
    tb.style.minHeight = ""; tb.hidden = false; tb.classList.remove("rd-take-ghost");
    b.pages.forEach(function (q) { if (q.takeaway) { t.textContent = q.takeaway; mh = Math.max(mh, tb.offsetHeight); } });
    tb.style.minHeight = mh + "px"; tb.hidden = was[0]; tb.className = was[1]; t.textContent = was[2];
    var fontsDone = !document.fonts || document.fonts.status === "loaded";
    tb.dataset.book = fontsDone ? b.id + "@" + innerWidth + "x" + innerHeight : "";
    if (!fontsDone) document.fonts.ready.then(function () { if (cur === b) reserveTake(b); });
  }
  function paint() {
    var P = pages(cur), end = idx >= P.length, host = $("page");
    if (end) markDone(cur); // the end card counts as finished (and drives "Up next", the shelf progress and the ✓ on the cover)
    host.innerHTML = ""; host.appendChild(pageNode(cur, idx));
    $("rd-progfill").style.width = Math.round((idx + 1) / P.length * 100) + "%"; $("rd-pagetitle").textContent = end ? "Finished — " + P.length + " pages" : P[idx].gist ? "The 60-second version" : P[idx].title;
    $("rd-prev").disabled = idx === 0; $("rd-next").disabled = end;
    $("rd-next").setAttribute("aria-label", idx === P.length - 1 ? "Finish the book" : "Next page");
    $("rd-more").hidden = true;
    $("rd-count").textContent = end ? "Finished" : P[idx].gist ? "Summary" : "Page " + idx + " of " + (P.length - 1);
    var dots = $("rd-dots"); dots.innerHTML = ""; dots.classList.toggle("seg", P.length - 1 > 9); // long books: a slim segmented bar, always one row
    P.forEach(function (q, i) { if (q.gist) return; var d = el("button", "dot" + (i === idx ? " on" : "")); d.type = "button"; d.setAttribute("aria-label", "Page " + i + " of " + (P.length - 1)); if (i === idx) d.setAttribute("aria-current", "page"); d.dataset.i = i; d.onclick = function (e) { go(nearestDot(e, i)); }; dots.appendChild(d); }); // one dot per drawn page
    var bk = $("book"), base = parseFloat(bk.dataset.ar || "0.58"); bk.style.setProperty("--ar", (end || P[idx].gist) && base > 0.75 ? "0.75" : base.toFixed(4)); // wide cards: text pages (summary, end card) get a taller frame so the recap fits
    var on = !end && isSaved(cur.id, idx + 1);
    $("rd-bm").setAttribute("aria-pressed", String(on)); $("rd-bm-lbl").textContent = on ? "Saved" : "Save page"; $("rd-bm").disabled = end;
    $("rd-bm").setAttribute("aria-label", on ? "Page saved. Remove from Saved" : "Save this page");
    $("ribbon").hidden = !on;
    ["rd-stamps", "rd-stamps2"].forEach(function (id, k) {
      var st = $(id); st.innerHTML = "";
      if (k === 0 && freshSet()[cur.id]) st.appendChild(stamp("New", "rd-stamp"));
      if (!end && idx > 0 && cur.pages[idx - 1].outlook) { var os = stamp("Outlook", "rd-stamp"); os.classList.add("is-ol"); st.appendChild(os); }
    });
    var anyOl = cur.pages.some(function (q) { return q.outlook; }), hasSt = !!$("rd-stamps2").childNodes.length; // books with an Outlook page keep the stamp row's space on every page
    $("rd-pagerow").hidden = !hasSt && !anyOl; $("rd-pagerow").classList.toggle("rd-pagerow-ghost", !hasSt && anyOl);
    if (!end) ls(LS.last, { id: cur.id, p: idx + 1 });
    var pg = !end && idx > 0 ? cur.pages[idx - 1] : null, tk = pg && pg.takeaway;
    var tb = $("rd-take"), anyTk = cur.pages.some(function (q) { return q.takeaway; });
    if (anyTk && tb.dataset.book !== cur.id + "@" + innerWidth + "x" + innerHeight) reserveTake(cur, tk);
    if (!anyTk) { tb.style.minHeight = ""; tb.dataset.book = ""; }
    tb.hidden = !tk && !anyTk; tb.classList.toggle("rd-take-ghost", !tk && anyTk); tb.setAttribute("aria-hidden", String(!tk));
    $("rd-take-t").textContent = tk || "";
    askReset();
    var reached = Math.min(idx + 1, P.length); if (reached > (ls(LS.prog + cur.id) || 0)) ls(LS.prog + cur.id, reached);
    var h = "#book/" + cur.id + "/" + Math.min(idx + 1, P.length);
    if (location.hash !== h) history.replaceState(history.state, "", h);
  }
  /* where "back" goes: the library view the book was opened from (home, or one shelf) */
  function backTo() { var t = libSlug && TOPICS.filter(function (x) { return x.slug === libSlug; })[0]; return t ? { long: "Back to " + t.name, short: t.short } : { long: "Back to the shelf", short: "Shelf" }; }
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
  var sigSeen = {};
  function open(id, n) {
    var b = find(id); if (!b) return false;
    if (!b.pages) { // the light list is in, the full book isn't yet: wait for it (it's already on its way)
      var t = setTimeout(function () { toast("Opening the book\u2026", 1600); }, 250);
      loadFull().then(function () { clearTimeout(t); if (location.hash.indexOf("#book/" + id) === 0) route(); }, function () { clearTimeout(t); toast("The book didn\u2019t load. Check your connection and try again."); });
      return true;
    }
    var first = !cur || cur.id !== id;
    cur = b; idx = Math.max(0, Math.min((n || 1) - 1, b.pages.length));
    $("rd-title").textContent = b.title; $("rd-topic").textContent = b.topic;
    var vtOn = document.documentElement.hasAttribute("data-vt");
    $("reader").className = "reader " + tcls(b.topic) + (first && !vtOn && !reduce() ? " rd-enter" : "");
    $("book").dataset.ar = (b.pages[0].w / b.pages[0].h).toFixed(4); $("book").style.setProperty("--ar", $("book").dataset.ar); // the book takes its pages' shape
    $("reader").hidden = false; document.body.classList.add("reading");
    if (first) {
      askReset(); if (!$("rd-askp").hidden) { $("rd-askp").hidden = true; $("rd-ask").setAttribute("aria-expanded", "false"); $("rd-ask").setAttribute("aria-pressed", "false"); }
      opens[id] = (opens[id] || 0) + 1; ls(LS.opens, opens);
      var bk = $("book"); bk.classList.remove("opening"); void bk.offsetWidth;
      /* the shelf's signature: a closed cloth cover lands first (the shelf morph lands on it), then the moment plays across it and it swings open.
         Once per book per visit, only when opening at the start, never under reduced motion; tap to skip. AI keeps the plain open. */
      var sig = idx === 0 && !sigSeen[id] && window.PulseSig && PulseSig.has(b.topic) && !reduce() && PulseSig.cover(bk, b.topic, { title: b.title, cls: tcls(b.topic) });
      if (sig) { sigSeen[id] = 1; setTimeout(function () { if (cur === b) PulseSig.play(); }, vtOn ? 400 : 140); }
      else if (!reduce() && !vtOn) bk.classList.add("opening");
      setTimeout(function () { if (cur) { var cb = $("rd-close"); cb.classList.toggle("nofv", !kbdNav); cb.focus({ preventScroll: true }); } }, 30);
    }
    setBackLabel(); onScrollTop();
    paint(); return true;
  }
  function hideReader(was) {
    if (window.PulseSig) PulseSig.stop();
    $("reader").hidden = true; document.body.classList.remove("reading"); cur = null;
    $("rd-askp").hidden = true; $("rd-ask").setAttribute("aria-expanded", "false"); $("rd-ask").setAttribute("aria-pressed", "false");
    renderLib();
    restoreY(libY); /* same view, same scroll position as when the book was opened */
    var sp = document.querySelector('#shelves a[data-id="' + was.id + '"]'); if (sp) { sp.focus({ preventScroll: true }); var sc = sp.closest(".row-scroll"); if (sc) sp.scrollIntoView({ inline: "nearest", block: "nearest" }); }
    onScrollTop();
  }
  function dstOf(was) { return function () { var a = document.querySelector('#shelves a[data-id="' + was.id + '"]'); return a && (a.querySelector(".sp-body") || a.querySelector(".cv")); }; }
  function close() {
    var was = cur; if (!was) return;
    withVT($("book"), dstOf(was), function () {
      hideReader(was);
      if (fromShelf()) history.back();
      else history.replaceState(null, "", libSlug ? "#shelf/" + libSlug : location.pathname + location.search);
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
    if (lines.length) { var ul = el("ul", "askp-lines"); lines.forEach(function (l) { var li = el("li", null, typeof l === "string" ? l : l.l); if (l.g) li.appendChild(el("span", "askp-tag", " · Summary")); ul.appendChild(li); }); o.appendChild(ul); }
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
      var a = el("a", "askp-from", "from " + h.b.title + " · " + (h.i === 0 ? "Summary" : "page " + h.i) + " →");
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
  var zoomFrom = null, askBlurAt = 0;
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
    var h = location.hash;
    if (h === "#topics") { history.replaceState(null, "", location.pathname + location.search); h = ""; } // the old Topics view is now the home rows
    var m = h.match(/^#book\/([a-z0-9-]+)(?:\/(\d+))?/);
    if (m && moved(m[1])) {
      var mv = moved(m[1]), to = mv.to && find(mv.to);
      if (to) { history.replaceState(history.state, "", "#book/" + to.id + "/1"); open(to.id, 1); toast("\u201c" + mv.was + "\u201d is now part of \u201c" + to.title + "\u201d", 3200); }
      else { history.replaceState(null, "", location.pathname); if (cur) close(); toast("\u201c" + mv.was + "\u201d has been retired for now. It will return in a new version.", 3600); }
      return;
    }
    if (m) {
      if (!find(m[1]) && !lib._full) { loadFull().then(route, function () {}); return; } // maybe a retired id: library.json knows
      if (!open(m[1], +m[2] || 1)) { history.replaceState(null, "", location.pathname); if (cur) close(); toast("That book isn\u2019t on the shelf"); }
      return;
    }
    var s = h.match(/^#shelf\/([a-z0-9-]+)/), want = s ? s[1] : "";
    if (want && !TOPICS.some(function (t) { return t.slug === want; })) { history.replaceState(null, "", location.pathname + location.search); want = ""; toast("That shelf isn\u2019t here"); }
    var changed = want !== libSlug; if (changed) { libSlug = want; tSub = "All"; }
    if (cur) { var was = cur; withVT($("book"), dstOf(was), function () { if (changed) libY = 0; hideReader(was); }); }
    else if (changed) { renderLib(); jump(0); }
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
    (function () { // phones: arrows sit in the counter row under the card, never over card text; desktop keeps them beside the book
      var mq = matchMedia("(max-width: 640px)"), pv = $("rd-prev"), nx = $("rd-next"), stg = $("rd-stage"), bk = $("book"), row = document.querySelector(".rd-foot");
      function place() { if (mq.matches) { row.appendChild(pv); row.appendChild(nx); row.classList.add("has-nav"); } else { stg.insertBefore(pv, bk); stg.appendChild(nx); row.classList.remove("has-nav"); } }
      place(); if (mq.addEventListener) mq.addEventListener("change", place); else mq.addListener(place);
    })();
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
    /* phones: tapping Ask (or Explain simply) blurs the box first, the keyboard drops, the sheet slides down and the click
       used to land on the page image underneath (full-page zoom, question never asked). Keep focus on pointerdown so the
       click lands on the button, and remember the blur so a stray click on the page is ignored. */
    [].forEach.call(document.querySelectorAll("#askp-form button[type=submit], #askp-simple"), function (x) { x.addEventListener("pointerdown", function (e) { if (document.activeElement === $("askp-in")) e.preventDefault(); }); });
    $("askp-in").addEventListener("blur", function () { askBlurAt = Date.now(); });
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
    $("ask-input").addEventListener("focus", function () { openSearch(); });
    $("ask-input").addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); clearQuery(); closeSearch(); this.blur(); } });
    $("ask-clear").onclick = function () { clearQuery(); renderResults(); $("ask-input").focus(); };
    var deb;
    $("ask-input").addEventListener("input", function () {
      var v = this.value; clearTimeout(deb); syncClear();
      if (!v.trim()) { query = ""; renderResults(); return; }
      deb = setTimeout(function () { if (v.trim().length >= 2) ask(v); }, 180);
    });
    // close the empty search sheet when you tap anywhere else (a typed search stays until cleared)
    document.addEventListener("pointerdown", function (e) { if (!document.body.classList.contains("searching") || query || !$("reader").hidden) return; if (e.target.closest && e.target.closest("#lib-bar,#lib-results")) return; closeSearch(); }, true);
    if (window.visualViewport) visualViewport.addEventListener("resize", fitResults);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || !$("reader").hidden) return;
      var a = document.activeElement; if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
      e.preventDefault(); $("ask-input").focus();
    });
    window.addEventListener("hashchange", route);
    window.addEventListener("popstate", function (e) { if (e.state && e.state.pulseShelf) route(); });
  }
  /* the full books (pages, recaps, sources, page words) load after the shelf has painted */
  var fullP = null;
  function loadFull() {
    if (!fullP) fullP = fetch("data/library.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var byId = {}; d.books.forEach(function (x) { byId[x.id] = x; });
        lib.books.forEach(function (b) { var x = byId[b.id]; if (!x) return; ["pages", "recap", "recap_pages", "sources", "gist_lead", "gist"].forEach(function (k) { if (x[k] != null) b[k] = x[k]; }); b._ix = null; b._rw = null; });
        lib.moved = d.moved; lib._full = true; lib._df = null; VOC = null;
        return lib;
      })
      .catch(function (e) { fullP = null; throw e; });
    return fullP;
  }
  fetch("data/shelf.json", { cache: "no-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (d) {
      TOPICS = d.topics || []; TOPICS.forEach(function (t) { TOP[t.name] = t; });
      lib = { books: d.books.filter(function (b) { if (TOP[b.topic]) return true; console.error("Pulse: \u201c" + b.id + "\u201d is on an unknown shelf (" + b.topic + "), so it is not shown"); return false; }),
        path: d.path || [], popular: d.popular || [], questions: d.questions || [], updated: d.updated };
      wire(); wireTips(); wireKbdDismiss(); savedBadge(); heroMeta(); rotateHints();
      // the site's own sticky header stays on top; our search bar sticks just under it
      var navH = function () { var n = document.querySelector("header.topnav-wrap"); document.documentElement.style.setProperty("--nav-h", (n ? n.offsetHeight : 0) + "px"); };
      navH(); addEventListener("resize", navH); if (document.fonts) document.fonts.ready.then(navH);
      var s = location.hash.match(/^#shelf\/([a-z0-9-]+)/); libSlug = s && TOPICS.some(function (t) { return t.slug === s[1]; }) ? s[1] : "";
      renderLib();
      if (location.hash && !/^#shelf\//.test(location.hash) || (s && !libSlug)) route();
      var idle = window.requestIdleCallback || function (f) { setTimeout(f, 400); };
      idle(function () { loadFull().catch(function (e) { console.error("Pulse: books failed to load", e); }); }, { timeout: 1500 });
    })
    .catch(function (e) { console.error("Pulse: library failed to load", e); $("shelves").innerHTML = '<p class="lib-loading">The library didn\u2019t load. Refresh to try again.</p>'; });
})();

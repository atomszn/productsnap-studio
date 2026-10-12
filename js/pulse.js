/* Pulse — the sketch library. Reads data/library.json (built by scripts/add_book.py).
   Page 1 of every book is the "60-second version"; the drawn pages follow.
   Deep links: #book/<id>/<page>  (page is 1-based, counting the gist page). */
(function () {
  "use strict";
  var TOPICS = { AI: "AI", Tech: "Tech", Macro: "Macro" };
  var LS = { seen: "pulse_seen", opens: "pulse_opens", bm: "pulse_bm_" };
  var SYN = {
    gpu: ["chip", "compute", "nvidia", "bottleneck"], chips: ["gpu", "compute"],
    power: ["energy", "electricity", "grid"], energy: ["power", "grid"],
    robot: ["physical", "humanoid", "robots"], robots: ["physical", "humanoid"],
    money: ["stablecoin", "payments", "rails"], payments: ["stablecoin", "rails", "checkout"],
    agent: ["agents", "swarm"], agents: ["agent", "swarm"], swarm: ["agents"],
    moat: ["moats", "defensible"], scarce: ["bottleneck", "shortage"], shortage: ["bottleneck"],
    words: ["vocabulary", "glossary"], jargon: ["vocabulary"], assets: ["tokenization"],
    simulate: ["world", "models"], security: ["permissions", "sandbox", "keys"],
    mortgage: ["mortgage", "10-year", "yield"], rates: ["mortgage", "yield", "fed"], fed: ["mortgage", "plumbing", "reserves"],
    debt: ["debt", "loop", "deficit", "interest"], inflation: ["debasement", "dollar", "cpi"], dollar: ["dollar", "debasement"],
    gold: ["gold"], yen: ["japan", "yen"], japan: ["yen"], housing: ["mortgage"], banks: ["bank", "leverage"]
  };
  var CHIPS = ["why are GPUs scarce?", "what is an agent?", "robots", "why are mortgages so high?", "payments"];
  var $ = function (id) { return document.getElementById(id); };
  var lib = null, topic = "All", query = "";
  /* The Shelf (spines) is always the default view, at every width; Topics is opt-in per visit
     and never restored from storage. Only an explicit #topics hash opens it. */
  var view = location.hash === "#topics" ? "topics" : "shelf";
  var cur = null, idx = 0, turning = false;

  function ls(k, v) {
    try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); localStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { return null; }
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function toast(msg) { var t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, 2200); }

  /* ---------- living shelf state ---------- */
  var lastSeen = ls(LS.seen); // ISO date of previous visit (null on first visit)
  var opens = ls(LS.opens) || {};
  function isNew(b) { return lastSeen && (b.updated || b.added) > lastSeen; }

  /* ---------- search ---------- */
  function words(s) { return (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && STOP.indexOf(w) < 0; }); }
  var STOP = ["the", "and", "are", "why", "what", "how", "does", "for", "with", "who", "can", "this", "that", "your", "you", "about", "into", "from"];
  function score(b, q) {
    var terms = []; words(q).forEach(function (w) { terms.push(w); (SYN[w] || []).forEach(function (s) { terms.push(s); }); if (w.endsWith("s")) terms.push(w.slice(0, -1)); });
    if (!terms.length) return { s: 0 };
    var hay = { title: b.title.toLowerCase(), meta: (b.blurb + " " + b.gist.join(" ")).toLowerCase() };
    var s = 0, hitPage = -1, best = 0;
    terms.forEach(function (t) { if (hay.title.indexOf(t) >= 0) s += 5; if (hay.meta.indexOf(t) >= 0) s += 2; });
    b.pages.forEach(function (p, i) { var ps = 0; terms.forEach(function (t) { if (p.title.toLowerCase().indexOf(t) >= 0) ps += 3; }); s += ps; if (ps > best) { best = ps; hitPage = i; } });
    return { s: s, page: hitPage };
  }

  /* ---------- shelf ---------- */
  function tagline(b) { return b.tagline || b.blurb; }
  function decorate(a, b) {
    a.href = "#book/" + b.id + "/1";
    a.setAttribute("aria-label", b.title + " — " + tagline(b) + " (" + (b.pages.length + 1) + " pages)" + (b.start_here ? ". Start here." : ""));
    a.title = b.title + " — " + tagline(b);
    if (isNew(b)) a.classList.add("is-new");
    if ((opens[b.id] || 0) >= 3) a.classList.add("is-lean");
    if (b.start_here) a.classList.add("is-start");
  }
  /* Designed cover (HTML/CSS, no cropped images): topic, title, tagline, Vol. mark. */
  function coverArt(b) {
    var c = el("span", "cv t-" + b.topic.toLowerCase());
    c.appendChild(el("span", "cv-topic", b.topic === "Tech" ? "Tech · fintech" : b.topic));
    c.appendChild(el("span", "cv-title", b.title));
    c.appendChild(el("span", "cv-rule"));
    c.appendChild(el("span", "cv-tag", tagline(b)));
    var f = el("span", "cv-foot"); f.appendChild(el("span", "cv-vol", "Vol. " + (b.vol || 1))); f.appendChild(el("span", "cv-mark", "ProductSnap · Pulse")); c.appendChild(f);
    if (b.start_here) c.appendChild(el("span", "cv-start", "Start here"));
    if (isNew(b)) c.appendChild(el("span", "bk-newdot", "new"));
    return c;
  }
  function cover(b) {
    var a = el("a", "bk t-" + b.topic.toLowerCase()); decorate(a, b);
    a.appendChild(coverArt(b));
    var meta = el("span", "bk-meta", (b.pages.length + 1) + " pages");
    var bm = ls(LS.bm + b.id); if (bm) meta.appendChild(el("span", "bk-bm", " · bookmarked p." + bm));
    a.appendChild(meta);
    return a;
  }
  /* Spine for the Shelf view: same cloth, topic colour and type as the cover. */
  function spine(b) {
    var a = el("a", "sp t-" + b.topic.toLowerCase()); decorate(a, b);
    a.style.setProperty("--h", (200 + Math.min(b.pages.length, 6) * 14) + "px");
    if (b.start_here) a.appendChild(el("span", "sp-start", "Start here"));
    a.appendChild(el("span", "sp-topic", b.topic));
    a.appendChild(el("span", "sp-title", b.title));
    a.appendChild(el("span", "sp-vol", "Vol. " + (b.vol || 1)));
    if (isNew(b)) a.appendChild(el("span", "sp-new", "new"));
    var tip = el("span", "sp-tip"); tip.appendChild(el("b", null, b.title)); tip.appendChild(el("span", null, tagline(b)));
    var bm = ls(LS.bm + b.id); if (bm) tip.appendChild(el("span", "bk-bm", "Bookmarked · p." + bm));
    a.appendChild(tip);
    return a;
  }
  function renderTabs() {
    var t = $("lib-tabs"); t.innerHTML = "";
    ["All"].concat(Object.keys(TOPICS)).forEach(function (k) {
      var n = k === "All" ? lib.books.length : lib.books.filter(function (b) { return b.topic === k; }).length;
      var btn = el("button", "chip" + (k !== "All" ? " c-" + k.toLowerCase() : ""), k + " · " + n);
      btn.setAttribute("role", "tab"); btn.setAttribute("aria-selected", String(topic === k)); btn.dataset.topic = k;
      if (!n && k !== "All") btn.disabled = true;
      btn.onclick = function () { topic = k; query = ""; $("ask-input").value = ""; $("ask-hint").textContent = ""; renderTabs(); renderShelves(); };
      t.appendChild(btn);
    });
    var v = el("div", "viewtog"); v.setAttribute("role", "group"); v.setAttribute("aria-label", "View");
    [["shelf", "Shelf"], ["topics", "Topics"]].forEach(function (p) {
      var b = el("button", "chip vt", p[1]); b.dataset.view = p[0]; b.setAttribute("aria-pressed", String(view === p[0]));
      b.onclick = function () { view = p[0]; renderTabs(); renderShelves(); }; v.appendChild(b);
    });
    t.appendChild(v);
  }
  function renderShelves() {
    var host = $("shelves"); host.innerHTML = "";
    var books = lib.books.filter(function (b) { return topic === "All" || b.topic === topic; });
    if (query) {
      books = books.map(function (b) { var r = score(b, query); b._s = r.s; b._p = r.page; return b; })
        .filter(function (b) { return b._s > 0; }).sort(function (a, b) { return b._s - a._s; });
      var h = $("ask-hint"); h.innerHTML = "";
      if (!books.length) { h.textContent = "Nothing on the shelves for that yet — try “agents”, “GPUs” or “payments”."; }
      else {
        h.appendChild(document.createTextNode("Best match: "));
        var top = books[0], a = el("a", null, top.title + (top._p >= 0 ? " — “" + top.pages[top._p].title + "”" : ""));
        a.href = "#book/" + top.id + "/" + (top._p >= 0 ? top._p + 2 : 1); h.appendChild(a);
        var clr = el("button", "linkbtn", "clear"); clr.type = "button"; clr.onclick = function () { query = ""; $("ask-input").value = ""; h.textContent = ""; renderShelves(); };
        h.appendChild(document.createTextNode(" · ")); h.appendChild(clr);
      }
    }
    var groups = (view === "topics" && !query)
      ? Object.keys(TOPICS).map(function (k) { return [k, books.filter(function (b) { return b.topic === k; })]; }).filter(function (g) { return g[1].length; })
      : [[query ? "Matches" : (topic === "All" ? "The shelf" : topic + " shelf"), books]];
    groups.forEach(function (g) {
      var s = el("section", "shelf" + (TOPICS[g[0]] ? " t-" + g[0].toLowerCase() : ""));
      s.appendChild(el("h2", "shelf-h", g[0]));
      var spines = view === "shelf" && !query;
      var row = el("div", spines ? "shelf-row spines" : "shelf-row covers");
      g[1].forEach(function (b) { row.appendChild(spines ? spine(b) : cover(b)); });
      s.appendChild(row); host.appendChild(s);
    });
  }
  function renderChips() {
    var f = $("lib-ask"), c = el("div", "ask-chips");
    CHIPS.forEach(function (q) { var b = el("button", "chip ask-chip", q); b.type = "button"; b.onclick = function () { $("ask-input").value = q; ask(q); }; c.appendChild(b); });
    f.parentNode.insertBefore(c, f.nextSibling);
  }
  function ask(q) { query = q.trim(); topic = "All"; renderTabs(); renderShelves(); }

  /* ---------- reader ---------- */
  function pages(b) { return [{ gist: true }].concat(b.pages); }
  function find(id) { return lib.books.filter(function (b) { return b.id === id; })[0]; }
  function pageNode(b, i) {
    var p = pages(b)[i], d = el("div", "pg");
    if (p.gist) {
      d.classList.add("pg-gist");
      d.appendChild(el("p", "g-kicker", "The 60-second version"));
      d.appendChild(el("h3", "g-title", b.title));
      d.appendChild(el("p", "g-blurb", b.blurb));
      var ol = el("ol", "g-list"); b.gist.forEach(function (g) { ol.appendChild(el("li", null, g)); }); d.appendChild(ol);
      var go = el("button", "g-go", "Turn the page →"); go.type = "button"; go.onclick = function () { turn(1); }; d.appendChild(go);
    } else {
      var img = el("img"); img.src = p.file; img.alt = b.title + " — " + p.title; img.width = p.w; img.height = p.h; img.decoding = "async";
      img.onclick = function () { zoom(p, b); }; d.appendChild(img);
      // preload neighbour
      var nx = pages(b)[i + 1]; if (nx && !nx.gist) { var pre = new Image(); pre.src = nx.file; }
    }
    d.appendChild(el("span", "pg-num", (i + 1) + " of " + pages(b).length));
    return d;
  }
  function paint() {
    var P = pages(cur), host = $("page");
    host.innerHTML = ""; host.appendChild(pageNode(cur, idx));
    $("rd-pagetitle").textContent = P[idx].gist ? "The 60-second version" : P[idx].title;
    $("rd-prev").disabled = idx === 0; $("rd-next").disabled = idx === P.length - 1;
    var dots = $("rd-dots"); dots.innerHTML = "";
    P.forEach(function (_, i) { var d = el("button", "dot" + (i === idx ? " on" : "")); d.setAttribute("aria-label", "Page " + (i + 1) + " of " + P.length); d.onclick = function () { go(i); }; dots.appendChild(d); });
    var bm = ls(LS.bm + cur.id);
    $("rd-bm").setAttribute("aria-pressed", String(bm === idx + 1)); $("rd-bm").textContent = bm === idx + 1 ? "Bookmarked" : "Bookmark";
    $("ribbon").hidden = bm !== idx + 1;
    var h = "#book/" + cur.id + "/" + (idx + 1);
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  function open(id, n) {
    var b = find(id); if (!b) return false;
    var first = !cur || cur.id !== id;
    cur = b; idx = Math.max(0, Math.min((n || 1) - 1, b.pages.length));
    $("rd-title").textContent = b.title; $("rd-topic").textContent = b.topic;
    $("reader").className = "reader t-" + b.topic.toLowerCase();
    $("reader").hidden = false; document.body.classList.add("reading");
    if (first) {
      opens[id] = (opens[id] || 0) + 1; ls(LS.opens, opens);
      var bk = $("book"); bk.classList.remove("opening"); void bk.offsetWidth; bk.classList.add("opening");
      setTimeout(function () { $("rd-close").focus(); }, 30);
    }
    paint(); return true;
  }
  function close() {
    $("reader").hidden = true; document.body.classList.remove("reading"); cur = null;
    history.replaceState(null, "", location.pathname + location.search); renderShelves();
  }
  function go(i) { if (i === idx || turning) return; if (Math.abs(i - idx) === 1) return turn(i - idx); idx = i; paint(); }
  function turn(dir) {
    var P = pages(cur), to = idx + dir;
    if (to < 0 || to >= P.length || turning) return;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { idx = to; return paint(); }
    turning = true;
    var book = $("book"), leaf = el("div", "leaf " + (dir > 0 ? "fwd" : "back"));
    var front = el("div", "leaf-face front"), back = el("div", "leaf-face back");
    if (dir > 0) { front.appendChild(pageNode(cur, idx)); idx = to; paint(); }
    else { front.appendChild(pageNode(cur, to)); }
    leaf.appendChild(front); leaf.appendChild(back); leaf.appendChild(el("div", "leaf-shade"));
    book.appendChild(leaf);
    requestAnimationFrame(function () { requestAnimationFrame(function () { leaf.classList.add("go"); }); });
    setTimeout(function () { if (dir < 0) { idx = to; paint(); } leaf.remove(); turning = false; }, 620);
  }
  function zoom(p, b) {
    var z = $("zoom"), img = $("zoom-img"); img.src = p.file; img.alt = b.title + " — " + p.title;
    z.hidden = false; z.classList.remove("big"); z.scrollTop = 0; $("zoom-x").focus();
  }
  function unzoom() { $("zoom").hidden = true; }

  function route() {
    var m = location.hash.match(/^#book\/([a-z0-9-]+)(?:\/(\d+))?/);
    if (m) { if (!open(m[1], +m[2] || 1)) close(); }
    else if (cur) close();
  }

  function wire() {
    $("rd-prev").onclick = function () { turn(-1); };
    $("rd-next").onclick = function () { turn(1); };
    $("rd-close").onclick = close;
    $("rd-bm").onclick = function () {
      var k = LS.bm + cur.id, on = ls(k) === idx + 1;
      if (on) { try { localStorage.removeItem(k); } catch (e) {} toast("Bookmark removed"); } else { ls(k, idx + 1); toast("Bookmarked page " + (idx + 1)); }
      paint();
    };
    $("rd-share").onclick = function () {
      var url = location.origin + location.pathname + "#book/" + cur.id + "/" + (idx + 1);
      var done = function () { toast("Link copied — opens on page " + (idx + 1)); };
      if (navigator.share && /Mobi/.test(navigator.userAgent)) navigator.share({ title: cur.title, url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { toast(url); });
      else toast(url);
    };
    $("zoom-x").onclick = unzoom;
    $("zoom").onclick = function (e) { if (e.target.id === "zoom-img") $("zoom").classList.toggle("big"); else if (e.target.id === "zoom") unzoom(); };
    document.addEventListener("keydown", function (e) {
      if (!$("zoom").hidden) { if (e.key === "Escape") unzoom(); return; }
      if (!cur) return;
      if (e.key === "ArrowRight") turn(1); else if (e.key === "ArrowLeft") turn(-1); else if (e.key === "Escape") close();
    });
    var sx = null;
    $("rd-stage").addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    $("rd-stage").addEventListener("touchend", function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) turn(dx < 0 ? 1 : -1); sx = null; }, { passive: true });
    $("lib-ask").onsubmit = function (e) { e.preventDefault(); ask($("ask-input").value); };
    $("ask-input").addEventListener("input", function () { if (!this.value) { query = ""; $("ask-hint").textContent = ""; renderShelves(); } });
    window.addEventListener("hashchange", route);
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
      wire(); renderChips(); renderTabs(); renderShelves(); newBadge(); route();
    })
    .catch(function (e) { console.error("Pulse: library failed to load", e); $("shelves").innerHTML = '<p class="lib-loading">The library didn’t load. Refresh to try again.</p>'; });
})();

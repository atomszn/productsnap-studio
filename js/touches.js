/* Small touches that remove friction, on every page:
   - a paper-plane "back to top" that shows up once you've scrolled a while
   - a reading-progress line on the case studies
   - a "you landed here" glow when a chip jumps you to a card
   - "Ask the studio" on the homepage: answers pulled from this site, nothing invented */
(function () {
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  function still() { return reduce && reduce.matches; }
  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  ready(function () {
    /* ---------- back to top ---------- */
    var top = document.createElement("button");
    top.type = "button"; top.className = "totop"; top.setAttribute("aria-label", "Back to top");
    top.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3 3 10.5l7 2.6L12.8 21z"/><path d="m21 3-11 10.1"/></svg><span class="totop-l" aria-hidden="true">top</span>';
    document.body.appendChild(top);
    var shown = false;
    function onScroll() {
      var want = scrollY > innerHeight * 1.2 && !document.body.classList.contains("reading");
      if (want !== shown) { shown = want; top.classList.toggle("is-on", want); }
      if (bar) {
        var h = document.documentElement.scrollHeight - innerHeight;
        bar.style.transform = "scaleX(" + (h > 0 ? Math.min(1, scrollY / h) : 0) + ")";
      }
    }
    top.addEventListener("click", function () {
      if (!still()) { top.classList.add("is-flying"); setTimeout(function () { top.classList.remove("is-flying"); }, 900); }
      scrollTo({ top: 0, behavior: still() ? "auto" : "smooth" });
      var skip = document.getElementById("main") || document.querySelector("main");
      if (skip) { skip.setAttribute("tabindex", "-1"); skip.focus({ preventScroll: true }); }
    });

    /* ---------- reading progress (case studies only) ---------- */
    var bar = null;
    if (document.querySelector(".cs-sec")) {
      bar = document.createElement("div"); bar.className = "read-bar"; bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
    }
    addEventListener("scroll", onScroll, { passive: true }); onScroll();

    /* ---------- landed glow ---------- */
    function land() {
      var id = decodeURIComponent(location.hash.slice(1)); if (!id) return;
      var t = document.getElementById(id); if (!t || !/^idea-/.test(id)) return;
      t.classList.remove("is-landed"); void t.offsetWidth; t.classList.add("is-landed");
      setTimeout(function () { t.classList.remove("is-landed"); }, 1600);
    }
    addEventListener("hashchange", land); land();

    /* ---------- Ask the studio ---------- */
    var ask = document.getElementById("ask-form"); if (ask) initAsk(ask);
  });

  function initAsk(form) {
    var input = document.getElementById("ask-in"), out = document.getElementById("ask-out");
    /* every answer is a line already on this site, with the page it came from */
    var KB = [
      { k: "build built make making ideas projects products studio jeevan work portfolio", a: "Four ideas, all live: ProductSnap (iOS and Android), FlickMango, Run It Back and Pulse. I make the product calls, the design and the QA. AI does the typing.", href: "#work", src: "The studio wall" },
      { k: "ai artificial intelligence grok llm agent code coding tools crew future", a: "AI is my build crew. It brings speed, options and code. I bring taste, the product calls and the \u201cnope, that feels wrong.\u201d Pulse books even have Ask built in: answers pulled from the page, nothing invented.", href: "#process", src: "Scribble. Argue. Ship." },
      { k: "measure metric metrics north star data success kpi numbers growth signal", a: "Every idea gets a North Star, the one metric I steer by. ProductSnap: practice reps finished each week. FlickMango: searches that end in \u201cpress play.\u201d Run It Back: practice sessions finished without tears. Pulse: books read to the last page.", href: "#work", src: "North Star on each card" },
      { k: "productsnap snap pm product managers judgment app ios android flashcards gym", a: "ProductSnap trains product judgment like a muscle: a concept, a real story, a quick practice set. Live on the App Store and Google Play. Free, no paywall.", href: "projects/productsnap.html", src: "ProductSnap case study" },
      { k: "flickmango movie movies film films watch streaming indian telugu hindi tamil ott", a: "FlickMango answers \u201cwhere can I watch this?\u201d for Indian films. Pick your language, region and the services you already pay for. Live in Hindi, Telugu, Tamil, Malayalam and Kannada.", href: "projects/flickmango.html", src: "FlickMango case study" },
      { k: "run it back runitback math kids school seventh grade homework learning education", a: "Run It Back makes seventh grade math feel more like play than a test: pictures, plain words, hints only when you ask. No timer, no account.", href: "projects/runitback.html", src: "Run It Back case study" },
      { k: "pulse books book picture shelf macro fintech tech economy read reading", a: "Pulse turns big shifts in tech and money into five-minute picture books. One idea per page. A story, not a lecture.", href: "pulse.html", src: "Pulse shelf" },
      { k: "design sketch sketches ux ui pencil wireframe process simple simplicity friction", a: "Pencil first. Every screen here started as a scribble: boxes, arrows, margin notes. If it doesn't make sense in pencil, it won't make sense in pixels.", href: "sketches.html", src: "The sketchbook" },
      { k: "contact hire hiring reach talk connect linkedin email chat role job", a: "LinkedIn is the one door, and it's open.", href: "https://www.linkedin.com/in/jeevan99", src: "LinkedIn", ext: true }
    ];
    var STOP = ["how","what","who","why","do","does","did","you","your","is","are","the","an","to","of","in","on","for","and","me","tell","about","can","with"];
    function words(s) { return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(function (w) { return w.length > 1 && STOP.indexOf(w) < 0; }); }
    function best(q) {
      var qs = words(q), top = null, score = 0;
      KB.forEach(function (e) {
        var ks = e.k.split(" "), n = 0;
        qs.forEach(function (w) { ks.forEach(function (k) { if (k === w || (w.length > 3 && k.indexOf(w) === 0) || (k.length > 3 && w.indexOf(k) === 0)) n++; }); });
        if (n > score) { score = n; top = e; }
      });
      return top;
    }
    var typing = 0;
    function show(q) {
      var e = best(q);
      out.hidden = false; out.innerHTML = "";
      var p = document.createElement("p"); p.className = "ask-a"; out.appendChild(p);
      var text = e ? e.a : "That one isn't on this site yet, and I'd rather not make it up. Try the work, AI, how I measure success, or say hi on LinkedIn.";
      var foot = document.createElement("p"); foot.className = "ask-src";
      if (e) {
        var a = document.createElement("a"); a.href = e.href; a.textContent = e.src + (e.ext ? " \u2197" : " \u2192");
        if (e.ext) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
        foot.appendChild(document.createTextNode("From: ")); foot.appendChild(a);
      }
      clearInterval(typing);
      if (still()) { p.textContent = text; out.appendChild(foot); return; }
      var i = 0; p.classList.add("is-typing");
      typing = setInterval(function () {
        i += 3; p.textContent = text.slice(0, i);
        if (i >= text.length) { clearInterval(typing); p.classList.remove("is-typing"); out.appendChild(foot); }
      }, 16);
    }
    form.addEventListener("submit", function (ev) { ev.preventDefault(); if (input.value.trim()) show(input.value); });
    (form.closest(".ask-card") || document).querySelectorAll("[data-q]").forEach(function (b) {
      b.addEventListener("click", function () { input.value = b.getAttribute("data-q"); show(input.value); });
    });
  }
})();

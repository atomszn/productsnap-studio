/* =====================================================================
   ProductSnap Studio — shared reveal-on-scroll  (Pass K: living notebook)
   ---------------------------------------------------------------------
   Standalone + dependency-free so it can load on EVERY page (index, app,
   pulse, sketches, notes) without colliding with page-specific scripts.

   Why this exists: the homepage reveal logic used to live only in
   js/main.js, which only index.html loads. A CSS rule then hid every
   .section-head on all pages, but the inner pages had no JS to fade them
   back in — so their headings stayed invisible. This script guarantees
   the reveal runs everywhere, and the CSS hidden state is gated on a class
   THIS script sets, so the content can never be permanently hidden even if
   the script fails to load or run.

   Contract with css/style.css (UNCHANGED, do not weaken):
     - Hidden start state is `html.reveal-on .section-head, ...{opacity:0}`.
     - This script adds `reveal-on` to <html> ONLY when it is actually able
       to observe + reveal. If the script never runs, the class is absent,
       the hidden rule never matches, and everything is visible by default.

   Pass K additions (all motion gated behind reveal-on + reduced-motion CSS):
     - Per-group STAGGER: items sharing a parent reveal a beat after one
       another via a --reveal-delay custom property (rhythm, not chaos).
     - is-revealed class so sketches can resolve a subtle scale and the
       handwritten notes/carets can be "discovered" last.
     - Gentle, transform-only PARALLAX on a few marked sketches.
   All failsafes from the prior version are preserved verbatim.
   ===================================================================== */
(function () {
  "use strict";

  // Load-critical content (must never get stuck hidden). Order matters only
  // for the safety sweep, not for correctness.
  var SEL =
    ".section-head, .phone-real, .screen-thumb, .pair, .teardown, " +
    ".future-card, .hub-card, .conv-card, .idea-sketch, .sketches-featured, " +
    ".station";

  // Decorative "discovery" elements — handwritten notes + carets that arrive
  // last. Kept separate so the safety sweep below only guarantees the
  // load-critical SEL set; these are connective tissue, not content.
  var DISCOVERY_SEL = ".sketches-note, .pencil-note";

  // Note: scroll-parallax was intentionally NOT added. The hand-drawn sketches
  // already carry CSS rotate/scale transforms (the notebook tilt + the
  // "placed down" reveal). Layering a scroll-driven translate on the same
  // elements would either collide with those transforms or require a wrapper
  // that muddies the markup — and a SaaS-style parallax fights the notebook
  // identity. The wow here comes from rhythm (stagger) + discovery, per brief.

  function show(el) {
    el.style.opacity = "1";
    el.style.translate = "0 0";
    el.classList.add("is-revealed");
  }

  function revealAll(els) {
    for (var i = 0; i < els.length; i++) show(els[i]);
  }

  // Assign a small stagger delay (ms) to each element based on its index
  // among siblings that are also reveal targets. Groups feel like a page
  // settling rather than everything snapping in at once. Capped so a long
  // list never feels slow.
  function assignStagger(els) {
    var byParent = new Map();
    for (var i = 0; i < els.length; i++) {
      var p = els[i].parentNode || document.body;
      if (!byParent.has(p)) byParent.set(p, 0);
      var idx = byParent.get(p);
      var delay = Math.min(idx * 70, 280); // 70ms apart, cap 280ms
      if (delay > 0) els[i].style.setProperty("--reveal-delay", delay + "ms");
      byParent.set(p, idx + 1);
    }
  }

  function setupObserver(els) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    for (var i = 0; i < els.length; i++) io.observe(els[i]);
    return io;
  }

  function init() {
    var root = document.documentElement;

    // The pre-paint <head> script already decided whether reveal should run
    // (motion allowed + IntersectionObserver present) and added `reveal-on`
    // BEFORE first paint so there is no flash. If it is absent, the hidden
    // CSS never applied and everything is already visible — nothing to do.
    if (!root.classList.contains("reveal-on")) {
      // Safety: if anything is somehow hidden without reveal-on, show it.
      revealAll(document.querySelectorAll(SEL));
      revealAll(document.querySelectorAll(DISCOVERY_SEL));
      return;
    }

    var els = document.querySelectorAll(SEL);
    var discovery = document.querySelectorAll(DISCOVERY_SEL);

    // Stagger within groups (rhythm). Sketches get their richer transition
    // from CSS; everything else keeps the original opacity+translate fade.
    assignStagger(els);
    for (var i = 0; i < els.length; i++) {
      // Don't override the sketch's CSS transition (it also animates transform).
      if (!els[i].classList.contains("idea-sketch")) {
        els[i].style.transition =
          "opacity .55s ease, translate .55s cubic-bezier(.2,.8,.2,1)";
        els[i].style.transitionDelay =
          els[i].style.getPropertyValue("--reveal-delay") || "0ms";
      }
    }

    var io = els.length ? setupObserver(els) : null;
    if (discovery.length) {
      assignStagger(discovery);
      setupObserver(discovery);
    }

    // ---- Failsafes (preserved from prior version) ----
    // If the observer never fires for an element (async-rendered sections,
    // zero-height-at-setup parents, layout quirks), force-reveal anything
    // still hidden so a heading can never get stuck. Runs on a short timer
    // AND on first user scroll, whichever is first.
    function sweepStuck() {
      var all = [].slice.call(els).concat([].slice.call(discovery));
      var stuck = [];
      for (var j = 0; j < all.length; j++) {
        if (parseFloat(getComputedStyle(all[j]).opacity) < 0.5) stuck.push(all[j]);
      }
      if (stuck.length) revealAll(stuck);
    }
    // Re-observe any element that had no box when first observed (e.g. a
    // section whose content pulse.js/app.js injects after fetch). A second
    // pass after layout settles lets the observer pick them up normally.
    window.setTimeout(function () {
      if (!io) return;
      for (var k = 0; k < els.length; k++) {
        if (parseFloat(getComputedStyle(els[k]).opacity) < 0.5) io.observe(els[k]);
      }
    }, 350);
    window.setTimeout(sweepStuck, 1500);
    window.addEventListener(
      "scroll",
      function onFirstScroll() {
        window.setTimeout(sweepStuck, 600);
        window.removeEventListener("scroll", onFirstScroll);
      },
      { passive: true, once: true }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* =====================================================================
   ProductSnap Studio — shared reveal-on-scroll
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

   Contract with css/style.css:
     - Hidden start state is `html.reveal-on .section-head, ...{opacity:0}`.
     - This script adds `reveal-on` to <html> ONLY when it is actually able
       to observe + reveal. If the script never runs, the class is absent,
       the hidden rule never matches, and everything is visible by default.
   ===================================================================== */
(function () {
  "use strict";

  var SEL =
    ".section-head, .phone-real, .screen-thumb, .pair, .teardown, " +
    ".future-card, .hub-card, .conv-card, .idea-sketch, .sketches-featured";

  function revealAll(els) {
    for (var i = 0; i < els.length; i++) {
      els[i].style.opacity = "1";
      els[i].style.translate = "0 0";
    }
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
      return;
    }

    var els = document.querySelectorAll(SEL);
    if (!els.length) return;

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.style.opacity = "1";
            e.target.style.translate = "0 0";
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );

    for (var i = 0; i < els.length; i++) {
      els[i].style.transition =
        "opacity .55s ease, translate .55s cubic-bezier(.2,.8,.2,1)";
      io.observe(els[i]);
    }

    // Failsafe: if the observer never fires for an element (async-rendered
    // sections, zero-height-at-setup parents, layout quirks), force-reveal
    // anything still hidden so a heading can never get stuck. We run this
    // both on a short timer AND on the first user scroll, whichever is first.
    function sweepStuck() {
      var stuck = [];
      for (var j = 0; j < els.length; j++) {
        if (parseFloat(getComputedStyle(els[j]).opacity) < 0.5) stuck.push(els[j]);
      }
      if (stuck.length) revealAll(stuck);
    }
    // Re-observe any element that had no box when first observed (e.g. a
    // section whose content pulse.js/app.js injects after fetch). A second
    // pass after layout settles lets the observer pick them up normally.
    window.setTimeout(function () {
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

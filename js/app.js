/* =====================================================================
   ProductSnap Studio — /app page
   Loads data/app-page-content.json and renders:
     - Module grid (6 cards, dot indicator on mobile carousel)
     - Tooling timeline + QA grid + build pills (with handwritten marker)
     - Wireframe gallery (with lightbox + mobile dots)
     - Hard parts / what's next / learning
   Also wires:
     - Flashcard flip (tap + keyboard + mobile pull-down gesture)
     - Deep-dive carousel dot indicator
     - Mobile carousel observers for module + wireframe galleries
   ===================================================================== */

(function () {
  "use strict";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const isMobile = () => window.matchMedia("(max-width: 720px)").matches;

  /* ---------- module grid ---------- */
  function renderModules(modules) {
    const grid = $("#module-grid");
    const dotsRoot = $("#module-dots");
    if (!grid || !modules) return;
    grid.innerHTML = modules.map((m, i) => (
      '<article class="module-card" data-mod-index="' + i + '">' +
        '<div class="mc-head">' +
          '<span class="mc-icon" aria-hidden="true">' + escapeHTML(m.icon) + '</span>' +
          '<h3 class="mc-name">' + escapeHTML(m.name) + '</h3>' +
        '</div>' +
        '<p class="mc-desc">' + escapeHTML(m.desc) + '</p>' +
        '<div class="mc-thumb">' +
          '<img src="' + escapeHTML(m.screenshot) + '"' +
          ' alt="' + escapeHTML(m.alt || m.name) + '"' +
          ' loading="' + (i === 0 ? "eager" : "lazy") + '" />' +
        '</div>' +
      '</article>'
    )).join("");

    if (dotsRoot) {
      dotsRoot.innerHTML = modules.map((_, i) =>
        '<span class="md-dot' + (i === 0 ? " is-active" : "") + '" data-md-index="' + i + '"></span>'
      ).join("");
      wireCarouselDots(grid, ".module-card", dotsRoot, ".md-dot");
    }
  }

  /* ---------- generic carousel dot wiring via IntersectionObserver ---------- */
  function wireCarouselDots(container, itemSel, dotsRoot, dotSel) {
    if (!container || !dotsRoot) return;
    const items = $$(itemSel, container);
    const dots = $$(dotSel, dotsRoot);
    if (!items.length || !dots.length) return;

    if (!("IntersectionObserver" in window)) return;

    const io = new IntersectionObserver((entries) => {
      // pick the one most visible
      let best = null;
      let bestRatio = 0;
      entries.forEach((e) => {
        if (e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio;
          best = e.target;
        }
      });
      if (!best) return;
      const idx = items.indexOf(best);
      if (idx < 0) return;
      dots.forEach((d, i) => d.classList.toggle("is-active", i === idx));
    }, { root: container, threshold: [0.5, 0.75, 1.0] });

    items.forEach((it) => io.observe(it));
  }

  /* ---------- timeline ---------- */
  function arrowDownSVG() {
    return (
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none"' +
      ' stroke="currentColor" stroke-width="2" stroke-linecap="round"' +
      ' stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 5 V19 M6 13 L12 19 L18 13"/></svg>'
    );
  }

  function renderTimeline(stops) {
    const root = $("#timeline");
    if (!root || !stops) return;
    const items = [];
    stops.forEach((s, i) => {
      items.push(
        '<li class="timeline-stop">' +
          '<div class="ts-head">' +
            '<span class="ts-tool">' + escapeHTML(s.tool) + '</span>' +
            '<span class="ts-date">' + escapeHTML(s.date) + '</span>' +
          '</div>' +
          '<p class="ts-note">' + escapeHTML(s.note) + '</p>' +
        '</li>'
      );
      if (i < stops.length - 1) {
        items.push('<li class="timeline-arrow" aria-hidden="true">' + arrowDownSVG() + '</li>');
      }
    });
    root.innerHTML = items.join("");
  }

  /* ---------- qa grid ---------- */
  function renderQA(devices) {
    const root = $("#qa-grid");
    if (!root || !devices) return;
    root.innerHTML = devices.map((d) => (
      '<div class="qa-card">' +
        '<div class="qa-icon" aria-hidden="true">' + escapeHTML(d.icon) + '</div>' +
        '<div class="qa-name">' + escapeHTML(d.name) + '</div>' +
        '<div class="qa-note">' + escapeHTML(d.note) + '</div>' +
      '</div>'
    )).join("");
  }

  /* ---------- builds strip (with handwritten marker entries) ---------- */
  function renderBuilds(builds) {
    const root = $("#builds-strip");
    if (!root || !builds) return;
    const items = [];
    builds.forEach((b, i) => {
      const isMarker = b.id === "--note--";
      const isFinal = i === builds.length - 1;

      if (isMarker) {
        items.push(
          '<span class="build-marker" aria-label="Note about intermediate builds">' +
            '<svg class="bm-squiggle" viewBox="0 0 80 24" width="80" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
              '<path d="M2 12 Q 12 2, 22 12 T 42 12 T 62 12 T 78 12" />' +
            '</svg>' +
            '<span class="bm-text">' + escapeHTML(b.marker) + '</span>' +
          '</span>'
        );
      } else {
        items.push(
          '<span class="build-pill' + (isFinal ? " is-final" : "") + '">' +
            '<span class="bp-id">Build ' + escapeHTML(b.id) + '</span>' +
            '<span class="bp-note">' + escapeHTML(b.note) + '</span>' +
          '</span>'
        );
      }

      if (i < builds.length - 1 && !isMarker) {
        items.push('<span class="bp-arrow" aria-hidden="true">→</span>');
      }
    });
    root.innerHTML = items.join("");
  }

  /* ---------- wireframe gallery + lightbox ---------- */
  function renderWireframes(wires) {
    const root = $("#wire-gallery");
    const dotsRoot = $("#wire-dots");
    if (!root || !wires) return;
    root.innerHTML = wires.map((w, i) => (
      '<figure class="wire-card" role="listitem" data-wire-index="' + i + '">' +
        '<img src="' + escapeHTML(w.src) + '" alt="Wireframe: ' + escapeHTML(w.caption) + '" loading="lazy" />' +
        '<figcaption>' + escapeHTML(w.caption) + '</figcaption>' +
      '</figure>'
    )).join("");

    if (dotsRoot) {
      dotsRoot.innerHTML = wires.map((_, i) =>
        '<span class="wd-dot' + (i === 0 ? " is-active" : "") + '"></span>'
      ).join("");
      wireCarouselDots(root, ".wire-card", dotsRoot, ".wd-dot");
    }

    const lb = $("#wire-lightbox");
    const lbImg = $("#wl-img");
    const lbCap = $("#wl-caption");

    function openWire(i) {
      const w = wires[i];
      if (!w) return;
      lbImg.src = w.src;
      lbImg.alt = "Wireframe: " + w.caption;
      lbCap.textContent = w.caption;
      lb.hidden = false;
      document.body.style.overflow = "hidden";
    }
    function closeWire() {
      lb.hidden = true;
      lbImg.src = "";
      document.body.style.overflow = "";
    }

    root.addEventListener("click", (e) => {
      const card = e.target.closest(".wire-card");
      if (!card) return;
      openWire(parseInt(card.dataset.wireIndex, 10));
    });

    if (lb) {
      lb.addEventListener("click", (e) => {
        if (e.target && e.target.matches("[data-wl-close]")) closeWire();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !lb.hidden) closeWire();
    });
  }

  /* ---------- deep-dive (Chapter 03) dot indicator ---------- */
  function wireDeepDive() {
    const track = $("#deepdive-track");
    const dotsRoot = $("#deepdive-dots");
    if (!track || !dotsRoot) return;
    const items = $$(".deepdive-shot", track);
    const dots = $$(".dd-dot", dotsRoot);
    if (!items.length || !dots.length) return;

    // dot click → scroll to item
    dots.forEach((dot) => {
      dot.addEventListener("click", () => {
        const i = parseInt(dot.dataset.ddIndex, 10);
        const target = items[i];
        if (!target) return;
        track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: "smooth" });
      });
    });

    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      let best = null;
      let bestRatio = 0;
      entries.forEach((e) => {
        if (e.intersectionRatio > bestRatio) {
          bestRatio = e.intersectionRatio;
          best = e.target;
        }
      });
      if (!best) return;
      const idx = items.indexOf(best);
      if (idx < 0) return;
      dots.forEach((d, i) => d.classList.toggle("is-active", i === idx));
    }, { root: track, threshold: [0.5, 0.75, 1.0] });
    items.forEach((it) => io.observe(it));
  }

  /* ---------- hard / next / learning ---------- */
  function renderHardParts(items) {
    const root = $("#hard-list");
    if (!root || !items) return;
    root.innerHTML = items.map((s) => "<li>" + escapeHTML(s) + "</li>").join("");
  }
  function renderNext(items) {
    const root = $("#next-list");
    if (!root || !items) return;
    root.innerHTML = items.map((s) => (
      '<li class="roadmap-row' + (s.tentative ? ' is-tentative' : '') + '">' +
        '<span class="rm-tag">' + escapeHTML(s.tag) + '</span>' +
        '<span class="rm-note">' + escapeHTML(s.note) + '</span>' +
      '</li>'
    )).join("");
  }
  function renderLearning(text) {
    const el = $("#learning-text");
    if (el && text) el.textContent = text;
  }

  /* ---------- flashcard flip + pull-down gesture ---------- */
  function wireFlashcard() {
    const fc = $("#flashcard-demo");
    if (!fc) return;
    const back = fc.querySelector(".fc-back");

    function flip() {
      const flipped = fc.classList.toggle("is-flipped");
      fc.setAttribute("aria-pressed", flipped ? "true" : "false");
      if (back) back.setAttribute("aria-hidden", flipped ? "false" : "true");
    }
    function reset() {
      fc.classList.remove("is-flipped");
      fc.setAttribute("aria-pressed", "false");
      if (back) back.setAttribute("aria-hidden", "true");
    }

    fc.addEventListener("click", flip);
    fc.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        flip();
      }
    });

    /* mobile pull-down gesture */
    let startY = null;
    let activePreview = false;
    const PULL_THRESHOLD = 80;
    const PULL_MAX = 120;

    fc.addEventListener("touchstart", (e) => {
      if (!isMobile()) return;
      startY = e.touches[0].clientY;
      activePreview = false;
    }, { passive: true });

    fc.addEventListener("touchmove", (e) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 8 && dy < PULL_MAX) {
        activePreview = true;
        // preview rotation on the X axis (front side); back is naturally rotated 180.
        const angle = (dy / PULL_MAX) * -60;
        fc.style.transform = (fc.classList.contains("is-flipped")
          ? `rotateY(180deg) rotateX(${angle}deg)`
          : `rotateX(${angle}deg)`);
      }
    }, { passive: true });

    fc.addEventListener("touchend", (e) => {
      if (startY === null) return;
      const dy = (e.changedTouches[0].clientY - startY);
      fc.style.transform = "";
      if (activePreview && dy > PULL_THRESHOLD) {
        flip();
      }
      startY = null;
      activePreview = false;
    });

    fc.addEventListener("touchcancel", () => {
      fc.style.transform = "";
      startY = null;
      activePreview = false;
    });

    const review = $("#fc-review");
    const got = $("#fc-got");
    if (review) review.addEventListener("click", reset);
    if (got) got.addEventListener("click", reset);
  }

  /* ---------- init ---------- */
  function init(data) {
    if (data) {
      renderModules(data.modules);
      if (data.build) {
        renderTimeline(data.build.timeline);
        renderQA(data.build.qa_stack);
        renderBuilds(data.build.builds);
      }
      renderWireframes(data.wireframes);
      renderHardParts(data.hard_parts);
      renderNext(data.whats_next);
      renderLearning(data.learning);
    }
    wireFlashcard();
    wireDeepDive();
  }

  function loadData() {
    fetch("data/app-page-content.json", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(init)
      .catch((err) => {
        console.error("App: failed to load content", err);
        // Wire the flashcard even on failure so the demo still works.
        wireFlashcard();
        wireDeepDive();
      });
  }

  document.addEventListener("DOMContentLoaded", loadData);
})();

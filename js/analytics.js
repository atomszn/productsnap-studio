/* =====================================================================
   ProductSnap Studio — lightweight, privacy-friendly analytics
   ---------------------------------------------------------------------
   This is a PRODUCT EXPERIMENT, not marketing tracking. The goal is to
   understand what visitors find interesting inside the notebook, while
   staying true to the ProductSnap Studio philosophy:
     • no cookies            • no consent banner needed
     • no UI changes         • no performance impact (deferred load)
     • no personal data      • respects Do-Not-Track / GPC

   It uses Umami Cloud (https://umami.is) — a cookieless, anonymized,
   GDPR/CCPA-friendly analytics service. The tiny (~2KB) script is loaded
   only after the page is interactive, and ONLY if the visitor has not
   asked not to be tracked.

   Custom events are wired with pure event delegation at the document
   level — so NONE of the existing page scripts (pulse.js, app.js,
   nav.js, theme.js) are touched, and no behavior changes.

   ▸ OWNER OPT-OUT (no UI): the site owner can exclude their own regular
     visits, per browser/device, with a hidden URL trigger —
         /?analytics=off  disables tracking on that browser (persisted)
         /?analytics=on   re-enables it
     The choice is stored in localStorage and remembered across visits,
     works on mobile, and is invisible to normal visitors (who stay fully
     tracked). See README "Analytics" section.

   ▸ SETUP: replace UMAMI_WEBSITE_ID below with the real website ID from
     your Umami Cloud dashboard (Settings → Websites → ⟨your site⟩). Until
     then, the script no-ops and sends nothing. That's the only change
     needed to go live. See README "Analytics" section.
   ===================================================================== */

(function () {
  "use strict";

  /* ----------------------------------------------------------------
     CONFIG — the one value to swap in after creating the Umami site.
     ---------------------------------------------------------------- */
  var UMAMI_WEBSITE_ID = "bee92859-e064-4f4c-85d9-30266343eef7";
  var UMAMI_SRC = "https://cloud.umami.is/script.js";
  // If you self-host Umami later, point UMAMI_SRC at your own script URL
  // and set a data-host-url below (left default for Umami Cloud).

  // localStorage keys. PSNAP_FLAG is our own per-browser owner switch;
  // UMAMI_FLAG is Umami's NATIVE kill switch (it refuses to send anything
  // when this is "1"/"true"), so opt-out is enforced at two layers.
  var PSNAP_FLAG = "psnap-analytics";   // "off" => excluded, "on"/unset => tracked
  var UMAMI_FLAG = "umami.disabled";    // Umami's own opt-out key

  /* ----------------------------------------------------------------
     OWNER OPT-OUT — a hidden, UI-less way for the site owner to exclude
     their OWN regular visits from analytics, per browser/device. There
     is no setting screen: you flip it once with a URL trigger and the
     choice is remembered in localStorage thereafter.

         https://productsnap.studio/?analytics=off   → stop tracking here
         https://productsnap.studio/?analytics=on    → resume tracking

     This works on mobile too (no devtools needed). It is invisible to
     normal visitors, who never see or use the parameter. After applying
     the preference we strip ?analytics= from the address bar so it never
     pollutes the tracked page URL and can't be accidentally shared.
     ---------------------------------------------------------------- */
  function safeLS() {
    // Some browsers throw on localStorage in private mode — fail open
    // (i.e. behave like a normal tracked visitor) rather than break.
    try { return window.localStorage; } catch (e) { return null; }
  }

  function applyOwnerTrigger() {
    var ls = safeLS();
    var search = location.search || "";
    if (search.indexOf("analytics=") === -1) return;
    var val = null;
    try { val = new URLSearchParams(search).get("analytics"); } catch (e) {}
    if (val !== "off" && val !== "on") return;

    if (ls) {
      try {
        if (val === "off") {
          ls.setItem(PSNAP_FLAG, "off");
          ls.setItem(UMAMI_FLAG, "1");   // Umami's native kill switch
        } else {
          ls.setItem(PSNAP_FLAG, "on");
          ls.removeItem(UMAMI_FLAG);     // re-enable Umami sending
        }
      } catch (e) {}
    }

    // Remove ONLY the analytics param, preserving any others + the hash,
    // so the tracked URL stays clean and the trigger isn't shareable.
    try {
      var url = new URL(location.href);
      url.searchParams.delete("analytics");
      var qs = url.searchParams.toString();
      var clean = url.pathname + (qs ? "?" + qs : "") + url.hash;
      history.replaceState(null, "", clean);
    } catch (e) {}
  }

  /* ----------------------------------------------------------------
     PRIVACY GATE — honor the visitor's stated tracking preference.
     Umami is already cookieless and anonymized, but we go further: if
     the browser sends Do-Not-Track or Global Privacy Control, OR the
     owner has opted this browser out, we skip analytics entirely.
     Respectful by default — the notebook way.
     ---------------------------------------------------------------- */
  function ownerExcluded() {
    var ls = safeLS();
    if (!ls) return false;
    try { return ls.getItem(PSNAP_FLAG) === "off"; } catch (e) { return false; }
  }

  function visitorOptedOut() {
    try {
      var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
      if (dnt === "1" || dnt === "yes" || dnt === true) return true;
      if (navigator.globalPrivacyControl === true) return true;
    } catch (e) {}
    return false;
  }

  // Apply any ?analytics= trigger FIRST so the preference is recorded
  // even on the visit that sets it, then enforce it on this page load.
  applyOwnerTrigger();

  // Nothing to do if not configured yet, the visitor opted out, or the
  // owner has excluded this browser. Returning here means Umami never
  // loads and no events ever fire on this device.
  var CONFIGURED = UMAMI_WEBSITE_ID && UMAMI_WEBSITE_ID.indexOf("REPLACE_WITH") === -1;
  if (ownerExcluded()) return;
  if (visitorOptedOut()) return;

  /* ----------------------------------------------------------------
     PAGE IDENTITY — friendly names so the dashboard reads like the
     notebook's chapters rather than file paths.
     ---------------------------------------------------------------- */
  var PAGE_BY_FILE = {
    "index.html": "Home",
    "":            "Home",
    "sketches.html": "Sketches",
    "app.html":   "App",
    "pulse.html": "Pulse",
    "notes.html": "Notes"
  };
  function currentFile() {
    var p = location.pathname;
    var seg = p.substring(p.lastIndexOf("/") + 1);
    // tolerate clean URLs like /pulse  ->  treat as pulse.html
    if (seg && seg.indexOf(".") === -1) seg = seg + ".html";
    return seg;
  }
  function currentPageName() {
    return PAGE_BY_FILE[currentFile()] || "Home";
  }
  var THIS_PAGE = currentPageName();

  /* ----------------------------------------------------------------
     SAFE TRACK — buffers events until the Umami script is ready, then
     flushes. Never throws; if analytics is disabled the calls are inert.
     ---------------------------------------------------------------- */
  var queue = [];
  var ready = false;

  function flush() {
    if (!ready || !window.umami) return;
    while (queue.length) {
      var ev = queue.shift();
      try { window.umami.track(ev.name, ev.data); } catch (e) {}
    }
  }

  function track(name, data) {
    if (!CONFIGURED) return; // no-op until a real website ID is set
    var payload = Object.assign({ from: THIS_PAGE }, data || {});
    if (ready && window.umami) {
      try { window.umami.track(name, payload); } catch (e) {}
    } else {
      queue.push({ name: name, data: payload });
    }
  }

  /* ----------------------------------------------------------------
     LOAD UMAMI — deferred so it never competes with first paint or the
     scroll-reveal motion. We wait until the window has fully loaded and
     the browser is idle, then inject the script.
     ---------------------------------------------------------------- */
  function loadUmami() {
    if (!CONFIGURED) return;
    var s = document.createElement("script");
    s.async = true;
    s.defer = true;
    s.src = UMAMI_SRC;
    s.setAttribute("data-website-id", UMAMI_WEBSITE_ID);
    // We fire pageviews ourselves with friendly names, so disable auto.
    s.setAttribute("data-auto-track", "false");
    // Don't track local dev / preview hosts.
    s.setAttribute("data-domains", "productsnap.studio");
    s.onload = function () {
      ready = true;
      // Manual, named pageview so the dashboard shows chapters.
      try {
        if (window.umami && window.umami.track) {
          window.umami.track(function (props) {
            return Object.assign({}, props, { name: THIS_PAGE });
          });
        }
      } catch (e) {}
      flush();
    };
    document.head.appendChild(s);
  }

  function whenIdle(fn) {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(fn, { timeout: 2500 });
    } else {
      setTimeout(fn, 1200);
    }
  }
  if (document.readyState === "complete") {
    whenIdle(loadUmami);
  } else {
    window.addEventListener("load", function () { whenIdle(loadUmami); }, { once: true });
  }

  /* ================================================================
     CUSTOM EVENTS — pure delegation. We never touch existing scripts.
     Event names are written like a product experiment: short, readable,
     and grouped so the Umami dashboard tells a story.
     ================================================================ */

  // Map an href to a friendly destination chapter (internal nav).
  function navDestFromHref(href) {
    if (!href) return null;
    var f = href.split("#")[0].split("?")[0];
    f = f.substring(f.lastIndexOf("/") + 1);
    if (f && f.indexOf(".") === -1) f = f + ".html";
    return PAGE_BY_FILE.hasOwnProperty(f) ? PAGE_BY_FILE[f] : null;
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* ---- Outbound: App Store & Google Play -------------------- */
    var storeLink = t.closest('a[href*="apps.apple.com"], a[href*="play.google.com"]');
    if (storeLink) {
      var href = storeLink.getAttribute("href") || "";
      var store = href.indexOf("apps.apple.com") > -1 ? "App Store" : "Google Play";
      track("store click", { store: store });
      track("outbound", { destination: store, kind: "app-store" });
      return;
    }

    /* ---- Outbound: any other external link (e.g. LinkedIn) ----- */
    var extLink = t.closest('a[href^="http"]');
    if (extLink) {
      var eh = extLink.getAttribute("href") || "";
      var sameOrigin = eh.indexOf(location.origin) === 0 ||
                       eh.indexOf("productsnap.studio") > -1;
      // Treat font / structured-data hosts as non-clickable noise.
      var noisy = /fonts\.(googleapis|gstatic)\.com/.test(eh);
      if (!sameOrigin && !noisy) {
        var host = "";
        try { host = new URL(eh).hostname.replace(/^www\./, ""); } catch (e2) {}
        track("outbound", { destination: host || eh, kind: "external" });
        return;
      }
    }

    /* ---- Internal navigation between chapters ----------------- */
    // Only count clicks that come from the primary nav (desktop or the
    // mobile panel) and the brand/home link, plus the footer chapter-turn.
    var navLink = t.closest('.nav-links a, .nav-panel a, .brand');
    if (navLink) {
      var dest = navDestFromHref(navLink.getAttribute("href"));
      if (dest && dest !== THIS_PAGE) {
        track("nav", { to: dest });
      }
      return;
    }
    var chapterLink = t.closest('.chapter-turn-link');
    if (chapterLink) {
      var cdest = navDestFromHref(chapterLink.getAttribute("href"));
      if (cdest) track("nav next-chapter", { to: cdest });
      return;
    }
    // Notes pinned cards link out to other chapters too — a real signal
    // that the messy-middle content earned a click.
    var pinCard = t.closest('.pin-card');
    if (pinCard) {
      var pdest = navDestFromHref(pinCard.getAttribute("href"));
      if (pdest) track("notes pinned-card", { to: pdest });
      return;
    }

    /* ---- PULSE engagement ------------------------------------- */
    if (THIS_PAGE === "Pulse") {
      // Expand/collapse a reasoning step in the Pulse Explorer. The real
      // expandable elements are the explorer chain steps and the evidence
      // chips / explore affordance — NOT the mobile nav toggle (also uses
      // aria-expanded), which we explicitly skip.
      var step = t.closest('.chain-step, .evidence-chip, .explore-signals');
      if (step) {
        // aria-expanded reflects state BEFORE this click toggles it.
        var opening = step.getAttribute("aria-expanded") === "false";
        track("pulse step", { action: opening ? "expand" : "collapse" });
        return;
      }
      // Lens switch (the "thinking layer" tabs).
      var lens = t.closest('[data-lens], .lens-tab');
      if (lens) {
        track("pulse lens", { lens: lens.getAttribute("data-lens") || "switch" });
        return;
      }
      // Sources modal — visitor is checking the receipts.
      if (t.closest('#px-sources-btn, [data-sources], .sources-btn')) {
        track("pulse sources", { action: "open" });
        return;
      }
      // Pick a category or a specific signal.
      var cat = t.closest('[data-category]');
      if (cat) {
        track("pulse category", { category: cat.getAttribute("data-category") });
        return;
      }
      var sig = t.closest('[data-signal]');
      if (sig) {
        track("pulse signal", { signal: sig.getAttribute("data-signal") });
        return;
      }
    }

    /* ---- THEME toggle (Late Night Mode) ----------------------- */
    var themeBtn = t.closest('.theme-toggle');
    if (themeBtn) {
      // aria-pressed reflects state BEFORE the toggle flips it.
      var goingDark = themeBtn.getAttribute("aria-pressed") === "false";
      track("theme toggle", { to: goingDark ? "dark" : "light" });
      return;
    }
  }, true); // capture phase: read aria state before page handlers flip it

  /* ----------------------------------------------------------------
     NOTES engagement — a quiet read-depth signal. Notes is mostly a
     reading page; the meaningful question is "did people actually read
     the messy middle?" We fire ONE event per visit when they pass 60%
     scroll depth. No scroll spam, no timers running forever.
     ---------------------------------------------------------------- */
  if (THIS_PAGE === "Notes") {
    var firedDepth = false;
    function onScroll() {
      if (firedDepth) return;
      var doc = document.documentElement;
      var scrolled = window.scrollY + window.innerHeight;
      var pct = scrolled / doc.scrollHeight;
      if (pct >= 0.6) {
        firedDepth = true;
        track("notes read-depth", { reached: "60%" });
        window.removeEventListener("scroll", onScroll);
      }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
  }
})();

/* Seasonal layer: one switch, retires itself.
   Winter (no holiday names, the audience is global): a warmer evening palette,
   a lamp glow, frost on the shelf planks, gentle snow over the Pulse shelves
   (with an off switch, never under reduced motion) and a "Year in review" shelf.
   To turn it off early set on:false. After `end` it does nothing at all.
   QA override: ?season=on or ?season=off in the URL. */
(function () {
  "use strict";
  var SEASON = {
    on: true,
    name: "winter",
    start: "2026-11-20",          /* first day, local date */
    end: "2027-01-06",            /* first day it is OFF again */
    bestTitle: "Year in review: best of 2026",
    bestSub: "Our picks from this year's shelves, two per topic.",
    best: ["ai-compute", "ai-agents", "nuclear-for-ai", "how-humanoid-robots-work",
           "stablecoins", "fintech-rails", "inflation", "dollar-gold-yen"]
  };
  function today() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  var t = today(), q = (location.search.match(/[?&]season=(on|off)\b/) || [])[1];
  SEASON.active = q ? q === "on" : (SEASON.on && t >= SEASON.start && t < SEASON.end);
  window.PSNAP_SEASON = SEASON;
  if (!SEASON.active) return;
  document.documentElement.setAttribute("data-season", SEASON.name);

  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)");
  var KEY = "psnap-snow";

  function ready(fn) { if (document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function () {
    /* homepage: surface the seasonal shelf next to the Pulse proof */
    var yir = document.querySelector(".pf-yir"); if (yir) yir.hidden = false;
    if (!document.body.classList.contains("page-pulse")) return;
    initSnow();
  });

  /* ---------- snow over the Pulse shelves only ---------- */
  function initSnow() {
    var hero = document.getElementById("lib-hero"), host = document.getElementById("shelves");
    if (!hero || !host) return;
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "snow-toggle"; btn.id = "snow-toggle";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/></svg><span class="snow-l"></span>';
    hero.appendChild(btn);

    var on = false, raf = 0, last = 0, flakes = [], W = 0, H = 0, dpr = 1, visible = true;
    var cv = document.createElement("canvas"); cv.className = "snow-canvas"; cv.setAttribute("aria-hidden", "true");
    var ctx = cv.getContext("2d");

    function pref() { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } }
    function label() {
      var allowed = !(reduce && reduce.matches);
      btn.hidden = !allowed;
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.querySelector(".snow-l").textContent = on ? "Snow on" : "Snow off";
      btn.setAttribute("aria-label", on ? "Snow is on. Turn snow off" : "Snow is off. Turn snow on");
    }
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      W = innerWidth; H = innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var n = Math.min(70, Math.max(14, Math.round(W * H / 22000)));
      while (flakes.length < n) flakes.push(flake(true));
      flakes.length = n;
    }
    function flake(anywhere) {
      return { x: Math.random() * W, y: anywhere ? Math.random() * H : -6, r: 1 + Math.random() * 1.9,
               v: 14 + Math.random() * 26, a: Math.random() * 6.28, w: .4 + Math.random() * .8 };
    }
    function clipRect() {
      var r = host.getBoundingClientRect(), lh = host.querySelector(".lib-h"), top = lh ? lh.getBoundingClientRect().top : r.top;
      var bar = document.getElementById("lib-bar");
      if (bar) { var b = bar.getBoundingClientRect(); if (b.top <= 1) top = Math.max(top, b.bottom); }
      return { x: r.left, y: Math.max(0, top), w: r.width, h: Math.min(H, r.bottom) - Math.max(0, top) };
    }
    function frame(ts) {
      raf = 0;
      if (!on || document.hidden || document.body.classList.contains("reading") || document.body.classList.contains("searching")) { ctx.clearRect(0, 0, cv.width, cv.height); return; }
      var dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016); last = ts;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var c = clipRect();
      if (visible && c.h > 0) {
        var dark = document.documentElement.getAttribute("data-theme") === "dark";
        ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
        ctx.fillStyle = dark ? "rgba(255,255,255,.78)" : "rgba(255,255,255,.95)";
        ctx.strokeStyle = dark ? "rgba(255,255,255,0)" : "rgba(120,140,170,.45)";
        ctx.lineWidth = .8;
        for (var i = 0; i < flakes.length; i++) {
          var f = flakes[i];
          f.y += f.v * dt; f.a += f.w * dt; f.x += Math.sin(f.a) * 8 * dt;
          if (f.y > H + 6) { flakes[i] = flake(false); continue; }
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill(); if (!dark) ctx.stroke();
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf && on) { last = 0; raf = requestAnimationFrame(frame); } }
    function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, cv.width, cv.height); }
    function apply() {
      on = pref() && !(reduce && reduce.matches);
      if (on) { if (!cv.parentNode) document.body.appendChild(cv); size(); start(); }
      else { stop(); if (cv.parentNode) cv.parentNode.removeChild(cv); }
      label();
    }
    btn.addEventListener("click", function () {
      try { localStorage.setItem(KEY, on ? "off" : "on"); } catch (e) {}
      apply();
    });
    addEventListener("resize", function () { if (on) size(); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) start(); });
    if (reduce && reduce.addEventListener) reduce.addEventListener("change", apply);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) start(); }).observe(host);
    /* reader closes / search clears: body class changes, so wake the loop */
    new MutationObserver(function () { start(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    apply();
  }
})();

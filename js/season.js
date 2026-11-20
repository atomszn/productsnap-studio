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
    if (document.body.classList.contains("page-pulse")) initSnow();
    else initHeroSnow();
  });

  /* ---------- snowflakes: real six-point crystals, pre-drawn once per theme ---------- */
  var SPRITE = 64, sprites = {};
  function crystal(c, design, outline) {
    /* one arm drawn six times, rotated 60deg each; design picks the branch pattern */
    var R = SPRITE * 0.42;
    c.save(); c.translate(SPRITE / 2, SPRITE / 2);
    for (var k = 0; k < 6; k++) {
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -R);
      if (design === 0) { c.moveTo(0, -R * .55); c.lineTo(-R * .26, -R * .78); c.moveTo(0, -R * .55); c.lineTo(R * .26, -R * .78); }
      if (design === 1) { [.38, .66].forEach(function (p) { var b = R * (p < .5 ? .24 : .18); c.moveTo(0, -R * p); c.lineTo(-b, -R * p - b); c.moveTo(0, -R * p); c.lineTo(b, -R * p - b); }); }
      if (design === 2) { c.moveTo(0, -R * .78); c.lineTo(-R * .16, -R); c.moveTo(0, -R * .78); c.lineTo(R * .16, -R); c.moveTo(-R * .2, -R * .34); c.lineTo(R * .2, -R * .34); }
      if (design === 3) { c.moveTo(0, -R * .3); c.lineTo(-R * .18, -R * .46); c.moveTo(0, -R * .3); c.lineTo(R * .18, -R * .46); c.moveTo(0, -R * .62); c.lineTo(-R * .3, -R * .86); c.moveTo(0, -R * .62); c.lineTo(R * .3, -R * .86); }
      c.stroke(); c.rotate(Math.PI / 3);
    }
    if (design === 2) { c.beginPath(); for (var h = 0; h < 6; h++) { var a = h * Math.PI / 3; c[h ? "lineTo" : "moveTo"](Math.sin(a) * R * .22, -Math.cos(a) * R * .22); } c.closePath(); c.stroke(); }
    c.restore();
  }
  function getSprites(dark) {
    var key = dark ? "d" : "l"; if (sprites[key]) return sprites[key];
    var out = [];
    for (var d = 0; d < 4; d++) {
      var cv = document.createElement("canvas"); cv.width = cv.height = SPRITE;
      var c = cv.getContext("2d"); c.lineCap = "round"; c.lineJoin = "round";
      if (dark) { c.shadowColor = "rgba(190,215,255,.9)"; c.shadowBlur = 5; c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 3.4; crystal(c, d); }
      else {
        c.strokeStyle = "rgba(66,92,138,.85)"; c.lineWidth = 7; crystal(c, d);     /* soft slate outline so white reads on cream paper */
        c.strokeStyle = "#ffffff"; c.lineWidth = 3.2; crystal(c, d);
      }
      out.push(cv);
    }
    return (sprites[key] = out);
  }
  /* depth: far flakes are small, faint and slow; near ones are bigger, brighter, faster */
  function makeFlake(W, H, phone, anywhere) {
    var z = Math.random(), layer = z < .5 ? 0 : z < .85 ? 1 : 2;
    var size = [[9, 12], [13, 17], [19, 26]][layer], s = size[0] + Math.random() * (size[1] - size[0]);
    if (phone) s *= 1.12;
    return { x: Math.random() * W, y: anywhere ? Math.random() * H : -s, s: s, d: (Math.random() * 4) | 0,
             o: [.5, .78, .95][layer] - Math.random() * .12, v: [12, 20, 30][layer] + Math.random() * 10,
             a: Math.random() * 6.28, w: .35 + Math.random() * .6, sway: 6 + layer * 5,
             rot: Math.random() * 6.28, spin: (Math.random() - .5) * (.5 + layer * .25) };
  }
  function drawFlakes(ctx, list, dark, dt, W, H, phone, fade) {
    var sp = getSprites(dark);
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      if (dt) { f.y += f.v * dt; f.a += f.w * dt; f.x += Math.sin(f.a) * f.sway * dt; f.rot += f.spin * dt; }
      if (f.y > H + f.s) { list[i] = makeFlake(W, H, phone, false); continue; }
      var alpha = f.o * (fade ? Math.max(0, 1 - f.y / H) * 1.25 : 1); if (alpha <= 0.02) continue;
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
      ctx.drawImage(sp[f.d], -f.s / 2, -f.s / 2, f.s, f.s); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }

  /* ---------- homepage: a light flurry across the top of the hero only ---------- */
  function initHeroSnow() {
    var hero = document.querySelector(".pf-hero"); if (!hero) return;
    var cv = document.createElement("canvas"); cv.className = "hero-snow"; cv.setAttribute("aria-hidden", "true");
    hero.insertBefore(cv, hero.firstChild);
    var ctx = cv.getContext("2d"), flakes = [], W = 0, H = 0, dpr = 1, raf = 0, last = 0, visible = true, phone = false;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = hero.clientWidth; phone = W < 600; H = Math.min(hero.clientHeight, phone ? 420 : 380);
      cv.style.height = H + "px"; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var n = phone ? 16 : 26;
      while (flakes.length < n) flakes.push(makeFlake(W, H, phone, true));
      flakes.length = n;
    }
    function paint(dt) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); drawFlakes(ctx, flakes, isDark(), dt, W, H, phone, true); }
    function frame(ts) {
      raf = 0; if (!visible || document.hidden) return;
      var dt = Math.min(.05, last ? (ts - last) / 1000 : .016); last = ts; paint(dt);
      raf = requestAnimationFrame(frame);
    }
    function moving() { return !(reduce && reduce.matches); }
    function start() { if (moving() && !raf && visible) { last = 0; raf = requestAnimationFrame(frame); } else if (!moving()) paint(0); }
    size(); start();
    addEventListener("resize", function () { size(); if (!moving()) paint(0); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) start(); });
    new MutationObserver(function () { if (!moving()) paint(0); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (reduce && reduce.addEventListener) reduce.addEventListener("change", start);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) start(); }).observe(hero);
  }

  /* ---------- Pulse: snow over the library (off switch; never under reduced motion) ---------- */
  function initSnow() {
    var hero = document.getElementById("lib-hero"), host = document.getElementById("shelves");
    if (!hero || !host) return;
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "snow-toggle"; btn.id = "snow-toggle";
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/></svg><span class="snow-l"></span>';
    hero.appendChild(btn);

    var on = false, raf = 0, last = 0, flakes = [], W = 0, H = 0, dpr = 1, visible = true, phone = false;
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
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight; phone = W < 600;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var n = phone ? 30 : Math.min(48, Math.max(24, Math.round(W * H / 30000)));
      while (flakes.length < n) flakes.push(makeFlake(W, H, phone, true));
      flakes.length = n;
    }
    function clipRect() {
      var lib = document.getElementById("lib") || host, r = lib.getBoundingClientRect(), top = r.top;
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
        ctx.save(); ctx.beginPath(); ctx.rect(c.x, c.y, c.w, c.h); ctx.clip();
        drawFlakes(ctx, flakes, isDark(), dt, W, H, phone, false);
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

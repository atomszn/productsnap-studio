/* Pulse signature "open book" moments, one per shelf (Frontier Tech, Macro, Fintech; AI keeps the plain open).
   cover(book, topic, info): puts a closed cloth cover over the book the moment it opens (so the shelf morph lands on it).
   play(): the shelf's moment plays ACROSS the whole cover (rocket streaks across it, coins rain into a full-width chart,
           a card rides a subway map), then the cover swings open onto the 60-second page. Under ~1.15s in all.
   burst(el, topic): a ~250ms flourish over a tapped spine or cover on the shelf.
   Any tap, key, wheel or route change skips (120ms fade). Nothing is ever created under prefers-reduced-motion.
   The cover never stays once reading starts: it removes itself when it ends, is skipped, or the book closes.
   Pure SVG + Web Animations API, no libraries. */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var mq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var live = null, macroFlip = 0;
  var SCENE_MS = 820, OPEN_MS = 320; // scene, then the cover swings open: 1140ms
  function S(tag, attrs, parent) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; }
  function A(node, frames, opts) { var a = node.animate(frames, opts); if (live) live.anims.push(a); return a; }
  function box(n, x, y) { n.style.transformBox = "view-box"; n.style.transformOrigin = x + "px " + y + "px"; }
  function sketch(g, d, cls, w) { // the same line drawn twice, the second a hair off and thinner, like a pen going over it again
    var p1 = S("path", { d: d, "class": cls || "sg-ink", "stroke-width": w || 2 }, g);
    var p2 = S("path", { d: d, "class": (cls || "sg-ink") + " sg-ghost", "stroke-width": (w || 2) * 0.5, transform: "translate(1.4 -1.1)" }, g);
    return [p1, p2];
  }
  function drawOn(paths, delay, dur, easing) {
    paths.forEach(function (p) {
      var L = p.getTotalLength(); p.style.strokeDasharray = L + " " + L; p.style.strokeDashoffset = L;
      A(p, [{ strokeDashoffset: L }, { strokeDashoffset: 0 }], { duration: dur, delay: delay, easing: easing || "cubic-bezier(.3,.7,.3,1)", fill: "both" });
    });
  }
  function pop(n, delay, dur) { A(n, [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1.18)", offset: .6 }, { opacity: 1, transform: "scale(1)" }], { duration: dur || 220, delay: delay, easing: "ease-out", fill: "both" }); }
  function puffD(x, y, s) { // a lumpy hand-drawn cloud
    return "M" + (x - s) + " " + y + " c " + (-s * .2) + " " + (-s * .9) + " " + (s * .7) + " " + (-s * 1.2) + " " + (s * .9) + " " + (-s * .5) +
      " c " + (s * .3) + " " + (-s * .8) + " " + (s * 1.3) + " " + (-s * .4) + " " + (s * 1.1) + " " + (s * .4) +
      " c " + (s * .7) + " " + (s * .1) + " " + (s * .6) + " " + (s * 1.1) + " " + (-s * .2) + " " + (s * 1.1) +
      " c " + (-s * .5) + " " + (s * .3) + " " + (-s * 1.4) + " " + (s * .3) + " " + (-s * 1.8) + " " + (-s * .1) + " z";
  }
  function rocketShape(parent, s) {
    var r = S("g", { "class": "sg-rocket" }, parent), body = S("g", { transform: "scale(" + s + ")" }, r);
    var flame = S("path", { d: "M-14 -3.4 C -22 -2, -28 0, -33 0 C -28 0, -22 2, -14 3.4 Z", "class": "sg-flame" }, body);
    S("path", { d: "M-13 -5 C -4 -8.5, 8 -7.5, 16 0 C 8 7.5, -4 8.5, -13 5 Z", "class": "sg-body" }, body);
    S("path", { d: "M-12 -5 L -19 -12 L -7 -6.5 M -12 5 L -19 12 L -7 6.5", "class": "sg-ink sg-fin", "stroke-width": 1.8 }, body);
    S("circle", { cx: 3.5, cy: 0, r: 2.8, "class": "sg-window" }, body);
    flame.style.transformBox = "fill-box"; flame.style.transformOrigin = "100% 50%";
    return { g: r, flame: flame };
  }
  function along(path, n) { // keyframes that fly a shape along a path, nose first
    var L = path.getTotalLength(), K = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, p = path.getPointAtLength(t * L), q = path.getPointAtLength(Math.min(L, t * L + 1)), p0 = path.getPointAtLength(Math.max(0, t * L - 1));
      K.push({ transform: "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) rotate(" + (Math.atan2(q.y - p0.y, q.x - p0.x) * 180 / Math.PI).toFixed(1) + "deg)", offset: t });
    }
    return K;
  }

  /* ---------- Frontier Tech: stars wink on, a rocket lifts off the bottom of the cover and streaks out the top corner ---------- */
  function rocket(svg, W, H) {
    var g = S("g", {}, svg);
    for (var i = 0; i < 16; i++) { // a star field across the art area
      var x = 16 + ((i * 97) % 268), y = H * .36 + ((i * 61) % Math.round(H * .5)), st = S("path", { d: "M" + x + " " + (y - 4) + " l1.3 2.7 2.7 1.3 -2.7 1.3 -1.3 2.7 -1.3 -2.7 -2.7 -1.3 2.7 -1.3z", "class": "sg-star" }, g);
      box(st, x, y); pop(st, 20 + (i % 8) * 34, 200);
    }
    var trail = "M24 " + (H - 26) + " C 70 " + (H - 40) + ", 120 " + (H * .72) + ", 160 " + (H * .55) + " S 250 " + (H * .2) + ", 360 " + (-80);
    var smoke = sketch(g, trail, "sg-smoke", 7);
    var puffs = [[.06, 16], [.15, 20], [.26, 22], [.38, 20], [.5, 18], [.62, 15]];
    var guide = S("path", { d: trail, fill: "none", stroke: "none" }, svg), L = guide.getTotalLength();
    var pz = puffs.map(function (c) { var p = guide.getPointAtLength(c[0] * L * 1.25), q = S("path", { d: puffD(p.x, p.y, c[1]), "class": "sg-puff" }, g); box(q, p.x, p.y); return q; });
    var r = rocketShape(svg, 2.6), D = 700, EZ = "cubic-bezier(.5,.02,.8,.5)"; // slow lift-off, then away
    A(r.g, along(guide, 32), { duration: D, delay: 60, easing: EZ, fill: "both" });
    smoke.forEach(function (p) { var l = p.getTotalLength(); p.style.strokeDasharray = l + " " + l; A(p, [{ strokeDashoffset: l }, { strokeDashoffset: 0 }], { duration: D, delay: 60, easing: EZ, fill: "both" }); });
    A(r.flame, [{ transform: "scaleX(.7)" }, { transform: "scaleX(1.35)" }, { transform: "scaleX(.85)" }, { transform: "scaleX(1.4)" }], { duration: 160, iterations: 5 });
    pz.forEach(function (q, k) { pop(q, 60 + D * Math.pow(puffs[k][0] * 1.25, .62), 240); });
    A(g, [{ opacity: 1 }, { opacity: .55 }], { duration: 200, delay: 640, easing: "ease-in", fill: "both" });
  }

  /* ---------- Macro A: coins rain down and stack into a full-width bar chart, then a trend arrow sweeps over it ---------- */
  function coins(svg, W, H) {
    var g = S("g", {}, svg), base = H - 34, cols = [42, 96, 150, 204, 258], hts = [2, 3, 5, 6, 8], n = 0, gap = 17;
    drawOn(sketch(g, "M14 " + (base + 2) + " C 100 " + (base + 4) + ", 200 " + base + ", 288 " + (base + 2), "sg-ink", 2.6), 0, 260);
    cols.forEach(function (cx, c) {
      for (var j = 0; j < hts[c]; j++) {
        var y = base - 9 - j * gap, coin = S("g", { "class": "sg-coin" }, g);
        S("path", { d: "M" + (cx - 22) + " " + y + " v6 a22 7 0 0 0 44 0 v-6", "class": "sg-coin-edge" }, coin);
        S("ellipse", { cx: cx, cy: y, rx: 22, ry: 7, "class": "sg-coin-face" }, coin);
        S("path", { d: "M" + (cx - 6) + " " + (y - .5) + " h12", "class": "sg-ink", "stroke-width": 1.6 }, coin);
        var d0 = 20 + n * 21;
        A(coin, [{ transform: "translateY(" + (-(y + 40)) + "px) rotate(" + (n % 2 ? 9 : -9) + "deg)", opacity: 0, easing: "cubic-bezier(.5,0,1,.6)" },
                 { transform: "translateY(0) rotate(0deg)", opacity: 1, offset: .74, easing: "ease-out" }, { transform: "translateY(-5px)", offset: .87, easing: "ease-in" }, { transform: "translateY(0)", opacity: 1 }],
                 { duration: 300, delay: d0, fill: "both" });
        box(coin, cx, y); n++;
      }
    });
    var top = function (k) { return base - 9 - (k - 1) * gap - 30; };
    var tr = "M" + (cols[0] - 14) + " " + top(2) + " C 90 " + top(3) + ", 130 " + top(4.6) + ", 165 " + top(5.4) + " S 235 " + top(7) + ", 276 " + (top(8) - 24);
    drawOn(sketch(g, tr, "sg-accent", 3.4), 540, 240);
    drawOn(sketch(g, "M260 " + (top(8) - 30) + " L 277 " + (top(8) - 25) + " L 270 " + (top(8) - 8), "sg-accent", 3.4), 770, 60, "linear");
  }
  /* ---------- Macro B (alternate opens): an oil drop falls the height of the cover, the splash ripples out and becomes a rising price line ---------- */
  function oil(svg, W, H) {
    var g = S("g", {}, svg), cx = 110, sy = H - 70;
    drawOn(sketch(g, "M14 " + sy + " C 100 " + (sy + 2) + ", 200 " + (sy - 2) + ", 288 " + sy, "sg-ink", 2.6), 0, 240);
    var drop = S("path", { d: "M0 -26 C 7 -14, 16 -3, 16 7 A 16 16 0 0 1 -16 7 C -16 -3, -7 -14, 0 -26 Z", "class": "sg-oil" }, g);
    A(drop, [{ transform: "translate(" + cx + "px," + (H * .3) + "px) scale(.8,1)", opacity: .3 }, { transform: "translate(" + cx + "px," + (sy - 22) + "px) scale(.9,1.15)", opacity: 1, offset: .85 }, { transform: "translate(" + cx + "px," + (sy - 8) + "px) scale(1.6,.4)", opacity: 0 }], { duration: 340, delay: 20, easing: "cubic-bezier(.55,0,1,.6)", fill: "both" });
    [0, 1, 2].forEach(function (k) {
      var e = S("ellipse", { cx: cx, cy: sy, rx: 8, ry: 3, "class": "sg-ink sg-ring" }, g);
      A(e, [{ rx: 6, ry: 2, opacity: 1 }, { rx: 70 + k * 40, ry: 12 + k * 5, opacity: 0 }], { duration: 460, delay: 340 + k * 80, easing: "ease-out", fill: "both" });
    });
    var price = sketch(g, "M" + cx + " " + sy + " l 22 -24 l 18 12 l 24 -40 l 20 14 l 26 -56 l 22 10 l 24 -48", "sg-accent", 3.4);
    drawOn(price, 470, 300, "cubic-bezier(.3,.6,.4,1)");
    var dot = S("circle", { cx: cx + 156, cy: sy - 132, r: 6, "class": "sg-dot" }, g); box(dot, cx + 156, sy - 132); pop(dot, 760, 160);
  }

  /* ---------- Fintech: a card swipes in, the payment rides a big subway map across the cover to the shop, which ticks ---------- */
  function swipe(svg, W, H) {
    var g = S("g", {}, svg), y0 = H - 60, y1 = H * .6, y2 = H * .42;
    var line = "M40 " + y0 + " L 120 " + y0 + " L 170 " + (y1) + " L 230 " + y1 + " L 262 " + (y2);
    drawOn(sketch(g, "M20 " + (y1 + 28) + " L 300 " + (y1 + 28), "sg-line sg-line2", 6), 40, 300, "ease-out"); // a second line crossing, like a real map
    drawOn(sketch(g, "M196 " + (H * .34) + " L 196 " + (H - 20), "sg-line sg-line3", 6), 90, 300, "ease-out");
    var rails = sketch(g, line, "sg-line", 9); drawOn(rails, 60, 320, "ease-out");
    [[120, y0], [170, y1], [230, y1]].forEach(function (s, k) { var c = S("circle", { cx: s[0], cy: s[1], r: 9, "class": "sg-stop" }, g); box(c, s[0], s[1]); pop(c, 160 + k * 80, 200); });
    var shop = S("g", { "class": "sg-shop" }, g); // the shop at the end of the line
    S("path", { d: "M244 " + (y2 - 4) + " h40 v-30 h-40 z M240 " + (y2 - 34) + " l6 -14 h36 l6 14 z", "class": "sg-shopface" }, shop);
    S("path", { d: "M258 " + (y2 - 4) + " v-16 h12 v16", "class": "sg-ink", "stroke-width": 2 }, shop);
    box(shop, 264, y2 - 20); pop(shop, 280, 220);
    var card = S("g", { "class": "sg-card" }, svg);
    S("rect", { x: -34, y: -22, width: 68, height: 44, rx: 6, "class": "sg-cardface" }, card);
    S("path", { d: "M-34 -9 H 34", "class": "sg-ink", "stroke-width": 5 }, card);
    S("rect", { x: -24, y: 4, width: 13, height: 10, rx: 2, "class": "sg-chip" }, card);
    A(card, [{ transform: "translate(-60px," + (y0 - 30) + "px) rotate(-18deg)", opacity: 0 }, { transform: "translate(52px," + (y0 - 30) + "px) rotate(-4deg)", opacity: 1, offset: .55 }, { transform: "translate(46px," + (y0 - 30) + "px) rotate(0deg)", opacity: 1 }],
      { duration: 300, delay: 0, easing: "cubic-bezier(.2,.9,.3,1.2)", fill: "both" });
    A(card, [{ opacity: 1 }, { opacity: .35 }], { duration: 200, delay: 420, fill: "forwards" });
    var guide = S("path", { d: line, fill: "none", stroke: "none" }, svg);
    var pay = S("g", { "class": "sg-pay" }, svg); S("circle", { r: 12, "class": "sg-paydot" }, pay); S("path", { d: "M-4 -5 h6 a3 3 0 0 1 0 6 h-4 a3 3 0 0 0 0 6 h6 M0 -8 v16", "class": "sg-tick", "stroke-width": 1.8 }, pay);
    A(pay, along(guide, 24), { duration: 440, delay: 300, easing: "cubic-bezier(.45,.05,.4,1)", fill: "both" });
    A(pay, [{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: 1, offset: .9 }, { opacity: 0 }], { duration: 480, delay: 290, fill: "both" });
    var ok = S("path", { d: "M252 " + (y2 - 58) + " l9 9 l17 -20", "class": "sg-okmark", "stroke-width": 5 }, g); drawOn([ok], 730, 140, "ease-out");
  }

  var PLAY = { "Frontier Tech": rocket, "Macro": null, "Fintech": swipe };
  function sceneFor(topic) { if (topic === "Macro") return (macroFlip++ % 2) ? oil : coins; return PLAY[topic]; }
  function has(topic) { return topic === "Macro" || !!PLAY[topic]; }

  function onSkip(e) { if (!live) return; if (e && e.type === "keydown" && /^(Shift|Control|Alt|Meta)$/.test(e.key)) return; finish(true); }
  function unhook() { removeEventListener("pointerdown", onSkip, true); removeEventListener("keydown", onSkip, true); removeEventListener("wheel", onSkip, true); removeEventListener("hashchange", onSkip); }
  function finish(skipped) {
    var L = live; if (!L) return; live = null; unhook(); clearTimeout(L.timer);
    L.anims.forEach(function (a) { try { a.pause(); } catch (e) {} });
    if (!skipped) { L.el.remove(); return; }
    var f = L.el.animate([{ opacity: getComputedStyle(L.el).opacity }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
    f.onfinish = function () { L.el.remove(); }; setTimeout(function () { L.el.remove(); }, 200);
  }
  /* cover(): the closed cover. Call it while the reader opens, before any page text is visible. */
  function cover(book, topic, info) {
    finish(false);
    if (!book || !has(topic) || mq.matches || !Element.prototype.animate) return false;
    var el = document.createElement("div"); el.className = "sg-cover cloth " + (info.cls || ""); el.setAttribute("aria-hidden", "true");
    var t = document.createElement("div"); t.className = "sgc-text";
    var k = document.createElement("span"); k.className = "sgc-k"; k.textContent = topic; t.appendChild(k);
    var h = document.createElement("span"); h.className = "sgc-t"; h.textContent = info.title; t.appendChild(h);
    el.appendChild(t);
    var hint = document.createElement("span"); hint.className = "sgc-skip"; hint.textContent = "Tap to skip"; el.appendChild(hint);
    book.appendChild(el);
    live = { el: el, anims: [], topic: topic, book: book };
    addEventListener("pointerdown", onSkip, true); addEventListener("keydown", onSkip, true); addEventListener("wheel", onSkip, { capture: true, passive: true }); addEventListener("hashchange", onSkip);
    live.timer = setTimeout(function () { finish(true); }, 4000); // safety: never strand a cover
    return true;
  }
  /* play(): the scene across the cover, then the cover swings open. Returns the total ms (0 if nothing plays). */
  function play() {
    var L = live; if (!L || L.playing) return 0; L.playing = true; clearTimeout(L.timer);
    var r = L.el.getBoundingClientRect(); if (r.width < 60 || document.hidden) { finish(false); return 0; }
    var W = 300, H = Math.round(300 * r.height / r.width);
    var svg = S("svg", { viewBox: "0 0 " + W + " " + H, preserveAspectRatio: "xMidYMid slice", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "class": "sgc-art" }, L.el);
    sceneFor(L.topic)(svg, W, H);
    A(L.el, [{ transform: "perspective(1400px) rotateY(0deg)", opacity: 1 }, { transform: "perspective(1400px) rotateY(-28deg)", opacity: 1, offset: .45 }, { transform: "perspective(1400px) rotateY(-96deg)", opacity: 0 }],
      { duration: OPEN_MS, delay: SCENE_MS, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "both" });
    L.timer = setTimeout(function () { finish(false); }, SCENE_MS + OPEN_MS + 30);
    return SCENE_MS + OPEN_MS;
  }

  /* burst(): a quick flourish over a tapped spine/cover on the shelf (~250ms), fixed-position, never takes taps */
  function burst(el, topic) {
    if (!el || !has(topic) || mq.matches || !Element.prototype.animate) return 0;
    var r = el.getBoundingClientRect(), pad = 46, w = r.width + pad * 2, h = Math.min(r.height, 220) + pad;
    var host = document.createElement("div"); host.className = "sg-burst " + (el.className.match(/\bt-[a-z-]+/) || [""])[0]; host.setAttribute("aria-hidden", "true");
    host.style.left = (r.left - pad) + "px"; host.style.top = (r.top - pad) + "px"; host.style.width = w + "px"; host.style.height = h + "px";
    var svg = S("svg", { viewBox: "0 0 " + w + " " + h, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }, host);
    document.body.appendChild(host);
    var cx = w / 2, top = pad, an = [];
    var go = function (n, f, o) { an.push(n.animate(f, o)); };
    if (topic === "Frontier Tech") {
      var rk = rocketShape(svg, 1.3); go(rk.g, [{ transform: "translate(" + cx + "px," + (top + 40) + "px) rotate(-90deg)", opacity: 0 }, { transform: "translate(" + cx + "px," + (top + 10) + "px) rotate(-90deg)", opacity: 1, offset: .25 }, { transform: "translate(" + (cx + 14) + "px," + (-30) + "px) rotate(-80deg)", opacity: 0 }], { duration: 300, easing: "cubic-bezier(.5,0,.9,.5)", fill: "both" });
      var tr = S("path", { d: "M" + cx + " " + (top + 46) + " L " + (cx + 8) + " " + (top - 20), "class": "sg-smoke", "stroke-width": 4 }, svg); var l = tr.getTotalLength(); tr.style.strokeDasharray = l; go(tr, [{ strokeDashoffset: l, opacity: 1 }, { strokeDashoffset: 0, opacity: .8, offset: .6 }, { strokeDashoffset: 0, opacity: 0 }], { duration: 320, fill: "both" });
    } else if (topic === "Macro") {
      [-18, 0, 18].forEach(function (dx, i) { var c = S("ellipse", { cx: 0, cy: 0, rx: 9, ry: 3.2, "class": "sg-coin-face" }, svg); go(c, [{ transform: "translate(" + cx + "px," + (top + 20) + "px)", opacity: 0 }, { transform: "translate(" + (cx + dx * 1.6) + "px," + (top - 18 - i % 2 * 10) + "px)", opacity: 1, offset: .5 }, { transform: "translate(" + (cx + dx * 2) + "px," + (top - 6) + "px)", opacity: 0 }], { duration: 300, delay: i * 25, easing: "ease-out", fill: "both" }); });
    } else {
      [0, 1, 2].forEach(function (i) { var p = S("path", { d: "M" + (cx - 30) + " " + (top - 6 + i * 9) + " h" + (40 - i * 8), "class": "sg-line", "stroke-width": 3.4 }, svg); var l = p.getTotalLength(); p.style.strokeDasharray = l; go(p, [{ strokeDashoffset: l, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: .5 }, { strokeDashoffset: -l, opacity: 0 }], { duration: 280, delay: i * 30, fill: "both" }); });
    }
    setTimeout(function () { host.remove(); }, 380);
    return 220;
  }

  window.PulseSig = {
    has: has, cover: cover, play: play, burst: burst,
    stop: function () { finish(false); }, nextMacro: function () { macroFlip++; }, // nextMacro: QA only (shows the other Macro variant) playing: function () { return !!live; },
    // QA helper (screenshots): freeze every animation at t ms after play() started
    seek: function (t) { if (!live) return false; clearTimeout(live.timer); live.anims.forEach(function (a) { a.pause(); a.currentTime = t; }); return true; }
  };
})();

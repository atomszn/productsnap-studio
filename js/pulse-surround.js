/* Book surroundings.
   When a book is open, the reader field borrows that book's paper and a quiet
   texture. Palette text in library.json wins (hex codes, then a few colour
   words). Otherwise a small table sampled once from each book's first page
   (no image work while reading). Anything we can't read stays on the usual
   topic paper. Controls are not recoloured here. */
(function (factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.PulseSurround = api;
})(function () {
  "use strict";
  /* paper, line, wash. Sampled from the first-page thumbnail, light pixels for
     the sheet and the two strongest inks for the wash. */
  var ART = {
    "ai-basics": ["#F5F5F3", "#D8B05C", "#2F496D"],
    "ai-wrong": ["#EEE2C9", "#C9B38E", "#C9B38E"],
    "using-ai": ["#F8F5EA", "#CF6C5E", "#C99537"],
    "searching-ai": ["#F1E7D3", "#B19877", "#B19877"],
    "jobs-school": ["#F5EDDD", "#80493E", "#80493E"],
    "deepfakes": ["#F4F3F6", "#90B550", "#9C81C9"],
    "privacy": ["#F4EDDD", "#8E7048", "#8E7048"],
    "health": ["#E8F2EF", "#99CDBF", "#29436B"],
    "ai-agents": ["#F5EFE1", "#C5AB84", "#C5AB84"],
    "agent-built": ["#F4F1E8", "#A58458", "#A58458"],
    "ai-shopping": ["#F8F4EF", "#CF7136", "#CF7136"],
    "what-powers-ai": ["#F2F5F5", "#76B3C3", "#C5AB1B"],
    "robots": ["#F6EDDB", "#AF6843", "#264B47"],
    "open-closed": ["#F3F2F1", "#8CAACA", "#BF7770"],
    "tokenization": ["#F3EFE5", "#AD8D57", "#872A1E"],
    "mortgage-rates": ["#F4EFE2", "#C8AA79", "#C8AA79"],
    "debt-loop": ["#FAE2C8", "#E1B57F", "#E1B57F"],
    "dollar-gold-yen": ["#F3EBE0", "#315A86", "#CBAB64"],
    "two-schools-economics": ["#F3F1EA", "#B8A280", "#80466E"],
    "fintech-rails": ["#F1EBF0", "#AF7857", "#BFA4CE"],
    "stablecoins": ["#F8EFDD", "#A54E3F", "#B49159"],
    "inflation": ["#F9F4E8", "#DA9186", "#DA9186"],
    "how-starlink-works": ["#E3EBF3", "#C8C388", "#86BBC0"],
    "spacex-rockets": ["#F7F2DA", "#D2A456", "#B3CC91"],
    "boring-company": ["#F2F1ED", "#DFC096", "#A9BCD4"],
    "how-neuralink-works": ["#F4E7DC", "#D3C0AA", "#D3C0AA"],
    "how-electric-cars-work": ["#F3F1EB", "#DB998C", "#DAC190"],
    "how-humanoid-robots-work": ["#EEEFF0", "#E2A58C", "#86A3DA"],
    "nuclear-for-ai": ["#F3F1E7", "#E2AE87", "#8FC5D1"],
    "ai-compute": ["#F2F2EB", "#C6CB9A", "#D98770"]
  };
  var NAMED = {
    cream: "#F7F1E1", peach: "#F6D3B4", orange: "#E07A2F", teal: "#1E8264",
    yellow: "#E6B325", tomato: "#C4452D", red: "#C4452D", navy: "#1B2A4A",
    mint: "#3EAE8A", coral: "#D64E40", butter: "#F2C14E", mustard: "#A06900",
    plum: "#783C78", sunflower: "#E6B325", sky: "#2A76C4"
  };
  var FADED = [0x6c, 0x6a, 0x60], SOFT = [0x3a, 0x3a, 0x36];
  var DFADED = [0xa8, 0x9c, 0x86], DINK = [0xf3, 0xea, 0xd9];
  var NEUTRAL = [0xf6, 0xef, 0xe1];

  function hexRgb(hex) {
    var h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) h = h.replace(/./g, function (c) { return c + c; });
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbHex(c) {
    function b(v) { var n = Math.max(0, Math.min(255, Math.round(v))); return (n < 16 ? "0" : "") + n.toString(16); }
    return "#" + b(c[0]) + b(c[1]) + b(c[2]);
  }
  function rgbHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2, d = max - min;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  function hslRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, s));
    l = Math.max(0, Math.min(1, l));
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  function lin(u) { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
  function contrast(a, b) {
    var L1 = lum(a), L2 = lum(b);
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  }
  function hueDist(a, b) { var d = Math.abs(a - b); return Math.min(d, 360 - d); }

  /* Light sheet stays bright enough for the faded ink on the footer.
     Night sheet stays darker than the card, with the book's hue. */
  function calm(hex) {
    var src = hexRgb(hex);
    if (!src) return null;
    var hsl = rgbHsl(src), h = hsl[0], s0 = hsl[1], s = s0;
    if (s > 0.42) s = 0.42;
    if (s0 >= 0.12 && s < 0.16) s = 0.16;
    var l = 0.9, light = null, i;
    for (i = 0; i < 16; i++) {
      var c = hslRgb(h, s, l);
      if (contrast(FADED, c) >= 4.55 && contrast(SOFT, c) >= 4.5) { light = c; break; }
      l += 0.005;
      s = Math.max(0.04, s - 0.02);
    }
    if (!light) light = NEUTRAL.slice();
    var ds = Math.min(0.2, Math.max(0.08, s0 * 0.45)), dl = 0.112;
    var dark = hslRgb(h, ds, dl);
    for (i = 0; i < 6 && (contrast(DFADED, dark) < 4.55 || contrast(DINK, dark) < 7); i++) {
      dl -= 0.008;
      ds = Math.max(0.05, ds - 0.02);
      dark = hslRgb(h, ds, dl);
    }
    return { light: rgbHex(light), dark: rgbHex(dark) };
  }
  function lite(hex) {
    var c = hexRgb(hex);
    if (!c) return "#d8cdb9";
    var t = rgbHsl(c);
    var s = Math.min(0.62, Math.max(0.28, t[1] || 0.3));
    return rgbHex(hslRgb(t[0], s, 0.74));
  }
  function kindOf(text) {
    var s = text || "";
    if (/grid|blueprint/.test(s)) return "grid";
    if (/comic|halftone|\bdots?\b/.test(s)) return "dots";
    if (/receipt|ruled|ledger/.test(s)) return "rules";
    return "fiber";
  }
  function parsePalette(str) {
    if (!str || typeof str !== "string") return null;
    var found = [], re = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, m, low = str.toLowerCase();
    while ((m = re.exec(str))) {
      var raw = m[1].length === 3 ? m[1].replace(/./g, function (c) { return c + c; }) : m[1];
      found.push({ hex: "#" + raw.toUpperCase(), i: m.index });
    }
    Object.keys(NAMED).forEach(function (name) {
      var i = 0;
      while ((i = low.indexOf(name, i)) >= 0) {
        var before = i === 0 || !/[a-z]/.test(low.charAt(i - 1));
        var after = i + name.length >= low.length || !/[a-z]/.test(low.charAt(i + name.length));
        var nearHex = found.some(function (f) { return f.i >= i && f.i <= i + name.length + 10; });
        if (before && after && !nearHex) found.push({ hex: NAMED[name].toUpperCase(), i: i });
        i += name.length;
      }
    });
    found.sort(function (a, b) { return a.i - b.i; });
    var colors = [];
    found.forEach(function (f) {
      if (hexRgb(f.hex) && !colors.some(function (c) { return c === f.hex; })) colors.push(f.hex);
    });
    if (!colors.length) return null;
    var paper = null;
    colors.forEach(function (hex) {
      if (!paper && rgbHsl(hexRgb(hex))[2] >= 0.84) paper = hex;
    });
    if (!paper) {
      paper = colors.slice().sort(function (a, b) { return rgbHsl(hexRgb(b))[2] - rgbHsl(hexRgb(a))[2]; })[0];
      if (rgbHsl(hexRgb(paper))[2] < 0.72) paper = "#F7F1E1";
    }
    var vivid = colors.filter(function (hex) {
      if (hex === paper) return false;
      var t = rgbHsl(hexRgb(hex));
      return t[1] > 0.18 && t[2] > 0.12 && t[2] < 0.9;
    });
    var picked = [];
    vivid.forEach(function (hex) {
      if (picked.length >= 3) return;
      var h = rgbHsl(hexRgb(hex))[0];
      if (picked.some(function (p) { return hueDist(rgbHsl(hexRgb(p))[0], h) < 22; })) return;
      picked.push(hex);
    });
    if (!picked.length) return null;
    var kind = kindOf(low), ink = picked[0], wash = picked[1] || picked[0];
    if (kind === "grid") {
      var sky = null;
      vivid.forEach(function (hex) {
        var t = rgbHsl(hexRgb(hex));
        if (!sky && t[0] > 190 && t[0] < 235 && t[2] > 0.32) sky = hex;
      });
      if (sky) {
        ink = sky;
        wash = picked.filter(function (h) {
          return h !== sky && rgbHsl(hexRgb(h))[2] > 0.28;
        })[0] || picked[0];
      }
    }
    return { paper: paper, ink: ink, wash: wash, kind: kind };
  }

  function forBook(book) {
    if (!book) return null;
    var spec = book.palette ? parsePalette(book.palette) : null;
    if (!spec && ART[book.id]) {
      var a = ART[book.id];
      spec = { paper: a[0], ink: a[1], wash: a[2] || a[1], kind: "fiber" };
    }
    if (!spec) return null;
    var sheet = calm(spec.paper);
    if (!sheet) return null;
    var ink = hexRgb(spec.ink) ? spec.ink : "#6e5428";
    var wash = hexRgb(spec.wash) ? spec.wash : ink;
    return {
      paper: sheet.light,
      paperDark: sheet.dark,
      ink: ink,
      inkLite: lite(ink),
      wash: wash,
      washLite: lite(wash),
      kind: spec.kind || "fiber"
    };
  }

  return { forBook: forBook, parsePalette: parsePalette, contrast: contrast, hexRgb: hexRgb };
});

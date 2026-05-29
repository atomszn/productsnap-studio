/* =====================================================================
   ProductSnap Studio — Pulse (Phase 2A)
   Loads data/pulse-content.json and renders:
     - Weekly note
     - Weekly Connection (hero)
     - PM tension card
     - What's Changed strip
     - Category + signal pickers
     - Pulse Explorer (chain, expandable steps) + quantitative context
       (sparkline, compared-to, percentile, current value, footnote)
     - Why-I-think-this drawer
     - Category grid (6 cards)
     - Sources modal
   Frontend-only rendering. Pass B adds a scheduled data refresh that updates
   data/pulse-content.json; the page still reads static JSON at runtime.
   ===================================================================== */

(function () {
  "use strict";

  /* ---------- constants ---------- */
  const CATEGORY_DOT = {
    "inflation":   "var(--note-gold)",
    "liquidity":   "var(--note-teal)",
    "ai-tech":     "var(--note-lavender)",
    "consumer":    "var(--note-blush)",
    "labor":       "var(--note-pink)",
    "regulation":  "var(--note-sand)",
    "activity":    "var(--note-sand)"
  };

  const CATEGORY_TONE_CLASS = {
    "inflation":   "tone-amber",
    "liquidity":   "tone-teal",
    "ai-tech":     "tone-lavender",
    "consumer":    "tone-blush",
    "labor":       "tone-pink",
    "regulation":  "tone-sand",
    "activity":    "tone-sand"
  };

  const STATUS_TONE_CLASS = {
    green:    "tone-green",
    amber:    "tone-amber",
    red:      "tone-red",
    pink:     "tone-pink",
    neutral:  "tone-neutral",
    lavender: "tone-lavender"
  };

  const CMP_TONE_CLASS = {
    green:   "cmp-tone-green",
    amber:   "cmp-tone-amber",
    neutral: "cmp-tone-neutral"
  };

  const STALE_AFTER_DAYS_BY_SIGNAL = {
    "10y-treasury": 3,
    "fed-net-liquidity": 15,
    "cpi-headline": 65,
    "ppi": 65,
    "pce": 65,
    "retail-sales": 65,
    "consumer-confidence": 65,
    "nonfarm-payrolls": 65
  };

  let DATA = null;
  let CURRENT_SIGNAL_ID = null;
  let CURRENT_CATEGORY_ID = null;

  /* ---------- utils ---------- */
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function escapeHTML(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtSignedPct(n) {
    if (n == null) return "—";
    if (Math.abs(n) >= 999) return ">+999%";
    const v = Math.round(n * 10) / 10;
    const sign = v > 0 ? "+" : "";
    return sign + v + "%";
  }

  function fmtMonth(yyyymm) {
    if (!yyyymm) return "";
    const [y, m] = yyyymm.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[parseInt(m, 10) - 1] + " " + y;
  }

  function daysSince(iso) {
    if (!iso) return Infinity;
    const d = new Date(iso + "T00:00:00Z");
    if (isNaN(d.getTime())) return Infinity;
    const today = new Date();
    return Math.floor((today - d) / 86400000);
  }

  /* ---------- inline SVG helpers ---------- */
  function arrowSVG() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12 H19 M13 6 L19 12 L13 18"/></svg>';
  }

  function arrowDirSVG(dir) {
    if (dir === "up") {
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13 V3 M4 7 L8 3 L12 7"/></svg>';
    }
    if (dir === "down") {
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3 V13 M4 9 L8 13 L12 9"/></svg>';
    }
    // flat
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8 H13 M10 5 L13 8 L10 11"/></svg>';
  }

  /* =====================================================================
     RENDER: weekly note
     ===================================================================== */
  function renderWeeklyNote(note) {
    if (!note) return;
    const t = $("#wn-text");
    const d = $("#wn-date");
    const h = $("#hero-date");
    if (t) t.textContent = note.text;
    if (d) d.textContent = note.date_label || note.date || "";
    if (h) h.textContent = note.date_label || note.date || "";
  }

  /* =====================================================================
     RENDER: Weekly Connection (hero)
     ===================================================================== */
  function renderWeeklyConnection(conn) {
    if (!conn) return;
    $("#wc-title").textContent = conn.title || "";
    $("#wc-subtitle").textContent = conn.subtitle || "";
    $("#wc-date").textContent = conn.date_label || conn.date || "";

    // Structured triad (refined). Falls back to body paragraphs if missing.
    // Pass A folds the old standalone PM tension into the WC as a new closing
    // beat: “The decision this forces this week”.
    const refined = conn.refined || null;
    if (refined) {
      $("#wc-observation").textContent = refined.observation || "";
      $("#wc-why").textContent = refined.why_it_matters || "";
      $("#wc-implication").textContent = refined.pm_implication_default || "";
      const decEl = $("#wc-decision");
      const decRow = $("#wc-triad-decision-row");
      const decText = refined.decision_this_week || "";
      if (decEl && decText) {
        decEl.textContent = decText;
      } else if (decRow) {
        decRow.style.display = "none";
      }
    } else {
      $("#wc-triad").style.display = "none";
    }

    // "Where would this show up first?" tabs
    const tabsRoot = $("#wc-where-tabs");
    const where = (refined && refined.where_shows_up) || [];
    if (tabsRoot && where.length) {
      tabsRoot.innerHTML = where.map((w, i) =>
        '<button type="button" class="wc-where-tab" data-where="' + escapeHTML(w.key) + '"' +
        ' role="tab" aria-selected="' + (i === -1 ? "true" : "false") + '">' +
          escapeHTML(w.label) +
        '</button>'
      ).join("");
    } else {
      $("#wc-where").style.display = "none";
    }

    // Full thread (details body)
    const body = $("#wc-body");
    if (body) {
      body.innerHTML = (conn.body_paragraphs || []).map((p) =>
        "<p>" + escapeHTML(p) + "</p>"
      ).join("");
    }

    // Helper label under "Where would this show up first?"
    const helperEl = $("#wc-where-helper");
    if (helperEl) {
      const helper = (refined && refined.where_helper) || conn.where_helper || "";
      helperEl.textContent = helper;
      helperEl.style.display = helper ? "" : "none";
    }

    // connected signal pills — human-readable, with clear scroll-to-explorer purpose
    const sigs = (conn.connected_signals || []).map((id) => {
      const s = DATA.signals.find((x) => x.id === id);
      const dot = CATEGORY_DOT[s && s.category] || "#ccc";
      const label = s ? (s.pill_label_short || s.pill_label || s.title.split(" — ")[0]) : id;
      const aria = "Explore signal: " + label;
      return (
        '<button type="button" class="wc-signal-pill" data-signal="' + escapeHTML(id) + '"' +
          ' aria-label="' + escapeHTML(aria) + '"' +
          ' title="' + escapeHTML(aria) + '">' +
          '<span class="wc-signal-dot" style="background:' + dot + '"></span>' +
          '<span class="wc-signal-pill-text">' + escapeHTML(label) + '</span>' +
          '<span class="wc-signal-pill-arrow" aria-hidden="true">↓</span>' +
        '</button>'
      );
    });

    // join with hand-drawn arrows
    const sigList = $("#wc-signals");
    const html = [];
    sigs.forEach((s, i) => {
      html.push(s);
      if (i < sigs.length - 1) {
        html.push('<span class="wc-arrow">' + arrowSVG() + '</span>');
      }
    });
    sigList.innerHTML = html.join("");
  }

  // When the user picks a 'where would this show up' tab, reshape the PM implication line.
  // The PM implication block is the ONLY thing that changes — we highlight it so that
  // becomes visually obvious without flashy motion.
  function selectWhereTab(key) {
    const conn = DATA && DATA.weekly_connection;
    if (!conn || !conn.refined) return;
    const found = (conn.refined.where_shows_up || []).find((w) => w.key === key);
    const implEl = $("#wc-implication");
    const implRow = document.querySelector(".wc-triad-row.wc-triad-pm");
    const focusBadge = $("#wc-implication-focus");
    if (found && implEl) {
      // Smooth swap: tiny fade
      implEl.style.transition = "opacity .18s ease";
      implEl.style.opacity = "0.25";
      setTimeout(() => {
        implEl.textContent = found.implication;
        implEl.style.opacity = "1";
      }, 140);
    }
    // Highlight the PM implication region
    if (implRow) implRow.classList.add("is-focused");
    // Show the small contextual badge: “for …”
    if (focusBadge && found) {
      focusBadge.textContent = "→ for " + (found.label || "").toLowerCase();
      focusBadge.style.display = "";
    }
    $$("#wc-where-tabs .wc-where-tab").forEach((t) => {
      t.setAttribute("aria-selected", t.dataset.where === key ? "true" : "false");
    });
  }

  function resetWhereTab() {
    const conn = DATA && DATA.weekly_connection;
    if (!conn || !conn.refined) return;
    const implEl = $("#wc-implication");
    const implRow = document.querySelector(".wc-triad-row.wc-triad-pm");
    const focusBadge = $("#wc-implication-focus");
    if (implEl) implEl.textContent = conn.refined.pm_implication_default || "";
    if (implRow) implRow.classList.remove("is-focused");
    if (focusBadge) {
      focusBadge.textContent = "";
      focusBadge.style.display = "none";
    }
    $$("#wc-where-tabs .wc-where-tab").forEach((t) => t.setAttribute("aria-selected", "false"));
  }

  /* =====================================================================
     RENDER: PM tension
     ===================================================================== */
  function renderPMTension(t) {
    if (!t) return;
    $("#pmt-eyebrow").textContent = t.label || "This week’s PM tension";
    $("#pmt-axis").textContent = t.axis || "";
    $("#pmt-question").textContent = t.question || "";
    $("#pmt-note").textContent = t.note || "";

    // Toggle bar — lets the reader switch which tension they're holding.
    const root = $("#pmt-toggle");
    const toggles = (t.toggles || []);
    if (!root || !toggles.length) {
      if (root) root.style.display = "none";
      return;
    }
    root.innerHTML = toggles.map((tg, i) =>
      '<button type="button" class="pmt-toggle-pill" role="tab"' +
      ' data-tension="' + escapeHTML(tg.key) + '"' +
      ' aria-selected="' + (i === 0 ? "true" : "false") + '">' +
        '<span class="pmt-toggle-left">' + escapeHTML(tg.left) + '</span>' +
        '<span class="pmt-toggle-sep" aria-hidden="true">vs</span>' +
        '<span class="pmt-toggle-right">' + escapeHTML(tg.right) + '</span>' +
      '</button>'
    ).join("");
  }

  function selectTension(key) {
    const t = DATA && DATA.pm_tension;
    if (!t || !t.toggles) return;
    const tg = t.toggles.find((x) => x.key === key);
    if (!tg) return;
    const axisEl = $("#pmt-axis");
    const qEl = $("#pmt-question");
    const nEl = $("#pmt-note");
    if (axisEl) axisEl.textContent = tg.left + " vs " + tg.right;
    if (qEl) {
      qEl.style.transition = "opacity .18s ease";
      qEl.style.opacity = "0.25";
      setTimeout(() => {
        qEl.textContent = tg.question || "";
        qEl.style.opacity = "1";
      }, 140);
    }
    if (nEl) nEl.textContent = tg.note || "";
    $$("#pmt-toggle .pmt-toggle-pill").forEach((p) => {
      p.setAttribute("aria-selected", p.dataset.tension === key ? "true" : "false");
    });
  }

  /* =====================================================================
     RENDER: What's Changed strip
     ===================================================================== */
  function lookupSignalTitle(id) {
    const s = DATA.signals.find((x) => x.id === id);
    return s ? s.title : id;
  }

  function momentumPill(label) {
    if (!label) return "";
    const slug = String(label).toLowerCase().replace(/\s+/g, "-");
    return '<span class="wch-momentum mom-' + escapeHTML(slug) + '">' + escapeHTML(label) + '</span>';
  }

  function confidencePill(conf) {
    if (!conf) return "";
    const dots = conf === "high" ? 3 : (conf === "medium" ? 2 : 1);
    let html = '<span class="wch-confidence wch-conf-' + escapeHTML(conf) + '" title="' + escapeHTML(conf) + ' confidence" aria-label="' + escapeHTML(conf) + ' confidence">';
    for (let i = 0; i < 3; i++) {
      html += '<span class="wch-conf-dot' + (i < dots ? " on" : "") + '"></span>';
    }
    html += '</span>';
    return html;
  }

  // New simplified row: short label · movement cue · confidence dots · product implication.
  // No repeated sentence. Fast scan, not dashboard density.
  function buildWchItem(it, kind) {
    const id = (typeof it === "string") ? it : it.signal_id;
    const s = DATA.signals.find((x) => x.id === id);
    const labelText = (typeof it === "object" && it && it.short_label)
      ? it.short_label
      : (s ? (s.pill_label_short || s.pill_label || s.title.split(" — ")[0]) : id);
    const dir = (typeof it === "object" && it && it.direction)
      ? it.direction
      : (kind === "diff" ? "flat" : "flat");
    const movement = (typeof it === "object" && it && it.movement) || "";
    const implication = (typeof it === "object" && it && it.implication) || "";
    const conf = (typeof it === "object" && it && it.confidence) || null;
    const arrowCls = dir === "up" ? "up" : (dir === "down" ? "down" : "flat");
    const iconHTML = (kind === "diff")
      ? '<span class="wch-shift-icon" aria-hidden="true">⚡</span>'
      : '<span class="wch-arrow ' + arrowCls + '" aria-hidden="true">' + arrowDirSVG(arrowCls) + '</span>';

    return (
      '<li><button type="button" class="wch-item wch-item-row" data-signal="' + escapeHTML(id) + '"' +
        ' aria-label="' + escapeHTML(labelText + " — " + movement + ". " + implication) + '">' +
        '<span class="wch-item-main">' +
          iconHTML +
          '<span class="wch-label-strong">' + escapeHTML(labelText) + '</span>' +
          (movement ? '<span class="wch-sep" aria-hidden="true">·</span><span class="wch-movement">' + escapeHTML(movement) + '</span>' : '') +
          confidencePill(conf) +
        '</span>' +
        (implication ? '<span class="wch-implication">' + escapeHTML(implication) + '</span>' : '') +
      '</button></li>'
    );
  }

  function renderWhatsChanged(wc) {
    if (!wc) return;
    const movedHTML = (wc.moved || []).map((m) => buildWchItem(m, "moved")).join("");
    const heldHTML  = (wc.held_steady || []).map((h) => buildWchItem(h, "held")).join("");
    const diffHTML  = (wc.behaving_differently || []).map((d) => buildWchItem(d, "diff")).join("");

    $("#wch-moved").innerHTML = movedHTML || '<li class="wch-empty"><span class="wch-note">no notable moves this week</span></li>';
    $("#wch-held").innerHTML  = heldHTML  || '<li class="wch-empty"><span class="wch-note">—</span></li>';
    $("#wch-diff").innerHTML  = diffHTML  || '<li class="wch-empty"><span class="wch-note">—</span></li>';
  }

  /* =====================================================================
     RENDER: Category pills + Signal sub-pills
     ===================================================================== */
  function renderCategoryPills() {
    const root = $("#category-pills");
    if (!root) return;
    root.innerHTML = DATA.categories.map((c) => (
      '<button type="button" class="picker-pill" role="tab"' +
      ' data-category="' + escapeHTML(c.id) + '"' +
      ' aria-selected="false">' +
        '<span class="pp-dot" style="background:' + (CATEGORY_DOT[c.id] || "#ccc") + '"></span>' +
        escapeHTML(c.label) +
      '</button>'
    )).join("");
  }

  function renderSignalPills(categoryId) {
    const root = $("#signal-pills");
    if (!root) return;
    const cat = DATA.categories.find((c) => c.id === categoryId);
    if (!cat) { root.innerHTML = ""; return; }
    const signals = (cat.signal_ids || []).map((id) =>
      DATA.signals.find((s) => s.id === id)
    ).filter(Boolean);

    root.innerHTML = signals.map((s) => {
      const lbl = pickerSignalLabel(s);
      return (
        '<button type="button" class="picker-pill" role="tab"' +
        ' data-signal="' + escapeHTML(s.id) + '"' +
        ' aria-selected="false"' +
        ' title="' + escapeHTML(lbl.title) + '">' +
          escapeHTML(lbl.display) +
        '</button>'
      );
    }).join("");
  }

  function shortSignalLabel(s) {
    // Always return the FULL label — no dead-end ellipsis. Pass A removed the
    // 34-char clip. Prefer the plain-language pill_label_short, which was
    // written human-first; fall back to pill_label or a clean title prefix.
    return (
      s.pill_label_short ||
      s.pill_label ||
      (s.title || s.id).split(" — ")[0].split(":")[0]
    );
  }

  // Picker pills always show the full label — no truncation. The flex-wrap row
  // and pill wrapping handle long labels gracefully on desktop and mobile.
  function pickerSignalLabel(s) {
    const full = shortSignalLabel(s);
    return { display: full, title: full };
  }

  function setActivePicker(rootSel, attr, value) {
    $$(rootSel + " .picker-pill").forEach((p) => {
      p.setAttribute("aria-selected", p.dataset[attr] === value ? "true" : "false");
    });
  }

  /* =====================================================================
     RENDER: Pulse Explorer (active chain + quantitative context)
     ===================================================================== */
  function renderExplorer(signal) {
    if (!signal) return;

    $("#px-category").textContent = signal.category_label || "";
    $("#px-title").textContent = signal.title || "";
    $("#px-summary").innerHTML = glossifyText(signal.summary || "", signal.term_glossary);

    // status pill
    const sp = $("#status-pill");
    sp.className = "status-pill " + (STATUS_TONE_CLASS[signal.status_tone] || "tone-amber");
    sp.textContent = signal.status || "—";

    // confidence pill
    const cp = $("#confidence-pill");
    cp.className = "confidence-pill " + (signal.confidence || "");
    cp.textContent = (signal.confidence || "—") + " confidence";

    // current value
    $("#px-current-val").textContent = signal.current_value || "—";
    $("#px-current-unit").textContent = signal.current_unit || "";

    // reference point — the comparison line that makes the value meaningful
    const refEl = $("#px-reference");
    if (refEl) {
      refEl.textContent = signal.reference_point || "";
      refEl.style.display = signal.reference_point ? "" : "none";
    }

    // sparkline
    $("#sparkline-svg").innerHTML = buildSparkline(signal.data_points || [], signal.category);

    // compared-to
    $("#compared-to").innerHTML = buildComparedTo(signal.compared_to);

    // percentile pill
    $("#percentile-pill").innerHTML = buildPercentile(signal.percentile);

    // chain (expandable). The PM question step (last in the 5) is pre-expanded
    // on first load so the interaction pattern is immediately obvious without
    // shouting "click me". Other steps show a persistent “+ tap to expand” hint.
    const chain = $("#chain");
    const steps = signal.chain || [];
    const lastIndex = steps.length - 1; // PM question step
    chain.innerHTML = steps.map((step, i) => {
      const isPreOpen = (i === lastIndex);
      const openCls = isPreOpen ? " is-open" : "";
      const ariaOpen = isPreOpen ? "true" : "false";
      const ariaLabel = step.label + " — tap to toggle.";
      const hintHTML = step.expansion
        ? '<span class="cs-expand-hint">' +
            '<span class="cs-hint-collapsed">＋ tap to expand</span>' +
            '<span class="cs-hint-expanded">− tap to collapse</span>' +
          '</span>'
        : '<span class="cs-expand-hint" aria-hidden="true" style="visibility:hidden">.</span>';
      return (
        '<li class="chain-step' + openCls + '" data-step="' + (i + 1) + '" role="button" tabindex="0"' +
        ' aria-expanded="' + ariaOpen + '" aria-label="' + escapeHTML(ariaLabel) + '">' +
          '<span class="cs-num">0' + (i + 1) + '</span>' +
          '<span class="cs-label">' + escapeHTML(step.label) + '</span>' +
          '<p class="cs-text">' + glossifyText(step.text || "", signal.term_glossary) + '</p>' +
          (step.expansion
            ? '<div class="cs-expansion">' + glossifyText(step.expansion, signal.term_glossary) + '</div>'
            : '') +
          hintHTML +
        '</li>'
      );
    }).join("");

    // why drawer — simplified to Evidence / Counter-signal / Product takeaway
    const rw = signal.refined_why || null;
    const w  = signal.why_we_think_this || {};
    let whyHTML;
    if (rw) {
      whyHTML =
        '<div class="wb-block wb-evidence">' +
          '<span class="wb-block-label">Evidence</span>' +
          '<p class="wb-text">' + escapeHTML(rw.evidence || "") + '</p>' +
        '</div>' +
        '<div class="wb-block wb-counter">' +
          '<span class="wb-block-label">Counter-signal</span>' +
          '<p class="wb-text">' + escapeHTML(rw.counter_signal || "") + '</p>' +
        '</div>' +
        '<div class="wb-block wb-takeaway">' +
          '<span class="wb-block-label">Product takeaway</span>' +
          '<p class="wb-text wb-takeaway-text">' + escapeHTML(rw.product_takeaway || "") + '</p>' +
        '</div>';
    } else {
      // legacy fallback
      whyHTML =
        '<div class="wb-block">' +
          '<span class="wb-block-label">Evidence</span>' +
          '<p class="wb-text">' + escapeHTML(w.reasoning || "") + '</p>' +
        '</div>' +
        '<div class="wb-block">' +
          '<span class="wb-block-label">Counter-signal</span>' +
          '<p class="wb-text">' + escapeHTML((w.counterarguments || [])[0] || "") + '</p>' +
        '</div>' +
        '<div class="wb-block">' +
          '<span class="wb-block-label">Product takeaway</span>' +
          '<p class="wb-text wb-takeaway-text">' + escapeHTML(w.what_would_make_us_wrong || "") + '</p>' +
        '</div>';
    }
    $("#why-body").innerHTML = whyHTML;

    // footnote
    renderFootnote(signal);
  }

  /* =====================================================================
     COMPONENT: sparkline (hand-drawn-feeling SVG)
     ===================================================================== */
  function buildSparkline(points, category) {
    if (!points || points.length < 2) {
      return '<svg viewBox="0 0 160 44" preserveAspectRatio="none"><text x="80" y="26" text-anchor="middle" font-family="Kalam, cursive" font-size="11" fill="#7A7974">no data</text></svg>';
    }
    const W = 160, H = 44, padX = 4, padY = 6;
    const xs = points.map((p, i) => i);
    const ys = points.map((p) => +p.value);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
    const rangeY = (maxY - minY) || 1;
    const stepX = (W - padX * 2) / (points.length - 1);

    const coords = points.map((p, i) => {
      const x = padX + i * stepX;
      const y = padY + (H - padY * 2) * (1 - (p.value - minY) / rangeY);
      return [x, y];
    });

    // smooth-ish path with slight catmull-rom feel via simple cubic curves
    let d = "M " + coords[0][0].toFixed(2) + " " + coords[0][1].toFixed(2);
    for (let i = 1; i < coords.length; i++) {
      const [x, y] = coords[i];
      const [px, py] = coords[i - 1];
      const cx = (px + x) / 2;
      d += " C " + cx.toFixed(2) + " " + py.toFixed(2) + ", " +
                  cx.toFixed(2) + " " + y.toFixed(2)  + ", " +
                  x.toFixed(2)  + " " + y.toFixed(2);
    }

    // area fill closing path
    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaD = d + " L " + last[0].toFixed(2) + " " + (H - padY).toFixed(2) +
                      " L " + first[0].toFixed(2) + " " + (H - padY).toFixed(2) + " Z";

    const fillColor = sparkAreaColor(category);
    const strokeColor = "#2b251c";
    const endX = last[0].toFixed(2);
    const endY = last[1].toFixed(2);

    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' +
        '<defs>' +
          '<filter id="spark-rough" x="-2%" y="-10%" width="104%" height="120%">' +
            '<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3"/>' +
            '<feDisplacementMap in="SourceGraphic" scale="1.2"/>' +
          '</filter>' +
        '</defs>' +
        '<path d="' + areaD + '" fill="' + fillColor + '" opacity="0.55" filter="url(#spark-rough)"/>' +
        '<path d="' + d + '" fill="none" stroke="' + strokeColor + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#spark-rough)"/>' +
        '<circle cx="' + endX + '" cy="' + endY + '" r="2.6" fill="' + strokeColor + '"/>' +
      '</svg>'
    );
  }

  function sparkAreaColor(category) {
    const map = {
      "inflation":  "#f0d68a",
      "liquidity":  "#b4dfd5",
      "ai-tech":    "#d4c2ee",
      "consumer":   "#f5cfc1",
      "labor":      "#f7c2c2",
      "regulation": "#e6c98a",
      "activity":   "#e6c98a"
    };
    return map[category] || "#e6d9bd";
  }

  /* =====================================================================
     COMPONENT: compared-to widget
     ===================================================================== */
  function buildComparedTo(c) {
    if (!c) return "";
    const cells = [
      { label: "vs 6mo ago",  d: c.vs_6mo },
      { label: "vs 12mo ago", d: c.vs_12mo },
      { label: "vs pre-2020", d: c.vs_pre_2020 }
    ];
    return cells.map((cell) => {
      const d = cell.d || {};
      const dir = d.direction || "flat";
      const toneClass = CMP_TONE_CLASS[d.tone] || "cmp-tone-neutral";
      return (
        '<div class="cmp-cell">' +
          '<span class="cmp-label">' + escapeHTML(cell.label) + '</span>' +
          '<span class="cmp-val ' + toneClass + '">' +
            '<span class="cmp-arrow">' + arrowDirSVG(dir) + '</span>' +
            escapeHTML(fmtSignedPct(d.delta_pct)) +
          '</span>' +
        '</div>'
      );
    }).join("");
  }

  /* =====================================================================
     COMPONENT: percentile pill
     ===================================================================== */
  function buildPercentile(p) {
    if (!p) return "";
    const val = Math.max(0, Math.min(100, +p.value || 0));
    return (
      '<div class="pp-bar" role="img" aria-label="' + escapeHTML(p.label || (val + "th percentile")) + '">' +
        '<span class="pp-dot" style="left:' + val + '%"></span>' +
      '</div>' +
      '<span class="pp-label">' + val + 'th percentile · last ' + (p.lookback_years || 10) + ' years</span>' +
      (p.label ? '<span class="pp-label" style="font-style:italic;opacity:0.75;">' + escapeHTML(p.label) + '</span>' : '')
    );
  }

  /* =====================================================================
     COMPONENT: source/tier/last-updated footnote
     ===================================================================== */
  function renderFootnote(signal) {
    const tier = signal.tier || 3;
    const tierLabel = ["", "Tier 1", "Tier 2", "Tier 3"][tier];
    const tierType = signal.tier_label || (tier === 1 ? "primary" : (tier === 2 ? "market" : "editorial"));
    const lu = signal.last_updated || "";
    // Format like "May 19, 2026" from ISO "2026-05-19"
    let luLabel = "—";
    if (lu && /^\d{4}-\d{2}-\d{2}/.test(lu)) {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const y = lu.slice(0, 4);
      const m = parseInt(lu.slice(5, 7), 10);
      const d = parseInt(lu.slice(8, 10), 10);
      luLabel = months[m - 1] + " " + d + ", " + y;
    }
    const dSince = daysSince(lu);
    // Stale rule: auto-fetched signals use roughly 2× their expected cadence.
    // Curated signals keep the older loose default so they do not over-warn.
    const staleAfterDays = STALE_AFTER_DAYS_BY_SIGNAL[signal.id] || 60;
    const stale = dSince > staleAfterDays;
    const srcCount = (signal.sources || []).length;

    $("#px-footnote").innerHTML = (
      '<span class="tier-badge tier-' + tier + '"><span class="tier-dot"></span>' + tierLabel + ' · ' + escapeHTML(tierType) + '</span>' +
      '<span class="fn-source">' + escapeHTML(signal.source_note || "") + '</span>' +
      '<span class="fn-sep">·</span>' +
      '<span class="fn-updated">last updated ' + escapeHTML(luLabel) + '</span>' +
      (stale ? '<span class="fn-stale">data may be stale</span>' : '') +
      '<button class="sp-cta btn-link" type="button" id="px-sources-btn" style="font-size:15px;margin-left:auto;">' +
        'Sources (' + srcCount + ') ' +
        '<span class="link-arrow" aria-hidden="true">↗</span>' +
      '</button>'
    );

    const btn = $("#px-sources-btn");
    if (btn) btn.addEventListener("click", () => openSourcesModal(signal));
  }

  /* =====================================================================
     GLOSSARY — wrap glossable terms with hover/tap tooltips
     ===================================================================== */
  function glossifyText(text, glossary) {
    if (!text) return "";
    let out = escapeHTML(text);
    if (!glossary || !glossary.length) return out;
    // Replace first occurrence of each term (case-insensitive, word boundary)
    glossary.forEach((g) => {
      if (!g || !g.term || !g.gloss) return;
      const term = g.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("\\b(" + term + ")\\b", "i");
      if (re.test(out)) {
        out = out.replace(re,
          '<span class="gloss-term" tabindex="0" data-gloss="' + escapeHTML(g.gloss) + '">$1</span>'
        );
      }
    });
    return out;
  }

  /* =====================================================================
     CATEGORY GRID
     ===================================================================== */
  function categoryMargin(catId) {
    const notes = {
      inflation:  "how sticky is sticky?",
      liquidity:  "how expensive is patience?",
      "ai-tech":  "is intelligence still getting cheaper?",
      consumer:   "are wallets opening?",
      labor:      "who's hiring, who's freezing?",
      regulation: "what just got harder?"
    };
    return notes[catId] || "";
  }

  /* =====================================================================
     QUIET FOOTER SIGNAL INDEX  — dense utility directory, six categories
     ===================================================================== */
  function renderFooterSignalIndex() {
    const root = $("#fsi-grid");
    if (!root) return;
    root.innerHTML = DATA.categories.map((cat) => {
      const signals = (cat.signal_ids || []).map((id) =>
        DATA.signals.find((s) => s.id === id)
      ).filter(Boolean);
      const dot = CATEGORY_DOT[cat.id] || "#ccc";
      const links = signals.map((s) => {
        const label = shortSignalLabel(s);
        return (
          '<li>' +
            '<button type="button" class="fsi-link" data-signal="' + escapeHTML(s.id) + '"' +
            ' title="' + escapeHTML(label) + '">' +
              '<span class="fsi-link-text">' + escapeHTML(label) + '</span>' +
              '<span class="fsi-link-arrow" aria-hidden="true">↑</span>' +
            '</button>' +
          '</li>'
        );
      }).join("");
      return (
        '<div class="fsi-group" data-category="' + escapeHTML(cat.id) + '">' +
          '<div class="fsi-group-head">' +
            '<span class="fsi-group-dot" style="background:' + dot + '"></span>' +
            '<span class="fsi-group-name">' + escapeHTML(cat.label) + '</span>' +
          '</div>' +
          '<ul class="fsi-list">' + links + '</ul>' +
        '</div>'
      );
    }).join("");
  }

  function markActiveFsiLink(id) {
    $$("#fsi-grid .fsi-link").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.signal === id)
    );
  }

  /* =====================================================================
     LEGACY CATEGORY GRID renderer kept as no-op safety — the section was
     removed from the DOM in Pass A. Retained so any callers don’t error.
     ===================================================================== */
  function renderCategoryGrid() {
    const root = $("#category-grid");
    if (!root) return;
    root.innerHTML = DATA.categories.map((cat) => {
      const signals = (cat.signal_ids || []).map((id) =>
        DATA.signals.find((s) => s.id === id)
      ).filter(Boolean);

      // count signals with notable momentum
      const movedCount = signals.filter((s) => {
        const m = (s.momentum_label || "").toLowerCase();
        return m === "accelerating" || m === "decelerating" || m === "watch closely";
      }).length;

      const pillsHTML = signals.map((s) => {
        const m = (s.momentum_label || "").toLowerCase();
        let dot = "", dotClass = "";
        if (m === "accelerating")        { dot = "\u25B2"; dotClass = "mom-dot-up"; }
        else if (m === "decelerating")   { dot = "\u25BC"; dotClass = "mom-dot-down"; }
        else if (m === "watch closely")  { dot = "\u2022"; dotClass = "mom-dot-watch"; }
        const dotHTML = dot
          ? '<span class="cc-mom-dot ' + dotClass + '" aria-hidden="true" title="' + escapeHTML(s.momentum_label) + '">' + dot + '</span>'
          : "";
        return (
          '<span class="cc-signal-pill" data-signal="' + escapeHTML(s.id) + '">' +
            dotHTML +
            escapeHTML(shortSignalLabel(s)) +
          '</span>'
        );
      }).join("");

      const toneClass = "tone-" + (cat.color || "amber");
      const margin = categoryMargin(cat.id);
      const marginHTML = margin
        ? '<span class="cc-margin-note">' + escapeHTML(margin) + '</span>'
        : "";

      return (
        '<button type="button" class="category-card" role="listitem" data-category="' + escapeHTML(cat.id) + '">' +
          '<div class="cc-head">' +
            '<span class="cc-name">' + escapeHTML(cat.label) + '</span>' +
            '<span class="cc-kicker">' + escapeHTML(cat.kicker || "") + '</span>' +
            '<span class="cc-tone-bar ' + toneClass + '" aria-hidden="true"></span>' +
          '</div>' +
          marginHTML +
          '<div class="cc-signals">' + pillsHTML + '</div>' +
          '<div class="cc-foot">' +
            '<span class="cc-strongest">' +
              movedCount + ' moving \u00B7 ' + signals.length + ' watched' +
            '</span>' +
            '<span class="cc-open">Open <span aria-hidden="true">\u2197</span></span>' +
          '</div>' +
        '</button>'
      );
    }).join("");
  }

  function markActiveCategory(id) {
    $$(".category-card").forEach((c) =>
      c.classList.toggle("is-active", c.dataset.category === id)
    );
  }

  /* =====================================================================
     SOURCES MODAL
     ===================================================================== */
  function openSourcesModal(signal) {
    const modal = $("#sources-modal");
    const body  = $("#modal-body");
    if (!modal || !body) return;

    const philosophy = (DATA && DATA.source_philosophy && DATA.source_philosophy.tiers) || [];
    const sigSources = (signal && signal.sources) || [];

    const byTier = { 1: [], 2: [], 3: [] };
    sigSources.forEach((src) => {
      const t = src.tier || 3;
      if (!byTier[t]) byTier[t] = [];
      byTier[t].push(src);
    });

    body.innerHTML = philosophy.map((tier) => {
      const list = (byTier[tier.tier] || [])
        .map((s) => '<li><a href="' + escapeHTML(s.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHTML(s.name) + ' <span aria-hidden="true">↗</span></a></li>')
        .join("");
      return (
        '<div class="tier-block">' +
          '<header class="tier-head">' +
            '<span class="tier-num">T' + tier.tier + '</span>' +
            '<span class="tier-label">' + escapeHTML(tier.label) + '</span>' +
          '</header>' +
          '<p class="tier-examples">' + escapeHTML(tier.examples) + '</p>' +
          (list
            ? '<ul class="tier-sources">' + list + '</ul>'
            : '<p class="tier-examples" style="margin:0; font-style:italic; opacity:0.7;">(no sources cited at this tier for this signal)</p>'
          ) +
        '</div>'
      );
    }).join("");

    modal.hidden = false;
    document.body.style.overflow = "hidden";
    const closeBtn = $(".modal-close", modal);
    if (closeBtn) closeBtn.focus();
  }

  function closeSourcesModal() {
    const modal = $("#sources-modal");
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
  }

  /* =====================================================================
     SELECTION
     ===================================================================== */
  function selectSignal(id, opts) {
    if (!DATA) return;
    const signal = DATA.signals.find((s) => s.id === id) || DATA.signals[0];
    CURRENT_SIGNAL_ID = signal.id;
    // Make sure the category for this signal is active
    if (signal.category && signal.category !== CURRENT_CATEGORY_ID) {
      CURRENT_CATEGORY_ID = signal.category;
      renderSignalPills(CURRENT_CATEGORY_ID);
      setActivePicker("#category-pills", "category", CURRENT_CATEGORY_ID);
      markActiveCategory(CURRENT_CATEGORY_ID);
    }
    setActivePicker("#signal-pills", "signal", signal.id);
    markActiveFsiLink(signal.id);
    renderExplorer(signal);

    if (opts && opts.scroll) {
      const target = $("#pulse-explorer");
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function selectCategory(id, opts) {
    if (!DATA) return;
    const cat = DATA.categories.find((c) => c.id === id) || DATA.categories[0];
    CURRENT_CATEGORY_ID = cat.id;
    setActivePicker("#category-pills", "category", cat.id);
    markActiveCategory(cat.id);
    renderSignalPills(cat.id);
    // load first signal of the category
    const firstSignal = (cat.signal_ids || [])[0];
    if (firstSignal) selectSignal(firstSignal, opts);
  }

  function currentSignal() {
    return (DATA && DATA.signals.find((s) => s.id === CURRENT_SIGNAL_ID)) || (DATA && DATA.signals[0]);
  }

  /* =====================================================================
     EVENT WIRING
     ===================================================================== */
  function bindEvents() {
    // Category picker
    $("#category-pills").addEventListener("click", (e) => {
      const b = e.target.closest("[data-category]");
      if (b) selectCategory(b.dataset.category);
    });

    // Signal picker
    $("#signal-pills").addEventListener("click", (e) => {
      const b = e.target.closest("[data-signal]");
      if (b) selectSignal(b.dataset.signal);
    });

    // Footer signal index — quiet utility directory. Clicking any link jumps
    // to that signal in the explorer above.
    const fsiRoot = $("#fsi-grid");
    if (fsiRoot) {
      fsiRoot.addEventListener("click", (e) => {
        const b = e.target.closest("[data-signal]");
        if (b) selectSignal(b.dataset.signal, { scroll: true });
      });
    }

    // What's changed items
    $("#whats-changed").addEventListener("click", (e) => {
      const b = e.target.closest("[data-signal]");
      if (b) selectSignal(b.dataset.signal, { scroll: true });
    });

    // Weekly connection pills
    $("#wc-signals").addEventListener("click", (e) => {
      const b = e.target.closest("[data-signal]");
      if (b) selectSignal(b.dataset.signal, { scroll: true });
    });

    // Chain step expand on tap / Enter / Space — single-open accordion.
    // Clicking another card collapses the previous and opens the selected one.
    // Clicking the currently-open card collapses it.
    function toggleChainStep(step) {
      if (!step) return;
      const wasOpen = step.classList.contains("is-open");
      const parent = step.parentElement;
      if (parent) {
        Array.from(parent.querySelectorAll(".chain-step.is-open")).forEach((s) => {
          if (s !== step) {
            s.classList.remove("is-open");
            s.setAttribute("aria-expanded", "false");
          }
        });
      }
      if (wasOpen) {
        step.classList.remove("is-open");
        step.setAttribute("aria-expanded", "false");
      } else {
        step.classList.add("is-open");
        step.setAttribute("aria-expanded", "true");
      }
    }
    $("#chain").addEventListener("click", (e) => {
      const step = e.target.closest(".chain-step");
      if (!step) return;
      // Don't toggle when tapping a glossary term (let its handler run)
      if (e.target.closest(".gloss-term")) return;
      toggleChainStep(step);
    });
    $("#chain").addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const step = e.target.closest(".chain-step");
        if (!step) return;
        e.preventDefault();
        toggleChainStep(step);
      }
    });

    // Glossary tap support (mobile / touch)
    document.addEventListener("click", (e) => {
      const g = e.target.closest(".gloss-term");
      if (g) {
        // Toggle is-tapped for this one, clear others
        $$(".gloss-term.is-tapped").forEach((el) => { if (el !== g) el.classList.remove("is-tapped"); });
        g.classList.toggle("is-tapped");
      } else {
        $$(".gloss-term.is-tapped").forEach((el) => el.classList.remove("is-tapped"));
      }
    });

    // Weekly Connection — "Where this shows up" tabs
    const whereTabs = $("#wc-where-tabs");
    if (whereTabs) {
      whereTabs.addEventListener("click", (e) => {
        const tab = e.target.closest(".wc-where-tab");
        if (!tab) return;
        const key = tab.dataset.where;
        if (tab.getAttribute("aria-selected") === "true") {
          resetWhereTab();
        } else {
          selectWhereTab(key);
        }
      });
    }

    // (PM tension card removed in Pass A — its job is now the WC closing beat.)

    // Sources philosophy CTA
    const phiBtn = $("#sources-philosophy-btn");
    if (phiBtn) phiBtn.addEventListener("click", () => openSourcesModal(currentSignal()));

    // Modal close
    document.addEventListener("click", (e) => {
      if (e.target && e.target.matches && e.target.matches("[data-close]")) closeSourcesModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSourcesModal();
    });
  }

  /* =====================================================================
     INIT
     ===================================================================== */
  function init(data) {
    DATA = data;

    renderWeeklyNote(data.weekly_note);
    renderWeeklyConnection(data.weekly_connection);
    renderWhatsChanged(data.whats_changed);

    renderCategoryPills();
    renderFooterSignalIndex();

    // Open default = first category, first signal — or use weekly_connection's first
    const defaultId = (data.weekly_connection && data.weekly_connection.connected_signals && data.weekly_connection.connected_signals[0])
      || (data.signals[0] && data.signals[0].id);
    const defaultSignal = data.signals.find((s) => s.id === defaultId) || data.signals[0];
    CURRENT_CATEGORY_ID = defaultSignal.category;
    renderSignalPills(CURRENT_CATEGORY_ID);
    setActivePicker("#category-pills", "category", CURRENT_CATEGORY_ID);
    markActiveCategory(CURRENT_CATEGORY_ID);
    selectSignal(defaultSignal.id);

    bindEvents();
  }

  /* ---------- load JSON ---------- */
  function loadData() {
    fetch("data/pulse-content.json", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(init)
      .catch((err) => {
        console.error("Pulse: failed to load content", err);
        if (window.PULSE_FALLBACK) init(window.PULSE_FALLBACK);
      });
  }

  document.addEventListener("DOMContentLoaded", loadData);
})();

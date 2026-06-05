/* =====================================================================
   ProductSnap Studio v2 — interactions
   ===================================================================== */

(function () {
  "use strict";

  /* ---------- Macro-to-Micro Signal Explorer ----------
     Framework: Signal → Interpretation → Product implication →
     Real company example → PM question (surprising, not generic).
  ----------------------------------------------------- */

  const SIGNALS = {
    inflation: {
      label: "Inflation rises",
      accent: "pink",
      steps: [
        { title: "Signal", body: "Inflation rises." },
        {
          title: "Interpretation",
          body: "Customers become more price-sensitive. Every dollar gets compared.",
        },
        {
          title: "Product implication",
          body: "Bundles, tiers, and value messaging start carrying more weight than features.",
          variant: "is-impact",
        },
        {
          title: "Real company example",
          body:
            "Netflix ships an ad-supported tier. Costco wins. SaaS adds annual prepay discounts and pauses price increases.",
          variant: "is-example",
        },
        {
          title: "PM question",
          body:
            "If customers become more price-sensitive, what becomes <em>easier</em> to justify inside our product?",
          variant: "is-question",
        },
      ],
    },
    rates: {
      label: "Interest rates rise",
      accent: "teal",
      steps: [
        { title: "Signal", body: "Interest rates rise." },
        {
          title: "Interpretation",
          body: "Capital is expensive. Future cashflows are worth less today. Payback windows shrink.",
        },
        {
          title: "Product implication",
          body: "Roadmaps tilt toward retention, efficiency, and automation. Land-grab gets paused.",
          variant: "is-impact",
        },
        {
          title: "Real company example",
          body:
            "Stripe cuts headcount and re-prices. Salesforce pushes Einstein for cost-to-serve. Shopify trims its logistics arm.",
          variant: "is-example",
        },
        {
          title: "PM question",
          body:
            "Which roadmap items <em>protect revenue, reduce cost, or shorten payback</em>?",
          variant: "is-question",
        },
      ],
    },
    ai: {
      label: "AI agents improve",
      accent: "purple",
      steps: [
        { title: "Signal", body: "AI agents improve." },
        {
          title: "Interpretation",
          body: "Workflows can be delegated. The unit of work shrinks from clicks to outcomes.",
        },
        {
          title: "Product implication",
          body: "Products start asking <em>what do you want done?</em> instead of <em>which menu next?</em>",
          variant: "is-impact",
        },
        {
          title: "Real company example",
          body:
            "Notion AI drafts the page before you start. Linear triages. Gmail summarizes a 40-message thread into three lines.",
          variant: "is-example",
        },
        {
          title: "PM question",
          body:
            "What should the user <em>no longer have to do manually</em>?",
          variant: "is-question",
        },
      ],
    },
    tokenization: {
      label: "Tokenization expands",
      accent: "yellow",
      steps: [
        { title: "Signal", body: "Tokenization expands." },
        {
          title: "Interpretation",
          body: "Ownership, identity, and access become programmable. Assets get more liquid and portable.",
        },
        {
          title: "Product implication",
          body: "Loyalty, credentials, and marketplace mechanics get reshaped. New composability appears.",
          variant: "is-impact",
        },
        {
          title: "Real company example",
          body:
            "Starbucks experiments with on-chain rewards. BlackRock tokenizes treasuries. Stripe re-opens stablecoin payouts.",
          variant: "is-example",
        },
        {
          title: "PM question",
          body:
            "What part of <em>ownership, identity, loyalty, or access</em> could become programmable in our product?",
          variant: "is-question",
        },
      ],
    },
    attention: {
      label: "Attention fragments",
      accent: "cream",
      steps: [
        { title: "Signal", body: "Attention fragments." },
        {
          title: "Interpretation",
          body: "Sessions get shorter. Patience evaporates. Habits are harder to earn and easier to lose.",
        },
        {
          title: "Product implication",
          body: "Time-to-value has to compress. Daily reps replace long sessions. Notifications get earned, not assumed.",
          variant: "is-impact",
        },
        {
          title: "Real company example",
          body:
            "TikTok teaches the whole industry that the first 3 seconds are the product. Duolingo replaces lessons with one-minute reps.",
          variant: "is-example",
        },
        {
          title: "PM question",
          body:
            "Where are we asking users to <em>work too hard before they see value</em>?",
          variant: "is-question",
        },
      ],
    },
    markets: {
      label: "Markets shift",
      accent: "pink",
      steps: [
        { title: "Signal", body: "Markets shift — winners reshuffle." },
        {
          title: "Interpretation",
          body: "Demand migrates to new segments. Distribution channels reorder.",
        },
        {
          title: "Product implication",
          body: "Positioning, pricing, and partnerships need to be re-grounded in who is actually buying now.",
          variant: "is-impact",
        },
        {
          title: "Real company example",
          body:
            "Mid-market becomes the new enterprise. Consumer pricing shows up in B2B. PLG meets sales-led at the seam.",
          variant: "is-example",
        },
        {
          title: "PM question",
          body:
            "Are we still building for the customer we <em>thought</em> we had — or the one we have now?",
          variant: "is-question",
        },
      ],
    },
  };

  function renderChain(key) {
    const data = SIGNALS[key];
    const chain = document.getElementById("chain");
    if (!data || !chain) return;

    chain.innerHTML = "";
    data.steps.forEach((step, i) => {
      const el = document.createElement("article");
      el.className = "chain-step" + (step.variant ? " " + step.variant : "");
      el.style.setProperty("--i", i);
      el.innerHTML = `
        <span class="step-num">0${i + 1}</span>
        <h4>${step.title}</h4>
        <p>${step.body}</p>
      `;
      chain.appendChild(el);
    });
  }

  function initExplorer() {
    const tabs = document.querySelectorAll(".signal-tab");
    if (!tabs.length) return;

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        tabs.forEach((t) => {
          t.classList.remove("is-active");
          t.setAttribute("aria-selected", "false");
        });
        tab.classList.add("is-active");
        tab.setAttribute("aria-selected", "true");
        renderChain(tab.dataset.signal);
      });

      tab.addEventListener("keydown", (e) => {
        const arr = Array.from(tabs);
        const idx = arr.indexOf(tab);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          arr[(idx + 1) % arr.length].focus();
          arr[(idx + 1) % arr.length].click();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          arr[(idx - 1 + arr.length) % arr.length].focus();
          arr[(idx - 1 + arr.length) % arr.length].click();
        }
      });
    });

    renderChain("inflation");
  }

  /* ---------- Sticky note subtle parallax ---------- */
  function initSticky() {
    const canvas = document.querySelector(".sketch-canvas");
    if (!canvas) return;
    const stickies = canvas.querySelectorAll(".sticky");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      stickies.forEach((s, i) => {
        const depth = (i % 3) + 1;
        s.style.translate = `${x * depth * 4}px ${y * depth * 4}px`;
      });
    });
    canvas.addEventListener("mouseleave", () => {
      stickies.forEach((s) => (s.style.translate = "0 0"));
    });
  }

  /* ---------- Smooth-scroll ---------- */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href").slice(1);
        if (!id) return;
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      });
    });
  }

  /* ---------- Reveal-on-scroll ---------- */
  function initReveal() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const els = document.querySelectorAll(
      ".section-head, .phone-real, .screen-thumb, .pair, .teardown, .future-card, .hub-card, .conv-card"
    );
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.style.opacity = "1";
            e.target.style.translate = "0 0";
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.10, rootMargin: "0px 0px -40px 0px" }
    );
    els.forEach((el) => {
      // The hidden start state (opacity:0 / translate) now lives in CSS,
      // gated on html.js, so it applies before first paint and there's no
      // visible->hidden flash. We only attach the transition + observer here;
      // the IntersectionObserver fades each element in exactly as before.
      el.style.transition =
        "opacity .55s ease, translate .55s cubic-bezier(.2,.8,.2,1)";
      io.observe(el);
    });
  }

  /* ---------- Homepage live Pulse insert ----------
     Pulls this week's Weekly Connection (title + one line) from
     data/pulse-content.json so the homepage stays current on its own.
     Dependency-free; does not touch js/pulse.js or the JSON.
  ----------------------------------------------------- */
  function initHomePulse() {
    const titleEl = document.getElementById("home-pulse-title");
    const lineEl = document.getElementById("home-pulse-line");
    if (!titleEl || !lineEl) return;

    fetch("data/pulse-content.json", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        const wc = data && data.weekly_connection;
        if (!wc || !wc.title) throw new Error("weekly_connection missing");
        titleEl.textContent = wc.title;
        // "one line" — prefer subtitle, fall back to the refined observation.
        var line = wc.subtitle ||
          (wc.refined && wc.refined.observation) ||
          (wc.body_paragraphs && wc.body_paragraphs[0]) || "";
        lineEl.textContent = line;
      })
      .catch((err) => {
        console.error("Home Pulse: failed to load weekly connection", err);
        // Honest fallback that still points to the live page.
        titleEl.textContent = "This week's connection is on the Pulse page.";
        lineEl.textContent =
          "The live insert couldn't load here \u2014 read it in full on Pulse.";
      });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initExplorer();
    initSticky();
    initSmoothScroll();
    initReveal();
    initHomePulse();
  });
})();

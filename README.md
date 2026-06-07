# productsnap-studio

A living notebook for product judgment. Static site (GitHub Pages from `main`),
served at https://productsnap.studio.

Pages: `index.html`, `sketches.html`, `app.html`, `pulse.html`, `notes.html`.

## AI Agent Discovery Layer

A quiet, machine-readable layer that helps people and AI agents discover,
understand, summarize, and recommend the site — without changing the human
experience.

| File | Purpose |
| --- | --- |
| `llms.txt` | Plain-text overview for LLMs: what the studio is, who built it, key pages, themes. |
| `context.json` | Structured profile: person, projects, pages, themes, focus areas. Only intentionally-public info. |
| `pulse-feed.json` | Machine-readable summary of the current Pulse — **auto-generated** from `data/pulse-content.json`. |
| `sitemap.xml` | Lists the five important pages. |
| `robots.txt` | Welcomes legitimate crawlers; points to the sitemap and discovery resources. |
| `assets/og-default.png` | 1200×630 social/OpenGraph preview image (paper/notebook aesthetic). |
| JSON-LD (in each page `<head>`) | Schema.org: Person, WebSite, SoftwareApplication (ProductSnap), CreativeWork (Pulse, Studio, Sketches, Notes). |

### Regenerating the Pulse feed

`pulse-feed.json` is derived from `data/pulse-content.json` and **respects the
same trust gate as the live site** — when an interpretation is "under review,"
the feed withholds it (so machines never read a stale take):

```bash
node scripts/generate-pulse-feed.js          # rewrite pulse-feed.json
node scripts/generate-pulse-feed.js --check  # verify it's in sync (exit 1 if stale)
```

> Note: the daily "Refresh Pulse data" workflow updates `data/pulse-content.json`
> but does not regenerate `pulse-feed.json`. Run the generator after a data or
> editorial refresh to keep the feed current. (Pulse framing: the feed is **not**
> financial analysis, investment advice, or market prediction.)

## Analytics (privacy-friendly)

Lightweight, cookieless analytics via [Umami Cloud](https://umami.is) — treated
as a **product experiment** (understand what visitors find interesting), not
marketing tracking. No cookies, no consent banner, no personal data, no UI
change, deferred load (zero impact on first paint or scroll-reveal motion).
Honors **Do-Not-Track / Global Privacy Control**: if the visitor signals "do not
track," analytics is skipped entirely. The site owner can also exclude their own
regular visits per browser (see **Excluding your own visits** below).

All of it lives in one file — `js/analytics.js` — loaded `defer` at the bottom
of each page. Custom events use pure event delegation, so **no other script
(`pulse.js`, `app.js`, `nav.js`, `theme.js`) is touched** and no markup changes.

### Configuration

**Configured and live.** The Umami **Website ID** is set in `js/analytics.js`
(`UMAMI_WEBSITE_ID`). Analytics only reports for the `productsnap.studio` domain
(`data-domains`), so local dev / preview hosts are never tracked.

To point at a different Umami site, replace the ID in `js/analytics.js`. Setting
it back to a `REPLACE_WITH…` placeholder turns the script into a complete no-op
(loads nothing, sends nothing). If you ever self-host Umami, also point
`UMAMI_SRC` at your own script URL.

### Excluding your own visits (owner opt-out)

You want real visitor analytics while excluding your *own* regular visits. There
is **no UI for this** — you flip it once per browser/device with a hidden URL
trigger, and the choice is remembered in `localStorage` thereafter:

| URL | Effect on that browser |
| --- | --- |
| `https://productsnap.studio/?analytics=off` | Stops all tracking — Umami never loads and no events fire. Persisted. |
| `https://productsnap.studio/?analytics=on` | Re-enables tracking. Persisted. |

How it works:

- The trigger sets two `localStorage` keys: our own `psnap-analytics` (`off`/`on`)
  and Umami's **native** `umami.disabled` kill switch — so opt-out is enforced at
  two layers (the script short-circuits *before* loading Umami, and even if it
  somehow loaded, Umami itself refuses to send).
- The `?analytics=` parameter is **stripped from the address bar** immediately
  (via `history.replaceState`) so it never pollutes the tracked page URL and
  can't be accidentally shared.
- Works on **mobile** (no devtools needed). It is **invisible to normal
  visitors**, who are never affected and stay fully tracked.
- `localStorage` is per-browser and per-device, so visit `?analytics=off` once on
  **each** personal browser/device you use (and again if you clear site data).

### Events captured

| Event | Fires when | Props |
| --- | --- | --- |
| pageview (named) | each page load | `Home` / `Sketches` / `App` / `Pulse` / `Notes` |
| `nav` | clicking a primary-nav / brand link to another chapter | `to` |
| `nav next-chapter` | clicking a footer "chapter turn" link | `to` |
| `store click` + `outbound` | App Store or Google Play link | `store` |
| `outbound` | any other external link (e.g. LinkedIn) | `destination`, `kind` |
| `theme toggle` | Late Night / Day Mode switch | `to` |
| `pulse step` | expanding/collapsing an Explorer step or evidence chip | `action` |
| `pulse lens` | switching the thinking-layer lens | `lens` |
| `pulse category` / `pulse signal` | picking a category or signal | `category` / `signal` |
| `pulse sources` | opening the sources modal | `action` |
| `notes pinned-card` | clicking a pinned card on Notes | `to` |
| `notes read-depth` | scrolling past 60% of Notes (once per visit) | `reached` |

Every event also carries a `from` prop (the chapter it happened on). Traffic
source/referrer, device category, and browser/platform are captured
automatically by Umami — no extra setup.

## QA & content gates

```bash
node scripts/qa-visual.mjs                  # honest visual QA (hidden/overflow/JS errors). Exit 0 = pass.
node scripts/validate-pulse-data.js --check # read-only Pulse content gate. Exit 0 = pass.
```

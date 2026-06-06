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

## QA & content gates

```bash
node scripts/qa-visual.mjs                  # honest visual QA (hidden/overflow/JS errors). Exit 0 = pass.
node scripts/validate-pulse-data.js --check # read-only Pulse content gate. Exit 0 = pass.
```

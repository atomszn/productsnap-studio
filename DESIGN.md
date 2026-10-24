---
version: alpha
name: ProductSnap Pulse
description: >-
  Picture-led explainer books on a hand-drawn bookshelf at productsnap.studio/pulse.html.
  Four topics, in shelf order: Frontier Tech, AI, Fintech, Macro. Light and dark themes. Phone-first.
  Every value below comes from css/style.css, css/pulse.css or css/pulse-sig.css
  (approved Oct 24 2026; shipped to productsnap.studio from pulse-redesign-frontier).
colors:
  primary: "#2c3e66"            # --t-ai (light): AI navy, also the default topic tint
  secondary: "#7535b6"          # --t-fintech (light): Fintech plum
  tertiary: "#3b7436"           # --t-macro (light): Macro green
  frontier: "#83580b"           # --t-frontier (light): Frontier launch amber
  neutral: "#f3efe7"            # Pulse paper (light)
  paper: "#f3efe7"
  paper-2: "#ece6da"
  card: "#fbf9f4"
  ink: "#1d1f1d"
  ink-soft: "#3a3a36"
  ink-faded: "#6c6a60"
  cloth-ai: "#2c3e66"
  cloth-fintech: "#683296"
  cloth-macro: "#3a6e35"
  cloth-frontier: "#7d5309"
  on-cloth: "#fbf5e8"           # cover + spine text
  new-pill: "#bf4579"           # New badge background (light), white text
  on-new-pill: "#ffffff"
  new-glow: "#e0679a"           # --new accent, glow ring only
  start-tag: "#f3e2b3"          # "Start here" ribbon
  on-start-tag: "#3b2f17"
  pen: "#c2391f"                # hand-drawn pen marks
  pen-bg: "#fbf0dc"
  plank: "#d9c7a6"              # shelf plank
  paper-dark: "#1c1916"
  paper-2-dark: "#24201b"
  card-dark: "#27221c"
  ink-dark: "#f3ead9"
  ink-soft-dark: "#d8cdb9"
  ink-faded-dark: "#a89c86"
  ai-dark: "#8fa6d6"
  fintech-dark: "#b779d8"
  macro-dark: "#8fd08a"
  frontier-dark: "#e3b45a"
  cloth-ai-dark: "#33497a"
  cloth-fintech-dark: "#7c45ae"
  cloth-macro-dark: "#3d7637"
  cloth-frontier-dark: "#8a5c0e"
  new-pill-dark: "#f08bb5"      # dark text #1c1916 on it
  on-new-pill-dark: "#1c1916"
  pen-dark: "#ff9a85"
  plank-dark: "#5a4632"
typography:
  cover-title:                 # fluid on the cover: 12.5cqw/1.04
    fontFamily: Fraunces
    fontWeight: 600
    lineHeight: 1.04
  gist-title:                  # clamp(1.15rem, min(5.4cqh,8cqw), 2.2rem)
    fontFamily: Fraunces
    fontSize: 2.2rem
    fontWeight: 600
    lineHeight: 1.12
  reader-title:
    fontFamily: Fraunces
    fontSize: 1.1rem
    fontWeight: 600
  hand-heading:                # .em-h
    fontFamily: Caveat
    fontSize: 1.7rem
    fontWeight: 600
    lineHeight: 1.1
  tagline:                     # .cv-tag 8.4cqw/1.22
    fontFamily: Kalam
    fontWeight: 400
    lineHeight: 1.22
  body-md:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.6
  button:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: 600
  chip:
    fontFamily: Inter
    fontSize: 0.9rem
    fontWeight: 500
  label-sm:                    # page counter, "Scroll for more"
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: 600
  spine-topic:
    fontFamily: Inter
    fontSize: 0.58rem
    fontWeight: 600
    letterSpacing: 0.12em
rounded:
  hair: 2px
  sm: 4px
  md: 10px
  lg: 12px
  site: 18px
  site-lg: 26px
  full: 999px
spacing:
  page-pad: "clamp(20px, 4vw, 56px)"
  content-max: 1180px
  tap-min: 44px
  spine-w-phone: 44px
  cover-w-phone: 132px         # swipe-row cover; ~2.6 covers show so the next one peeks
  cover-w-desktop: 156px
  row-max: 10                  # covers per row before a "+N more" tile
  results-cap: 8               # search results shown before "Show all"
  plank-h: 14px
  hover-lift: 16px
  card-w: 1600px               # book card art width
  card-h: 2400px               # AI Agents template height
components:
  book-cover:
    backgroundColor: "{colors.cloth-ai}"
    textColor: "{colors.on-cloth}"
    rounded: "3px 9px 9px 3px"
  book-cover-frontier:
    backgroundColor: "{colors.cloth-frontier}"
    textColor: "{colors.on-cloth}"
    rounded: "3px 9px 9px 3px"
  book-cover-frontier-dark:
    backgroundColor: "{colors.cloth-frontier-dark}"
    textColor: "{colors.on-cloth}"
  book-spine:
    backgroundColor: "{colors.cloth-ai}"
    textColor: "{colors.on-cloth}"
    width: "{spacing.spine-w-phone}"
  new-pill:
    backgroundColor: "{colors.new-pill}"
    textColor: "{colors.on-new-pill}"
    rounded: "{rounded.full}"
    padding: 5px 12px
  new-pill-dark:
    backgroundColor: "{colors.new-pill-dark}"
    textColor: "{colors.on-new-pill-dark}"
  chip:
    textColor: "{colors.ink-soft}"
    typography: "{typography.chip}"
    rounded: "{rounded.full}"
    height: 44px
  button-primary:              # .lib-ask button
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    height: 44px
  reader-button:               # .rd-btn prev/next/close
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 44px
  page-dot:                    # visual dot stays small; ::after hit area max(44px, own size)
    size: 44px
  takeaway-box:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.md}"
  search-bar:                  # sticky under the site header; input + Saved
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: 48px
  row-arrow:                   # desktop-only swipe-row arrows
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 44px
  finished-stamp:
    textColor: "{colors.pen}"
    rounded: "{rounded.sm}"
  start-here-tag:
    backgroundColor: "{colors.start-tag}"
    textColor: "{colors.on-start-tag}"
---

# Pulse: a sketchbook library

A warm, hand-drawn bookshelf at golden hour: cloth-bound books in navy, plum and green lean on a wooden plank, and each one opens into a picture-led story you can finish on the bus and explain to a friend.

## Principles, in priority order

When two rules pull apart, the higher one wins. **Journey always beats style.**

1. **End-user experience is paramount.** Friction-free from first tap to last page. The reader must understand the whole journey start to finish, with no loose ends: every card earns its place, every term is explained before it's needed, and every screen has an obvious way forward and back.
2. **Delight and wow.** Every book carries at least one moment that makes a reader smile or gasp (a guess-first card, an upside-down answer, a tap-to-reveal, a morphing open).
3. **Variety.** Mix things up and never be routine or monotonous. No two books share an art style *or* a structure. Neighbours on a shelf must feel different at a glance.

Reader in mind: a curious high-schooler in any country (India, Australia, the UK, the US), new to the topic, on a phone.

## Overview

Pulse is a library of short illustrated explainer "books" (8 to 10 cards each). The site chrome is a quiet sketchbook: paper, ink, hand lettering and cloth covers. The **books** are where the colour, style and surprise live. The chrome stays calm and consistent, so each book can be bold and different.

The journey, start to finish (every step must work in light and dark at 375/390/430 widths):
1. **Land:** the shelf follows the device theme on first visit. A short hero ("Small books for big shifts."), then a sticky search bar with topic chips. Below it: "Continue reading" (only when a book is half-read), **"New to Pulse? Start here"** (one easy book per shelf, numbered 1–4 in shelf order: How Starlink Works, AI Basics, Stablecoins, Why Your Mortgage Moves), **"New this week"**, then one swipe row per topic, in shelf order.
2. **Choose:** swipe a topic row, tap "See all" for the topic page (sub-chips, Suggested/Newest/Shortest, a Hide-read switch), or search, which lands on the best page. Empty search always offers a way out.
3. **Open:** the book opens with a morph (a simple fade under reduced motion) onto a gist page: title, 3-line gist and a Go button.
4. **Read:** one card per page, with a takeaway caption under the card (never drawn on it), page dots, prev/next arrows that never cover the card, and "Scroll for more ↓" where a card runs long.
5. **Finish:** a "Finished!" stamp, a recap that covers *all* pages, "<Shelf>: k of n read" progress, and the next **unread** book (same shelf first, then the **next shelf in order**: Frontier Tech → AI → Fintech → Macro → back to Frontier Tech). The book now shows "✓ Read" on its cover and spine and leaves "Continue reading".
6. **Return:** save pages (star), share (each book has a share page + OG image), bookmark, "Continue reading" on the next visit. Old or retired links redirect with a short "X is now part of Y" note. A bad link falls back to the shelf.

## Colors

Four topics, **in this order everywhere** (rows, chips, Start here, See all, Next shelf): **Frontier Tech, AI, Fintech, Macro** (set Oct 24 2026). The order and the list live in one place, `scripts/topics.py` (copied into `shelf.json`); class names come from a slug (`t-frontier-tech`), never from the raw name. An unknown topic is **never** coerced to another shelf: `add_book.py` and `check_library.py` reject it, and `pulse.js` drops the book with a console error.

- **AI navy** (#2c3e66 light / #8fa6d6 dark; cloth #2c3e66 / #33497a). Calm and technical.
- **Fintech plum** (#7535b6 / #b779d8; cloth #683296 / #7c45ae). Money with a modern edge.
- **Macro green** (#3b7436 / #8fd08a; cloth #3a6e35 / #3d7637). Economies, growth, the big picture.
- **Frontier launch amber** (#83580b / #e3b45a; cloth #7d5309 / #8a5c0e). Rockets, satellites, robots, brain chips, new power. Spine label "FRONTIER".
- **Paper and ink:** paper #f3efe7, card #fbf9f4 and ink #1d1f1d in light; paper #1c1916, card #27221c and ink #f3ead9 in dark. Never pure black on pure white.
- **Pink is only for the New badge:** "New" marks only the latest batch (books added within 2 days of the newest addition, at most 10 days old, **max 6**), and disappears once you've opened the book. #bf4579 with white text in light (4.84:1), #f08bb5 with #1c1916 text in dark (7.55:1). The #e0679a `--new` tint is used only for its glow ring.

Measured contrast (WCAG ratio; light / dark):
| Use | AI | Fintech | Macro |
|---|---|---|---|
| Use | AI | Fintech | Macro | Frontier |
|---|---|---|---|---|
| Topic text on paper | 9.21 / 7.16 | 6.23 / 5.62 | 4.90 / 9.63 | 5.44 / 9.12 |
| Cover text #fbf5e8 on cloth | 9.72 / 8.14 | 7.78 / 5.82 | 5.58 / 5.03 | 6.21 / 5.34 |

Topics must stay clearly distinct in both themes. Current ΔE76 (light/dark): AI–Fintech 57/40, AI–Macro 68/68, Fintech–Macro 120/103, Frontier–AI 74/79, Frontier–Fintech 111/98, Frontier–Macro 47/47. Don't ship a topic colour within ΔE ~25 of another, or below 4.5:1 for text.

**Cloth weave per shelf**, so shelves differ by texture as well as hue (never colour alone): AI a fine grid, Fintech a pinstripe, Macro a linen cross-hatch, Frontier a star-dot field.

**Inside books**, palettes vary freely per book, following the 60-30-10 rule (60% base, 30% panels, 10% one accent for the thing to notice). Never use colour alone for meaning (pair it with an icon or label), and avoid red-vs-green-only pairs.

## Typography

- **Chrome:** Fraunces (serif) for book and page titles, Caveat and Kalam (hand) for headings, taglines and the "Vol. 1" mark, Inter for UI and body. All fonts are self-hosted in `assets/fonts/`.
- **Book cards:** at most 2 families per book (a display face for headings, a clean sans for body). The AI Agents template uses Caveat + Nunito. Pick a large x-height with distinct I/l/1 and 0/O. Body weight 400+.
- **Card sizes at 1600px width:** body ≥ 40px (never under 28px), headings 72–110px, line height 1.35–1.5 for body and 1.05–1.2 for heads, 35–55 characters per line, left-aligned and never justified.

## Layout

- **Phone-first.** The reader must fit the viewport with all controls on screen at 375, 390 and 430px. Shelf spines are 44px wide on phones. The site's max content width is 1180px.
- **Cards** are 1600px wide. The template is 1600×2400; the target is ~2760 tall, with a hard cap of 3700 (split the card if it would go over). No big blank areas.
- **Card anatomy:** a perspective badge and title row top-left (it matches the page title in library.json exactly), one focal picture, then 1–3 short labelled lines per idea. Keep the top-right clear (the reader's page counter sits there). "card N of M" bottom-left, the source line, and the **Atom footer stamp** on every card. No other bot names.
- Text over art always sits on a solid panel.

## Shelves: swipe rows

- **One labelled row per topic**: icon, shelf name, "N books · about M min", and **"See all →"** to the topic page. Rows scroll sideways; the page itself never scrolls sideways (checked at 360/390/412/430 and desktop).
- **Swiping must be obvious:** covers are sized so the next one **peeks** (~2.6 per phone width), with `scroll-snap`, edge fades that appear only where there's more, and 44px ← → arrows on desktop (hidden on touch). Keyboard: Arrow keys move one cover, Home/End jump to the ends. Rows are labelled regions.
- A row shows at most 10 covers, then a "+N more" tile that opens the topic page.
- **Covers show the book's own art** (a 320px WebP of the summary card, lazy below the fold), the title, a tagline, reading time ("9 min") and a state: "New", "✓ Read" or a progress bar.
- **Topic page** (`#shelf/<slug>`): sub-chips appear only when a shelf has ≥8 books and a sub-topic has ≥3; sort Suggested/Newest/Shortest; a Hide-read switch that is remembered; an honest empty state.
- **Page numbering**, one scheme everywhere: the gist is "Summary", then "Page N of M" (search, Saved and the reader all say "page N").
- **Load fast:** the shelf renders from `shelf.json` (~26KB for 24 books); the full `library.json` (page text, recaps) loads in the background and before a book opens.

## Search rules

- Search titles, taglines, page titles, takeaways and page words. Rank title > page title > tagline > body; show the **best page** first, then up to **8 books** with "Showing 8 of N · Show all".
- **Typo fixing only against real vocabulary** (words that occur in the library), with a visible **"Did you mean …"**. Never "fix" words under 5 letters; allow 1 edit, or 2 for words of 9+ letters. Never invent a match.
- **Synonyms are exact words only** (rocket → SpaceX/launch, Starlink → satellite internet, Elon → SpaceX/Starlink/Tesla, nuclear, robots…) and results found only through a synonym are labelled **"related"**. If nothing really matches, say so and offer popular searches.
- On phones the input scrolls to the top and the results panel sizes to `visualViewport`, so results stay **visible above the keyboard**.

## Motion: per-shelf signatures

- When a book opens, a **cover-wide signature** plays across the cover art area, then the cover swings open onto the summary: **Frontier** a rocket arcing across a star field with a smoke trail; **Macro** rising coin stacks with a trend arrow (alternating with an oil drop and price line); **AI** a hand-drawn neural network that fills the art area and lights up layer by layer (signals run along the wires, nodes glow), ending in a spark from the answer node; **Fintech** a card and a payment dot riding a subway map to the shop, then ✓. Every shelf has one.
- Budget **≤ 1.15s** total (820ms scene + 320ms open). Plays **once per book per visit**. Any tap, key or scroll **skips** it (120ms fade). It never covers text once reading starts, and is **off under `prefers-reduced-motion`** (the reader simply opens).
- On the shelf, tapping a cover or spine plays a ~300ms **burst** (rocket streak, coin pop, swoosh) before the open (AI: three nodes pop above the spine, wires flash and the top node sparks).

## Elevation & Depth

Depth is physical and tactile, not glassy: books lift on hover/focus (spring easing `cubic-bezier(.34,1.36,.64,1)`, 16px lift), covers have an inset spine shadow and woven cloth texture, and cards use soft paper shadows (`--shadow-1`, `--shadow-2`). The reader adds a per-topic paper stock tint. Under `prefers-reduced-motion`, all lifts, tilts and morphs switch off.

## Shapes

Hand-made, slightly imperfect: covers 3px 9px 9px 3px (bound spine edge), sketch boxes with uneven radii, pills (999px) for chips, buttons and badges, 10–12px for panels and takeaway boxes, and 18/26px for site cards.

## Components

- **Book cover:** topic cloth, the title (2–5 words), a tagline, "Vol. 1" and "ProductSnap · Pulse". No dates on the shelf.
- **Spine:** the topic label, a vertical title, the Vol mark and an optional "Start here" tag, with a tooltip on hover.
- **Gist page:** a kicker, the title, a 3-line gist and a Go button (44px).
- **Reader controls:** prev/next/close are 44px pills. Page dots keep a small visual dot with a ≥44px invisible hit area, and a tap goes to the nearest dot.
- **Takeaway caption:** under the card, tinted with the topic colour. Optional per page.
- **End card:** "You finished <title>", a recap of 1–4 lines covering every page (`check_library.py` enforces `recap_pages == pages`), plus "pairs with".
- **Optional delight:** a page-turn sound (off by default) and haptics.

## Book rules (every book)

**Story and substance**
- **Every book feels like a good movie:** a hook on the opening card (a question or surprise), rising stakes as the running example gets harder, a turn or reveal near the end, and a payoff that ties back to the hook. No flat lists of facts.
- About 700 words and picture-led. Cards 1–2 are a **picture map plus key words**. Define each term once only, never on both cards. At most ~3 new terms on any later card.
- **One running example** threads every card, with a made-up lead whose name no other book uses. Each vantage point (you, the company, the shop, the bank, the referee) is tied back to that same example. **One perspective per card.**
- Each card has enough substance that the reader can follow the whole journey. Analogies walk the full path, before and after, never a single stop.
- Where money changes hands, spell out **who pays** so it can't be misread.
- **Each book stands alone:** no cross-book references or "see the X book" pointers.

**Facts and labels**
- **Every claim is sourced** on the card (named, primary where possible). Our own arithmetic says so.
- Use one **"as of"** label per book. No ages, no stray stats, no strings of dates, no launch history.
- Spell out acronyms on first use. Pick examples that make sense in any country, and add a local equivalent for country-only terms.
- Label opinions **"Our read"** and fictional people and numbers **"Made up"**. Facts carry no label.
- No crypto hype, no politics, no paid-source content. Debates (e.g. Keynesian vs Austrian) are mirrored fairly.

**Scannable cards**
- **Cards must be scannable:** numbered steps, labeled boxes, short lines and generous white space instead of paragraphs. A reader should get the point from the headings and boxes alone.
- **Split a crowded card rather than shrinking its text.** Body text never drops below the sizes in Typography to make something fit.

**Look and surprise**
- **Varied styles per book:** each book gets a **distinct art style AND structure**. Menu (rotate, never repeat a neighbour): comic panels, one big picture + one line, tap-to-reveal, recipe cards, subway/transit map, whiteboard with a mascot, receipt, travel journal, field guide, scoreboard, board game, lab notebook, and the **dictionary-page layout** (ref `pulse_mockup/style_refs/dictionary_page.jpg`; borrow the format only, never mock real people).
- Each book has its own palette, keeping text legible and the Atom stamp intact.
- Each book has at least one **delight moment**, such as a guess-first card with the answer upside down. Phones don't rotate to upside-down portrait, so never say "turn your phone".
- Faces are whole (never cropped) and the art matches the text exactly (counts, labels, no stray logos).
- **Journey template:** AI Agents (Zara books dinner for 8). It has a picture map, money words, then the user / AI company / restaurant / bank / referee sides, and a wrap-up.

## Adding or replacing a book

- `python3 scripts/add_book.py entry --dir <book folder> --slug <id>` imports pages, the recap and sources, writes covers and rebuilds `shelf.json`. Rerunning on an existing slug **replaces** it in place, keeps its original added date, and deletes stale page images.
- **Cover art:** the shelf cover shows a 4:3 window of the book's own art. By default it's the top of page 1; when that is mostly text, set `taxonomy.json` → `books.<id>.cover = {"page": 1, "box": [x0, y0, x1, y1]}` (page pixels, about 4:3) so the cover shows the book's picture and style (e.g. Starlink's notebook pencil sketch, SpaceX's sticker-book Nia).
- **Version swaps** reuse the id: Starlink v2 and SpaceX v2 replaced their v1 entries (Oct 24, 2026) with `add_book.py entry --dir … --slug how-starlink-works` / `--slug spacex-rockets`, then `check_library.py`.

## Quality gate (before a book goes up for review)

1. **High-school backtest:** read every card end to end as a newcomer. Any spot where the dots don't connect means rework. Check every source, the one example and the labels.
2. **Contrast:** WCAG AA, 4.5:1 for body text and 3:1 for large text and key icons/arrows. axe stays clean.
3. **Tap targets:** 44px minimum everywhere, including page dots.
4. **QA matrix:** light + dark × 360/390/412/430 + desktop × Chromium and WebKit, **one browser at a time**. Scripts in `pulse_mockup/`: `qa_e2e_35.py` (journey end to end), `fit_driver.sh` (every book and page fits, one process per book), `dots_check.py`, `arrow_check.py` (arrows never cover the card or takeaway), `contrast_check.py`, `topic_colors_check.py`, plus the share/OG check and `scripts/check_library.py`.
5. Staging (pulse-preview) first, then live, then rerun live QA. Books that pass QA may be published, with a short note per batch. Structural or homepage changes need sign-off first.

## Do's and Don'ts

- Don't add a fifth topic without sign-off, don't coerce an unknown topic onto another shelf, and don't use pink anywhere but the New badge.
- Don't write paragraph cards; don't shrink text to fit (split the card).
- Don't let a signature animation run past ~1.2s, block a tap, or play under reduced motion.
- Don't let search "fix" a word into something unrelated; show "Did you mean" and label related results.
- Don't format two books the same way, and don't put the same style next to itself on a shelf.
- Don't define a word on both card 1 and card 2, or explain the same idea three times.
- Don't add ages, launch histories, date strings or stats that don't serve the story.
- Don't point to another book, and don't reuse a lead character's name.
- Don't draw the takeaway on the card, and don't put text on busy art without a panel.
- Don't put dates on covers or spines, or use titles longer than 5 words.
- Don't use colour alone for meaning, pure #000 on #fff, or justified text.
- Don't ship without the backtest and the full QA matrix. A green checker never replaces reading it as a reader.
- Do choose the reader's journey whenever style and clarity collide.

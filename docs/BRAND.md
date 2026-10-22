# Thinker brand and design system

Thinker is a reading companion: you open a PDF, ask it questions, and mark up what matters.
The look comes from a reader's desk, and the tools on it.

## The mark

The **T** is the logo (`renderer/assets/brand/t-mark.svg`, traced from the original artwork).
It always sits on a **highlighter-yellow tile** when used as an app mark, drawn in ink.

| File | Use |
| --- | --- |
| `assets/brand/t-mark.svg` | The bare T (ink). Inside tiles in the title bar, chat header and splash. |
| `assets/brand/app-icon.svg` | App icon source: yellow tile, ink T. |
| `assets/brand/app-icon-512.png`, `app-icon-256.png`, `build/icon.ico` | Generated. Run `npx electron scripts/render-brand.js` after changing the SVG. |
| `assets/brand/wordmark.svg` | Tile + "Thinker" for documents and the README. |

Rules: keep clear space of half the tile's width around it; do not recolour the tile on
light backgrounds; do not stretch or rotate it (the splash screen's gentle float is the only
exception).

## Colour: the reader's desk

Four colours, each a tool on the desk:

| Role | Light ("Paper") | Dark ("Ink") |
| --- | --- | --- |
| **Ink** (text, the T) | `#1c1b2e` | `#f3f0e6` |
| **Paper** (background / surfaces) | `#f4f1e9` / `#ffffff` | `#121120` / `#1a1930` |
| **Highlighter** (brand, primary actions, "you are here") | `#ffd23f` | `#ffd23f` |
| **Pen** (links, focus, AI accents) | `#4f46e5` | `#9c95ff` |

All values live in `renderer/css/tokens.css` as semantic tokens (`--surface`, `--text-2`,
`--primary`, `--accent`...). Components never use raw colours, so both themes and the
user's accent choice work everywhere. The accent setting changes `--primary` (buttons and the
active pill); text on it flips between ink and white automatically.

Yellow is reserved for **primary actions** and **where you are** (active rail item, the
greeting's highlighter swipe, your own chat messages). Indigo marks **navigation and AI**
(links, focus rings, citation chips). Status colours (green / amber / red) are only for status.

## Type

- **Fraunces** (soft serif) for brand moments: the wordmark, greetings, panel and dialog
  titles, glossary terms. It is what makes Thinker feel like a book rather than a dashboard.
- **Inter** for everything you read or click.
- Scale: 12 / 13 / 14 / 16 / 18 / 22 / 30 / 44 px (`--text-xs` ... `--text-3xl`). Body is 14px.
- Never put body text below 12px.

## Shape, space, motion

- 4px spacing grid (`--space-1` ... `--space-10`); radii 6 / 10 / 14 / 20.
- Elevation is three soft shadows (`--shadow-1/2/3`); no glows, no animated gradients.
- Motion is short (120-200ms), eases out, and always respects `prefers-reduced-motion`.

## Layout

- Title bar (44px) holds the brand and the document tabs. Tabs are not a second row.
- A labelled navigation rail (72px): where you are (Home / Reader / Settings) is highlighted
  yellow; panels and chat are soft toggles.
- The toolbar is one row and never wraps. It adapts to the width it actually has (container
  queries): the fit menu goes first, then the camera, then the layout switcher.
- Chat docks beside the document from 1360px; below that it is a drawer that starts closed.
- Minimum window size is 960 x 620.

## Voice

Warm, short, plain. Say what happened and what to do next.
"Nothing here yet. Open a PDF and it will wait for you here." beats "No recent files."
Errors name the fix: "Your saved API key could not be unlocked on this computer. Open Settings
and enter it again."

## Building blocks

`css/` is split by concern, loaded in this order by `index.html`:
`tokens` > `base` > `components` > `shell` > `screens` > `panels` > `chat` > `overlays` > `pdf`.
`pdf.css` holds functional rules for the document layers; change it with care.
After any layout change, start the app with `--remote-debugging-port=9222` and a PDF, then run
`node scripts/ui-tour.mjs <outDir>`. It screenshots every view in both themes at four window
sizes and fails on horizontal overflow or clipped text.

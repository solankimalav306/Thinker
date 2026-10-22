# UI stress testing

`scripts/ui-stress.mjs` drives the real app over the Chrome DevTools Protocol and checks it against
awkward, real-world conditions. Run it before any UI release.

```
node scripts/make-ui-fixtures.js <fixturesDir>          # awkward PDFs: long/Unicode/symbol names,
                                                        # corrupt, empty, 300 pages, mixed sizes
npx electron . --user-data-dir=<throwaway copy> --remote-debugging-port=9222 <fixturesDir>/single-page.pdf
node scripts/ui-stress.mjs <outDir> <fixturesDir> [docs,text,tabs,viewports,audit,interact]
```

Use a throwaway copy of the app data: the tests wipe AI profiles and seed hostile content.
Password-protected fixtures need `pip install pypdf` (see the encrypt step in the session notes).

| Section | What it checks |
| --- | --- |
| docs | Every fixture opens or fails with a plain-language state; locked PDFs ask for the password; pages are fitted to the window; 300 pages stay responsive |
| text | Hostile and extreme text (markup, 400-char words, RTL, emoji, tables, code) stays inert and inside its panel in chat, notes, glossary, mind maps |
| tabs | Many tabs, long names, nothing under the window controls |
| viewports | Eight window sizes and display scales in both themes, no horizontal overflow |
| audit | WCAG contrast (4.5:1) for every visible text, minimum text size, fonts, icons that fail to resolve, hit targets, real Tab-key focus rings; both themes, five accents |
| interact | No-AI-model guidance, form validation, Escape closes dialogs, rapid clicks, long toasts |

`scripts/ui-tour.mjs` is the quicker screenshot-only tour used while designing.

# The user manual

`frontend/public/tie-me-ghana-manual.pdf` is generated, not written by hand.
Editing it directly means the next build overwrites the edit.

## Regenerating it

With the app running locally:

```bash
cd frontend
npm run dev                      # in one terminal
npm run manual                   # in another
```

`npm run manual` does two things:

1. **`manual:capture`** drives a real Chrome over the DevTools Protocol,
   walks the app to each documented screen, and writes `shots/*.png` plus
   `screens.json`.
2. **`manual:pdf`** turns those into `manual.html` and prints it to
   `frontend/public/tie-me-ghana-manual.pdf` using the same Chrome.

Pass `--base` if the dev server is somewhere other than `http://localhost:5183`.

Neither step adds a dependency. Both use the Chrome already installed and
Node's own `fetch` and `WebSocket`. Documentation tooling has no business
appearing in the bundle a hospital downloads.

## Why the callouts are measured rather than drawn

Each numbered callout names a CSS selector. The capture asks the running app
where that element actually is and records the rectangle. The manual then
places the ring and the arrow from that measurement.

A callout positioned by hand is correct on the day it is drawn and quietly
wrong after the next layout change, which is how manuals come to point at the
wrong button. These cannot: if the control moves, rerunning the capture moves
the callout with it, and if a control is renamed or removed the capture reports
the selector as not found rather than printing a figure with a number pointing
at nothing.

## Editing the text

The prose lives in `frontend/tools/build-manual.mjs`:

- `EXPLANATIONS` is what each numbered callout says, keyed by selector.
- `SECTIONS` is the introduction and the numbered steps for each screen.
- The sections that have no screenshot, on connections, privacy and
  troubleshooting, are written inline in `page()`.

A test asserts that every callout the capture measured has an explanation, so
adding a callout without writing its entry fails the suite rather than printing
a number with nothing beside it.

## Adding a screen

Add an entry to `SCREENS` in `frontend/tools/capture-manual.mjs` with the
selectors to call out, then a matching `EXPLANATIONS` and `SECTIONS` entry in
`build-manual.mjs`, then rerun `npm run manual`.

## Size

The PDF ships in `public/`, so it is downloaded by anyone who opens the link
and it counts against the repository. Two things keep it reasonable:
screenshots are captured at 1.5x rather than 2x, which is about 310 dots per
inch at the size a figure prints, and their palettes are reduced to 200
colours, which is invisible on flat interface colours. It is currently around
745 KB, against a pre-commit limit of 1024 KB.

The service worker does not precache it. Its glob covers scripts, styles,
markup, fonts and images, so a PDF of this size never lands on a device that
has not asked for it.

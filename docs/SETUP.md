# SETUP

## Requirements

- Node 18.17+ (Node 20+ recommended; `.nvmrc` pins 22)
- `npm install` once: sharp is the only dependency, and it is not optional - it
  is what strips metadata and bakes in EXIF orientation

## Quick start (any instance)

```sh
npm install
npm run seed            # optional: 12 sample photos into photos/
npm run build           # -> dist/
npm run serve           # http://127.0.0.1:3100/
npm test                # unit + end-to-end checks, ~1s, no browser
```

To run your own wall, copy `wall.config.example.json` to `wall.config.json`,
set `title`, `description` and `siteUrl`, and put your photos in `photos/`.
Nothing else in the repo is instance specific.

## One-time GitHub setup

1. **Pages source**: repository Settings > Pages > Build and deployment >
   Source = "GitHub Actions". The workflow deploys the committed `dist/`; it
   does not build from a branch.
2. **Custom domain**: Pages > Custom domain, with the DNS record pointing at
   GitHub Pages. `CNAME` is copied into the build, and it also provides the
   default `siteUrl` for the canonical link, `og:url` and `sitemap.xml`.
   Without a CNAME, set `siteUrl` in the config if you want those tags.

## Daily flow - updating the wall

1. Drop or rename image files in the local `photos/` folder (gitignored, never
   pushed).
2. `npm run build` - re-encodes the photos and rebuilds `dist/` from scratch.
3. `npm run serve`, look at it, and check the build log (photo count, canvas
   size, bytes saved, ignored files).
4. Commit and push. `dist/` is committed on purpose: it is the deployable site.
   CI runs the tests, the structural check and the build-stamp check, then
   deploys.
5. The live site is whatever the CNAME points at.

Notes:

- Accepted formats: `jpg`, `jpeg`, `png`, `webp`, `gif`. GIFs are converted to
  a still PNG (first frame); HEIC/AVIF are not scanned and are reported as
  ignored - convert them to jpg first.
- A filename ending in `-x` before the extension (`IMG_1234-x.jpg`) is always
  full width. On top of that, `layout.heroRate` (default 3 out of 10) of the
  unmarked portraits are promoted by a stable hash; set it to `0` for full
  manual control.
- Captions show up to two lines by default (year + exposure, then camera), all
  switchable in `captions`, and any line can be overridden per photo with
  `photos/captions.json`. GPS is never read or shown.
- Clicking (or tapping) a photo zooms and pans so that photo fills the screen;
  Cmd/Ctrl-click, middle-click or Enter on a focused frame opens the full-size
  file instead. The "fit the whole wall" button (or Home) zooms back out.
- Dark mode is automatic; the wall follows the OS/browser preference.
- Every published photo is re-encoded: longest side capped at `images.maxEdge`
  (2048 px), JPEG q`images.quality` (82), metadata stripped, EXIF rotation baked
  in, plus a 24px inline placeholder per photo. The originals in
  `photos/` are never modified and never leave your machine. Sizes vary with the
  photos; the reference instance serves 101 photos as ~25 MB from ~830 MB of
  originals.
- The build wipes and rebuilds its output directory. It refuses to run when the
  output path would contain the photos or the project (see `checkPaths`), and
  refuses to wipe a non-empty directory that is not a previous build unless you
  pass `--force`.
- If a photo cannot be published, the build stops with exit code 3 and writes
  no page, rather than shipping a wall with a broken frame.

## Local preview

```sh
npm run build                 # regenerate dist/ from photos/
npm run serve                 # http://127.0.0.1:3100/
```

`npm run serve` is a small zero-dependency Node server (`scripts/serve.js`), so
no python3 is needed. `dist/` is committed - it is the deployable site.

While iterating on looks, `npm run build` takes about a minute for a 100-photo
wall (most of it re-encoding), and roughly a second for a seeded fixture.

## Checks before pushing

```sh
npm test
node scripts/check-build.js dist    # structure of the committed page
npm run stamp                        # dist/ matches gen.js + wall.config.json
```

CI runs the same three, plus a full build from seeded fixtures, so a stale
`dist/` or a broken generator cannot reach the live site.

## Debugging on a phone

The wall can only really be judged on a device, and a device-only crash has to
be narrowed down on the device:

1. **The system's own crash log** - on iOS: Settings > Privacy & Security >
   Analytics & Improvements > Analytics Data. A `JetsamEvent-<date>` entry means
   the tab was killed for memory (the header names the process and its
   footprint), while a `Safari-` or `WebContent-` entry means the web process
   crashed. That distinction decides whether the fix is about memory or about
   rendering. On Android, `adb logcat` shows the same information.
2. **Reproduce it in a desktop WebKit** - Playwright's WPE build runs on Linux
   once `libicu74` and `libjpeg-turbo8` are dropped into its bundle. Compare the
   *web process* memory (never the sum across WebKit's processes, which
   double-counts shared memory): `/proc/<pid>/status` for anything named
   WebKitWebProcess.
3. **What to report**: whether the page went blank, reloaded, or showed an error,
   how far you had zoomed, and what you did immediately before it went.

Anything that changes the rendering path must be tested on the phone before it
is merged. The engine is deliberately not a template: see
[ARCHITECTURE.md](ARCHITECTURE.md).

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `sharp is required (npm install)` | dependencies are missing; run `npm install` |
| `refusing to build: outDir ...` | the output path would delete photos or the project; use the default `dist`, or `--force` for a non-build directory |
| `failed to publish N photo(s)` | a file changed or became unreadable during the build (often a photo still copying from a card); re-run |
| a photo is missing from the wall | the build log lists every ignored file with a reason |
| CI: `stamp check: dist/index.html is stale` | run `npm run build` and commit `dist/` with the source change |
| the wall looks empty in the preview | check the console: the page needs JavaScript for the interactive wall, or the noscript grid shows without it |
| the page is blank and the console shows a syntax error | the engine script is generated: run `npm test` and `node scripts/check-build.js dist`, which compile it |

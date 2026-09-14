# CODE REVIEW - jpg.krisztian.wtf (2026-09-10)

Review of the photo-wall generator and site, done with OSS release ("Keret") in
mind. Baseline: commit `e2d9707` + the staged docs changes, 101 photos in the
local `photos/`.

Method: full read of `gen.js` (1207 lines), `scripts/seed-placeholders.js`,
`pages.yml`, all of `docs/`; a scratch rebuild (`node gen.js photos <tmp>`);
automated analysis of the built `POS` data (overlaps, bounds, referenced-vs-
present files); a headless-Chromium load of `dist/` (console errors, culling,
keyboard, light/dark, mobile emulation); and a byte/memory measurement of what
the page actually downloads. Every claim below was measured, not assumed -
reproduction commands are at the end.

Actionable items live in [TODO.md](TODO.md), keyed by the `R-nn` ids below.

## Verdict

The engine is in good shape: the build is deterministic, the layout has zero
overlaps, the page runs clean in a browser, and the build-time image handling
(header parsing, EXIF, sharp pipeline) is genuinely well written and
dependency-free.

It is **not yet safe to hand to strangers**. Three blockers: the build can
delete the photo originals (`R-01`), it can publish a page that references
images it failed to write while exiting 0 (`R-02`), and the "metadata is
stripped" privacy promise silently disappears when `sharp` is missing (`R-03`).
On top of that, the fit-view decodes ~1 GB of image data to draw 73px frames
(`R-07`), and nearly every doc in `docs/` contradicts the code it describes
(`R-16` to `R-20`).

## Verified correct

- Build is reproducible: a scratch rebuild produced a **byte-identical**
  `index.html` to the committed `dist/` (94,831 bytes), so `dist/` is in sync
  with `gen.js`.
- Layout: **0** overlapping frame pairs out of 101; canvas 6792x7088 with
  exactly `PAD` (260px) slack on all four sides; every referenced image exists
  in `dist/photos/` and there are no orphan files there.
- Browser: no console errors, no page errors, no failed requests on load
  (desktop light, desktop dark, 390x844 mobile emulation). Culling works (18
  items visible at open, 6 at 196%, 101 after fit). Fit lands exactly on the
  whole wall (12%).
- Zero-dep image parsing works: `Make`/`Model` tags found in 101/101 originals,
  orientation handled, `-x` markers and captions render.
- Privacy, normal path: GPS (IFD 0x8825) is never followed; sharp re-encodes so
  metadata is dropped; originals are gitignored and never committed.
- No secrets in git history (`.github-token`, `.git-credentials`, `ghp_*`,
  `x-access-token` all absent); the remote URL carries no token; both credential
  files are ignored and untracked.
- Performance of the build itself is fine: 828 MB of originals to 25 MB served
  in 52 s.

## P0 - fix before any OSS release

### R-01 The build can delete the photo originals (data loss)

`gen.js:27-28` takes `outDir` from argv and `gen.js:1164` does
`fs.rmSync(OUT_DIR, {recursive:true, force:true})` with no guard.

Measured: `node gen.js photos photos` **deleted the original photo**, then
finished with exit 0 and no warning (the write step only logged
`skip DSC00339.jpg: ENOENT`). One mistyped argument destroys the only copy of
photos that the whole design keeps out of git. `node gen.js photos .` is also
broken, it aborts with `EINVAL: invalid argument, rmdir '.'` (exit 1, no damage
in my run, because Node refuses `.` itself after deleting children - luck, not
a guard).

Fix: refuse to run when `outDir` resolves to the same path as `photosDir`, an
ancestor of it, or a non-empty directory that does not look like a previous
build output (no `index.html`) unless `--force` is passed. Print the resolved
absolute paths at the start.

### R-02 Photos that fail to write stay in the page as broken frames

`gen.js:1169-1183`: the layout is computed first, then each photo is written;
a failure `continue`s the loop (`gen.js:1177-1178`) but the photo is still in
`laid.photos` and therefore in the page JSON.

Measured: in the same footgun run the build reported `wall: 1 photos` and wrote
an `index.html` referencing `DSC00339.jpg`, which exists nowhere - a permanent
black `.pbox` on the live site. The code's own comment says this is expected
("photos may be mid-copy/rename while building"), so it will happen in normal
use when a photo is still being copied off a card.

Fix: after the write loop, verify every `dist/photos/<file>` exists, drop the
missing ones from the layout, rebuild the page, and exit non-zero if anything
was dropped. The count printed must be the number of images actually served.

### R-03 "Metadata stripped" is silently lost without sharp

`gen.js:1054` loads sharp in a `try/catch`; `gen.js:1063-1066` and
`gen.js:1088-1092` then copy the **original bytes** (EXIF, GPS, thumbnail) into
the published `dist/`. `docs/SETUP.md` promises "metadata stripped" and the
README calls `npm install` optional ("first time only").

Their 101 originals currently carry no GPS IFD (verified), so nothing is leaking
today, but a photographer who geotags their photos would publish coordinates on
the first `npm ci` failure, silently.

Fix: make sharp a hard requirement for `jpg/jpeg/png/webp` (fail the build with
a clear message), or strip metadata in the fallback, or require an explicit
`--allow-unstripped` flag.

## P1 - real bugs

### R-04 `POS[].h` is the sort hash, not the image height

`gen.js:359` - `layout()` builds `{...p, aspect, h: hashFile(p.file)}`, so the
intrinsic height is overwritten by the FNV hash in the object it returns; that
hash is then used as the hero lottery (`gen.js:373`, `p.h % 10`) and is emitted
as `h` in the page JSON (`gen.js:481-485`).

Measured: **0 of 101** `POS` entries have a plausible pixel height; every `h` is
a 32-bit hash. The page happens to ignore `d.h` today, so nothing breaks - but
`w`/`h` are 2.5 KB of dead payload and any future use is silently wrong.

Fix: keep `w`/`h` as real pixels, add a separate `hash`/`sortKey` field for the
ordering and hero pick (or drop `w`/`h` from the page JSON entirely).

### R-05 `title` is computed, embedded, never rendered

`gen.js:1152` builds `title` for every photo, `gen.js:484` puts it in the JSON
(2,686 bytes), and the client only ever renders `d.spec` and `d.cam`
(`gen.js:727`, `// filename line hidden for now`). Measured: 101/101 entries
carry a title and `d.title` appears nowhere in the page script.

Fix: either render the filename line (`docs/SETUP.md` still documents it as
visible) or drop the field; do not ship both answers.

### R-06 Page JSON is injected into `<script>` unescaped

`gen.js:481-485` + `gen.js:677`: `JSON.stringify(...)` is interpolated straight
into the inline script. `JSON.stringify` does not escape `<`, so a filename (or
an EXIF `Make`/`Model` string from a foreign photo) containing `</script>`
closes the tag early and injects markup into the page.

Fix: one line - `.replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ...)` on the
serialized JSON - plus a build assertion that the POS blob contains no
`</script`.

### R-07 The fit view decodes ~1 GB of image data to draw 73px frames

Measured in headless Chromium at 1440x900:

| view | photos requested | transferred | decoded |
|---|---|---|---|
| open (75%) | 18 | 4.7 MB | 18 |
| after "fit" (12%) | 101 | 25.1 MB | 101 |

At fit, all 101 served copies (up to 2048px wide) are decoded at full
resolution - 278 megapixels, about **1,061 MB** of RGBA - to paint frames whose
widest on-screen box is **73 CSS px**. That is the memory profile that kills
mobile Safari tabs, and it is reachable with one click on the home button.

Fix: serve a low-res tier (roughly 256px, so 4x DPR at fit is still covered) and
switch tiers by zoom + DPR, or generate tiles. Until then, cap `MAX_SCALE` by
the served resolution and consider loading high-res only above a zoom threshold.
This is the same item as the "zoom-aware image sources" note in the old TODO,
now with numbers attached.

### R-08 A failed image leaves a permanent black hole

`gen.js:566` gives `.pbox` `background:#000` and there is no `onerror` handler;
if a request 404s or fails to decode, the blurred placeholder fades and a black
rectangle stays on the wall forever.

Fix: on `error`, keep the `.pbg` thumbnail visible (do not add `.loaded`) and
give the box a neutral placeholder rather than black.

### R-09 Small walls are laid out badly

`gen.js:1110-1120` searches `COLS` 4..14 regardless of how many photos exist,
and `gen.js:421` starts every column at `PAD`, so an unused column has height
`-GAP` (-64) and is treated as the "shortest" by the arch reorder
(`gen.js:450-466`), which parks it at the outer edge.

Measured, one landscape photo: canvas 3272x1016, the single frame at x=964 -
964px of slack left, 1668px right, so the composition is visibly off-centre in a
mostly-empty canvas. A fresh clone that seeds 12 placeholders is the same class
of case (12 photos still get 4+ columns).

Fix: `COLS = clamp(ceil(sqrt(brickCount)), 1, 14)`; skip empty columns when
computing `canvasW`; and lay out the arch/salon centring from the occupied
columns only.

### R-10 Interaction edge cases

- After a two-finger pinch, `dragStart` is null (`gen.js:843-844`) so the
  `moved` test at `gen.js:857-858` compares `clientX` with itself and stays
  false; the trailing `pointerup` can then be read as a double-tap
  (`gen.js:948-958`) and jump the zoom 2.2x.
- Three fingers: neither branch of `gen.js:860-900` runs, and `endPointer`
  (`gen.js:903-911`) only clears `pinch` when fewer than 2 pointers remain, so
  going 3 -> 2 resumes with a stale `lastDist`/midpoint and the view jumps.
- `gen.js:991-1010` ignores modifiers: Cmd/Ctrl `+`/`-` (browser zoom) is
  hijacked by `preventDefault`, and the handler would also fire while typing in
  any future input.

Fix: gate the double-tap on `!pinched`, reset `pinch`/`dragStart` on any pointer
count change, and bail out of the keydown handler on modifier keys or when
`e.target` is an editable element.

### R-11 Build log cosmetics

`gen.js:1196-1198`: `savedMb` can be negative, producing `(- -0.0 MB)`
(measured in a 2-photo build). The photo count printed at `gen.js:1195` is the
layout count, not the served count (see `R-02`), and the mode line
(`optimized` / `copied as-is`) is decided at `gen.js:1188` but printed after it.

### R-12 Filenames are not URL-encoded

`gen.js:702` - `img.src = 'photos/' + d.file`. Spaces work by accident (browsers
encode them), and the repo already holds `DSC08737 (2).jpg`; a `#`, `?`, `&` or
`%` in a filename silently requests the wrong URL (`#` becomes a fragment).

Fix: `'photos/' + encodeURIComponent(d.file)` (and `encodeURIComponent` on the
per-segment path in any future sub-directory support).

### R-13 GIFs and the fallback path ship originals verbatim

`gen.js:1063` passes GIFs through untouched (sharp cannot encode them) and
`R-03` covers the sharp-less path. A GIF keeps its original bytes, its size and
any embedded comment/XMP blocks; an animated GIF also bypasses the 2048px cap.

Fix: transcode the first frame to JPEG/WebP (sharp can read GIF), or refuse
GIFs with a clear message and document conversion.

### R-14 Unsupported-but-common formats vanish silently

`IMAGE_EXTS` (`gen.js:34`) has no HEIC/AVIF, which is what iPhones produce by
default. Those files are not scanned and not reported as skipped (only
dims-unknown files are, `gen.js:1140`), so "my photos are missing" has no
explanation in the log.

Fix: report every ignored file with a reason (`unsupported extension`,
`unreadable`, `dims unknown`), and mention HEIC conversion in the message.

### R-15 The layout comments promise stability the code does not have

`gen.js:339` and `gen.js:15-16` claim "earlier photos never move when new ones
are appended"; `README.md` claims "deterministic from filename order". Order is
actually hash-scrambled (`gen.js:364`), pairs re-form greedily
(`gen.js:379-384`), then columns and the arch silhouette rebalance globally, so
adding one photo can re-lay the whole wall - and `naturalSort`
(`gen.js:291-312`) is effectively only a hash-collision tiebreak.

Fix: state the real contract in code and docs: byte-stable for a given photo
set, not additive-stable.

## P2 - docs contradict the code

The project convention says docs are checked first when context is lost, so
stale docs are a correctness problem, not cosmetics.

- **R-16 README**: "The layout is a tidy grid: uniform-height rows of framed
  photos (museum hang)" and "Layout is deterministic from filename order" are
  both wrong - the wall is hash-scrambled masonry with portrait pairing.
- **R-17 ARCHITECTURE**: "max = x5" (now 4, `gen.js:678`); `GAP_X`/`ROW_GAP`
  (one `GAP` now); "`-x` is the ONLY photos that display full-size ... No
  automatic full-size rule exists" - the code has `HERO_RATE: 3`
  (`gen.js:323`, `373`); "date is parsed but not displayed" - the year is
  prefixed to the spec line (measured: `"spec":"2020 - 70mm f/2.8 1/80s ISO
  1000"`); "camera above, exposure specs below" - the page renders spec first,
  camera second (`gen.js:727`).
- **R-18 API**: documents `OPEN_WORLD`, which no longer exists; says `layout()`
  returns `rows` and per-photo `iw/ih` (it returns `{photos, canvasW, canvasH,
  cols}` with neither); documents `POS` as `{...,c1,c2}` (actual keys:
  `title, spec, cam, thumb`, plus the bogus `h` from `R-04`); "zero npm
  dependencies" next to a `sharp` dependency; documents `COLS: 6` while the
  build auto-picks 4..14; and says CI runs `node gen.js` - it does not.
- **R-19 SETUP**: "three-line caption: file name, specs, camera" (the page
  renders two lines and the filename line is deliberately hidden); "435 MB of
  originals served as ~10 MB" (now 828 MB -> 25 MB); `python3 -m http.server`
  only (no Windows note); the daily flow never says that `dist/` must be
  rebuilt before every push.
- **R-20 CHANGELOG**: contains a truncated fragment (`photos/ folder - node
  gen.js optimizes them ...` at the end of the 2026-09-08 section) and is
  missing the most recent work: hero portraits (`eb3efd3`), loading polish
  (`d2d2583`), the portrait hash rule, the wall rebuild after renames
  (`baf66cb`) and the iOS Safari crash fix (`e2d9707`).

## P2 - OSS readiness

- **R-21 License and repo furniture**: the repo is already public
  (github.com/krisztianhadi/jpg.krisztian.wtf) and has **no LICENSE**, so it is
  "all rights reserved" to anyone who finds it. Also missing: CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, issue/PR templates, `.editorconfig`, `.nvmrc`,
  `.gitattributes`. Note the trap: `.gitignore`'s first line `.*` silently
  ignores root dotfiles - verified with `git check-ignore` for `.editorconfig`,
  `.nvmrc` and `.gitattributes` - so each new one needs an explicit negation.
- **R-22 Instance config is hard-coded**: title (`JPG BY K`), meta description,
  umami website id + `data-domains`, favicon SVG, CNAME, photos dir, open zoom,
  `MAX_SCALE` and all of `LAYOUT`/`OPTIM` live in `gen.js` and its template. One
  config object (or `wall.config.json`) is the prerequisite for a second
  instance and for "a fresh clone is not JPG BY K".
- **R-23 No self-check**: there is no `npm test`. A `test/` suite should build
  from a temp fixture (the seeded placeholders are ideal), assert determinism
  (byte-identical rebuild), zero frame overlaps, ~square canvas, every
  referenced image present, no `</script` in the data blob, and then load
  `dist/` headless and assert no console errors with culling working. Working
  prototypes of exactly these checks are in `.tmp-review/` (`check-build.mjs`,
  `smoke.cjs`, `perf.cjs`, `mem.cjs`) and can be promoted almost as-is.
- **R-24 CI verifies nothing**: `pages.yml` uploads whatever `dist/` is
  committed - no build, no checks, and it would happily deploy a stale or
  hand-edited `dist/`. Actions are pinned by tag, not SHA; there is no `paths`
  filter; nothing guards against deploying a `dist/` that no longer matches
  `gen.js` (a commit-stamp comment written by the build would let CI assert
  freshness). Add a PR job that runs the fixture build + self-check.
- **R-25 `package.json`**: still instance-named (`jpg-wall`), no `engines`
  (sharp 0.35 needs Node 18.17+), no `license`, `repository`, `bugs`,
  `homepage`, no `test`, and no dev-server script although the README asks the
  user to run `python3` (not available on a stock Windows box). The lockfile is
  committed - good.
- **R-26 No social/no-JS/no-search surface**: no `og:`/`twitter:` tags and no
  `og:image`, so sharing the link (the main way a photo page travels) shows a
  bare URL; the sibling `krisztian.wtf` repo already does this properly and
  sharp could bake a hero OG image at build time. There is no `<noscript>`
  fallback (JS off = a header on an empty page, which also means the images are
  invisible to search/image indexing), no `robots.txt`/`sitemap.xml`, and the
  favicon is an inline data-URI only (no apple-touch-icon).
- **R-27 Analytics is hard-wired**: the umami script with website id and
  `data-domains` is in the template (`gen.js:494-495`); for OSS it must be
  config-gated (and ideally self-hosted or SRI-pinned).

## P3 - accessibility and polish

- **R-28 a11y** (measured): all 101 `alt` values are raw filenames
  (`"DSC07904"`); only 3 focusable elements exist (the controls) and there is no
  keyboard or screen-reader path to any photo, no `<main>`/landmarks; caption
  text is 11px; `--ink-dim` on the glass chrome computes to **3.07:1** in light
  mode (**4.45:1** dark) for the hint and the zoom label, under the 4.5:1
  requirement; the viewport meta sets `maximum-scale=1, user-scalable=no`
  (`gen.js:491`), which blocks page pinch-zoom (WCAG 1.4.4) - a defensible
  trade-off for a canvas app, but it must be a documented decision because axe
  will flag it; control buttons are 34px against the 44px touch guidance; the
  hint is `display:none` on coarse pointers, so touch users never learn the
  gestures; and `prefers-reduced-motion` is not handled anywhere (verified: no
  such media query in the built page) although inertia glide and transitions
  are central to the feel.
- **R-29 Render nits**: a `filter: blur(12px)` layer per photo (up to 101) is
  composited while loading; consider `fetchpriority=high` on the first
  viewport images (LCP), debounce the `resize` handler (`gen.js:1026`), and see
  the stepped-culling idea in the old TODO.
- **R-30 Zoom ceiling vs source resolution**: `MAX_SCALE = 4` with 2048px
  served copies means a 600px brick is 2400 CSS px (4800 device px on a 2x
  phone) - visibly soft. Derive the ceiling from the served resolution
  (2048/600 = 3.4) or generate tiles; either way document the contract.
- **R-31 Repo growth**: committed `dist/` is 26 MB for 101 photos and grows with
  every batch; that is the intended trade-off (originals stay local) but it
  deserves a line in the docs, plus a `.nojekyll` for robustness if the Pages
  source is ever switched away from GitHub Actions.
- **R-32 Device testing gap**: the iOS Safari crash fix (`e2d9707`) and pinch
  behaviour were only verified on desktop Chromium and emulated mobile here; a
  real-device pass is still the only ground truth and belongs in the release
  checklist.
- **R-33 No way to author real captions**: EXIF is the only caption source, so
  every photo is captioned with camera telemetry and its filename. An optional
  sidecar (`photos/captions.json`, or `photo-name.txt`) for title, alt and
  credit is the single biggest product gap both for the personal page and for a
  public instance.

## Reproduce

```sh
# scratch build (never touches the committed dist/)
node gen.js photos .tmp-review/dist-check

# layout/data checks on a build
node .tmp-review/check-build.mjs .tmp-review/dist-check

# headless smoke + perf (needs a static server on :3199)
python3 -m http.server 3199 -d dist --bind 127.0.0.1
PLAYWRIGHT_BROWSERS_PATH=/home/k/Code/ghosted/.tmp-review/pw-browsers \
  node .tmp-review/smoke.cjs
PLAYWRIGHT_BROWSERS_PATH=/home/k/Code/ghosted/.tmp-review/pw-browsers \
  node .tmp-review/mem.cjs

# the data-loss case, safely, on a scratch copy
mkdir -p /tmp/x/photos && cp gen.js /tmp/x/ && cp dist/photos/<any>.jpg /tmp/x/photos/
cd /tmp/x && node gen.js photos photos && ls photos   # original is gone
```

The helper scripts above are review artifacts in the gitignored `.tmp-review/`;
promote the useful ones into `test/` (R-23) rather than reusing them in place.

# ARCHITECTURE

## Pieces

```
photos/                     originals - LOCAL ONLY (gitignored, never pushed)
  captions.json             optional sidecar: title / alt / credit per file
gen.js                      build entry point (CLI + orchestration)
src/config.js               defaults, wall.config.json, env + CLI overrides, path guards
src/images.js               header + EXIF parsing, scanning, re-encoding (sharp)
src/layout.js               wall geometry (bricks, columns, arch, centring)
src/page.js                 the published page: HTML + inline CSS + viewport engine
src/stamp.js                build stamp (source hash) written into index.html
scripts/seed-placeholders.js sample photo generator (also the test fixtures)
scripts/serve.js            zero-dep preview server
scripts/check-build.js      structural check of a built dist/ (no browser)
scripts/check-stamp.js      fails when dist/ is older than the source
test/                       node:test suite
.github/workflows/ci.yml    tests + fixture build + stamp check
.github/workflows/pages.yml verifies, then deploys the committed dist/
dist/                       optimized, deployable site (committed)
CNAME                       custom domain; also supplies the default siteUrl
wall.config.json            instance configuration
```

## Build pipeline

1. **Configure** - `src/config.js` merges the built-in defaults, `wall.config.json`
   (or `--config` / `WALL_CONFIG`), `WALL_*` environment variables and CLI flags,
   in that order. Unknown keys, wrong types and out-of-range numbers are hard
   errors, so a typo cannot silently do nothing.
2. **Guard** - before anything is deleted, the resolved paths are checked: the
   output may not be the photos directory, sit inside it, contain it, or be the
   project root or above it. A non-empty output directory that is not a previous
   build is refused unless `--force` is passed. (`checkPaths` in `src/config.js`;
   the build wipes its output, so this is the one place where a typo would be
   destructive.)
3. **Scan** - `photos/` is read for `jpg/jpeg/png/webp/gif`. Hidden and
   underscore-prefixed names, non-images and directories are reported with a
   reason rather than skipped silently.
4. **Measure** - each image is measured by parsing its header (no image library):
   JPEG SOF marker, PNG IHDR, GIF logical screen descriptor, WebP VP8/VP8L/VP8X.
   JPEG dimensions are swapped for EXIF orientations 5-8, so the baked aspect
   ratio matches what a browser renders.
5. **Read EXIF** (JPEG APP1 `Exif`, PNG `eXIf`) with a small zero-dependency TIFF
   reader: camera make/model, focal length, f-number, shutter, ISO, date taken.
   The GPS IFD (0x8825) is deliberately never followed.
6. **Re-encode** every photo with sharp into `out/photos/` (longest edge
   `images.maxEdge`, JPEG q`images.quality`, metadata stripped, EXIF orientation
   baked in, GIF decoded to a still PNG), plus a 24px inline placeholder per photo. sharp is a hard
   requirement: the alternative would publish the originals with their EXIF,
   GPS included.
7. **Fail loudly** - every published copy is verified to exist and be non-empty.
   If any photo cannot be published the build stops with a non-zero exit code
   and writes no page. A wall that references a missing file is worse than a
   failed build.
8. **Lay out** (world coordinates, 1 world px = 1 CSS px at scale 1): see below.
9. **Render** one self-contained `out/index.html` from the asset templates (the
   verified CSS and engine, with the wall data and the instance metadata filled
   in), plus `og.jpg` (copied from `og.source` when that file exists - this
   repository ships a designed card at `assets/og.jpg` - otherwise generated from
   a photo), `apple-touch-icon.png`, `robots.txt`, `sitemap.xml` (when
   a site URL is known), `CNAME`, `.nojekyll` and a build stamp comment
   recording the hash of the generator source that produced it.
10. **Report** - photo count, canvas size, bytes saved, which
    social image was used, whether analytics is on, and every ignored file.

## Layout

A column slot is a **brick**: either one full-width photo (`layout.long` world
px) or two portrait photos side by side scaled so their combined width fills the
same slot, so a pair reads as a landscape tile and portraits never tower over the
column rhythm. Photos keep their exact aspect and are never cropped.

- A filename ending in `-x` (`layout.markSuffix`) is always full width.
- On top of that, a stable hash-selected slice of unmarked portraits
  (`layout.heroRate` out of 10, never extreme 9:16 shapes) is promoted to full
  width for rhythm. Set `heroRate: 0` for full manual control.
- A leftover unpaired portrait stays a single full-width brick rather than
  leaving a hole in the column rhythm.
- Bricks are ordered by a hash of the filename (so the wall never shows
  chronological or name clusters), then flow into equal-width columns, shortest
  column first.
- The column count is chosen automatically (`layout.cols: 0`) by searching a
  band around `ceil(sqrt(bricks))` for the canvas closest to square.
- Columns are shifted so that their vertical midpoints share one axis (salon
  centring), then re-ordered into an arch: the tallest column in the middle,
  the shortest at the outer edges. Only occupied columns take part, so a wall
  with fewer photos than columns stays centred.
- The canvas is the occupied width plus `layout.pad` on every side.

**Determinism contract:** the same photo set and config produce a byte-identical
page. It is *not* additive-stable - adding a photo may re-lay the whole wall,
because the order is hashed and the column count depends on the set.

## Front end

The wall's markup, CSS and engine are the files in `src/assets/`
(`head.html`, `body.html`, `page.css`, `engine.js`). They are taken verbatim
from the commit that fixed the iOS zoom crash and carry tokens for the values
the build owns; `src/page.js` substitutes those tokens and adds the instance
metadata and the `<noscript>` grid. Nothing in `src/` changes how the engine
draws or animates, and `test/page.test.js` asserts the emitted `<style>` and
engine are byte-identical to the assets, so an accidental change to the
rendering path fails the suite.

What that engine does, for orientation:

- one transformed container: `#world` carries `translate(tx,ty) scale(s)` and the
  frames carry only their world position, so panning and zooming never cause a
  re-layout;
- frames outside the viewport are culled with the `off` class; sources are
  assigned when the frame is built, with `loading="lazy"` letting the browser
  defer off-screen photos;
- zoom is clamped between "whole wall visible" and `zoom.max` (4);
- a resize re-clamps the view instead of resetting the user's zoom;
- the opening zoom is 0.75 on a pointer:fine viewport and 0.35 on a coarse
  pointer, and the wall opens centred;
- captions are up to two lines drawn inside a fixed-height caption strip
  (`CAP_H`), which the layout uses when it sizes each brick;
- no `will-change` and no 3D transforms anywhere: those are what made iOS build
  a giant GPU layer and collapse the tab, and the engine must stay free of them.

## Accessibility decisions

Verified with axe-core (WCAG 2.0/2.1 A+AA plus best practice) against the built
page in light and dark, desktop and mobile: 31 rules pass. Two items remain by
design or by tooling limitation:

- `meta-viewport` is flagged because page zoom is disabled on purpose (below).
- `color-contrast` is reported "incomplete" for four nodes axe cannot resolve
  (the wall sits on a gradient vignette); the same pairs were measured directly
  from the live page instead: title 10.7:1, hint 10.7:1, photo count and zoom
  label 7.8:1, captions 4.7:1 in light mode, all higher in dark. Every text
  element is therefore above the 4.5:1 requirement.

- The title, hint and controls share one chip background (`--chrome-chip`,
  ~82% opaque) so their text has a predictable background over any photo, and
  the hint and controls sit inside a `<footer>` landmark.
- `user-scalable=no` and `maximum-scale=1` are deliberate: the wall owns pinch
  and pan, and letting the page zoom as well would fight it. This is a known
  WCAG 1.4.4 trade-off, documented here and in the page itself.
- `prefers-reduced-motion: reduce` disables the inertia glide, caption fades and
  key-move transitions.
- Control buttons are 44px on touch pointers.
- Every photo has real alt text (sidecar `alt`, else title or the readable
  filename plus the exposure facts), and the caption block is `aria-hidden`
  because the alt text already carries it.
- With JavaScript off, a `<noscript>` block renders up to `noscript.limit` photos
  as a plain scrollable grid with captions, so the page is still usable and
  crawlable.

## Empty state

With no photos the page shows a short note instead of the viewport and omits the
controls and the engine script.

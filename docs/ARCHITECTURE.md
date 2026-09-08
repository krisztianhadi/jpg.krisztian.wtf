# ARCHITECTURE - jpg.krisztian.wtf

## Pieces

```
photos/                     originals - LOCAL ONLY (gitignored, never pushed)
gen.js                      build script (Node; sharp optional for optimizing)
scripts/seed-placeholders.js sample photo generator
.github/workflows/pages.yml CI: deploy the committed dist/ to Pages
dist/                       optimized, deployable site (committed)
CNAME                       jpg.krisztian.wtf
```

## Build pipeline (gen.js)

1. **Scan** `photos/` for `jpg/jpeg/png/webp/gif`, natural-sorted by filename.
2. **Measure** each image by parsing its header (no image library): JPEG SOF marker, PNG IHDR, GIF logical screen, WebP VP8/VP8L/VP8X. JPEG dims are swapped for EXIF orientations 5-8 so the baked aspect matches how the browser renders the rotated photo. Files with unreadable dims are skipped with a build-log warning.
3. **Read EXIF** (JPEG APP1 `Exif`, PNG `eXIf`) with a small zero-dep TIFF reader: camera make/model, focal length, f-number, shutter, ISO (date is parsed but not displayed). GPS (IFD 0x8825) is deliberately never followed. ASCII values that fit in 4 bytes are read inline per TIFF spec. Each photo gets a two-line caption (camera line, specs line) or none.
4. **Layout** in world coordinates (1 world px = 1 CSS px at scale 1): masonry with portrait pairing. A column slot is a "brick": either one landscape photo at full slot width (`LONG`), or two portrait photos side by side scaled so their combined width fills the same slot - the pair reads as a landscape tile, and portrait photos never tower over the column rhythm. Photos keep exact aspect, never cropped. A filename ending `-x` before the extension marks the only photos that display full size - always a single brick, never paired. One exception: an odd leftover unmarked portrait (no pair available) may also render full-size. Bricks flow into `COLS` equal-width columns, shortest column first; bottoms stay ragged. Then every column is shifted vertically so its midpoint lies on one shared axis (salon center): shorter columns extend equally above and below it, so the whole wall is centered rather than hanging from a common top line. Finally the columns are reordered symmetrically (arch silhouette) - tallest in the middle, shortest at the outer edges. Deterministic; earlier photos never move when new ones are appended. Gaps are `GAP_X` (horizontal) and `ROW_GAP` (vertical); each photo sits inside a mat (`MAT`) with a fixed two-line caption strip (`CAP_H`) under it - so photos in a column stack evenly whether a caption exists or not. Deterministic - same photos in, same wall out.
5. **Optimize** each wall photo with `sharp` (optional dep): longest side <= 2048 px, JPEG q82, metadata stripped, EXIF rotation baked in; GIFs pass through. Falls back to plain copies without sharp.
6. **Render** one self-contained `dist/index.html`: inline CSS, inline wall data (`POS`), and the viewport JS. Copies the optimized photos into `dist/photos/` and `CNAME` into `dist/`. `dist/` is the deployable artifact and is committed; `photos/` (originals) is gitignored.

## Front end - the wall

Everything is a plain DOM layer `#world` inside `#stage`, transformed with `translate(tx,ty) scale(s)` (screen = world * scale + translate). The wall div is sized to the canvas (photos + empty border `PAD`); frames are absolutely positioned, so nothing waits on image load and layout never jumps.

Interaction:
- **Pan** - pointer drag. Two pointers switch to pinch mode.
- **Zoom** - mouse wheel to cursor, touch pinch, double-tap/double-click (x2.2), or the + / - / fit buttons. Zoom is clamped: min = whole wall visible, max = x5.
- **Fit** - initial view and the home button; zoom-out clamps exactly onto the whole-wall view. Panning stops at the wall edges (no empty-space roam); when the wall is smaller than the viewport on an axis it is centered and locked there.
- **Culling** - after every transform (rAF-throttled), frames outside the viewport get `display:none`, so off-screen images are never decoded. Images use `loading=lazy` and `decoding=async`.

Every frame: white mat + shadow per photo, on one flat surface color (`--wall`, identical for page, stage and wall - no gradient, no canvas edge, frames truly float; pan/zoom bounds are the only limits). Photos keep their exact aspect (image is `width:100%; height:auto`, never cropped); two small caption lines sit under each photo on the mat (camera above, exposure specs below, ellipsized with tooltips when long), vertically centered between the photo and the frame edge.

The page opens "in the gallery" at a zoom that shows ~1500 world px (~3 stacked photos) regardless of wall size; the fit button zooms out to the whole wall.

Theming is CSS-variable driven with an automatic `@media (prefers-color-scheme: dark)` block: light mode is a cream wall with white mats, dark mode a warm dark wall with dark mats and lighter caption text. No in-app toggle - the wall simply follows the OS/browser preference (`<meta name="color-scheme" content="light dark">` keeps native UI in sync).

## Empty state

With no photos in the wall data the page shows a short note instead of the viewport, and the controls are omitted.

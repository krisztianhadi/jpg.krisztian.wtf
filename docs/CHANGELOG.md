# CHANGELOG - jpg.krisztian.wtf

## 2026-09-08
- Feature: umami analytics script (website id f2bca9c3-b001-4e7a-9d5d-84cacfe31a54, ramen.lostsignals.studio) added to the page head.
- Tweak: the wall now opens at 75% zoom centered on the middle of the wall instead of the top-left overview.
 `photos/` folder - `node gen.js` optimizes them and the committed `dist/` is what gets deployed by CI (no more GitHub-side rebuild from originals). The repo stays small; only optimized images are pushed.
- Feature: dark-grey favicon with a single red dot.
- Tweak: frame titles show the file name verbatim in full caps with the extension; alt text cleaned to avoid duplicating the captions.
- Feature: initial photo-wall scaffold. `gen.js` build (scan, dims + EXIF-orientation parsing, museum-hang row layout, self-contained index.html), `scripts/seed-placeholders.js`, 12 sample placeholders, `pages.yml` CI deploy workflow, docs suite.
- Feature: viewport engine - drag pan, wheel/pinch zoom to cursor, double-tap zoom, fit/min/max clamps, offscreen culling, lazy images. No cropping, no lightbox.
- Feature: EXIF captions - small caption strip under each frame with date taken, camera, and exposure specs (GPS never read). Zero-dep TIFF reader in gen.js; sample placeholders now carry synthetic EXIF via PNG `eXIf` chunks.
- Feature: automatic dark mode - CSS-variable theming with `prefers-color-scheme` media query, light and dark wall palettes, `color-scheme` meta for native UI.
- Tweak: dark-mode mats lightened to a warm off-white (not pure white, `--mat: #c7bfab`, darker captions + stronger shadows); page background now matches the canvas tone in both themes (`--surround` = wall mid color) so no gutters show around the fitted wall; empty-state text moved to a wall-contrast variable (`--note`).
- Tweak: gallery look - photos 280 -> 400px tall, frame gaps widened (`GAP_X` 34->70, `ROW_GAP` 46->110, `MAT` 18->20), captions become two lines (`CAP_H` 20->36) with the date dropped - line 1 camera, line 2 exposure specs only. Initial view now opens mid-zoom "in the gallery" (a few rows), with the whole-wall overview still one fit-click away.
- Tweak: floating-photo look - page/stage/world/wall all use one flat color (`--wall`, light `#cfc8ba`, dark `#26231e`); wall gradient, vignette and edge line removed so frames truly float with no canvas border. Wall layout widened (`WALL_W` 2000->4600, `PAD` 380->260) so photos spread side-by-side into a wide arrangement instead of a tall strip. Open view retuned to ~2.5 rows at any viewport height.
- Feature: masonry layout replaces uniform rows - photos share `COL_W` width, keep aspect, and fill the shortest of `COLS`=7 columns, so column bottoms are ragged and the wall reads organic instead of grid-y. Open view now shows ~1500 world px regardless of wall size.
- Tweak: equal-weight sizing - photos are scaled so their longest side matches (`LONG` 560, landscape by width / portrait by height); header drops the column count (just "38 photos").
- Feature: `-x` highlight marker - ONLY filenames ending `-x` before the extension display full-size (user: "only those should be bigger"); the hash-based auto-hero rule was removed. Unmarked portraits always share cells; exception: an odd leftover (orphan) unmarked portrait may also go full size. Marker stripped from alt/title.
- Feature: arch silhouette - columns reordered tallest-center / shortest-edges, on top of the salon-center axis.
- Feature: salon center - all columns are vertically shifted so their midpoints share one axis (shorter columns breathe equally above and below); wall is centered, not top-hung.
- Feature: hero portraits - every 3rd portrait (by hash, aspect >= 0.6) displays big at full slot width, the rest share side-by-side cells; `COLS` 6 keeps the wall ~square (content 4420x3975).
- Feature: wall is scrambled - photos are ordered by a stable FNV-1a hash of their filename instead of name order, so no chronological/name clusters and builds stay deterministic (new photos slide in at their hash position).
- Tweak: wall shape squared - `COLS` 7 -> 5 (canvas 3976x3769, content ratio ~1.06); uniform gutters - one `GAP` (64px) between columns, stacked bricks and inside portrait pairs; `LONG` 560->600 so pair photos keep their size. Every frame gap measured 64px, 0 overlaps.
- Feature: classic masonry restored with portrait pairing (user idea: "2 portraits next to each other in the column to have a landscape" - pairs fill the same slot width as a single landscape). COLS 7 equal columns; each slot = one landscape OR two side-by-side portraits (aspect kept, budget = LONG - 2*MAT so slot widths match); pairs form in photo order, odd leftover portrait becomes one wide single. Canvas 5104x3223 for 38 photos, 0 overlaps. Replaces salon hang.
- Tweak: caption zone grows (`CAP_H` 36->56, `CAP_GAP` 22) - text is now vertically centered between photo and frame edge (22px air above and below the two lines).

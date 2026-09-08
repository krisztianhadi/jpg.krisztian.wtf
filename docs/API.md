# API - jpg.krisztian.wtf

## gen.js

Builds the wall. Node >= 18, zero npm dependencies.

```sh
node gen.js [photosDir] [outDir]
# defaults: photosDir=./photos  outDir=./dist
```

Behavior: scans photosDir (image extensions only, natural-sorted), measures dimensions, lays photos into rows, writes a self-contained `index.html` plus copies of the scanned photos and `CNAME` into outDir. `dist` output is always rebuilt from scratch. Prints a summary; lists skipped files (unreadable image or unparseable dimensions) on stdout so CI logs show why a photo did not appear.

Exits 1 if photosDir does not exist.

### Layout constants (top of file)

| Const    | px | Meaning                                        |
|----------|----|------------------------------------------------|
| `COLS`   | 6 | masonry columns (bricks fill the shortest)    |
| `LONG`   | 600 | display width of a landscape brick / pair slot |
| `GAP`    | 64 | uniform gutter everywhere: between columns, stacked bricks and the two photos of a portrait pair |
Filenames ending `-x` before the extension (e.g. `IMG_1234-x.jpg`) are the ONLY photos that display full-size (full slot width); they are never paired with another photo. No automatic full-size rule exists - unmarked portraits always share cells, except that an odd leftover (orphan) portrait may render full-size when no pair is available. The `-x` suffix is not shown in alt/title text.
| `PAD`    | 260 | empty wall around the whole arrangement       |
| `MAT`    | 20 | white mat border around each photo            |
| `CAP_H`  | 56 | caption zone under the photo (air + 2x16px)   |
| `CAP_GAP`| 22 | air between photo bottom and caption text     |
| `OPEN_WORLD` | 1500 | vertical world px shown on load (~3 photos) |

Masonry with portrait pairing: a column slot is one landscape photo at full width or TWO portraits side by side scaled to fill the same slot - pairs read as landscape tiles, portraits never tower. Pairs form in photo order; an odd leftover portrait becomes a single wider brick (typically the last portrait). Bricks flow into classic equal-width masonry columns. Captions: `CAP_GAP` air above, matching gap below (text vertically centered on the mat).

### Module exports

- `layout(photos)` - `[{file,w,h}]` -> `{photos(with x,y,pw,ph,iw,ih), canvasW, canvasH, rows}`
- `detectImageSize(buf, file)` - header parser; `{w,h}` or `null`. JPEG results honor EXIF orientation.
- `readExif(buf, file)` - jpg/jpeg/png only. Returns a flat object of caption fields or null: `orientation, make, model, date, shutter, fnum, iso, focal` (shutter/fnum/focal are numeric seconds / f-stop / mm). GPS is never followed.
- `formatCaption(exif)` - `{line1, line2, text}`. line1 = camera (make/model deduped), line2 = specs (`50mm f/1.8 1/200s ISO 100`). No date; empty lines when a part is unknown; `text` joins both with ` - ` for tooltips.
- `naturalSort(a,b)` - filename comparator (digits compare numerically).
- `LAYOUT` - the constants above.

## scripts/seed-placeholders.js

```sh
node scripts/seed-placeholders.js
```

Writes 12 sample PNGs (`photos/sample-*.png`) with a tiny built-in PNG encoder. 8 carry synthetic EXIF (attached as a PNG `eXIf` chunk, written by the bundled little-endian TIFF writer) so captions are visible; the rest are caption-less on purpose. Idempotent - existing files are never overwritten. Delete `photos/sample-*.png` once real photos arrive.

## Image optimization (optional, sharp)

`gen.js` requires `sharp` (npm dependency) when present; without it the build falls back to copying originals as-is. Served copies: longest side capped at `OPTIM.MAX_EDGE` (2048 px), JPEG quality `OPTIM.JPEG_QUALITY` (82), metadata stripped, EXIF orientation baked into the pixels (output matches the layout dims computed from the original). GIFs are always passed through - sharp cannot encode them.

## GitHub workflow

`.github/workflows/pages.yml` - on push to `main` (or manual dispatch): checkout, `node gen.js`, then `configure-pages` / `upload-pages-artifact` (path `dist`) / `deploy-pages`. Requires Pages source = "GitHub Actions" in repo settings.

## Wall data contract (dist/index.html)

`var POS` holds one entry per photo: `{x, y, pw, ph, file, w, h, base, c1, c2}` in world px. `file` is used as `photos/<file>`; `base` is alt text; `c1`/`c2` are the two pre-formatted caption lines (camera, then specs - both empty strings when the photo has no usable EXIF). Layout math in the page derives frame size from `pw/ph` + mat + caption strip, so `POS` and the generator's constants must stay in sync when tuning looks (both live in gen.js).

## Theme contract

The page auto-follows the OS/browser preference via `@media (prefers-color-scheme: dark)` over CSS variables in `:root` (`--surround`, `--wall-1..3`, `--mat`, `--cap`, `--chrome`, etc). Adding a manual light/dark toggle would mean overriding those variables from JS instead - the structure supports it, it just is not wired up.

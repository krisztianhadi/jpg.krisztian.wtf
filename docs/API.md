# API

## CLI

```sh
node gen.js [options] [photosDir] [outDir]

  --photos <dir>    photo source directory       (config: photosDir)
  --out <dir>       output directory             (config: outDir)
  --config <file>   instance config file         (default: wall.config.json)
  --force           wipe a non-empty output directory that is not a build
  --check           scan + lay out, write nothing (CI friendly)
  --help            usage
```

The two positional arguments are kept for backwards compatibility; the flags are
preferred. `npm run build` / `npm run check` wrap the two common cases.

Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | success (with `--check`: nothing written) |
| 1 | unexpected failure (config parse error, unknown flag, missing sharp) |
| 2 | refused: unsafe output directory, missing photos dir |
| 3 | a photo could not be published; no page was written |

Behaviour: scans the photos dir, measures each image, re-encodes every photo
(sharp is required), lays the wall out, writes a self-contained `index.html`
plus `og.jpg`, `apple-touch-icon.png`, `robots.txt`, `sitemap.xml`, `CNAME`,
`.nojekyll` and the served photo copies into the output dir. The output dir is
always rebuilt from scratch, and only after the path guards allow it.

Every ignored file is listed with a reason (`unsupported extension .heic`,
`image header unreadable (truncated or corrupt file?)`, `not a file`, ...).

## Configuration

Config is merged in this order: built-in defaults, `wall.config.json` (or
`--config` / `WALL_CONFIG`), `WALL_*` environment variables, CLI flags.
Unknown keys, wrong types and out-of-range values fail the build.

| Key | Default | Meaning |
| --- | --- | --- |
| `title` | `Photo Wall` | page title, `<h1>`, `og:title` |
| `description` | `A wall of photographs.` | meta description, `og:description` |
| `lang` | `en` | `<html lang>` |
| `siteUrl` | `''` | absolute site URL; enables canonical/og/sitemap. Defaults to `https://<CNAME>/` when a CNAME file exists |
| `themeColor` | `#26231e` | `theme-color` meta |
| `og.source` | `assets/og.jpg` | a ready-made 1200x630 social card, relative to the project root; copied as-is when it exists |
| `og.photo` | `''` | filename used for `og.jpg`; default is the widest landscape on the wall |
| `photosDir` / `outDir` | `photos` / `dist` | paths, relative to the project root |
| `captions.maxLines` | `2` | caption lines the engine draws (0-2) |
| `captions.showYear` | `true` | prefix the exposure line with the year taken |
| `captions.showSpecs` | `true` | exposure line (focal / f-number / shutter / ISO) |
| `captions.showCamera` | `true` | camera make/model line |
| `layout.cols` | `0` | `0` = auto (column count closest to a square canvas) |
| `layout.long` | `600` | full-width brick width, world px |
| `layout.gap` | `64` | one gutter for columns, stacked bricks and pairs |
| `layout.mat` | `20` | mat border around each photo |
| `layout.pad` | `260` | empty wall margin around the arrangement |
| `layout.capGap` | `22` | air between the photo and the caption text |
| `layout.heroRate` | `3` | out of 10, how often an unmarked portrait goes full width |
| `layout.heroMinAspect` | `0.6` | never promote extreme 9:16-ish portraits |
| `layout.markSuffix` | `-x` | filename suffix that forces full width |
| `layout.maxCols` | `14` | upper bound for the automatic column search |
| `images.maxEdge` | `2048` | longest edge of the served full copy |
| `images.quality` | `82` | JPEG/WebP quality |
| `images.thumbEdge` / `thumbQuality` | `24` / `55` | inline blurred placeholder |
| `images.ogWidth` / `ogHeight` / `ogQuality` | `1200` / `630` / `82` | social preview image |
| `zoom.max` | `4` | zoom ceiling the engine clamps to (the value the wall has always shipped) |
| `noscript.limit` | `60` | photos listed in the no-JS fallback (`0` disables it) |

Environment overrides (only these are read): `WALL_CONFIG`, `WALL_TITLE`,
`WALL_DESCRIPTION`, `WALL_LANG`, `WALL_SITE_URL`, `WALL_THEME_COLOR`,
`WALL_OG_PHOTO`, `WALL_OG_SOURCE`, `WALL_PHOTOS_DIR`, `WALL_OUT_DIR`, `WALL_ANALYTICS_SCRIPT`,
`WALL_ANALYTICS_ID`, `WALL_ANALYTICS_DOMAINS`, `WALL_MAX_EDGE`, `WALL_QUALITY`,
`WALL_SMALL_EDGE`, `WALL_MID_EDGE`, `WALL_COLS`, `WALL_HERO_RATE`, `WALL_CAPTION_LINES`,
`WALL_SHOW_FILENAME`, `WALL_SHOW_YEAR`, `WALL_SHOW_CAMERA`, `WALL_SHOW_SPECS`,
`WALL_ZOOM_MAX`, `WALL_NOSCRIPT_LIMIT`, `WALL_DEBUG`.

## Modules

### `src/config.js`

- `DEFAULTS` - the built-in configuration (see the table above).
- `loadConfig({ root, configPath, env, overrides })` -> `{ config, configPath, sources }`.
  Throws on unknown keys, bad types, out-of-range numbers, or an `analytics`
  block without a script and id.
- `checkPaths({ root, photosDir, outDir, force })` -> `{ ok, errors, warnings }`.
  The output may not be the photos dir, sit inside it, contain it, or be the
  project root or above it; a non-empty output dir that is not a previous build
  needs `--force`.
- `autoMaxZoom(config)` -> the zoom ceiling, explicit or derived from the served
  resolution.
- `isInside(parent, child)` -> true when `child` is `parent` or sits inside it.

### `src/layout.js`

- `hashFile(name)` -> FNV-1a hash, the stable wall order.
- `naturalSort(a, b)` - filename comparator (digits compare numerically).
- `buildBricks(photos, cfg)` -> `{ bricks, photos }`. Attaches `hash`, `marked`,
  `aspect`, `idx`; fills `pw`/`ph`; a brick's `list` holds one photo or a pair.
- `countBricks(photos, cfg)` -> brick count (bounds the column search).
- `layout(photos, cfg, cols)` -> `{ photos, bricks, canvasW, canvasH, cols }`
  with `x`, `y`, `col` on every photo. `cols` omitted/0 uses the config value or
  the automatic choice.
- `autoCols(photos, cfg)` -> the column count closest to a square canvas.
- `captionHeight(cfg)` -> caption strip height for `captions.maxLines`.
- `isMarked(file, suffix)`, `archTargets(n)` - helpers.

Determinism: the same photos and config produce identical geometry. Adding a
photo may re-lay the whole wall (the order is hashed and the column count
depends on the set).

### `src/images.js`

- `IMAGE_EXTS`, `TIER_DIR` (`'small'`).
- `requireSharp()` - loads sharp or throws with instructions (it is required,
  not optional: the fallback would publish metadata).
- `detectImageSize(buf, file)` -> `{ w, h }` or `null`; JPEG results honour EXIF
  orientation.
- `readExif(buf, file)` -> jpg/jpeg/png only. Flat object or `null`:
  `orientation, make, model, date, shutter, fnum, iso, focal`. GPS is never
  followed.
- `formatCaption(exif)` -> `{ camera, specs, year }`; `specs` looks like
  `50mm f/1.8 1/200s ISO 100`.
- `scanPhotos(photosDir, cfg, captionsFile)` -> `{ photos, skipped }`, where
  `skipped` entries carry a `reason`.
- `writeCopies(file, srcFull, outDir, cfg)` -> `{ before, after, thumb }`; writes
  the served copy and the inline placeholder, metadata stripped and EXIF
  orientation baked in.
- `writeOgImage(file, srcFull, outFile, cfg)`, `writeTouchIcon(outFile, cfg)`,
  `faviconSvg(cfg, size, radius)`, `pipeline(buf)`.

### `src/page.js`

- `buildPage(model, cfg)` -> the complete HTML document, assembled from
  `src/assets/` with the wall data and instance metadata substituted.
  `model = { photos, canvasW, canvasH, capH, maxScale }`, where each photo is a
  wall row in the engine's shape (see the contract above).
- `esc(s)` / `escJson(value)` - HTML and inline-script escaping (`<`, U+2028,
  U+2029). The wall data is always passed through `escJson`.

### `src/stamp.js`

- `sourceHash(root)` - hash of the generator sources plus `wall.config.json`.
- `applyStamp(html, root, photoCount)` / `readStamp(html)`.

### `gen.js`

- `main(argv)` - the whole build; throws `BuildError` (with `exitCode`) instead
  of calling `process.exit`, so it can be driven from tests.
- `parseArgs(argv)`, `captionLines(photo, cfg)`, `altText(photo)`.

## Wall data contract (`dist/index.html`)

`var POS` holds one entry per photo, in world px:

| Field | Meaning |
| --- | --- |
| `x`, `y` | frame position on the wall |
| `pw`, `ph` | photo box size (intrinsic aspect, never cropped) |
| `file` | filename inside `photos/` |
| `w`, `h` | intrinsic pixel size (not read by the engine) |
| `base` | filename without extension (used for the alt text) |
| `title` | uppercase filename, kept for parity with earlier builds |
| `spec` | exposure line, optionally prefixed with the year |
| `cam` | camera make and model |
| `thumb` | inline base64 placeholder (24px JPEG) |

The engine also reads `MAX_SCALE`, `MAT` and `CAP_H`, which the build fills in
from the config.

Globals next to it: `TIERS` (`[{ key, edge }]`, smallest first), `MAX_SCALE`,
`OPEN_DESKTOP`, `OPEN_TOUCH`, `MAT`, `CAP_H`, `REDUCE`. Frame size is derived in the page from
`pw/ph` + `MAT` + `CAP_H`, so the page and the generator must stay in sync -
both the CSS and those globals are emitted from the same config.

## Sidecar captions (`photos/captions.json`)

```json
{
  "DSC01234.jpg": "Harbour at dawn",
  "DSC05678.jpg": { "title": "Fog", "alt": "Boats in fog", "credit": "(c) Krisztian", "specs": "35mm" }
}
```

Keys may be the filename or the basename without extension. `title` becomes the
first caption line, `alt` the alt text (falling back to title/filename plus the
exposure facts), `credit` an extra line, and `specs` overrides the EXIF exposure
line.

## Scripts

- `scripts/seed-placeholders.js [dir] [count]` - writes sample PNGs with
  synthetic EXIF (never GPS). Used for a fresh clone and by the test suite.
- `scripts/serve.js [dir] [port]` - zero-dependency static preview server.
- `scripts/check-build.js [dist]` - structural check of a built output: every
  referenced photo exists, no overlapping frames, symmetric
  margin, alt text everywhere, no raw `</script` in the data, furniture and
  stamp present, plus a stylesheet check (no `var(--token)` that is never
  defined, no duplicated top-level selector).
- `scripts/check-stamp.js [dist/index.html]` - fails when the committed page was
  built from different source, so CI catches a stale `dist/`.

## CI

- `.github/workflows/ci.yml` - on push to `main` and on pull requests: `npm ci`,
  `npm test`, a build from seeded fixtures, `scripts/check-build.js` on that
  fixture build, and the stamp check for the committed `dist/`.
- `.github/workflows/pages.yml` - on push to `main`: the same verification, then
  upload `dist/` as the Pages artifact and deploy. Requires Pages source =
  "GitHub Actions" in the repository settings.

Both workflows pin actions by commit SHA; Dependabot keeps them current.

## Theme

The page follows the OS/browser preference via
`@media (prefers-color-scheme: dark)` over CSS variables in `:root`
(`--wall`, `--chrome-chip`, `--ink`, `--ink-dim`, `--note`, `--mat`, `--cap`,
`--pbox`). `--chrome-chip` is the background behind the title, the hint and the
controls, so their text contrast does not depend on the photo behind them. There is no in-app toggle; adding one would mean overriding those
variables from JS, which the structure supports.

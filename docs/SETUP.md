# SETUP - jpg.krisztian.wtf

## One-time GitHub setup

1. **Pages source**: repo Settings > Pages > Build and deployment > Source = "GitHub Actions" (required - the CI workflow deploys; this repo's pages.yml does not deploy from a branch).
2. **Custom domain**: Pages > Custom domain = `jpg.krisztian.wtf`, with the DNS record pointing to GitHub Pages (same pattern as the other krisztian.wtf subdomains). The repo `CNAME` file is copied into the build automatically.

## Daily flow - updating the wall

1. Drop/rename image files in the local `photos/` folder (gitignored - never pushed).
2. Run `node gen.js` - it optimizes the photos (see notes) and builds `dist/`.
3. Commit and push the repo: `dist/` is committed and contains everything the site needs.
4. The `pages.yml` workflow (`.github/workflows/pages.yml`) publishes the committed `dist/` to Pages.
5. The live site is `https://jpg.krisztian.wtf`.

Notes:
- Accepted formats: `jpg`, `jpeg`, `png`, `webp`, `gif`. Files with unreadable dimensions are skipped and reported in the build log. HEIC/AVIF are not scanned - convert them to jpg first.
- A filename ending `-x` before the extension (e.g. `IMG_1234-x.jpg`) is always displayed full-size; an odd leftover (orphan) portrait may also go full size. Everything else: landscapes single, portraits paired side by side.
- Every photo shows a three-line caption under the frame: the file name (uppercase, verbatim), exposure specs (focal/f-number/shutter/ISO), then the camera. No date, GPS is never read or shown.
- Dark mode is automatic: the wall follows the OS/browser light/dark preference. No setting to flip on the site.
- The build optimizes every photo for the web: longest side capped at 2048 px, JPEG quality 82, metadata stripped, EXIF rotation baked in. Originals in `photos/` are never touched, and since they are gitignored the repo stays small (435 MB of originals served as ~10 MB).

## Local preview

```sh
node gen.js                         # regenerate dist/ from photos/
python3 -m http.server 3100 -d dist # open http://localhost:3100
```

`dist/` is committed - it is the deployable site (optimized images + self-contained page). `photos/` (the originals) is gitignored.

## Test placeholders

`node scripts/seed-placeholders.js` writes 12 sample PNGs into `photos/`. Idempotent (never overwrites). Delete `photos/sample-*.png` once real photos arrive.

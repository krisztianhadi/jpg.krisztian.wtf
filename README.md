# jpg.krisztian.wtf - photo wall

A virtual photo gallery on a huge pannable, zoomable wall. Static site, hosted on GitHub Pages; images are resized and compressed at build time with sharp.

## How it works

Originals live in the local, gitignored `photos/` folder. `node gen.js` resizes and compresses them and builds a self-contained static wall in `dist/`, which is committed and deployed to Pages by a GitHub Action. Updating the wall: drop photos into `photos/`, run the build, commit and push.

The layout is a tidy grid: uniform-height rows of framed photos (museum hang), centered, never cropped. Each photo's intrinsic size and JPEG EXIF orientation are read at build time, so frames match the image exactly. Layout is deterministic from filename order.

## Quick start

```sh
npm install                         # first time only (sharp)
node scripts/seed-placeholders.js   # optional: sample photos to try it out
node gen.js                         # optimize + build dist/ from photos/
python3 -m http.server 3100 -d dist # preview at http://localhost:3100
git add dist && git commit && git push   # publish (originals stay local)
```

Upload new photos: drop JPG/PNG/WebP/GIF files into `photos/` locally, run `node gen.js`, commit `dist/` and push - CI deploys.

See [docs/INDEX.md](docs/INDEX.md) for the full documentation set.

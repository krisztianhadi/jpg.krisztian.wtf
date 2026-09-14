# Keret - a self-hosted photo wall

A wall of photographs you can pan and zoom like a room, built from a folder of
image files into a fully static site. No database, no CMS, no runtime: the
build optimizes the photos, lays them out and writes `dist/`, which is what
gets deployed.

This repository is the instance running at
[jpg.krisztian.wtf](https://jpg.krisztian.wtf/); the generator is written to be
runnable by anyone (see [wall.config.example.json](wall.config.example.json)).

## How it works

Originals live in the local, gitignored `photos/` folder. `node gen.js` reads
each file's header for its real dimensions and EXIF orientation, re-encodes a
web copy (metadata stripped, including GPS), lays the wall out, and writes a
self-contained static site into `dist/`, which is committed and deployed to
GitHub Pages by a workflow.

The layout is a masonry wall: full-width bricks mixed with pairs of portraits
that share a slot, arranged into columns whose count is chosen for a roughly
square canvas, then re-ordered into an arch (tallest column in the middle) and
hung on one shared midpoint axis. Photos are never cropped. Order is scrambled
by a hash of the filename, so the wall never reads as chronological and is
byte-stable for a given set of photos - adding photos may re-lay the whole wall.

Each frame carries two caption lines, read from EXIF: the year and exposure,
then the camera. Up to about 30% of unmarked portraits are promoted to full
width for rhythm (`layout.heroRate`), and a filename ending in `-x` always is.
Photos are never cropped, and the page opens at 75% on a desktop and 35% on a
touch viewport (the engine's own values) centred on the wall.

## Quick start

```sh
npm install          # sharp, the only dependency
npm run seed         # optional: 12 sample photos into photos/
npm run build        # optimize + build dist/ from photos/
npm run serve        # preview at http://127.0.0.1:3100
npm test             # unit + end-to-end checks (no browser needed)
```

Publish: commit `dist/` and push - the workflow checks the tests and the build
stamp, then deploys to Pages. Originals stay local.

Adding photos: drop JPG/PNG/WebP/GIF files into `photos/`, run `npm run build`,
commit `dist/`, push. A filename ending in `-x` before the extension is always
full width.

```json
{ "DSC01234.jpg": { "title": "Harbour at dawn", "alt": "Fishing boats in fog", "credit": "(c) Krisztian" } }
```

Configuration (title, description, site URL, analytics, caption lines, layout
dimensions, image sizes, zoom ceiling) lives in
[wall.config.json](wall.config.json); every key is documented in
[docs/API.md](docs/API.md), and `WALL_*` environment variables override
individual settings. The wall's CSS and view engine are not configurable
templates: they are the verified files in `src/assets/`, which the build emits
with the wall data filled in (see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Requirements

- Node 18.17 or newer (Node 20+ recommended, see `.nvmrc`)
- `sharp` builds on install; that is the whole dependency list

## Documentation

| File | Contents |
| --- | --- |
| [docs/INDEX.md](docs/INDEX.md) | documentation map |
| [docs/SETUP.md](docs/SETUP.md) | setup, daily flow, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | how the build and the page work |
| [docs/API.md](docs/API.md) | config keys, module API, CLI, environment |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | dated changes |
| [docs/CODE_REVIEW.md](docs/CODE_REVIEW.md) | 2026-09-10 review and findings |
| [docs/TODO.md](docs/TODO.md) | open work |
| [CONTRIBUTING.md](CONTRIBUTING.md) | how to work on it |
| [SECURITY.md](SECURITY.md) | metadata/privacy guarantees and reporting |

## License

[GNU AGPL-3.0-or-later](LICENSE) - use it, self-host it, change it, share it.
The point is that it stays free for the people using it: anyone who runs a
modified version as a network service has to offer their users the source of
that version, and anything built from it stays under the same licence. It is
not a licence for taking the wall closed-source, or for repackaging it as a
proprietary product.

For a normal wall (this repository, an unmodified build) nothing is required
beyond keeping the licence and copyright notices in place. If you run a modified
generator as a service, link your users to its source.

Copyright (c) 2026 Krisztian Hadi.

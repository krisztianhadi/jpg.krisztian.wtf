# Contributing

Thanks for looking at Keret. This started as a personal photo wall and is being
prepared for wider use, so the short version is: keep it small, keep it
dependency-light, keep the docs honest.

## Getting set up

```sh
npm install                 # sharp, the only dependency
npm run seed                # 12 sample images into photos/
npm run build               # writes dist/
npm run serve               # http://127.0.0.1:3100/
npm test                    # node's own test runner, no framework
```

## Ground rules

- **Photos are never committed.** `photos/` is gitignored; `dist/` is committed
  because the site is published straight from it.
- **`sharp` stays mandatory.** It is what strips EXIF (including GPS) and bakes
  in orientation. A fallback that copies originals would publish metadata.
- **Determinism matters.** The same photo set and config must produce a
  byte-identical `dist/index.html`. Nothing may depend on the clock, the
  environment or iteration order of a `Map`.
- **Docs are the source of truth.** If a change alters behaviour, update
  `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/SETUP.md` and add a dated entry
  to `docs/CHANGELOG.md` (tagged `[Feature]`, `[Fix]` or `[Break]`).
- **No em dashes** in code, comments, docs or copy - use a plain hyphen.
- **Guard rails stay.** The build wipes its output directory; anything that
  makes that safer (path checks, refusing to publish a page that references a
  missing file) is a feature, not a nuisance.

## Licence of contributions

The project is AGPL-3.0-or-later. By opening a pull request you agree that your
contribution is licensed under the same terms (inbound = outbound), so the wall
cannot drift away from the licence it ships under.

## Before opening a pull request

```sh
npm test
npm run build && npm run stamp && node scripts/check-build.js dist
```

If you changed the generator or `wall.config.json`, rebuild `dist/` in the same
commit - CI fails when the committed page is stale (the build stamp records the
source hash it was produced from).

## Reporting a vulnerability

See [SECURITY.md](SECURITY.md). Do not open a public issue for a
metadata/privacy problem: a broken privacy guarantee is the one class of bug
that must be handled privately first.

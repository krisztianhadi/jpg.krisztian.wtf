# TODO - Keret

State of this repository, and what is left. The review that started this work is
in [CODE_REVIEW.md](CODE_REVIEW.md); its findings were fixed, but the fixes to
the *rendering path* were reverted - see below.

## Where things stand (2026-09-10)

- The published wall is byte-for-byte the build that works on desktop and on a
  phone: `dist/index.html` rebuilds identically from this tree.
- The build-side work is in place: module split, output-directory guards, exit
  code 3 when a photo cannot be published, `sharp` required (metadata, including
  GPS, never ships), escaped wall data, deterministic output, a build stamp, the
  scripts, a 43-test suite, CI with SHA-pinned actions, AGPL-3.0 LICENSE, community
  files, config extraction, social tags, `robots.txt`/`sitemap.xml`,
  `.nojekyll`, `apple-touch-icon.png` and the no-JS photo grid.
- The wall's markup, CSS and engine are emitted verbatim from `src/assets/`, and
  `test/page.test.js` fails if they ever change. That is deliberate: a rewrite of
  the camera and the image serving made the wall unusable on a phone and on a
  desktop, so the render path is not something to touch without a device test.

## Open

- [ ] **The iOS crash investigation is parked.** The live build is stable; the
  experimental work (image tiers, a screen-space camera, frame links, `?off=`,
  `?modern=`, `?probe=` switches, a debug overlay, gesture changes) sits on
  branch `hardening-attempt-2026-09-10`. Nothing from it may be merged without
  being tested on a phone first, one change at a time, and each change must show
  a measured improvement - the last attempt made things worse.
- [ ] **Device test before any render change** (`R-32`): pinch, double-tap, fit
  and pan on an iPhone at the current wall size. `docs/SETUP.md` has the crash-log
  route (`JetsamEvent` = memory kill) and the WebKit recipe.
- [ ] **Split the instance from the generator**: this repository is one wall
  (photos, `wall.config.json`, `dist/`); the generic tool would be its own
  repository once the generator stops changing. `package.json` `files` and
  `wall.config.example.json` already describe the split.
- [ ] **Repository growth**: `dist/` is committed (25 MB for 101 photos) and grows
  with every batch; worth a note in the release process if it ever matters.
- [ ] **Accessibility pass with a tool** (`R-28`): the page has real alt text,
  labelled controls and a no-JS fallback, but no axe run since the engine was
  restored.

## Known hazards in this code

- `node gen.js photos photos` (or any output path that contains the photos or the
  project root) is refused by the guards - but only because `src/config.js` keeps
  them. Do not remove `checkPaths`.
- The engine must stay free of `will-change` and 3D transforms: those are what
  made iOS build one giant GPU layer and collapse the tab. `test/page.test.js`
  asserts their absence.

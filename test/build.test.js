'use strict';
/*
 * build: the end-to-end guarantees.
 *   - every published page references only files that exist
 *   - a rebuild is byte-identical (deterministic output)
 *   - a photo that cannot be published fails the build instead of shipping a
 *     broken frame
 *   - a mistyped output directory can never touch the originals
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { clearWallEnv, fixture, readPage, tempDir } = require('./helpers');
const { loadConfig } = require('../src/config');
const { main, BuildError, captionPair } = require('../gen.js');
const images = require('../src/images');
const { readStamp, sourceHash } = require('../src/stamp');

clearWallEnv();

const args = (fx, extra) => ['--photos', fx.photosDir, '--out', fx.outDir, '--config', fx.configPath].concat(extra || []);

test('a full build publishes the page and the furniture', async () => {
  const fx = fixture(4);
  await main(args(fx));

  const { html, pos } = readPage(fx.outDir);
  assert.equal(pos.length, 4);

  for (const row of pos) {
    const full = path.join(fx.outDir, 'photos', row.file);
    assert.ok(fs.existsSync(full), 'referenced file exists: ' + row.file);
    assert.ok(fs.statSync(full).size > 0);
    for (const key of ['x', 'y', 'pw', 'ph', 'file', 'spec', 'cam', 'base', 'thumb']) {
      assert.ok(key in row, 'wall row carries the engine key "' + key + '"');
    }
    assert.ok(row.base.length > 0, 'every photo has a base name');
  }

  assert.ok(fs.existsSync(path.join(fx.outDir, '.nojekyll')));
  assert.ok(fs.existsSync(path.join(fx.outDir, 'robots.txt')));
  assert.ok(fs.existsSync(path.join(fx.outDir, 'sitemap.xml')));
  assert.ok(fs.existsSync(path.join(fx.outDir, 'og.jpg')));
  assert.ok(fs.existsSync(path.join(fx.outDir, 'apple-touch-icon.png')));
  assert.match(html, /<title>Test Wall<\/title>/);
  assert.ok(pos.some((r) => r.cam), 'the seeded samples carry a camera the wall can show');
  assert.match(fs.readFileSync(path.join(fx.outDir, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
});

test('a committed social card is used as it is, and generated only when absent', async () => {
  const fx = fixture(2);
  // fixture() points og.source at assets/og.jpg, which the fixture directory has not got
  const cfg = JSON.parse(fs.readFileSync(fx.configPath, 'utf8'));
  assert.equal(cfg.og ? cfg.og.source : undefined, undefined, 'the fixture starts without a card');

  const card = Buffer.from('pretend this is a designed 1200x630 jpeg');
  const cardPath = path.join(fx.dir, 'card.jpg');
  fs.writeFileSync(cardPath, card);
  cfg.og = { source: cardPath, photo: '' };
  fs.writeFileSync(fx.configPath, JSON.stringify(cfg));

  await main(args(fx));
  assert.deepEqual(fs.readFileSync(path.join(fx.outDir, 'og.jpg')), card, 'the card is copied, not regenerated');
});

test('the build is deterministic: a rebuild is byte-identical', async () => {
  const fx = fixture(3);
  await main(args(fx));
  const first = fs.readFileSync(path.join(fx.outDir, 'index.html'));
  await main(args(fx));
  const second = fs.readFileSync(path.join(fx.outDir, 'index.html'));
  assert.deepEqual(first, second);
});

test('the page carries a freshness stamp for CI', async () => {
  const fx = fixture(2);
  await main(args(fx));
  const { html } = readPage(fx.outDir);
  const stamp = readStamp(html);
  assert.ok(stamp, 'stamp present');
  assert.equal(stamp.photos, 2);
  assert.equal(stamp.source, sourceHash(path.join(__dirname, '..')));
});

test('a photo that cannot be published fails the build and writes no page', async () => {
  const fx = fixture(3);
  const original = images.writeCopies;
  let calls = 0;
  images.writeCopies = async (...rest) => {
    calls++;
    if (calls === 2) throw new Error('simulated disk failure');
    return original(...rest);
  };
  try {
    await assert.rejects(main(args(fx)), (err) => {
      assert.ok(err instanceof BuildError);
      assert.equal(err.exitCode, 3);
      assert.match(err.message, /simulated disk failure/);
      return true;
    });
  } finally {
    images.writeCopies = original;
  }
  assert.equal(fs.existsSync(path.join(fx.outDir, 'index.html')), false, 'no half-built page is published');
});

test('a mistyped output directory is refused and the photos survive', async () => {
  const fx = fixture(2);
  const before = fs.readdirSync(fx.photosDir).sort();

  await assert.rejects(main(['--photos', fx.photosDir, '--out', fx.photosDir, '--config', fx.configPath]), (err) => {
    assert.equal(err.exitCode, 2);
    assert.match(err.message, /refusing to build/);
    return true;
  });

  await assert.rejects(main(['--photos', fx.photosDir, '--out', fx.dir, '--config', fx.configPath]), (err) => {
    assert.equal(err.exitCode, 2, 'the project root cannot be the output');
    return true;
  });

  assert.deepEqual(fs.readdirSync(fx.photosDir).sort(), before, 'the originals are untouched');
});

test('--check lays out the wall without writing anything', async () => {
  const fx = fixture(2);
  await main(args(fx, ['--check']));
  assert.equal(fs.existsSync(fx.outDir), false);
});

test('an empty photo directory still builds an explaining page', async () => {
  const fx = fixture(0);
  fs.rmSync(fx.photosDir, { recursive: true, force: true });
  fs.mkdirSync(fx.photosDir, { recursive: true });
  await main(args(fx));
  const { html, pos } = readPage(fx.outDir);
  assert.equal(pos.length, 0);
  assert.match(html, /The wall is empty/);
});


test('captions follow the config: two lines, and each one can be switched off', () => {
  const base = loadConfig({ root: tempDir(), env: {} }).config;
  const photo = { year: '2024', specs: '23mm f/2 1/1600s ISO 640', camera: 'FUJIFILM X100V' };
  const two = captionPair(photo, base);
  assert.deepEqual(two, { spec: '2024 - 23mm f/2 1/1600s ISO 640', cam: 'FUJIFILM X100V' });
  assert.deepEqual(captionPair(photo, { ...base, captions: { ...base.captions, maxLines: 1 } }), { spec: '2024 - 23mm f/2 1/1600s ISO 640', cam: '' });
  assert.deepEqual(captionPair(photo, { ...base, captions: { ...base.captions, showYear: false } }), { spec: '23mm f/2 1/1600s ISO 640', cam: 'FUJIFILM X100V' });
});

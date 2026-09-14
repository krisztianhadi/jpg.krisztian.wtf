'use strict';
/* config: defaults, file, environment, validation and the outDir guards. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { clearWallEnv, tempDir, ROOT } = require('./helpers');
const { DEFAULTS, loadConfig, checkPaths } = require('../src/config');

clearWallEnv();

test('defaults load when no config file exists', () => {
  const dir = tempDir();
  const { config, configPath } = loadConfig({ root: dir, env: {} });
  assert.equal(config.title, DEFAULTS.title);
  assert.equal(config.layout.heroRate, 3);
  assert.equal(config.analytics, null);
  assert.equal(configPath, null);
});

test('config file values are merged over the defaults', () => {
  const dir = tempDir();
  const file = path.join(dir, 'wall.config.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'Mine', layout: { long: 400 } }));
  const { config } = loadConfig({ root: dir, env: {} });
  assert.equal(config.title, 'Mine');
  assert.equal(config.layout.long, 400);
  assert.equal(config.layout.gap, DEFAULTS.layout.gap, 'untouched keys keep their default');
});

test('unknown config keys are rejected (typo protection)', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'wall.config.json'), JSON.stringify({ layuot: { long: 400 } }));
  assert.throws(() => loadConfig({ root: dir, env: {} }), /unknown key "layuot"/);
});

test('environment overrides are typed and validated', () => {
  const dir = tempDir();
  const { config } = loadConfig({
    root: dir,
    env: { WALL_TITLE: 'From env', WALL_HERO_RATE: '7', WALL_SHOW_YEAR: 'false', WALL_QUALITY: '55' },
  });
  assert.equal(config.title, 'From env');
  assert.equal(config.layout.heroRate, 7);
  assert.equal(config.captions.showYear, false);
  assert.equal(config.images.quality, 55);
  assert.throws(() => loadConfig({ root: dir, env: { WALL_QUALITY: 'high' } }), /must be a number/);
});

test('out of range values are rejected', () => {
  const dir = tempDir();
  const file = path.join(dir, 'wall.config.json');
  fs.writeFileSync(file, JSON.stringify({ images: { quality: 300 } }));
  assert.throws(() => loadConfig({ root: dir, env: {} }), /between 1 and 100/);
});

test('analytics needs a script and an id when enabled', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'wall.config.json'), JSON.stringify({ analytics: { script: 'https://x/y.js' } }));
  assert.throws(() => loadConfig({ root: dir, env: {} }), /analytics needs both/);
});

test('checkPaths refuses to wipe the photos or the project', () => {
  const root = tempDir();
  const photos = path.join(root, 'photos');
  fs.mkdirSync(photos, { recursive: true });

  const same = checkPaths({ root, photosDir: photos, outDir: photos });
  assert.equal(same.ok, false);
  assert.match(same.errors.join(' '), /same directory/);

  const contains = checkPaths({ root, photosDir: photos, outDir: root });
  assert.equal(contains.ok, false);
  assert.match(contains.errors.join(' '), /contains photosDir/);

  const inside = checkPaths({ root, photosDir: photos, outDir: path.join(photos, 'out') });
  assert.equal(inside.ok, false);
  assert.match(inside.errors.join(' '), /inside photosDir/);

  const fsRoot = checkPaths({ root, photosDir: photos, outDir: path.parse(root).root });
  assert.equal(fsRoot.ok, false);

  const fine = checkPaths({ root, photosDir: photos, outDir: path.join(root, 'dist') });
  assert.equal(fine.ok, true, fine.errors.join(' '));
});

test('checkPaths refuses to wipe a directory that is not a previous build', () => {
  const root = tempDir();
  const photos = path.join(root, 'photos');
  const out = path.join(root, 'out');
  fs.mkdirSync(photos, { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'precious.txt'), 'keep me');

  const guarded = checkPaths({ root, photosDir: photos, outDir: out });
  assert.equal(guarded.ok, false);
  assert.match(guarded.errors.join(' '), /not empty and does not look like a previous build/);

  const forced = checkPaths({ root, photosDir: photos, outDir: out, force: true });
  assert.equal(forced.ok, true);

  fs.writeFileSync(path.join(out, 'index.html'), '<!DOCTYPE html>');
  assert.equal(checkPaths({ root, photosDir: photos, outDir: out }).ok, true, 'a previous build is wiped freely');
});

test('the zoom ceiling is the value the engine has always shipped with', () => {
  const dir = tempDir();
  assert.equal(loadConfig({ root: dir, env: {} }).config.zoom.max, 4);
  assert.equal(loadConfig({ root: dir, env: { WALL_ZOOM_MAX: '2' } }).config.zoom.max, 2);
});

test('the caption line count is capped at the two lines the engine draws', () => {
  const dir = tempDir();
  const file = path.join(dir, 'wall.config.json');
  fs.writeFileSync(file, JSON.stringify({ captions: { maxLines: 3 } }));
  assert.throws(() => loadConfig({ root: dir, env: {} }), /between 0 and 2/);
});

test('the shipped instance config is valid', () => {
  const { config } = loadConfig({ root: ROOT, env: {} });
  assert.equal(config.title, 'JPG BY K');
  assert.ok(config.analytics, 'the personal instance has analytics configured');
});

'use strict';
/* Shared helpers for the test suite: hermetic temp dirs and small fixtures. */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeSamples } = require('../scripts/seed-placeholders');

const ROOT = path.join(__dirname, '..');

/** WALL_* variables must never leak from the developer's shell into tests. */
function clearWallEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('WALL_')) delete process.env[key];
  }
}

/** A temp directory that is removed when the process exits. */
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), (prefix || 'keret-') ));
  process.on('exit', () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (err) { /* best effort */ }
  });
  return dir;
}

/**
 * Build a fixture set: `count` sample PNGs in <tmp>/photos plus a config file.
 * Returns { dir, photosDir, outDir, configPath }.
 */
function fixture(count) {
  const dir = tempDir('keret-fixture-');
  const photosDir = path.join(dir, 'photos');
  writeSamples(photosDir, count || 4);
  const configPath = path.join(dir, 'wall.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    title: 'Test Wall',
    description: 'Fixture wall',
    siteUrl: 'https://example.test/',
    analytics: null,
    images: { maxEdge: 800, quality: 70 },
  }, null, 2));
  return { dir, photosDir, outDir: path.join(dir, 'out'), configPath };
}

/** Built page + its wall data (POS is absent on an empty wall). */
function readPage(outDir) {
  const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
  const m = /var POS = (\[.*?\]);\n/s.exec(html);
  return { html, pos: m ? JSON.parse(m[1]) : [] };
}

module.exports = { ROOT, clearWallEnv, tempDir, fixture, readPage };

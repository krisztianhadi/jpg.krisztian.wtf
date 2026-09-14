'use strict';
/*
 * stamp.js - the freshness stamp written into dist/index.html.
 *
 * The stamp is a hash of the generator sources plus the published photo count,
 * so CI can tell whether the committed dist/ still matches gen.js (a stale
 * dist/ is otherwise indistinguishable from a fresh one).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SOURCES = ['gen.js', 'src/config.js', 'src/images.js', 'src/layout.js', 'src/page.js', 'src/stamp.js'];
const STAMP_RE = /<!-- built by gen\.js source=([0-9a-f]+) photos=(\d+) -->/;

/** Hash of the generator sources (and the instance config when present). */
function sourceHash(root) {
  const entries = SOURCES.map((f) => path.join(root, f));
  const configFile = path.join(root, 'wall.config.json');
  if (fs.existsSync(configFile)) entries.push(configFile);
  const hash = crypto.createHash('sha256');
  for (const file of entries) {
    hash.update(path.relative(root, file));
    if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex').slice(0, 12);
}

function stampLine(root, photoCount) {
  return '<!-- built by gen.js source=' + sourceHash(root) + ' photos=' + photoCount + ' -->';
}

/** Insert or replace the stamp right after the doctype. */
function applyStamp(html, root, photoCount) {
  const line = stampLine(root, photoCount);
  const existing = STAMP_RE.exec(html);
  if (existing) return html.replace(STAMP_RE, line);
  return html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + line);
}

/** Read the stamp out of a built page. Returns { source, photos } or null. */
function readStamp(html) {
  const m = STAMP_RE.exec(html);
  return m ? { source: m[1], photos: Number(m[2]) } : null;
}

module.exports = { sourceHash, stampLine, applyStamp, readStamp, STAMP_RE, SOURCES };

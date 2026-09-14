#!/usr/bin/env node
'use strict';
/*
 * check-stamp.js - verify that a built page is still in sync with the source.
 *
 *   node scripts/check-stamp.js dist/index.html
 *
 * Photos are not committed, so CI cannot rebuild the wall; it can, however,
 * tell whether dist/ was produced by the gen.js that is in the tree. If the
 * stamp does not match, run `npm run build` and commit dist/.
 */

const fs = require('fs');
const path = require('path');
const { readStamp, sourceHash, SOURCES } = require('../src/stamp');

const file = process.argv[2] || 'dist/index.html';
const root = path.join(__dirname, '..');

if (!fs.existsSync(file)) {
  console.error('stamp check: ' + file + ' not found - run `npm run build`');
  process.exit(1);
}

const html = fs.readFileSync(file, 'utf8');
const stamp = readStamp(html);
if (!stamp) {
  console.error('stamp check: no build stamp in ' + file + ' - run `npm run build`');
  process.exit(1);
}

const expected = sourceHash(root);
if (stamp.source !== expected) {
  console.error('stamp check: ' + file + ' is stale (built from source=' + stamp.source
    + ', current source=' + expected + ')');
  console.error('  changed since that build: ' + SOURCES.join(', ') + ' or wall.config.json');
  console.error('  fix: npm run build && git add dist && commit it with the source change');
  process.exit(1);
}

// the alternative resolver stats the file list only, so report it as evidence
const missing = SOURCES.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.error('stamp check: source files missing: ' + missing.join(', '));
  process.exit(1);
}

console.log('stamp check: ' + file + ' is in sync (source=' + stamp.source + ', photos=' + stamp.photos + ')');

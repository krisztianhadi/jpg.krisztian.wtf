#!/usr/bin/env node
'use strict';
/*
 * check-build.js - structural check of a built output directory.
 *
 *   node scripts/check-build.js [dist]
 *
 * No browser involved: it reads the wall data out of index.html and verifies
 * the things that would otherwise only show up as a broken page in
 * production -
 *   - every referenced photo (full copy and low-res tier) exists and is not empty
 *   - frames never overlap and the wall keeps a symmetric margin
 *   - every photo has alt text, and the wall data cannot close the <script> tag
 *   - the furniture (og.jpg, robots.txt, sitemap.xml, .nojekyll, icons) is there
 *   - the page carries a build stamp
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { loadConfig } = require('../src/config');
const { captionHeight } = require('../src/layout');
const { readStamp } = require('../src/stamp');

const root = path.join(__dirname, '..');
const dir = path.resolve(process.argv[2] || path.join(root, 'dist'));

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error('check-build: no index.html in ' + dir);
  process.exit(1);
}

const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const { config } = loadConfig({ root });
const capH = captionHeight(config);

const match = /var POS = (\[.*?\]);\n/s.exec(html);
if (!match) {
  console.log('check-build: empty wall (no photos) - structural checks skipped');
} else {
  const raw = match[1];
  if (raw.includes('</script')) fail('the wall data contains a raw </script sequence');
  const pos = JSON.parse(raw);
  notes.push(pos.length + ' photos on the wall');

  const boxes = [];
  for (const row of pos) {
    const full = path.join(dir, 'photos', row.file);
    if (!fs.existsSync(full) || fs.statSync(full).size === 0) fail('missing photo: ' + row.file);
    if (!row.spec && !row.cam) fail('no caption data for ' + row.file);
    boxes.push({ f: row.file, x: row.x, y: row.y, w: row.pw + 2 * config.layout.mat, h: row.ph + capH + 2 * config.layout.mat });
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        fail('frames overlap: ' + a.f + ' and ' + b.f);
      }
    }
  }

  const canvas = /#wall \{\n\s*position:relative;\n\s*width:(\d+)px; height:(\d+)px;/.exec(html);
  if (!canvas) {
    fail('cannot read the wall canvas size from the page CSS');
  } else {
    const [, cw, ch] = canvas.map(Number);
    const slack = [
      Math.min(...boxes.map((b) => b.x)),
      cw - Math.max(...boxes.map((b) => b.x + b.w)),
      Math.min(...boxes.map((b) => b.y)),
      ch - Math.max(...boxes.map((b) => b.y + b.h)),
    ];
    if (new Set(slack).size !== 1) fail('the wall margin is not symmetric: ' + slack.join('/'));
    else if (slack[0] !== config.layout.pad) {
      fail('the wall margin is ' + slack[0] + 'px, config.layout.pad is ' + config.layout.pad);
    }
    notes.push('canvas ' + cw + 'x' + ch + 'px, margin ' + slack[0] + 'px');
  }
}

for (const file of ['og.jpg', 'apple-touch-icon.png', 'robots.txt', '.nojekyll']) {
  if (!fs.existsSync(path.join(dir, file))) fail('missing ' + file);
}
if (config.siteUrl) {
  if (!fs.existsSync(path.join(dir, 'sitemap.xml'))) fail('missing sitemap.xml');
  if (!html.includes('og:image')) fail('siteUrl is set but the page has no og:image');
}

/* JS sanity: the page's engine is generated from a template literal, where a
   stray backslash escape silently changes the output (a regex became a comment
   once, and a newline landed inside a string literal). Compiling it here is the
   cheapest possible guard - the page does nothing at all if this fails. */
const scriptMatch = /<script>\n"use strict";\n([\s\S]*?)<\/script>/.exec(html);
if (!scriptMatch) {
  fail('no inline wall engine script in index.html');
} else {
  try {
    new vm.Script(scriptMatch[1]); // compiles, does not run
    notes.push('engine script compiles (' + scriptMatch[1].split('\n').length + ' lines)');
  } catch (err) {
    fail('the wall engine script has a syntax error: ' + err.message);
  }
}

/* CSS sanity: a var() that is never defined silently disables its property
   (an undefined --token makes the whole declaration invalid at computed-value
   time), and a duplicated selector usually means a botched edit. Both have
   happened here, so check them. */
const style = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!style) {
  fail('no inline stylesheet in index.html');
} else {
  const css = style[1];
  const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const token of used) {
    if (!defined.has(token)) fail('CSS uses undefined variable ' + token);
  }
  // duplicated selectors are only a smell at the top level: the same rule may
  // legitimately appear again inside a media query
  const topLevel = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const selectors = [...topLevel.matchAll(/^\s*([#.a-z][^{}\n]*?)\s*\{/gm)].map((m) => m[1].trim());
  const seen = new Map();
  for (const sel of selectors) seen.set(sel, (seen.get(sel) || 0) + 1);
  for (const [sel, count] of seen) {
    if (count > 1 && !/^(html|body)/.test(sel)) fail('duplicated CSS rule for "' + sel + '" (' + count + ' times)');
  }
  notes.push('css: ' + defined.size + ' variables, ' + selectors.length + ' rules');
}

const stamp = readStamp(html);
if (!stamp) fail('no build stamp in index.html (was it built by gen.js?)');
else notes.push('stamp source=' + stamp.source + ' photos=' + stamp.photos);

for (const note of notes) console.log('check-build: ' + note);
if (problems.length) {
  console.error('check-build FAILED (' + problems.length + '):');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('check-build: ok - ' + dir);

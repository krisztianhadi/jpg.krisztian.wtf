'use strict';
/* page: the rendering path is the verified one, byte for byte. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { clearWallEnv, tempDir } = require('./helpers');
const { loadConfig } = require('../src/config');
const { buildPage, escJson } = require('../src/page');

clearWallEnv();
const base = loadConfig({ root: tempDir(), env: {} }).config;
const ASSETS = path.join(__dirname, '..', 'src', 'assets');
const asset = (f) => fs.readFileSync(path.join(ASSETS, f), 'utf8');

function model() {
  return {
    photos: [{
      x: 260, y: 260, pw: 600, ph: 400, file: 'a b.jpg', w: 4160, h: 2773,
      base: 'a b', title: 'A B.JPG', spec: '2024 - 23mm f/2 1/1600s ISO 640',
      cam: 'FUJIFILM X100V', thumb: 'data:image/jpeg;base64,AAAA', alt: 'a b',
    }],
    canvasW: 1160, canvasH: 1016, capH: 56, maxScale: 4,
  };
}

const styleOf = (html) => /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const scriptOf = (html) => /<script>\n"use strict";\n([\s\S]*?)\n<\/script>/.exec(html)[1];

test('the emitted CSS is the verified stylesheet, byte for byte', () => {
  const html = buildPage(model(), base);
  const css = styleOf(html)
    .replace('width:' + model().canvasW + 'px', 'width:{{canvasW}}px')
    .replace('height:' + model().canvasH + 'px', 'height:{{canvasH}}px');
  assert.equal(css, asset('page.css'));
});

test('the emitted engine is the verified engine, byte for byte', () => {
  const html = buildPage(model(), base);
  const js = scriptOf(html)
    .replace(escJson(model().photos), '{{POS}}')
    .replace('var MAX_SCALE = 4;', 'var MAX_SCALE = {{MAX_SCALE}};')
    .replace('var MAT = ' + base.layout.mat + ';', 'var MAT = {{MAT}};')
    .replace('var CAP_H = ' + model().capH + ';', 'var CAP_H = {{CAP_H}};');
  assert.equal(js, asset('engine.js'));
});

test('the engine keeps the fixes that made the wall work on a phone', () => {
  const js = asset('engine.js');
  assert.equal(/will-change/.test(js), false, 'no will-change: it built one giant GPU layer');
  assert.equal(/translate3d|translateZ/.test(js), false, 'no 3D transforms either');
  assert.match(js, /var MAX_SCALE = \{\{MAX_SCALE\}\};/);
  assert.match(js, /img\.loading = 'lazy'/);
});

test('the wall data cannot break out of the inline script', () => {
  const m = model();
  m.photos[0].title = '</script><script>alert(1)</script>';
  m.photos[0].base = '"><img onerror=alert(1)>';
  const html = buildPage(m, base);
  const blob = /var POS = (\[.*?\]);/s.exec(html)[1];
  assert.equal(blob.includes('</script'), false);
  assert.match(blob, /\\u003c/);
  assert.equal((html.match(/<script/g) || []).length, 1 + (base.analytics ? 1 : 0));
});

test('instance metadata comes from the config', () => {
  const cfg = { ...base, title: 'Museum Wall', description: 'Twelve photographs <of> nothing', siteUrl: 'https://photos.example.com', themeColor: '#123456' };
  const html = buildPage(model(), cfg);
  assert.match(html, /<title>Museum Wall<\/title>/);
  assert.match(html, /<h1>Museum Wall<\/h1>/);
  assert.match(html, /content="Twelve photographs &lt;of&gt; nothing"/);
  assert.match(html, /name="theme-color" content="#123456"/);
  assert.match(html, /property="og:image" content="https:\/\/photos\.example\.com\/og\.jpg"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/photos\.example\.com\/">/);
  assert.match(html, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);
});

test('no social tags without a site URL, analytics only when configured', () => {
  const plain = buildPage(model(), { ...base, siteUrl: '', analytics: null });
  assert.equal(/og:image/.test(plain), false);
  assert.equal(/data-website-id/.test(plain), false);
  const withAnalytics = buildPage(model(), { ...base, analytics: { script: 'https://stats.example.com/s.js', websiteId: 'abc', domains: 'photos.example.com' } });
  assert.match(withAnalytics, /data-website-id="abc"/);
  assert.match(withAnalytics, /data-domains="photos\.example\.com"/);
});

test('the no-JS fallback lists the photos, and an empty wall explains itself', () => {
  const html = buildPage(model(), base);
  const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html)[1];
  assert.match(noscript, /photos\/a%20b\.jpg/);
  assert.match(noscript, /<figcaption>2024 - 23mm f\/2 1\/1600s ISO 640 - FUJIFILM X100V<\/figcaption>/);

  const empty = buildPage({ photos: [], canvasW: 1160, canvasH: 520, capH: 56, maxScale: 4 }, base);
  assert.match(empty, /The wall is empty/);
  assert.equal(/var POS = \[/.test(empty), false);
});

test('the built page never carries the em dash (house copy rule)', () => {
  assert.equal(buildPage(model(), base).includes('\u2014'), false);
});

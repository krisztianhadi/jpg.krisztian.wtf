#!/usr/bin/env node
'use strict';
/*
 * gen.js - builds the jpg.krisztian.wtf photo wall into dist/.
 *
 * Zero dependencies (Node built-ins only). Run:  node gen.js
 * - scans photos/ for images (jpg/jpeg/png/webp/gif)
 * - reads intrinsic sizes + JPEG EXIF orientation so the wall layout
 *   matches how the browser renders each photo (never cropped)
 * - lays photos out in uniform-height rows (museum hang), centered,
 *   deterministic from filename order
 * - writes dist/index.html (self-contained: inline CSS + JS, wall JSON)
 * - copies photos/ and CNAME into dist/
 *
 * Existing photos never "move" between runs beyond the normal row
 * reflow that any tidy grid has when a photo is inserted mid-list.
 */

const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ */
/* CLI                                                                */
/* ------------------------------------------------------------------ */

const ROOT = __dirname;
const PHOTOS_DIR = process.argv[2] || path.join(ROOT, 'photos');
const OUT_DIR = process.argv[3] || path.join(ROOT, 'dist');

/* ------------------------------------------------------------------ */
/* Image header parsing (dims + orientation)                          */
/* ------------------------------------------------------------------ */

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
// skip sidecar/duplicate files some tools produce
const SKIP_PREFIXES = ['.', '_'];

function readU16(buf, o) { return (buf[o] << 8) | buf[o + 1]; }
function readU32(buf, o) {
  return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
}

/* ------------------------------------------------------------------ */
/* EXIF reader (zero-dep): orientation, date taken, camera, exposure  */
/*                                                                     */
/* GPS IFD (0x8825) is deliberately NOT followed - never expose where  */
/* a photo was taken.                                                  */
/* ------------------------------------------------------------------ */

const EXIF_TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 12: 8 };

/** Read every IFD entry the tags we care about, following ExifIFD. */
function readTiff(t) {
  if (t.length < 8) return null;
  const isLE = t.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (isLE ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o) => (isLE
    ? t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)
    : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  if (u16(2) !== 42) return null;

  const exif = {};

  function walk(ifdOff, target) {
    if (ifdOff + 2 > t.length) return;
    const n = u16(ifdOff);
    for (let e = 0; e < n; e++) {
      const p = ifdOff + 2 + e * 12;
      if (p + 12 > t.length) break;
      const tag = u16(p);
      const type = u16(p + 2);
      const count = u32(p + 4);
      const w = EXIF_TYPES[type];
      if (!w) continue;
      const bytes = w * count;
      let off = p + 8;
      if (bytes > 4) off = u32(p + 8); // value stored out-of-line
      if (off + bytes > t.length) continue;

      const ascii = () => t.toString('latin1', off, off + bytes).replace(/\0+$/, '').trim();
      const rat = () => {
        if (bytes !== 8) return null;
        const n2 = u32(off), d2 = u32(off + 4);
        return d2 === 0 ? null : n2 / d2;
      };

      switch (tag) {
        case 0x0112: exif.orientation = u16(off); break;          // Orientation
        case 0x010f: exif.make = ascii(); break;                  // Make
        case 0x0110: exif.model = ascii(); break;                 // Model
        case 0x0132: if (!exif.date) exif.date = ascii(); break;  // DateTime (fallback)
        case 0x8769: walk(u32(off), 'exif'); break;               // ExifIFD pointer
        case 0x9003: exif.date = ascii(); break;                  // DateTimeOriginal
        case 0x9004: if (!exif.date) exif.date = ascii(); break;  // DateTimeDigitized
        case 0x829a: exif.shutter = rat(); break;                 // ExposureTime
        case 0x829d: exif.fnum = rat(); break;                    // FNumber
        case 0x8827: exif.iso = u16(off); break;                  // ISOSpeedRatings
        case 0x920a: exif.focal = rat(); break;                   // FocalLength
        // 0x8825 GPS - intentionally skipped
        default: break;
      }
    }
  }

  walk(u32(4), 'ifd0');
  return Object.keys(exif).length ? exif : null;
}

/** TIFF blob from a JPEG APP1 'Exif' block. */
function jpegTiff(buf) {
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) break; // SOS / EOI
    const len = readU16(buf, i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    if (m === 0xe1) {
      const seg = buf.subarray(i + 4, i + 2 + len);
      if (seg.length > 8 && seg.toString('latin1', 0, 6) === 'Exif\x00\x00') {
        return seg.subarray(6);
      }
    }
    i += 2 + len;
  }
  return null;
}

/** TIFF blob from a PNG eXIf chunk (registered PNG chunk). */
function pngTiff(buf) {
  if (!(buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) {
    return null;
  }
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = readU32(buf, o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const p = o + 8;
    if (type === 'eXIf' && len > 0 && p + len <= buf.length) {
      const chunk = buf.subarray(p, p + len);
      // some writers prefix 'Exif\0\0' like JPEG APP1, some store raw TIFF
      return chunk.length > 6 && chunk.toString('latin1', 0, 6) === 'Exif\x00\x00'
        ? chunk.subarray(6) : chunk;
    }
    o = p + len + 4; // 4-byte CRC follows
  }
  return null;
}

/**
 * EXIF metadata for a jpg/jpeg/png buffer. Returns a flat object of the
 * fields the caption uses, or null when nothing useful is present.
 */
function readExif(buf, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.jpg' && ext !== '.jpeg' && ext !== '.png') return null;
  const tiff = (ext === '.png') ? pngTiff(buf) : jpegTiff(buf);
  return tiff ? readTiff(tiff) : null;
}

function fmtNum(v, decimals) {
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * Math.pow(10, decimals)) / Math.pow(10, decimals));
}

/** Nice shutter string from seconds: 1/250, 0.5s, 2s. */
function fmtShutter(v) {
  if (!v || v <= 0) return '';
  if (v < 1) {
    const d = Math.round(1 / v);
    return (1 / d === v || Math.abs(1 / d - v) / v < 0.05) ? '1/' + d + 's' : fmtNum(v, 2) + 's';
  }
  return fmtNum(v, 1) + 's';
}

/**
 * Tech-only caption for one photo, no date:
 *  line1: camera (make/model deduped), line2: focal f-number shutter ISO
 * Each line may be empty; both empty when no EXIF is usable.
 */
function formatCaption(exif) {
  if (!exif) return { line1: '', line2: '', text: '' };
  let line1 = '';
  if (exif.make && exif.model) {
    line1 = exif.model.toLowerCase().startsWith(exif.make.toLowerCase()) ? exif.model : exif.make + ' ' + exif.model;
  } else line1 = exif.model || exif.make || '';

  const specs = [];
  if (exif.focal) specs.push(fmtNum(exif.focal, 1) + 'mm');
  if (exif.fnum) specs.push('f/' + fmtNum(exif.fnum, 1));
  if (exif.shutter) specs.push(fmtShutter(exif.shutter));
  if (exif.iso) specs.push('ISO ' + exif.iso);
  const line2 = specs.join(' ');

  const text = [line1, line2].filter(Boolean).join(' - ');
  return { line1, line2, text };
}

function jpegSize(buf) {
  let i = 2;
  while (i + 9 <= buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const m = buf[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m === 0xda || m === 0xd9) break; // SOS / EOI: no SOF found before scan
    if (i + 4 > buf.length) break;
    const len = readU16(buf, i + 2);
    if (len < 2 || i + 2 + len > buf.length) break; // malformed segment
    const isSof = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) ||
      (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
    if (isSof && len >= 7) {
      return { w: readU16(buf, i + 7), h: readU16(buf, i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

function pngSize(buf) {
  if (buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: readU32(buf, 16), h: readU32(buf, 20) };
  }
  return null;
}

function gifSize(buf) {
  const sig = buf.toString('latin1', 0, 6);
  if ((sig === 'GIF87a' || sig === 'GIF89a') && buf.length >= 10) {
    return { w: buf[6] | (buf[7] << 8), h: buf[8] | (buf[9] << 8) };
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' ||
    buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  // walk chunks from offset 12: fourcc(4) + size(4) + payload
  let o = 12;
  while (o + 8 <= buf.length) {
    const fourcc = buf.toString('latin1', o, o + 4);
    const size = readU32(buf, o + 4);
    const p = o + 8;
    if (fourcc === 'VP8 ' && p + 10 <= buf.length) {
      // lossy: after frame tag(3) + start code(3)
      const b = buf;
      const w = b[p + 6] | ((b[p + 7] & 0x3f) << 8);
      const h = b[p + 8] | ((b[p + 9] & 0x3f) << 8);
      return w && h ? { w, h } : null;
    }
    if (fourcc === 'VP8L' && p + 5 <= buf.length && buf[p] === 0x2f) {
      const b = buf;
      const v = b[p + 1] | (b[p + 2] << 8) | (b[p + 3] << 16) | (b[p + 4] << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    if (fourcc === 'VP8X' && p + 10 <= buf.length) {
      const b = buf;
      const w = 1 + (b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16));
      const h = 1 + (b[p + 7] | (b[p + 8] << 8) | (b[p + 9] << 16));
      return w && h ? { w, h } : null;
    }
    o = p + size + (size % 2); // RIFF chunks are word-aligned
  }
  return null;
}

/**
 * Best-effort intrinsic size. Returns {w,h} or null. JPEG dims are
 * corrected for EXIF orientation so baked aspect == rendered aspect.
 */
function detectImageSize(buf, file) {
  const ext = path.extname(file).toLowerCase();
  let size = null;
  if (ext === '.jpg' || ext === '.jpeg') size = jpegSize(buf);
  else if (ext === '.png') size = pngSize(buf);
  else if (ext === '.gif') size = gifSize(buf);
  else if (ext === '.webp') size = webpSize(buf);
  if (!size) return null;
  if (ext === '.jpg' || ext === '.jpeg') {
    const exif = readExif(buf, file);
    if (exif && exif.orientation >= 5 && exif.orientation <= 8) return { w: size.h, h: size.w }; // rotated
  }
  return size;
}

/* ------------------------------------------------------------------ */
/* Natural filename sort                                              */
/* ------------------------------------------------------------------ */

function naturalSort(a, b) {
  const pa = a.match(/(\d+)|(\D+)/g) || [];
  const pb = b.match(/(\d+)|(\D+)/g) || [];
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const xa = pa[i], xb = pb[i];
    if (xa == null) return -1;
    if (xb == null) return 1;
    const da = /^\d+$/.test(xa), db = /^\d+$/.test(xb);
    if (da && db) {
      const la = xa.replace(/^0+/, ''), lb = xb.replace(/^0+/, '');
      if (la.length !== lb.length) return la.length - lb.length;
      const c = la.localeCompare(lb);
      if (c) return c;
    } else if (da !== db) return da ? -1 : 1;
    else {
      const c = xa.localeCompare(xb);
      if (c) return c;
    }
  }
  return a.localeCompare(b);
}

/* ------------------------------------------------------------------ */
/* Layout: uniform-height centered rows ("museum hang", no cropping)  */
/* ------------------------------------------------------------------ */

const LAYOUT = {
  COLS: 6,         // masonry columns - bricks fill the shortest column
  LONG: 600,       // display width of a landscape brick (world px)
  GAP: 64,         // uniform gutter: between columns, between stacked bricks,
                   // AND between the two photos of a portrait pair
  PAD: 260,        // empty wall around the whole arrangement
  MAT: 20,         // white mat border around each photo (px, world)
  CAP_H: 72,       // caption zone under the photo (air + three 16px lines)
  CAP_GAP: 22,     // air between photo bottom and the caption text
  OPEN_WORLD: 1500, // vertical world px shown on load (~2-3 stacked photos)
};

/**
 * photos: [{ file, w, h }] - intrinsic px. Masonry with portrait pairing:
 * a column slot ("brick") is either one landscape photo at full slot width,
 * or TWO portrait photos side by side scaled to fill the same slot width -
 * so a portrait pair reads like a landscape tile and portrait photos never
 * tower over the column rhythm. Pairs are formed greedily in photo order; a
 * leftover odd portrait becomes a single (wider) brick. Bricks then flow
 * into classic equal-width masonry columns (shortest column first). No crop.
 * Deterministic; earlier photos never move when new ones are appended.
 * Returns { photos: [{... + x, y, pw, ph, iw, ih}], canvasW, canvasH, cols }
 */
function hashFile(name) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function layout(photos) {
  const { COLS, LONG, GAP, PAD, MAT, CAP_H } = LAYOUT;
  const iw = LONG + 2 * MAT;          // brick slot width incl. mats
  // pair photos must leave room for both mats plus one uniform gutter
  const pairBudget = LONG - 2 * MAT - GAP;

  const sized = photos.map((p) => {
    const aspect = (p.w && p.h) ? p.w / p.h : 4 / 3; // unknown -> 4:3
    return { ...p, aspect, h: hashFile(p.file), marked: /-x\.[^.]+$/i.test(p.file) };
  });
  // scramble: order photos by a stable hash of their filename, so the wall
  // never shows chronological/name clusters and stays the same across builds
  // (a new photo just slides in at its own hash position)
  sized.sort((a, b) => a.h - b.h || a.file.localeCompare(b.file));
  sized.forEach((p, i) => { p.idx = i; });
  const lands = sized.filter((p) => p.aspect >= 1);
  const ports = sized.filter((p) => p.aspect < 1);

  // a "-x" filename suffix (before the extension) marks the ONLY photos that
  // display full size: always a single brick, never sharing a cell
  const marked = ports.filter((p) => p.marked);
  const pairPorts = ports.filter((p) => !p.marked);

  // pairs = two side-by-side portraits (in scrambled order); an odd leftover
  // portrait stays a single (wider) brick at its own position
  const pairCount = Math.floor(pairPorts.length / 2);
  const pairList = [];
  for (let k = 0; k < pairCount; k++) {
    pairList.push({ firstIdx: pairPorts[2 * k].idx, list: [pairPorts[2 * k], pairPorts[2 * k + 1]] });
  }
  const oddPortrait = pairPorts.length % 2 ? pairPorts[pairPorts.length - 1] : null;

  // size every brick
  for (const p of lands) {
    p.pw = LONG;
    p.ph = Math.max(1, Math.round(LONG / Math.max(p.aspect, 0.01)));
  }
  for (const p of marked) {
    p.pw = LONG; // highlighted ("-x") portraits: the only full-size ones
    p.ph = Math.max(1, Math.round(LONG / Math.max(p.aspect, 0.01)));
  }
  for (const pair of pairList) {
    const a1 = Math.max(pair.list[0].aspect, 0.01);
    const a2 = Math.max(pair.list[1].aspect, 0.01);
    const h = Math.min(pairBudget / (a1 + a2), 1500);
    pair.list[0].pw = Math.max(1, Math.round(h * a1)); pair.list[0].ph = Math.round(h);
    pair.list[1].pw = Math.max(1, Math.round(h * a2)); pair.list[1].ph = Math.round(h);
  }
  if (oddPortrait) {
    // orphan exception: an odd leftover portrait may go full size too
    oddPortrait.pw = LONG;
    oddPortrait.ph = Math.max(1, Math.round(LONG / Math.max(oddPortrait.aspect, 0.01)));
  }

  // bricks in near-original photo order: singles and pairs interleaved by index
  const bricks = lands.map((p) => ({ firstIdx: p.idx, list: [p] }));
  for (const p of marked) bricks.push({ firstIdx: p.idx, list: [p] });
  for (const pair of pairList) bricks.push(pair);
  if (oddPortrait) bricks.push({ firstIdx: oddPortrait.idx, list: [oddPortrait] });
  bricks.sort((a, b) => a.firstIdx - b.firstIdx);

  const colX = (c) => PAD + c * (iw + GAP);
  const colH = new Array(COLS).fill(PAD);

  for (const brick of bricks) {
    const ih = Math.max(...brick.list.map((p) => p.ph + CAP_H + 2 * MAT));
    let c = 0;
    for (let k = 1; k < COLS; k++) if (colH[k] < colH[c]) c = k;
    let x = colX(c);
    for (const p of brick.list) {
      p.x = x;
      p.y = colH[c];
      p.col = c;                       // remember column for centering below
      x += p.pw + 2 * MAT + GAP; // mates separated by the same uniform gutter
    }
    colH[c] += ih + GAP;
  }

  // salon center: shift every column so its vertical midpoint lies on one
  // shared axis - shorter columns extend equally above and below it, so the
  // whole wall is centered instead of hanging from a common top line
  const maxH = Math.max(...colH.map((v) => v - GAP - PAD));
  const midAxis = PAD + maxH / 2;
  for (const p of sized) {
    const h = colH[p.col] - GAP - PAD;
    p.y += Math.round(midAxis - (PAD + h / 2));
  }

  // arch silhouette: reorder the columns so heights descend from a tallest
  // center to the shortest outer edges (columns swap x positions, keeping
  // their internal layout and the shared midpoint axis)
  const heights = colH.map((v) => v - GAP - PAD);
  const desc = heights.map((h, c) => ({ h, c })).sort((a, b) => b.h - a.h);
  // target positions, center-out: even -> [cL, cR, cL-1, cR+1, ...]
  const target = [];
  if (COLS % 2 === 1) {
    const center = (COLS - 1) / 2;
    target.push(center);
    for (let d = 1; d <= center; d++) target.push(center - d, center + d);
  } else {
    const cL = COLS / 2 - 1; // left center, right center
    const cR = COLS / 2;
    for (let d = 0; d < COLS / 2; d++) target.push(cL - d, cR + d);
  }
  for (let j = 0; j < desc.length; j++) {
    const dx = (target[j] - desc[j].c) * (iw + GAP);
    for (const p of sized) if (p.col === desc[j].c) p.x += dx;
  }

  const arrW = COLS * iw + (COLS - 1) * GAP;
  const canvasH = maxH + 2 * PAD;
  return { photos: sized, canvasW: PAD * 2 + arrW, canvasH, cols: COLS };
}

/* ------------------------------------------------------------------ */
/* HTML template                                                      */
/* ------------------------------------------------------------------ */

function buildHtml(data) {
  const photos = data.photos;
  const empty = photos.length === 0;

  const json = JSON.stringify(photos.map((p) => ({
    x: p.x, y: p.y, pw: p.pw, ph: p.ph,
    file: p.file, w: p.w, h: p.h, base: p.base,
    title: p.title || '', spec: p.spec || '', cam: p.cam || '',
  })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="A photo wall you can pan and zoom.">
<title>JPG BY KRISZTIAN</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%2326231e'/%3E%3Ccircle cx='32' cy='32' r='10' fill='%23e23c30'/%3E%3C/svg%3E">
<style>
  :root {
    --wall: #cfc8ba;                   /* one flat color everywhere */
    --chrome: rgba(25, 22, 18, .62);   /* header/hint/controls glass */
    --ink: #f2eee4;
    --ink-dim: rgba(242, 238, 228, .55);
    --note: #4a443a;                   /* text sitting directly on the wall */
    --mat: #fbfaf6;                    /* frame mat */
    --cap: #776f63;                    /* caption text on the mat */
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --wall: #26231e;
      --chrome: rgba(12, 11, 9, .66);
      --ink: #e8e4d8;
      --ink-dim: rgba(232, 228, 216, .5);
      --note: #d5cfc2;
      --mat: #c7bfab;                  /* warm off-white, not pure white */
      --cap: #4c4637;
    }
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { height:100%; overflow:hidden; }
  body {
    background:var(--wall);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color:var(--ink);
    -webkit-user-select:none; user-select:none;
    overscroll-behavior:none;
  }

  #stage {
    position:fixed; inset:0;
    touch-action:none;               /* we handle pan/zoom, not the browser */
    cursor:grab;
    /* vignette baked into the stage background: the scene falls off into
       shadow toward the viewport edges, so it feels like the wall simply
       ends - nothing continues past it. Viewport-anchored (stage is never
       transformed). */
    background-color: var(--wall);
    background-image: radial-gradient(125% 125% at 50% 50%,
      rgba(0,0,0,0) 58%, rgba(0,0,0,.32) 100%);
  }
  #stage.dragging { cursor:grabbing; }

  #world { position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform; }

  #wall {
    position:relative;
    width:${data.canvasW}px; height:${data.canvasH}px;
    /* transparent: the stage background (with its vignette) shows through
       everywhere, frames float directly on it */
    background: transparent;
  }

  .item { position:absolute; left:0; top:0; will-change:transform; }
  .frame {
    background:var(--mat);
    padding:${LAYOUT.MAT}px;
    border-radius:2px;                  /* soft corners on the mat */
    box-shadow: 0 2px 3px rgba(0,0,0,.16), 0 9px 20px rgba(0,0,0,.20);
  }
  .frame img {
    display:block;
    width:100%; height:auto;          /* keep exact aspect, never crop */
    background:#000;
    border-radius:2px;                /* soft corners on the photo itself */
    -webkit-user-drag:none; user-drag:none;
  }
  .frame .cap {
    width:100%; height:${LAYOUT.CAP_H}px;
    padding-top:${LAYOUT.CAP_GAP}px;   /* air between photo and text */
    color:var(--cap);
    overflow:hidden;
    /* 22px air above + 22px (2px strip + 20px mat) below centers the text */
  }
  .frame .cap-line {
    height:16px; line-height:16px;   /* two 16px lines fit the strip */
    font-size:11px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .frame .cap-line:empty { display:none; }
  .item.off { display:none; }

  /* light mats cast a deeper shadow on the dark wall */
  @media (prefers-color-scheme: dark) {
    .frame { box-shadow: 0 2px 4px rgba(0,0,0,.45), 0 12px 28px rgba(0,0,0,.5); }
  }

  /* chrome: header + controls */
  header {
    position:fixed; top:0; left:0; right:0;
    display:flex; align-items:baseline; gap:14px;
    padding:14px 18px; pointer-events:none;
    background:linear-gradient(180deg, var(--chrome), rgba(0,0,0,0));
  }
  header h1 { font-size:13px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; }
  header .count { font-size:11px; color:var(--ink-dim); }

  #hint {
    position:fixed; left:50%; bottom:64px; transform:translateX(-50%);
    font-size:11px; color:var(--ink-dim); text-align:center; pointer-events:none;
    background:var(--chrome); padding:8px 14px; border-radius:6px;
    opacity:1; transition:opacity 1.2s ease 6s;
  }
  #hint.gone { opacity:0; }

  #controls {
    position:fixed; right:14px; bottom:14px;
    display:flex; gap:6px; align-items:center;
    background:var(--chrome); border:1px solid rgba(255,255,255,.12);
    padding:6px; border-radius:10px;
    backdrop-filter:blur(4px);
  }
  #controls button {
    width:34px; height:34px; border:0; border-radius:7px;
    background:transparent; color:var(--ink);
    font:inherit; font-size:17px; line-height:1; cursor:pointer;
  }
  #controls button:hover { background:rgba(255,255,255,.14); }
  #controls button:active { background:rgba(255,255,255,.24); }
  #controls .sep { width:1px; height:20px; background:rgba(255,255,255,.18); margin:0 2px; }
  #zoomLbl { min-width:38px; text-align:center; font-size:11px; color:var(--ink-dim); }

  .empty-note {
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    text-align:center; padding:0 24px;
  }
  .empty-note p { max-width:420px; font-size:13px; line-height:1.7; color:var(--note); }
  .empty-note code {
    color:var(--note); background:rgba(127,127,127,.2); padding:1px 6px; border-radius:4px;
  }
</style>
</head>
<body>
<div id="stage">
  <div id="world"><div id="wall"></div></div>
</div>

<header>
  <h1>JPG BY KRISZTIAN</h1>
  <span class="count">${photos.length} photo${photos.length === 1 ? '' : 's'}</span>
</header>

${empty ? `
<div class="empty-note"><p>The wall is empty.<br>Drop image files (jpg, png, webp, gif) into the <code>photos/</code> folder and run <code>node gen.js</code>.</p></div>` : `
<div id="hint">drag to move - scroll / pinch / +/- to zoom - arrows pan</div>

<div id="controls">
  <button id="zoomOut" aria-label="Zoom out">&minus;</button>
  <button id="zoomIn" aria-label="Zoom in">+</button>
  <span id="zoomLbl"></span>
  <span class="sep"></span>
  <button id="fitBtn" aria-label="Fit whole wall to view">&copy;</button>
</div>`}

<script>
"use strict";
${empty ? '/* empty wall - nothing to render */' : `
/* Photo wall viewport engine: pan by drag, zoom by wheel/pinch/buttons.
   The layout is baked into POS below, so the browser never has to wait
   for image dimensions - every frame is placed instantly. */

var POS = ${json};
var MAX_SCALE = 5;
// vertical world window shown on load, independent of wall size
var OPEN_WORLD = ${LAYOUT.OPEN_WORLD};

var stage = document.getElementById('stage');
var world = document.getElementById('world');
var wall = document.getElementById('wall');
var hint = document.getElementById('hint');
var zoomLbl = document.getElementById('zoomLbl');

var MAT = ${LAYOUT.MAT};
var CAP_H = ${LAYOUT.CAP_H};
var items = [];
for (var i = 0; i < POS.length; i++) {
  var d = POS[i];
  var el = document.createElement('div');
  el.className = 'item';
  el.style.transform = 'translate(' + d.x + 'px,' + d.y + 'px)';

  var frame = document.createElement('div');
  frame.className = 'frame';
  frame.style.width = (d.pw + 2 * MAT) + 'px';
  // height auto: image (d.ph) + caption strip (CAP_H)

  var img = document.createElement('img');
  img.src = 'photos/' + d.file;
  img.alt = d.base.replace(/-/g, ' '); // readable, not a copy of the frame text
  img.width = d.w;
  img.height = d.h;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false;
  frame.appendChild(img);

  var cap = document.createElement('div');
  cap.className = 'cap';
  var lines = [d.title, d.spec, d.cam];
  for (var k = 0; k < lines.length; k++) {
    var cl = document.createElement('div');
    cl.className = 'cap-line';
    cl.textContent = lines[k];
    if (lines[k]) cl.title = lines[k];
    cap.appendChild(cl);
  }
  frame.appendChild(cap);
  el.appendChild(frame);
  wall.appendChild(el);
  items.push({ el: el, x: d.x, y: d.y, w: d.pw + 2 * MAT, h: d.ph + CAP_H + 2 * MAT });
}

var wallW = ${data.canvasW}, wallH = ${data.canvasH};

// view state: screen = world * scale + (tx, ty)
var tx = 0, ty = 0, scale = 1;

function setTransform() {
  world.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
  if (zoomLbl) zoomLbl.textContent = Math.round(scale * 100) + '%';
}

function fitScale() {
  var vw = stage.clientWidth, vh = stage.clientHeight;
  return Math.min((vw - 32) / wallW, (vh - 32) / wallH);
}

function minScale() {
  return Math.max(fitScale(), 0.03); // smallest zoom = whole wall visible
}

// pan stops at the wall edges: no empty-space roaming. When the wall is
// smaller than the viewport on an axis, it is centered and locked there.
function clamp() {
  var vw = stage.clientWidth, vh = stage.clientHeight;
  var w = wallW * scale, h = wallH * scale;

  if (w < vw - 1) { tx = Math.round((vw - w) / 2); }
  else { tx = Math.min(0, Math.max(vw - w, tx)); }
  if (h < vh - 1) { ty = Math.round((vh - h) / 2); }
  else { ty = Math.min(0, Math.max(vh - h, ty)); }
}

function fit() {
  scale = Math.min(fitScale(), MAX_SCALE);
  if (scale < minScale()) scale = minScale();
  tx = 0; ty = 0;
  clamp();
  setTransform();
}

function zoomAt(cx, cy, factor) {
  var ns = scale * factor;
  if (ns > MAX_SCALE) ns = MAX_SCALE;
  if (ns < minScale()) ns = minScale(); // land exactly on the fit minimum
  var wx = (cx - tx) / scale, wy = (cy - ty) / scale; // point under cursor in world
  scale = ns;
  tx = cx - wx * scale;
  ty = cy - wy * scale;
  clamp();
  setTransform();
}

function toWorld(cx, cy) { return [(cx - tx) / scale, (cy - ty) / scale]; }

/* ---------- culling: hide frames outside the viewport ---------- */
var rafPending = false;
function scheduleCull() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(function () {
    rafPending = false;
    var x0 = -tx / scale - 200, y0 = -ty / scale - 200;
    var x1 = x0 + stage.clientWidth / scale + 400;
    var y1 = y0 + stage.clientHeight / scale + 400;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var off = it.x + it.w < x0 || it.x > x1 || it.y + it.h < y0 || it.y > y1;
      if (off && !it.el.classList.contains('off')) it.el.classList.add('off');
      else if (!off && it.el.classList.contains('off')) it.el.classList.remove('off');
    }
  });
}

/* ---------- drag to pan (pointer events, also pinch) ---------- */
var pointers = {}; // pointerId -> {x,y}
var dragStart = null;   // {sx,sy,tx,ty}
var pinchStart = null;  // {dist, cx, cy, scale}
var moved = false;

stage.addEventListener('pointerdown', function (e) {
  world.style.transition = ''; // key-move glide must not fight a drag
  stage.setPointerCapture(e.pointerId);
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(pointers);
  if (ids.length === 2) {
    var a = pointers[ids[0]], b = pointers[ids[1]];
    pinchStart = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      scale: scale
    };
    dragStart = null;
  } else {
    dragStart = { sx: e.clientX, sy: e.clientY, tx: tx, ty: ty };
  }
  moved = false;
});

stage.addEventListener('pointermove', function (e) {
  if (!pointers[e.pointerId]) return;
  var p = pointers[e.pointerId];
  var dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.abs(e.clientX - (dragStart ? dragStart.sx : e.clientX)) > 3 ||
      Math.abs(e.clientY - (dragStart ? dragStart.sy : e.clientY)) > 3) moved = true;

  var ids = Object.keys(pointers);
  if (ids.length === 2) {
    if (!pinchStart) return;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist < 8) return;
    var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    var factor = dist / pinchStart.dist;
    var ns = pinchStart.scale * factor;
    if (ns > MAX_SCALE) ns = MAX_SCALE;
    if (ns < minScale()) ns = minScale();
    var wx = (pinchStart.cx - tx) / scale, wy = (pinchStart.cy - ty) / scale;
    scale = ns;
    tx = cx - wx * scale;
    ty = cy - wy * scale;
    clamp(); setTransform(); scheduleCull();
    return;
  }
  if (dragStart && ids.length === 1) {
    stage.classList.add('dragging');
    tx = dragStart.tx + (e.clientX - dragStart.sx);
    ty = dragStart.ty + (e.clientY - dragStart.sy);
    clamp(); setTransform(); scheduleCull();
  }
});

function endPointer(e) {
  delete pointers[e.pointerId];
  if (Object.keys(pointers).length === 0) {
    dragStart = null; pinchStart = null;
    stage.classList.remove('dragging');
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

/* ---------- double-tap / double-click zooms in ---------- */
var lastTap = 0, tapX = 0, tapY = 0;
stage.addEventListener('pointerup', function (e) {
  if (moved) return;
  var now = Date.now();
  if (now - lastTap < 350 && Math.hypot(e.clientX - tapX, e.clientY - tapY) < 40) {
    zoomAt(e.clientX, e.clientY, 2.2);
    scheduleCull();
    lastTap = 0;
  } else {
    lastTap = now; tapX = e.clientX; tapY = e.clientY;
  }
});

/* ---------- wheel zoom (to cursor) ---------- */
stage.addEventListener('wheel', function (e) {
  e.preventDefault();
  var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0016));
  zoomAt(e.clientX, e.clientY, f);
  scheduleCull();
}, { passive: false });

/* ---------- keyboard panning (arrow keys) ---------- */
var keyT = null;
function moveBy(dx, dy) {
  tx += dx; ty += dy;
  clamp();
  world.style.transition = 'transform 0.18s ease'; // soft glide for key moves
  setTransform();
  clearTimeout(keyT);
  keyT = setTimeout(function () { world.style.transition = ''; }, 220);
}
window.addEventListener('keydown', function (e) {
  // + / = zoom in, - zoom out (around the viewport center)
  if (e.key === '+' || e.key === '=' || e.key === '-') {
    e.preventDefault();
    var dir = (e.key === '-') ? (1 / 1.5) : 1.5;
    zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, dir);
    scheduleCull();
    return;
  }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' &&
      e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  var vw = stage.clientWidth, vh = stage.clientHeight;
  // arrow = look in that direction: Right reveals content to the right, so
  // the wall shifts left (negative tx), Down shifts up (negative ty)
  var dx = e.key === 'ArrowRight' ? -Math.round(vw * 0.55) : e.key === 'ArrowLeft' ? Math.round(vw * 0.55) : 0;
  var dy = e.key === 'ArrowDown' ? -Math.round(vh * 0.55) : e.key === 'ArrowUp' ? Math.round(vh * 0.55) : 0;
  moveBy(dx, dy);
  scheduleCull();
});

/* ---------- controls ---------- */
var zoomIn = document.getElementById('zoomIn');
var zoomOut = document.getElementById('zoomOut');
var fitBtn = document.getElementById('fitBtn');
zoomIn.addEventListener('click', function () {
  zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.5); scheduleCull();
});
zoomOut.addEventListener('click', function () {
  zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.5); scheduleCull();
});
fitBtn.addEventListener('click', function () { fit(); scheduleCull(); });

window.addEventListener('resize', function () { fit(); scheduleCull(); });

/* ---------- go ---------- */
// open "in the gallery": about 1500 world px (~3 stacked photos) regardless
// of wall size (fit button still zooms out to the whole wall)
scale = Math.min(1, stage.clientHeight / OPEN_WORLD);
if (scale < minScale()) scale = minScale();
tx = 0; ty = 0;
clamp(); setTransform(); scheduleCull();
if (hint) setTimeout(function () { hint.classList.add('gone'); }, 7000);`}
</script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

// optimization (optional): sharp resizes + compresses for the web. Without
// it the build falls back to serving the originals untouched.
const OPTIM = {
  MAX_EDGE: 2048,  // longest side cap for served copies (px)
  JPEG_QUALITY: 82,
};
let sharp = null;
try { sharp = require('sharp'); } catch (err) { /* optional */ }

/**
 * Write an optimized web copy of one photo into dist/photos. Metadata is
 * stripped (privacy + smaller files) and EXIF orientation is baked in, so
 * the served file matches the layout dims computed from the original.
 * GIFs are passed through (sharp cannot encode them). Returns byte counts.
 */
async function writeOptimized(file, srcFull, destFull) {
  if (!sharp || path.extname(file).toLowerCase() === '.gif') {
    fs.copyFileSync(srcFull, destFull);
    return { before: fs.statSync(srcFull).size, after: fs.statSync(destFull).size };
  }
  const buf = fs.readFileSync(srcFull);
  const ext = path.extname(file).toLowerCase();
  let pipeline = sharp(buf, { failOn: 'none' }).rotate(); // bake EXIF orientation
  let out;
  try {
    if (ext === '.jpg' || ext === '.jpeg') {
      out = await pipeline
        .resize({ width: OPTIM.MAX_EDGE, height: OPTIM.MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: OPTIM.JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
    } else if (ext === '.webp') {
      out = await pipeline
        .resize({ width: OPTIM.MAX_EDGE, height: OPTIM.MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: OPTIM.JPEG_QUALITY })
        .toBuffer();
    } else { // png
      out = await pipeline
        .resize({ width: OPTIM.MAX_EDGE, height: OPTIM.MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();
    }
  } catch (err) {
    console.warn('optimize failed for ' + file + ' - serving original: ' + err.message);
    fs.copyFileSync(srcFull, destFull);
    return { before: buf.length, after: fs.statSync(destFull).size };
  }
  fs.writeFileSync(destFull, out);
  return { before: buf.length, after: out.length };
}

async function main() {
  if (!fs.existsSync(PHOTOS_DIR)) {
    console.error('photos dir not found: ' + PHOTOS_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(PHOTOS_DIR).filter((f) => {
    if (SKIP_PREFIXES.some((p) => f.startsWith(p))) return false;
    return IMAGE_EXTS.has(path.extname(f).toLowerCase());
  }).sort(naturalSort);

  const photos = [];
  const skipped = [];
  for (const f of files) {
    const full = path.join(PHOTOS_DIR, f);
    let buf;
    try { buf = fs.readFileSync(full); }
    catch (err) { skipped.push(f + ' (unreadable)'); continue; }
    const size = detectImageSize(buf, f);
    if (!size) { skipped.push(f + ' (dims unknown)'); continue; }
    const exif = readExif(buf, f);
    const cap = formatCaption(exif);
    const base = path.basename(f, path.extname(f)).replace(/-x$/i, '');
    const ext = path.extname(f).toLowerCase();
    photos.push({
      file: f,
      base,                                  // "-x" marker is not shown in alt/title
      // title = the file name verbatim (dashes kept), fully uppercase + ext
      title: base.toUpperCase() + ext.toUpperCase(),
      w: size.w, h: size.h,
      cam: cap.line1,                        // camera (small credit, last line)
      spec: cap.line2,                       // exposure specs (middle line)
    });
  }

  const laid = layout(photos);
  const html = buildHtml({ photos: laid.photos, canvasW: laid.canvasW, canvasH: laid.canvasH, cols: laid.cols });

  // clean + rebuild dist
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'photos'), { recursive: true });

  // write optimized copies of the photos on the wall
  let origBytes = 0, optBytes = 0;
  for (const p of laid.photos) {
    const src = path.join(PHOTOS_DIR, p.file);
    const dest = path.join(OUT_DIR, 'photos', p.file);
    const r = await writeOptimized(p.file, src, dest); // eslint-disable-line no-await-in-loop
    origBytes += r.before;
    optBytes += r.after;
  }
  const mode = sharp ? 'optimized' : 'copied as-is (npm install for optimization)';

  // CNAME for GitHub Pages custom domain
  const cname = path.join(ROOT, 'CNAME');
  if (fs.existsSync(cname)) fs.copyFileSync(cname, path.join(OUT_DIR, 'CNAME'));

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
  console.log('wall: ' + laid.photos.length + ' photos, canvas ' + laid.canvasW + 'x' + laid.canvasH + ' px, ' + mode);
  const savedMb = ((origBytes - optBytes) / (1024 * 1024)).toFixed(1);
  console.log('images: ' + (origBytes / (1024 * 1024)).toFixed(1) + ' MB original -> ' +
    (optBytes / (1024 * 1024)).toFixed(1) + ' MB served (-' + savedMb + ' MB)');
  if (skipped.length) console.log('skipped: ' + skipped.join(', '));
  console.log('output: ' + path.join(OUT_DIR, 'index.html'));
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });

module.exports = {
  layout, detectImageSize, readExif, formatCaption, naturalSort, LAYOUT,
};

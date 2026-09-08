#!/usr/bin/env node
'use strict';
/*
 * seed-placeholders.js - writes sample PNGs into photos/ so the wall has
 * something to show before real photos land.
 *
 * Run:  node scripts/seed-placeholders.js
 * Idempotent: never overwrites an existing file. Delete the samples from
 * photos/ whenever you want them gone.
 *
 * Zero dependencies: tiny PNG (RGB, 8-bit) encoder on Node zlib.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'photos');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- minimal PNG encoder ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgb(w,h,xyFn) with xyFn(x,y) -> [r,g,b] 0..255. Optional pngChunks
 *  appended after IHDR (used for the eXIf chunk). */
function writePng(file, w, h, xyFn, extraChunks) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = xyFn(x, y);
      const o = row + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(extraChunks || []),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

/* ---------------- tiny TIFF/EXIF writer (for sample captions) -------- */

const T_ASCII = 2, T_SHORT = 3, T_LONG = 4, T_RATIONAL = 5;

/**
 * Builds a little-endian TIFF blob with the camera fields the wall shows.
 * spec: { make, model, date: "YYYY:MM:DD HH:MM:SS",
 *         fnum, shutter, iso, focal } (all optional).
 * Deliberately never writes GPS.
 */
function makeExifTiff(spec) {
  const s = spec || {};
  // ExifIFD entries: date original, exposure, fnumber, iso, focal
  const e1 = [];
  if (s.date) e1.push([0x9003, T_ASCII, s.date + '\0']);
  if (s.shutter) e1.push([0x829a, T_RATIONAL, s.shutter]);       // [n, d]
  if (s.fnum) e1.push([0x829d, T_RATIONAL, s.fnum]);             // [n, d]
  if (s.iso) e1.push([0x8827, T_SHORT, [s.iso]]);
  if (s.focal) e1.push([0x920a, T_RATIONAL, s.focal]);

  const e0 = [];
  if (s.make) e0.push([0x010f, T_ASCII, s.make + '\0']);
  if (s.model) e0.push([0x0110, T_ASCII, s.model + '\0']);
  if (e1.length) e0.push([0x8769, T_LONG, null, 'ifd1']);        // ExifIFD ptr
  if (!e0.length && !e1.length) return null;

  const ifd0Bytes = 2 + e0.length * 12 + 4;
  const ifd0Off = 8;
  const ifd1Off = ifd0Off + ifd0Bytes;
  const ifd1Bytes = 2 + e1.length * 12 + 4;
  let pool = ifd1Off + ifd1Bytes;

  // out-of-line payloads: ascii bytes (already \0-terminated), rationals [n,d]
  const payloads = new Map(); // key 'ifdName-entryIndex' -> { off, buf }
  function reserve(buf) {
    pool += (pool % 2); // keep word-aligned
    const off = pool;
    pool += buf.length;
    return off;
  }
  const ifdNames = ['ifd0', 'ifd1'];
  for (let k = 0; k < 2; k++) {
    const entries = k === 0 ? e0 : e1;
    for (let i = 0; i < entries.length; i++) {
      const [tag, type, val] = entries[i];
      if (type === T_ASCII && val.length > 4) {
        // TIFF: ASCII that fits in 4 bytes is stored inline in the entry
        payloads.set(ifdNames[k] + '-' + i, { off: reserve(Buffer.from(val, 'latin1')), buf: Buffer.from(val, 'latin1') });
      } else if (type === T_RATIONAL) {
        const b = Buffer.alloc(8);
        b.writeUInt32LE(val[0], 0); b.writeUInt32LE(val[1], 4);
        payloads.set(ifdNames[k] + '-' + i, { off: reserve(b), buf: b });
      }
    }
  }

  const buf = Buffer.alloc(pool);
  buf.write('II', 0, 'latin1');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifd0Off, 4);

  function writeIfd(name, off, entries) {
    buf.writeUInt16LE(entries.length, off);
    let p = off + 2;
    for (let i = 0; i < entries.length; i++) {
      const [tag, type, val] = entries[i];
      buf.writeUInt16LE(tag, p);
      buf.writeUInt16LE(type, p + 2);
      const count = type === T_ASCII ? val.length : 1;
      buf.writeUInt32LE(count, p + 4);
      const pay = payloads.get(name + '-' + i);
      if (type === T_SHORT) {
        buf.writeUInt16LE(val[0], p + 8);
      } else if (type === T_ASCII && val.length <= 4) {
        buf.write(val, p + 8, 'latin1'); // inline ASCII (fits in value field)
      } else if (pay) {
        buf.writeUInt32LE(pay.off, p + 8);
      } else {
        buf.writeUInt32LE(0, p + 8);
      }
      p += 12;
    }
    buf.writeUInt32LE(0, p); // next IFD
  }

  // IFD1 has no pointer, write it first at ifd1Off; then IFD0, whose 0x8769
  // entry gets patched to point at ifd1Off.
  writeIfd('ifd1', ifd1Off, e1);
  writeIfd('ifd0', ifd0Off, e0);
  let p = ifd0Off + 2;
  for (let i = 0; i < e0.length; i++) {
    const tag = buf.readUInt16LE(p);
    if (tag === 0x8769) buf.writeUInt32LE(ifd1Off, p + 8);
    p += 12;
  }
  // copy payloads
  for (const { off, buf: pb } of payloads.values()) pb.copy(buf, off);
  return buf;
}

function exifChunk(spec) {
  const tiff = makeExifTiff(spec);
  return tiff ? chunk('eXIf', tiff) : null;
}

/* ---------------- sample artwork ---------------- */

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/** Vertical two-tone gradient + thin inner frame + a "sun" disc. */
function sample(c1, c2, sun) {
  return (x, y, w, h) => {
    let t = y / (h - 1);
    // gentle diagonal lean so samples look distinct
    t = Math.min(1, Math.max(0, t + (x - w / 2) / (w * 4)));
    let r = lerp(c1[0], c2[0], t);
    let g = lerp(c1[1], c2[1], t);
    let b = lerp(c1[2], c2[2], t);

    // inner frame line (like a border inside the composition)
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    if (edge < 8) { r *= 0.55; g *= 0.55; b *= 0.55; }

    // sun disc, soft-ish via plain circle
    if (sun) {
      const dx = x - sun[0] * w, dy = y - sun[1] * h;
      const d2 = dx * dx + dy * dy;
      const rr = h * 0.16;
      if (d2 < rr * rr) {
        r = lerp(r, 255, 0.9); g = lerp(g, 244, 0.9); b = lerp(b, 214, 0.9);
      } else if (d2 < (rr * 1.7) * (rr * 1.7)) {
        const glow = 1 - (Math.sqrt(d2) - rr) / (rr * 0.7);
        r = lerp(r, 255, glow * 0.25); g = lerp(g, 244, glow * 0.25); b = lerp(b, 214, glow * 0.25);
      }
    }
    return [r, g, b];
  };
}

// name -> [w, h, top color, bottom color, sun or null, exif or null]
// exif: {make, model, date, fnum:[n,d], shutter:[n,d], iso, focal:[n,d]}
const SAMPLES = [
  ['terracotta-3x2', 1200, 800, [196, 96, 70], [84, 40, 34], [0.7, 0.35],
    { make: 'Canon', model: 'Canon EOS R6', date: '2026:03:14 10:30:00', fnum: [18, 10], shutter: [1, 200], iso: 100, focal: [50, 1] }],
  ['olive-4x3', 1120, 840, [150, 140, 76], [44, 52, 36], null, null],
  ['teal-16x9', 1280, 720, [60, 150, 140], [16, 44, 52], [0.8, 0.3],
    { make: 'Apple', model: 'iPhone 15 Pro', date: '2025:11:02 18:44:12', fnum: [178, 100], shutter: [1, 120], iso: 400, focal: [686, 100] }],
  ['dustyrose-square', 1000, 1000, [188, 128, 138], [74, 46, 60], null, null],
  ['sand-3x2', 1200, 800, [226, 198, 148], [110, 82, 50], null,
    { make: 'FUJIFILM', model: 'X-T5', date: '2026:01:30 16:05:44', fnum: [28, 10], shutter: [1, 500], iso: 160, focal: [23, 1] }],
  ['indigo-9x16', 720, 1280, [96, 108, 208], [24, 26, 66], [0.5, 0.2],
    { make: 'Apple', model: 'iPhone 13 mini', date: '2024:08:19 07:15:03', fnum: [16, 10], shutter: [1, 60], iso: 250, focal: [51, 10] }],
  ['slate-2x3', 800, 1200, [120, 136, 148], [30, 38, 46], null, null],
  ['cobalt-16x9', 1280, 720, [58, 120, 220], [12, 26, 70], [0.35, 0.4],
    { make: 'Samsung', model: 'Galaxy S24 Ultra', date: '2025:05:27 12:01:09', fnum: [17, 10], shutter: [1, 1000], iso: 50, focal: [63, 10] }],
  ['plum-4x5', 800, 1000, [150, 70, 140], [46, 18, 50], null,
    { make: 'Sony', model: 'ILCE-7M4', date: '2026:06:21 20:22:31', fnum: [14, 10], shutter: [1, 40], iso: 800, focal: [35, 1] }],
  ['moss-1x1', 1000, 1000, [120, 150, 88], [30, 46, 26], [0.3, 0.6], null],
  ['ochre-3x4', 840, 1120, [214, 158, 74], [96, 60, 20], null,
    { make: 'Nikon', model: 'Z 6', date: '2025:02:11 09:47:55', fnum: [4, 1], shutter: [1, 250], iso: 200, focal: [85, 1] }],
  ['steel-21x9', 1260, 540, [130, 150, 170], [30, 42, 56], [0.5, 0.45],
    { make: 'Canon', model: 'Canon EOS R6', date: '2024:12:25 14:02:40', fnum: [56, 10], shutter: [1, 640], iso: 320, focal: [100, 1] }],
];

let written = 0;
for (const [name, w, h, c1, c2, sun, exif] of SAMPLES) {
  const file = path.join(OUT, 'sample-' + name + '.png');
  if (fs.existsSync(file)) continue;
  writePng(file, w, h, sample(c1, c2, sun), [exifChunk(exif)].filter(Boolean));
  written++;
  console.log('wrote ' + path.relative(path.join(__dirname, '..'), file));
}
console.log(written + ' placeholder(s) written to photos/ - ' +
  (written ? 'delete them anytime, real photos replace them.' : 'already present, nothing to do.'));

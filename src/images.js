'use strict';
/*
 * images.js - reading, describing and re-encoding photographs.
 *
 * Zero-dependency image headers: sizes and EXIF (orientation, date, camera,
 * exposure) are parsed straight from the file bytes, so the layout can be
 * computed before anything is written. The GPS IFD (0x8825) is deliberately
 * never followed - the build must not care where a photo was taken.
 *
 * Re-encoding uses sharp; it is a hard requirement, because the alternative
 * (copying the original bytes into the published output) would ship EXIF
 * metadata, possibly including GPS coordinates.
 */

const fs = require('fs');
const path = require('path');
const { naturalSort } = require('./layout');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const SKIP_PREFIXES = ['.', '_'];   // hidden files, editor/scratch sidecars

let sharp = null;
/** Load sharp once; a missing install is a hard error, never a silent downgrade. */
function requireSharp() {
  if (sharp) return sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    throw new Error('sharp is required (npm install) - without it photos would be '
      + 'published with their original EXIF metadata: ' + err.message);
  }
  return sharp;
}

/* ------------------------------------------------------------------ */
/* Image header parsing (dims + orientation)                          */
/* ------------------------------------------------------------------ */

function readU16(buf, o) { return (buf[o] << 8) | buf[o + 1]; }
function readU32(buf, o) {
  return ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
}

const EXIF_TYPES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 12: 8 };

/** Read every IFD entry we care about, following the ExifIFD pointer. */
function readTiff(t) {
  if (t.length < 8) return null;
  const isLE = t.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (isLE ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o) => (isLE
    ? t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)
    : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  if (u16(2) !== 42) return null;

  const exif = {};

  function walk(ifdOff) {
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
        case 0x8769: walk(u32(off)); break;                       // ExifIFD pointer
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

  walk(u32(4));
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

/** EXIF metadata for a jpg/jpeg/png buffer, or null when nothing is present. */
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

/** Nice shutter string from seconds: 1/250s, 0.5s, 2s. */
function fmtShutter(v) {
  if (!v || v <= 0) return '';
  if (v < 1) {
    const d = Math.round(1 / v);
    return (1 / d === v || Math.abs(1 / d - v) / v < 0.05) ? '1/' + d + 's' : fmtNum(v, 2) + 's';
  }
  return fmtNum(v, 1) + 's';
}

/**
 * Tech-only caption parts: camera (make/model deduped) and the exposure line.
 * Either may be empty when the EXIF is missing or unusable.
 */
function formatCaption(exif) {
  if (!exif) return { camera: '', specs: '', year: '' };
  let camera = '';
  if (exif.make && exif.model) {
    camera = exif.model.toLowerCase().startsWith(exif.make.toLowerCase())
      ? exif.model : exif.make + ' ' + exif.model;
  } else camera = exif.model || exif.make || '';

  const specs = [];
  if (exif.focal) specs.push(fmtNum(exif.focal, 1) + 'mm');
  if (exif.fnum) specs.push('f/' + fmtNum(exif.fnum, 1));
  if (exif.shutter) specs.push(fmtShutter(exif.shutter));
  if (exif.iso) specs.push('ISO ' + exif.iso);

  const year = exif.date ? (/^(\d{4})/.exec(exif.date) || [])[1] || '' : '';
  return { camera, specs: specs.join(' '), year };
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
 * Best-effort intrinsic size. Returns {w,h} or null. JPEG dims are corrected
 * for EXIF orientation so the baked aspect matches what the browser renders.
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
/* Re-encoding                                                        */
/* ------------------------------------------------------------------ */

/** sharp pipeline primed with orientation baked in and metadata dropped. */
function pipeline(buf) {
  return requireSharp()(buf, { failOn: 'none', animated: false }).rotate();
}

/**
 * Write the served copy of one photo into <out>/photos/<file>, metadata
 * stripped and EXIF orientation baked in, plus a tiny inline placeholder.
 *
 * Returns { before, after, thumb }.
 */
async function writeCopies(file, srcFull, outDir, cfg) {
  const s = requireSharp();
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(srcFull);
  const destFull = path.join(outDir, 'photos', file);
  const resize = { width: cfg.images.maxEdge, height: cfg.images.maxEdge, fit: 'inside', withoutEnlargement: true };

  const encode = async (pipe, edge, quality) => {
    // GIF is decoded to its first frame and re-encoded as PNG (keeps transparency)
    const opts = edge ? { width: edge, height: edge, fit: 'inside', withoutEnlargement: true } : resize;
    if (ext === '.png' || ext === '.gif') {
      return pipe.resize(opts).png({ compressionLevel: 9 }).toBuffer();
    }
    if (ext === '.webp') return pipe.resize(opts).webp({ quality }).toBuffer();
    return pipe.resize(opts).jpeg({ quality, mozjpeg: true }).toBuffer();
  };

  const out = await encode(pipeline(buf), 0, cfg.images.quality);
  fs.mkdirSync(path.dirname(destFull), { recursive: true });
  fs.writeFileSync(destFull, out);

  // tiny placeholder (inline base64 JPEG) so a frame shows a soft preview
  // while the real image decodes - no extra requests
  let thumb = '';
  try {
    const t = await s(buf, { failOn: 'none', animated: false }).rotate()
      .resize({ width: cfg.images.thumbEdge, height: cfg.images.thumbEdge, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: cfg.images.thumbQuality }).toBuffer();
    thumb = 'data:image/jpeg;base64,' + t.toString('base64');
  } catch (err) { /* placeholder is optional */ }

  return { before: buf.length, after: out.length, thumb };
}

/** Social preview image: a 1200x630 cover crop of one photo. */
async function writeOgImage(file, srcFull, outFile, cfg) {
  const buf = fs.readFileSync(srcFull);
  await pipeline(buf)
    .resize({ width: cfg.images.ogWidth, height: cfg.images.ogHeight, fit: 'cover', position: 'centre' })
    .jpeg({ quality: cfg.images.ogQuality, mozjpeg: true })
    .toFile(outFile);
  return fs.statSync(outFile).size;
}

/* The inline favicon in the page assets uses these two colours; the touch icon
   mirrors it. Change both together if the mark ever changes. */
const ICON = { bg: '#26231e', dot: '#e23c30' };

/** 180x180 apple-touch icon, matching the inline favicon. */
async function writeTouchIcon(outFile) {
  const s = requireSharp();
  const size = 180;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">'
    + '<rect width="180" height="180" rx="40" fill="' + ICON.bg + '"/>'
    + '<circle cx="90" cy="90" r="28" fill="' + ICON.dot + '"/></svg>';
  await s(Buffer.from(svg)).png().toFile(outFile);
  return fs.statSync(outFile).size;
}

/**
 * List image files in photosDir and describe each one.
 * Returns { photos, skipped: [{ file, reason }] }.
 */
function scanPhotos(photosDir, cfg, captionsFile) {
  const photos = [];
  const skipped = [];
  let entries = [];
  try {
    entries = fs.readdirSync(photosDir);
  } catch (err) {
    throw new Error('cannot read photos dir ' + photosDir + ': ' + err.message);
  }
  const sidecar = captionsFile ? path.basename(captionsFile) : null;

  for (const f of entries.sort(naturalSort)) {
    if (sidecar && f === sidecar) continue;
    const ext = path.extname(f).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      skipped.push({ file: f, reason: ext ? 'unsupported extension ' + ext : 'not an image' });
      continue;
    }
    if (SKIP_PREFIXES.some((p) => f.startsWith(p))) {
      skipped.push({ file: f, reason: 'name starts with "' + f[0] + '"' });
      continue;
    }
    const full = path.join(photosDir, f);
    let stat;
    try { stat = fs.statSync(full); } catch (err) { skipped.push({ file: f, reason: 'unreadable' }); continue; }
    if (!stat.isFile()) { skipped.push({ file: f, reason: 'not a file' }); continue; }
    let buf;
    try { buf = fs.readFileSync(full); } catch (err) { skipped.push({ file: f, reason: 'unreadable' }); continue; }
    const size = detectImageSize(buf, f);
    if (!size) { skipped.push({ file: f, reason: 'image header unreadable (truncated or corrupt file?)' }); continue; }
    const exif = readExif(buf, f);
    const cap = formatCaption(exif);
    photos.push({
      file: f,
      w: size.w,
      h: size.h,
      base: path.basename(f, ext).replace(/-x$/i, ''),
      camera: cap.camera,
      specs: cap.specs,
      year: cap.year,
      bytes: stat.size,
      mtime: stat.mtimeMs,
    });
  }
  return { photos, skipped };
}

module.exports = {
  IMAGE_EXTS, requireSharp, detectImageSize, readExif, formatCaption,
  scanPhotos, writeCopies, writeOgImage, writeTouchIcon, pipeline, ICON,
};

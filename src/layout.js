'use strict';
/*
 * layout.js - wall geometry.
 *
 * Masonry with portrait pairing: a column slot ("brick") is either one
 * full-width photo, or TWO portrait photos side by side sized to fill the same
 * slot width, so portrait pairs read like a landscape tile and never tower
 * over the column rhythm. Bricks flow into equal-width masonry columns
 * (shortest column first), the columns are re-ordered into an arch silhouette
 * (tallest in the middle) and shifted onto one shared midpoint axis.
 *
 * Determinism contract: for a given photo set and config the output is
 * byte-stable. It is NOT additive-stable - photos are ordered by a hash of
 * their filename (so the wall never shows name or date clusters), pairs form
 * from that order, and the column count is chosen for a roughly square canvas,
 * so adding a photo may re-lay the whole wall.
 */

/** FNV-1a hash of a filename: stable sort key for the scrambled wall order. */
function hashFile(name) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Natural filename order (DSC2 < DSC10). Used for logs and tie-breaks. */
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

const isMarked = (file, suffix) => new RegExp(escapeRe(suffix) + '\\.[^.]+$', 'i').test(file);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Group photos into bricks (independent of column count, so the column search
 * can reuse it).
 *
 * photos: [{ file, w, h, marked }] - intrinsic px, mark already resolved.
 * Returns [{ list: [...] }] with pw/ph filled in on every photo.
 */
function buildBricks(photos, cfg) {
  const { long, mat, gap, heroRate, heroMinAspect } = cfg.layout;
  const suffix = cfg.layout.markSuffix || '-x';
  const pairBudget = long - 2 * mat - gap;

  const sized = photos.map((p) => ({
    ...p,
    hash: p.hash === undefined ? hashFile(p.file) : p.hash,
    marked: p.marked === undefined ? isMarked(p.file, suffix) : p.marked,
    aspect: (p.w && p.h) ? p.w / p.h : 4 / 3,
  }));
  // scrambled order: hash of the filename, filenames as the tie-break
  sized.sort((a, b) => a.hash - b.hash || naturalSort(a.file, b.file));
  sized.forEach((p, i) => { p.idx = i; });

  const fullSize = (p) => {
    p.pw = long;
    p.ph = Math.max(1, Math.round(long / Math.max(p.aspect, 0.01)));
  };

  const marked = sized.filter((p) => p.marked);              // -x: always full width
  const landscapes = sized.filter((p) => !p.marked && p.aspect >= 1);
  const plainPorts = sized.filter((p) => !p.marked && p.aspect < 1);
  // hero lottery: a stable ~heroRate/10 slice of the unmarked portraits goes big
  const isHero = (p) => (p.hash % 10) < heroRate && p.aspect >= heroMinAspect;
  const heroes = plainPorts.filter(isHero);
  const pairable = plainPorts.filter((p) => !isHero(p));

  for (const p of landscapes) fullSize(p);
  for (const p of marked) fullSize(p);
  for (const p of heroes) fullSize(p);

  const pairCount = Math.floor(pairable.length / 2);
  const pairs = [];
  for (let k = 0; k < pairCount; k++) {
    const list = [pairable[2 * k], pairable[2 * k + 1]];
    const a1 = Math.max(list[0].aspect, 0.01);
    const a2 = Math.max(list[1].aspect, 0.01);
    const h = Math.min(pairBudget / (a1 + a2), 1500);
    list[0].pw = Math.max(1, Math.round(h * a1)); list[0].ph = Math.round(h);
    list[1].pw = Math.max(1, Math.round(h * a2)); list[1].ph = Math.round(h);
    pairs.push({ firstIdx: list[0].idx, list: list });
  }
  // an odd leftover portrait stays a single (wider) brick - deliberate: a lone
  // half-width cell would leave a hole in the column rhythm
  const odd = pairable.length % 2 ? pairable[pairable.length - 1] : null;
  if (odd) fullSize(odd);

  const bricks = [];
  for (const p of landscapes) bricks.push({ firstIdx: p.idx, list: [p] });
  for (const p of marked) bricks.push({ firstIdx: p.idx, list: [p] });
  for (const p of heroes) bricks.push({ firstIdx: p.idx, list: [p] });
  for (const pair of pairs) bricks.push(pair);
  if (odd) bricks.push({ firstIdx: odd.idx, list: [odd] });
  bricks.sort((a, b) => a.firstIdx - b.firstIdx);

  return { bricks, photos: sized };
}

/** How many bricks a photo set produces (used to bound the column search). */
function countBricks(photos, cfg) {
  return buildBricks(photos, cfg).bricks.length;
}

/**
 * Lay the wall out in `cols` columns.
 * Returns { photos, bricks, canvasW, canvasH, cols }.
 */
function layout(photos, cfg, cols) {
  const { long, gap, mat, capH, pad } = layoutDims(cfg);
  const iw = long + 2 * mat;                 // brick slot width incl. mats
  const nCols = Math.max(1, cols || cfg.layout.cols || autoCols(photos, cfg));

  const { bricks, photos: sized } = buildBricks(photos, cfg);

  const colH = new Array(nCols).fill(pad);
  for (const brick of bricks) {
    const ih = Math.max(...brick.list.map((p) => p.ph + capH + 2 * mat));
    let c = 0;
    for (let k = 1; k < nCols; k++) if (colH[k] < colH[c]) c = k;
    let x = pad + c * (iw + gap);
    for (const p of brick.list) {
      p.x = x;
      p.y = colH[c];
      p.col = c;
      x += p.pw + 2 * mat + gap;
    }
    colH[c] += ih + gap;
  }

  // salon center: shift every column so its vertical midpoint sits on one
  // shared axis - shorter columns extend equally above and below it
  const colHeight = (c) => Math.max(0, colH[c] - gap - pad);
  const used = [];
  for (let c = 0; c < nCols; c++) if (colH[c] > pad) used.push(c);
  const maxH = used.length ? Math.max(...used.map(colHeight)) : 0;
  const midAxis = pad + maxH / 2;
  for (const p of sized) {
    p.y += Math.round(midAxis - (pad + colHeight(p.col) / 2));
  }

  // arch silhouette: the tallest column lands in the middle, the shortest at
  // the outer edges. Only occupied columns take part, so a wall with fewer
  // photos than columns stays centered instead of drifting to one side.
  const desc = used.map((c) => ({ h: colHeight(c), c })).sort((a, b) => b.h - a.h || a.c - b.c);
  const targets = archTargets(used.length);
  const slot = iw + gap;
  const compact = new Map();                 // old column -> centered position
  for (let j = 0; j < desc.length; j++) compact.set(desc[j].c, j);
  const colCount = Math.max(1, used.length);
  const arrW = colCount * iw + (colCount - 1) * gap;
  const canvasW = pad * 2 + arrW;
  for (const p of sized) {
    const from = p.col;
    const to = compact.get(from) || 0;
    p.col = to;
    // absolute x: centered arrangement, target slot from the arch order
    p.x = pad + targets[to] * slot + (p.x - (pad + from * slot));
  }
  const canvasH = maxH + 2 * pad;
  return { photos: sized, bricks, canvasW, canvasH, cols: colCount };
}

/** Column targets, center-out: [center, center-1, center+1, ...]. */
function archTargets(n) {
  const out = [];
  if (n % 2 === 1) {
    const center = (n - 1) / 2;
    out.push(center);
    for (let d = 1; d <= center; d++) out.push(center - d, center + d);
  } else {
    const left = n / 2 - 1, right = n / 2;
    for (let d = 0; d < n / 2; d++) out.push(left - d, right + d);
  }
  return out;
}

/** caption strip height for the configured number of lines */
function captionHeight(cfg) {
  return cfg.layout.capGap + Math.max(1, cfg.captions.maxLines) * 16 + 2;
}

function layoutDims(cfg) {
  return { ...cfg.layout, capH: captionHeight(cfg) };
}

/** Auto column count: the most square canvas for this photo set. */
function autoCols(photos, cfg) {
  const max = cfg.layout.maxCols;
  const bricks = countBricks(photos, cfg);
  const target = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, bricks))));
  const lo = Math.max(1, Math.min(target - 2, max));
  const hi = Math.max(lo, Math.min(target + 3, max, Math.max(1, bricks)));
  let best = lo, bestScore = Infinity;
  for (let c = lo; c <= hi; c++) {
    const laid = layout(photos, cfg, c);
    const score = Math.abs(Math.log(laid.canvasW / laid.canvasH)); // 1:1 ideal
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

module.exports = { hashFile, naturalSort, layout, autoCols, countBricks, captionHeight, layoutDims, isMarked, archTargets };

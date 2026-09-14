'use strict';
/*
 * config.js - instance configuration: defaults, wall.config.json, env, CLI.
 *
 * Precedence (low to high): DEFAULTS -> config file -> environment -> CLI.
 * Unknown keys are a hard error, so a typo in the config file is caught
 * instead of being silently ignored.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // identity + sharing
  title: 'Photo Wall',
  description: 'A wall of photographs.',
  lang: 'en',
  siteUrl: '',            // absolute site URL, e.g. https://photos.example.com/
  themeColor: '#26231e',
  og: {
    // A ready-made 1200x630 social card, relative to the project root. When the
    // file exists it is copied as-is (that is how this repository ships its own
    // card); when it is missing the build generates one from a photo instead, so
    // a fresh clone still gets a share image.
    source: 'assets/og.jpg',
    photo: '',            // filename used when generating: '' = widest landscape on the wall
  },

  // paths
  photosDir: 'photos',
  outDir: 'dist',

  // analytics: null disables it completely
  analytics: null,        // { script:'', websiteId:'', domains:'', cache:true }

  captions: {
    // The engine draws two caption lines: the exposure line and the camera.
    maxLines: 2,           // 0..2 (the shipped engine has room for two)
    showYear: true,        // prefix the exposure line with the year taken
    showCamera: true,      // second line = camera make/model
    showSpecs: true,       // exposure line (focal / f-number / shutter / ISO)
  },

  layout: {
    cols: 0,               // 0 = auto (pick the column count closest to a square canvas)
    long: 600,             // display width of a full-width brick, world px
    gap: 64,               // one gutter for columns, stacked bricks and pairs
    mat: 20,               // mat border around each photo, world px
    pad: 260,              // empty wall margin around the whole arrangement
    capGap: 22,            // air between the photo and the caption text
    heroRate: 3,           // ~30% of unmarked portraits go full width (hash % 10 < rate)
    heroMinAspect: 0.6,    // never blow up extreme 9:16-ish portraits
    markSuffix: '-x',      // filename suffix that forces a photo to full width
    maxCols: 14,
  },

  images: {
    maxEdge: 2048,         // longest edge of the served full copy
    quality: 82,           // jpeg/webp quality
    thumbEdge: 24,         // inline blurred placeholder edge
    thumbQuality: 55,
    ogWidth: 1200,         // social preview image
    ogHeight: 630,
    ogQuality: 82,
  },

  zoom: {
    // Ceiling the engine clamps to. 4 is what the wall has always shipped with;
    // raising it lets the served copy be upscaled past 1:1.
    max: 4,
  },

  noscript: { limit: 60 }, // photos listed in the no-JS fallback
};

/* env overrides: WALL_<NAME> -> dotted config path. Only these are read, so
   the environment cannot silently inject arbitrary config. */
const ENV_MAP = {
  WALL_TITLE: 'title',
  WALL_DESCRIPTION: 'description',
  WALL_LANG: 'lang',
  WALL_SITE_URL: 'siteUrl',
  WALL_THEME_COLOR: 'themeColor',
  WALL_OG_PHOTO: 'og.photo',
  WALL_OG_SOURCE: 'og.source',
  WALL_PHOTOS_DIR: 'photosDir',
  WALL_OUT_DIR: 'outDir',
  WALL_ANALYTICS_SCRIPT: 'analytics.script',
  WALL_ANALYTICS_ID: 'analytics.websiteId',
  WALL_ANALYTICS_DOMAINS: 'analytics.domains',
  WALL_MAX_EDGE: 'images.maxEdge',
  WALL_QUALITY: 'images.quality',
  WALL_COLS: 'layout.cols',
  WALL_HERO_RATE: 'layout.heroRate',
  WALL_CAPTION_LINES: 'captions.maxLines',
  WALL_SHOW_YEAR: 'captions.showYear',
  WALL_SHOW_CAMERA: 'captions.showCamera',
  WALL_SHOW_SPECS: 'captions.showSpecs',
  WALL_ZOOM_MAX: 'zoom.max',
  WALL_NOSCRIPT_LIMIT: 'noscript.limit',
};

const BOOLEAN_KEYS = new Set([
  'captions.showYear', 'captions.showCamera', 'captions.showSpecs',
]);

/** Load config file + env, validate, and return the merged config. */
function loadConfig(opts = {}) {
  const root = opts.root || process.cwd();
  const env = opts.env || process.env;
  const sources = [];

  const file = opts.configPath
    || (env.WALL_CONFIG ? path.resolve(env.WALL_CONFIG) : null)
    || path.join(root, 'wall.config.json');

  let config = clone(DEFAULTS);
  if (file && fs.existsSync(file)) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error('cannot read config ' + file + ': ' + err.message);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config ' + file + ' must contain a JSON object');
    }
    assertKnownKeys(parsed, DEFAULTS, 'config ' + file);
    config = merge(config, parsed);
    sources.push(file);
  } else if (opts.configPath) {
    throw new Error('config file not found: ' + opts.configPath);
  }

  for (const [name, dotted] of Object.entries(ENV_MAP)) {
    if (env[name] === undefined || env[name] === '') continue;
    let value = env[name];
    if (BOOLEAN_KEYS.has(dotted)) value = /^(1|true|yes|on)$/i.test(value);
    else if (typeof getPath(DEFAULTS, dotted) === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(name + ' must be a number, got "' + env[name] + '"');
      value = n;
    } else if (dotted === 'analytics.websiteId' || dotted === 'analytics.script') {
      // first analytics env value creates the block
      if (!config.analytics) config.analytics = { script: '', websiteId: '', domains: '', cache: true };
    }
    setPath(config, dotted, value);
    sources.push(name);
  }

  if (opts.overrides) {
    assertKnownKeys(opts.overrides, DEFAULTS, 'command line');
    config = merge(config, opts.overrides);
  }

  validate(config, root);
  return { config, configPath: sources[0] || null, sources };
}

function validate(config, root) {
  const num = (v, name, min, max) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(name + ' must be a number');
    if (v < min || v > max) throw new Error(name + ' must be between ' + min + ' and ' + max + ', got ' + v);
  };
  num(config.layout.long, 'layout.long', 40, 4000);
  num(config.layout.gap, 'layout.gap', 0, 1000);
  num(config.layout.mat, 'layout.mat', 0, 200);
  num(config.layout.pad, 'layout.pad', 0, 5000);
  num(config.layout.capGap, 'layout.capGap', 0, 200);
  num(config.layout.heroRate, 'layout.heroRate', 0, 10);
  num(config.layout.cols, 'layout.cols', 0, 40);
  num(config.layout.maxCols, 'layout.maxCols', 1, 40);
  num(config.layout.heroMinAspect, 'layout.heroMinAspect', 0.05, 1);
  num(config.images.maxEdge, 'images.maxEdge', 64, 20000);
  num(config.images.quality, 'images.quality', 1, 100);
  num(config.images.thumbEdge, 'images.thumbEdge', 4, 256);
  num(config.images.thumbQuality, 'images.thumbQuality', 1, 100);
  num(config.zoom.max, 'zoom.max', 0, 20);
  num(config.captions.maxLines, 'captions.maxLines', 0, 2);
  num(config.noscript.limit, 'noscript.limit', 0, 10000);
  for (const key of ['title', 'description', 'lang', 'siteUrl', 'photosDir', 'outDir']) {
    if (typeof config[key] !== 'string') throw new Error(key + ' must be a string');
  }
  for (const key of ['source', 'photo']) {
    if (typeof config.og[key] !== 'string') throw new Error('og.' + key + ' must be a string');
  }
  if (config.analytics) {
    if (typeof config.analytics !== 'object') throw new Error('analytics must be an object or null');
    if (!config.analytics.script || !config.analytics.websiteId) {
      throw new Error('analytics needs both "script" and "websiteId" (or set analytics to null)');
    }
  }
  if (config.layout.cols > 0 && config.layout.cols > config.layout.maxCols) {
    throw new Error('layout.cols cannot exceed layout.maxCols (' + config.layout.maxCols + ')');
  }
  return config;
}

/**
 * Guard rails around the output directory. The build wipes outDir, so a
 * mistyped argument must never be able to delete the photo originals or the
 * project itself.
 *
 * Returns { ok, errors, warnings }.
 */
function checkPaths({ root, photosDir, outDir, force }) {
  const errors = [];
  const warnings = [];
  const photos = path.resolve(photosDir);
  const out = path.resolve(outDir);
  const home = path.resolve(root);

  if (out === photos) {
    errors.push('outDir and photosDir are the same directory (' + out + '): the build would delete the originals');
  } else if (isInside(photos, out)) {
    errors.push('outDir sits inside photosDir (' + out + '): the build would delete part of the originals');
  } else if (isInside(out, photos)) {
    errors.push('outDir contains photosDir (' + out + ' contains ' + photos + '): the build would delete the originals');
  }
  if (isInside(out, home)) {
    errors.push('outDir is the project root or above it (' + out + '): the build would delete the project');
  }
  if (out === path.parse(out).root) errors.push('outDir is a filesystem root (' + out + ')');

  if (!errors.length && fs.existsSync(out)) {
    let entries = [];
    try { entries = fs.readdirSync(out); } catch (err) { entries = []; }
    const looksBuilt = entries.includes('index.html');
    if (entries.length && !looksBuilt && !force) {
      errors.push('outDir ' + out + ' is not empty and does not look like a previous build '
        + '(no index.html): ' + entries.slice(0, 6).join(', ')
        + (entries.length > 6 ? ', ...' : '') + ' - pass --force to wipe it anyway');
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** true when `child` is `parent` itself or sits inside it. */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/* ---------------------------- helpers ---------------------------- */

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = clone(v);
    return out;
  }
  return value;
}

function merge(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = merge(out[k], v);
    } else {
      out[k] = clone(v);
    }
  }
  return out;
}

function assertKnownKeys(obj, defaults, where) {
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in defaults)) {
      throw new Error('unknown key "' + k + '" in ' + where + ' - known keys: '
        + Object.keys(defaults).join(', '));
    }
    const d = defaults[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && d && typeof d === 'object' && !Array.isArray(d)) {
      assertKnownKeys(v, d, where + ' -> ' + k);
    }
  }
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  const last = parts.pop();
  let cur = obj;
  for (const p of parts) {
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[last] = value;
}


module.exports = { DEFAULTS, ENV_MAP, loadConfig, checkPaths, isInside };

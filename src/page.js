'use strict';
/*
 * page.js - the published page.
 *
 * The wall's markup, CSS and engine are the ones that were verified on a phone:
 * src/assets/{head.html,body.html,page.css,engine.js} are taken verbatim from the
 * commit that fixed the iOS zoom-crash, with tokens for the values the build
 * owns. This module substitutes those tokens and adds the instance metadata
 * (title, description, analytics, social tags) and the no-JavaScript photo grid.
 * It does not change how the engine draws or animates anything.
 *
 * test/page.test.js asserts the emitted <style> and <script> blocks are
 * byte-identical to the assets once the tokens are put back, so a later edit
 * that quietly changes the rendering path fails the suite.
 */

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, 'assets');
const cache = new Map();

function asset(name) {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(ASSETS, name), 'utf8'));
  return cache.get(name);
}

/** Escape a string for an HTML text or attribute context. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Escape JSON for an inline <script> block (</script> and JS line breaks). */
function escJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * buildPage(model, cfg) -> the complete HTML document.
 *
 * model.photos are wall rows in the engine's own shape:
 *   { x, y, pw, ph, file, w, h, base, title, spec, cam, thumb }
 */
function buildPage(model, cfg) {
  const photos = model.photos;
  const empty = photos.length === 0;
  const site = cfg.siteUrl ? cfg.siteUrl.replace(/\/?$/, '/') : '';
  const count = photos.length + (photos.length === 1 ? ' photo' : ' photos');

  const extraHead = (site ? [
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="' + esc(cfg.title) + '">',
    '<meta property="og:description" content="' + esc(cfg.description) + '">',
    '<meta property="og:url" content="' + esc(site) + '">',
    '<meta property="og:image" content="' + esc(site) + 'og.jpg">',
    '<meta property="og:image:width" content="' + cfg.images.ogWidth + '">',
    '<meta property="og:image:height" content="' + cfg.images.ogHeight + '">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:image" content="' + esc(site) + 'og.jpg">',
    '<link rel="canonical" href="' + esc(site) + '">',
  ] : []).concat([
    '<meta name="theme-color" content="' + esc(cfg.themeColor) + '">',
    '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  ]).join('\n');

  const analytics = cfg.analytics ? [
    '<script defer src="' + esc(cfg.analytics.script) + '" data-website-id="' + esc(cfg.analytics.websiteId) + '" data-cache="true"',
    '        data-domains="' + esc(cfg.analytics.domains) + '"></script>',
  ].join('\n') : '';

  const head = asset('head.html')
    .replace(/\{\{lang\}\}/g, esc(cfg.lang))
    .replace(/\{\{description\}\}/g, esc(cfg.description))
    .replace(/\{\{title\}\}/g, esc(cfg.title))
    .replace('{{analytics}}', analytics)
    .replace('{{extraHead}}', extraHead);

  const css = asset('page.css')
    .replace(/\{\{canvasW\}\}/g, String(model.canvasW))
    .replace(/\{\{canvasH\}\}/g, String(model.canvasH));

  const body = asset('body.html')
    .replace(/\{\{title\}\}/g, esc(cfg.title))
    .replace(/\{\{count\}\}/g, esc(count));

  const script = asset('engine.js')
    .replace('{{POS}}', escJson(photos))
    .replace(/\{\{MAX_SCALE\}\}/g, String(model.maxScale))
    .replace(/\{\{MAT\}\}/g, String(cfg.layout.mat))
    .replace(/\{\{CAP_H\}\}/g, String(model.capH));

  const extras = [];
  if (empty) {
    extras.push('<div class="empty-note"><p>The wall is empty.<br>Drop image files ('
      + 'jpg, jpeg, png, webp, gif) into the <code>' + esc(cfg.photosDir)
      + '/</code> folder and run <code>node gen.js</code>.</p></div>');
  }

  // no-JS fallback: crawlers and visitors without JavaScript get a plain list
  const nojsLimit = Math.min(cfg.noscript.limit, photos.length);
  if (nojsLimit > 0) {
    const figures = photos.slice(0, nojsLimit).map((p) => '    <figure>\n'
      + '      <img src="photos/' + esc(encodeURIComponent(p.file)) + '" alt="' + esc(p.alt || p.base) + '" loading="lazy">\n'
      + '      <figcaption>' + esc([p.spec, p.cam].filter(Boolean).join(' - ')) + '</figcaption>\n'
      + '    </figure>').join('\n');
    extras.push('<noscript>\n  <div class="nojs">\n    <h1>' + esc(cfg.title) + '</h1>\n'
      + '    <p>JavaScript is off, so here '
      + esc(nojsLimit === photos.length
        ? (nojsLimit === 1 ? 'is the photo' : 'are all ' + nojsLimit + ' photos')
        : 'are the first ' + nojsLimit + ' of ' + photos.length + ' photos')
      + ' on a plain page. The interactive wall needs JavaScript.</p>\n'
      + '    <div class="nojs-grid">\n' + figures + '\n    </div>\n  </div>\n</noscript>');
  }

  const engine = empty
    ? '/* empty wall - nothing to render */'
    : '"use strict";\n' + script;

  return head
    + '<style>' + css + '</style>' + body + extras.join('') + '\n'
    + '<script>\n' + engine + '\n</script>\n</body>\n</html>\n';
}

module.exports = { buildPage, esc, escJson, ASSETS };

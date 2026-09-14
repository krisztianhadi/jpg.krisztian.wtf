
/* Photo wall viewport engine: pan by drag, zoom by wheel/pinch/buttons.
   The layout is baked into POS below, so the browser never has to wait
   for image dimensions - every frame is placed instantly. */

var POS = {{POS}};
var MAX_SCALE = {{MAX_SCALE}};
// vertical world window shown on load, independent of wall size

var stage = document.getElementById('stage');
var world = document.getElementById('world');
var wall = document.getElementById('wall');
var hint = document.getElementById('hint');
var zoomLbl = document.getElementById('zoomLbl');

var MAT = {{MAT}};
var CAP_H = {{CAP_H}};
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
  img.width = d.pw;              // sane, layout-accurate numbers
  img.height = d.ph;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.draggable = false;

  // photo box: exact image rectangle; clips the blurred placeholder so the
  // blur never bleeds past the photo onto the mat
  var pbox = document.createElement('div');
  pbox.className = 'pbox';
  pbox.style.width = d.pw + 'px';
  pbox.style.height = d.ph + 'px';
  if (d.thumb) {
    var pbg = document.createElement('div');
    pbg.className = 'pbg';
    pbg.style.backgroundImage = 'url("' + d.thumb + '")';
    pbox.appendChild(pbg);
  }
  pbox.appendChild(img);
  frame.appendChild(pbox);

  var cap = document.createElement('div');
  cap.className = 'cap';
  var lines = [d.spec, d.cam]; // filename line hidden for now
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

var wallW = 6792, wallH = 7088;

// mark a photo box as loaded the moment its image decodes (capturing phase
// catches every load, even ones that slip past per-element listeners)
document.addEventListener('load', function (e) {
  var t = e.target;
  if (t && t.tagName === 'IMG' && t.closest && t.closest('.pbox')) {
    t.closest('.pbox').classList.add('loaded');
  }
}, true);

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
      else if (!off) {
        if (it.el.classList.contains('off')) it.el.classList.remove('off');
        var pbi = it.el.querySelector('.pbox');
        if (pbi && !pbi.classList.contains('loaded')) {
          var imi = it.el.querySelector('img');
          if (imi.complete && imi.naturalWidth > 0) pbi.classList.add('loaded');
        }
      }
    }
  });
}

/* ---------- drag to pan (pointer events, also pinch) ---------- */
var pointers = {}; // pointerId -> {x,y}
var dragStart = null;   // {sx,sy,tx,ty}
var pinch = null;      // {lastDist, midX, midY} - incremental pinch state
var moved = false;

stage.addEventListener('pointerdown', function (e) {
  cancelGlide();                       // grabbing stops any inertia
  lastMoveT = 0;
  world.style.transition = ''; // key-move glide must not fight a drag
  try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic/test events */ }
  pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  var ids = Object.keys(pointers);
  if (ids.length === 2) {
    dragStart = null;
    pinch = null; // first two-finger move (re)initializes the pinch state
  } else {
    dragStart = { sx: e.clientX, sy: e.clientY, tx: tx, ty: ty };
    pinch = null;
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
    var a = pointers[ids[0]], b = pointers[ids[1]];
    var dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist < 8) return;
    var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (!pinch) {
      pinch = { lastDist: dist, midX: cx, midY: cy };
    }
    // follow the fingers: first translate by the midpoint delta, then zoom
    // anchored at the midpoint - no stale-anchor drift
    tx += cx - pinch.midX;
    ty += cy - pinch.midY;
    var ns = scale * (dist / pinch.lastDist);
    if (ns > MAX_SCALE) ns = MAX_SCALE;
    if (ns < minScale()) ns = minScale();
    var wx = (cx - tx) / scale, wy = (cy - ty) / scale;
    scale = ns;
    tx = cx - wx * scale;
    ty = cy - wy * scale;
    pinch.lastDist = dist; pinch.midX = cx; pinch.midY = cy;
    clamp(); setTransform(); scheduleCull();
    return;
  }
  if (ids.length === 1) {
    if (!dragStart) dragStart = { sx: e.clientX, sy: e.clientY, tx: tx, ty: ty };
    stage.classList.add('dragging');
    tx = dragStart.tx + (e.clientX - dragStart.sx);
    ty = dragStart.ty + (e.clientY - dragStart.sy);
    // velocity estimate (px/ms, exponential smoothing) for the glide
    var now = performance.now();
    if (lastMoveT) {
      var dtm = Math.max(8, now - lastMoveT);
      var ivx = (e.clientX - prevMoveX) / dtm;
      var ivy = (e.clientY - prevMoveY) / dtm;
      velX = velX * 0.65 + ivx * 0.35;
      velY = velY * 0.65 + ivy * 0.35;
    }
    prevMoveX = e.clientX; prevMoveY = e.clientY; lastMoveT = now;
    clamp(); setTransform(); scheduleCull();
  }
});

function endPointer(e) {
  delete pointers[e.pointerId];
  var n = Object.keys(pointers).length;
  if (n < 2) pinch = null;      // pinch needs exactly two fingers
  if (n === 0) {
    dragStart = null;
    stage.classList.remove('dragging');
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

/* ---------- inertia: iOS-like glide after a flick ---------- */
var glideRaf = 0, velX = 0, velY = 0, lastMoveT = 0, prevMoveX = 0, prevMoveY = 0;

function cancelGlide() {
  if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = 0; }
  velX = velY = 0; lastMoveT = 0;
}

function startGlide() {
  if (glideRaf) { cancelAnimationFrame(glideRaf); glideRaf = 0; }
  if (Math.abs(velX) < 0.03 && Math.abs(velY) < 0.03) return; // not a flick
  var last = performance.now();
  function step(now) {
    var dt = Math.min(32, now - last);
    last = now;
    var damp = Math.pow(0.93, dt / 16);  // exponential friction
    velX *= damp; velY *= damp;
    var bx = tx, by = ty;
    tx += velX * dt;
    ty += velY * dt;
    clamp();
    if (Math.abs(tx - bx) < 0.05) velX = 0; // hit the wall edge on x
    if (Math.abs(ty - by) < 0.05) velY = 0; // ...or on y
    setTransform();
    scheduleCull();
    if (Math.abs(velX) < 0.02 && Math.abs(velY) < 0.02) { glideRaf = 0; return; }
    glideRaf = requestAnimationFrame(step);
  }
  glideRaf = requestAnimationFrame(step);
}

/* ---------- double-tap / double-click zooms in ---------- */
var lastTap = 0, tapX = 0, tapY = 0;
stage.addEventListener('pointerup', function (e) {
  if (moved) { startGlide(); moved = false; return; }
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
  cancelGlide();
  e.preventDefault();
  var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0016));
  zoomAt(e.clientX, e.clientY, f);
  scheduleCull();
}, { passive: false });

/* ---------- native gesture suppression (iOS) ---------- */
// the wall owns all touches: stop Safari's pinch-zoom, double-tap zoom and
// rubber-band scrolling from fighting our pointer-event pan/zoom
document.addEventListener('touchmove', function (e) {
  if (e.target === stage || stage.contains(e.target)) e.preventDefault();
}, { passive: false });
['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
  document.addEventListener(name, function (e) {
    if (e.target === stage || stage.contains(e.target)) e.preventDefault();
  });
});

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

// resizing (rotation, mobile toolbars) must not reset the user's zoom -
// just keep the view inside the wall bounds
window.addEventListener('resize', function () { clamp(); setTransform(); scheduleCull(); });

/* ---------- go ---------- */
// open centered on the middle of the wall: 75% on desktop, 35% on
// touch/phone viewports where the wall is huge relative to the screen
var openScale = (matchMedia('(pointer: coarse)').matches || stage.clientWidth < 768) ? 0.35 : 0.75;
scale = openScale;
tx = Math.round((stage.clientWidth - wallW * scale) / 2);
ty = Math.round((stage.clientHeight - wallH * scale) / 2);
clamp(); setTransform(); scheduleCull();
if (hint) setTimeout(function () { hint.classList.add('gone'); }, 7000);
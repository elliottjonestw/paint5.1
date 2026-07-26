// The Paint app icon: a tilted tumbler holding brushes and a pencil, drawn in
// the soft-shaded Luna style Windows XP used.
//
// This is an original drawing that follows the composition and palette language
// of the XP Paint icon rather than a copy of Microsoft's artwork.
//
// Geometry is authored in a 1024x1024 design space and rendered natively at
// each output size, so small icons are genuinely re-rasterised rather than
// downscaled. Line weights are expressed with `du()` so they stop shrinking
// once they approach a single device pixel, which is what keeps the 16px
// favicon legible.

import { Canvas, fill, fillBlurred, ellipse, ccw, stroke, solid, linear } from './raster.mjs';

const DESIGN = 1024;

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const shade = (c, t) => mix(c, [24, 28, 48], t);
const tint = (c, t) => mix(c, [255, 255, 255], t);

/** Cross-barrel stops that read as a lit cylinder. */
const cylinder = (c) => [
  [0.0, shade(c, 0.5)],
  [0.16, c],
  [0.36, tint(c, 0.62)],
  [0.52, tint(c, 0.22)],
  [0.78, c],
  [1.0, shade(c, 0.42)],
];

// A final zoom about the composition's centre, so the drawing fills the square
// instead of floating in it. Tuned to leave a hair of margin for the shadow.
const VIEW = { scale: 1.07, cx: 512, cy: 516 };

class Pen {
  constructor(size) {
    this.cv = new Canvas(size);
    this.k = size / DESIGN;
  }
  /** Design units, but never thinner than `minPx` on the actual output. */
  du(units, minPx) {
    return Math.max(units, minPx / this.k);
  }
  #tx(x, y) {
    return [
      (VIEW.cx + (x - VIEW.cx) * VIEW.scale) * this.k,
      (VIEW.cy + (y - VIEW.cy) * VIEW.scale) * this.k,
    ];
  }
  #pts(sp) {
    return sp.map(p => p.map(([x, y]) => this.#tx(x, y)));
  }
  #paint(p) {
    if (p.kind !== 'linear') return p;
    return linear(this.#tx(...p.p0), this.#tx(...p.p1), p.stops);
  }
  fill(subpaths, paint, alpha = 1) {
    fill(this.cv, this.#pts(subpaths), this.#paint(paint), alpha);
  }
  shadow(subpaths, rgb, alpha, radius) {
    fillBlurred(this.cv, this.#pts(subpaths), rgb, alpha, radius * this.k);
  }
}

// ------------------------------------------------------------------- helpers

/** Implements run from deep in the glass (t=0) out to their tip (t=1). */
const ROD_BOTTOM = 890;

/**
 * Build a rod from its tip and a point it passes through, extending the butt
 * end down to the bottom of the glass so no flat cut-off is ever visible.
 */
function rod(tip, through) {
  const dx = through[0] - tip[0];
  const dy = through[1] - tip[1];
  const s = (ROD_BOTTOM - tip[1]) / dy;
  const base = [tip[0] + dx * s, ROD_BOTTOM];
  const vx = tip[0] - base[0];
  const vy = tip[1] - base[1];
  const len = Math.hypot(vx, vy);
  const px = -vy / len;
  const py = vx / len;
  return {
    len,
    at: (t, off = 0) => [base[0] + vx * t + px * off, base[1] + vy * t + py * off],
    /** t of a point `d` design units back from the tip. */
    fromTip(d) {
      return 1 - d / len;
    },
    /** Gradient axis across the barrel at `t`, for cylindrical shading. */
    axis(t, w) {
      return [this.at(t, -w), this.at(t, w)];
    },
  };
}

// A profile is [[t, half-width multiplier], ...] in ascending t. Parts are cut
// out of the same profile the outline uses, so edges always line up exactly.

function widthAt(prof, t) {
  if (t <= prof[0][0]) return prof[0][1];
  const last = prof[prof.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < prof.length; i++) {
    if (t > prof[i][0]) continue;
    const [t0, f0] = prof[i - 1];
    const [t1, f1] = prof[i];
    return f0 + ((f1 - f0) * (t - t0)) / (t1 - t0 || 1);
  }
  return last[1];
}

function subProfile(prof, t0, t1) {
  const out = [[t0, widthAt(prof, t0)]];
  for (const [t, f] of prof) if (t > t0 && t < t1) out.push([t, f]);
  out.push([t1, widthAt(prof, t1)]);
  return out;
}

/** Close a (sub)profile into a fillable outline around the rod's axis. */
function shape(g, w, prof) {
  const right = prof.map(([t, f]) => g.at(t, w * f));
  const left = prof.map(([t, f]) => g.at(t, -w * f)).reverse();
  return ccw([...right, ...left]);
}

const GLASS_RIM = { cx: 512, cy: 560, rx: 178, ry: 46 };
const GLASS_BASE = { cx: 512, cy: 900, rx: 133, ry: 35 };

function arc(e, from, to, steps = 48) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push([e.cx + Math.cos(t) * e.rx, e.cy + Math.sin(t) * e.ry]);
  }
  return pts;
}

/** Full glass silhouette: rim ellipse on top, tapered walls, rounded base. */
function glassSilhouette() {
  return ccw([
    ...arc(GLASS_RIM, Math.PI, Math.PI * 2),      // rim, back edge
    ...arc(GLASS_BASE, 0, Math.PI),               // base, front edge
  ]);
}

/**
 * Everything below the rim's front edge — the wall you look through. Shares the
 * silhouette's outer boundary, so it must trace the *front* of the base too.
 */
function glassFrontWall() {
  return ccw([
    ...arc(GLASS_RIM, 0, Math.PI),
    ...arc(GLASS_BASE, Math.PI, 0),
  ]);
}

// --------------------------------------------------------------- the drawing

const PALETTE = {
  blue: [46, 96, 176],
  violet: [104, 116, 206],
  green: [64, 154, 74],
  red: [214, 74, 40],
  yellow: [242, 194, 33],
  wood: [214, 170, 116],
  bristleWarm: [196, 116, 40],
  bristleDark: [74, 82, 112],
  ferrule: [186, 196, 210],
};

/**
 * Brushes and the pencil, back to front. `tip` is the business end and
 * `through` is any point further down the shaft; the butt is extended past it
 * into the glass automatically.
 */
const IMPLEMENTS = [
  { kind: 'brush', tip: [212, 190], through: [452, 700], w: 27, bristle: 176,
    handle: PALETTE.blue, hair: PALETTE.bristleWarm },
  { kind: 'brush', tip: [806, 214], through: [566, 700], w: 26, bristle: 172,
    handle: PALETTE.violet, hair: PALETTE.bristleDark },
  { kind: 'brush', tip: [370, 320], through: [466, 700], w: 22, bristle: 142,
    handle: PALETTE.green, hair: PALETTE.bristleDark },
  { kind: 'brush', tip: [660, 302], through: [550, 700], w: 23, bristle: 146,
    handle: PALETTE.red, hair: PALETTE.bristleWarm },
  { kind: 'pencil', tip: [500, 146], through: [502, 700], w: 23,
    handle: PALETTE.yellow },
];

const FERRULE_LEN = 56;

function brushProfile(g, bristle) {
  const fb = g.fromTip(bristle);
  const fa = g.fromTip(bristle + FERRULE_LEN);
  return {
    fa,
    fb,
    prof: [
      [0.00, 0.72], [0.12, 0.86], [fa - 0.03, 1.00],
      [fa, 1.07], [fb, 1.07],
      [fb + 0.006, 1.26], [fb + 0.05, 1.28],
      [0.94, 1.14], [0.985, 0.90], [1.00, 0.46],
    ],
  };
}

function pencilProfile(g) {
  const cone = g.fromTip(98);
  const lead = g.fromTip(30);
  return {
    cone,
    lead,
    prof: [[0.00, 0.84], [0.07, 1.00], [cone, 1.00], [lead, 0.30], [1.00, 0.05]],
  };
}

function drawBrush(pen, item, edge) {
  const g = rod(item.tip, item.through);
  const w = item.w;
  const { fa, fb, prof } = brushProfile(g, item.bristle);

  pen.fill(stroke(shape(g, w, prof), edge, true), solid([40, 48, 74]), 0.5);

  pen.fill([shape(g, w, subProfile(prof, 0, fa))],
    linear(...g.axis(fa * 0.5, w), cylinder(item.handle)));

  pen.fill([shape(g, w, subProfile(prof, fa, fb))],
    linear(...g.axis((fa + fb) / 2, w * 1.07), cylinder(PALETTE.ferrule)));
  // Crimp line across the ferrule.
  pen.fill([shape(g, w, subProfile(prof, fa + 0.008, fa + 0.022))],
    solid(shade(PALETTE.ferrule, 0.5)), 0.65);

  pen.fill([shape(g, w, subProfile(prof, fb, 1))],
    linear(...g.axis((fb + 1) / 2, w * 1.28), cylinder(item.hair)));

  // Hairlines so the head reads as fibres rather than a solid slab.
  const hair = pen.du(3.5, 0.8);
  for (const off of [-0.5, 0.16]) {
    pen.fill(stroke([g.at(fb + 0.03, w * off * 1.2), g.at(0.95, w * off * 0.9)], hair),
      solid(shade(item.hair, 0.5)), 0.45);
  }
}

function drawPencil(pen, item, edge) {
  const g = rod(item.tip, item.through);
  const w = item.w;
  const { cone, lead, prof } = pencilProfile(g);

  pen.fill(stroke(shape(g, w, prof), edge, true), solid([40, 48, 74]), 0.5);

  pen.fill([shape(g, w, subProfile(prof, 0, cone))],
    linear(...g.axis(cone * 0.5, w), cylinder(item.handle)));

  // Facet lines hint at the classic hexagonal barrel.
  const facet = pen.du(4, 0.8);
  for (const off of [-0.52, 0.44]) {
    pen.fill(stroke([g.at(0.03, w * off), g.at(cone - 0.01, w * off)], facet),
      solid(shade(item.handle, 0.42)), 0.4);
  }
  // Painted ring where the barrel meets the sharpening.
  pen.fill([shape(g, w, subProfile(prof, cone - 0.018, cone))],
    solid(shade(item.handle, 0.5)), 0.5);

  pen.fill([shape(g, w, subProfile(prof, cone, lead))],
    linear(...g.axis((cone + lead) / 2, w), cylinder(PALETTE.wood)));
  pen.fill([shape(g, w, subProfile(prof, lead, 1))],
    linear(...g.axis((lead + 1) / 2, w * 0.3), cylinder([84, 88, 100])));
}

export function drawIcon(size) {
  const pen = new Pen(size);

  // Contact shadow, wider and softer than the base so the glass sits on ground.
  pen.shadow([ccw(ellipse(512, 906, 190, 44))], [40, 52, 78], 0.34, 22);

  // Back wall / contents area, behind the brushes.
  pen.fill([glassSilhouette()],
    linear([334, 0], [690, 0], [
      [0.0, [206, 224, 238]],
      [0.25, [238, 247, 252]],
      [0.6, [214, 231, 243]],
      [1.0, [186, 208, 226]],
    ]), 0.62);

  const edge = pen.du(5, 0.7);
  for (const item of IMPLEMENTS) {
    if (item.kind === 'pencil') drawPencil(pen, item, edge);
    else drawBrush(pen, item, edge);
  }

  // Front wall tints whatever sits inside the glass.
  pen.fill([glassFrontWall()],
    linear([334, 0], [690, 0], [
      [0.0, [198, 220, 238]],
      [0.3, [236, 246, 252]],
      [0.72, [206, 226, 241]],
      [1.0, [176, 200, 222]],
    ]), 0.5);

  // A real tumbler is thickest at the base, which conveniently also swallows
  // the point where the shafts bottom out.
  pen.fill([glassFrontWall()],
    linear([0, 636], [0, 918], [
      [0.0, [238, 246, 252, 0]],
      [0.42, [234, 244, 251, 0.34]],
      [0.74, [242, 249, 253, 0.86]],
      [0.88, [238, 247, 252, 0.99]],
      [1.0, [212, 229, 243, 1]],
    ]));
  pen.fill([ccw(ellipse(512, 870, 116, 27))],
    linear([0, 843], [0, 897], [
      [0.0, [255, 255, 255, 0.6]],
      [1.0, [200, 220, 238, 0.25]],
    ]));

  // Glass edges: outline, bright rim, and two highlight streaks.
  pen.fill(stroke(glassSilhouette(), pen.du(6, 0.85), true), solid([96, 126, 156]), 0.55);
  pen.fill(stroke(ellipse(GLASS_RIM.cx, GLASS_RIM.cy, GLASS_RIM.rx, GLASS_RIM.ry),
    pen.du(7, 0.9), true), solid([250, 253, 255]), 0.72);
  pen.fill(stroke(arc(GLASS_RIM, Math.PI * 1.08, Math.PI * 1.62), pen.du(9, 1), false),
    solid([255, 255, 255]), 0.85);

  pen.fill(stroke([[374, 640], [398, 848]], pen.du(16, 1.2)), solid([255, 255, 255]), 0.5);
  pen.fill(stroke([[646, 646], [628, 800]], pen.du(9, 1)), solid([255, 255, 255]), 0.32);

  return pen.cv;
}

/** Padded, opaque variant for Android maskable icons (mask crops ~20% inset). */
export function drawMaskable(size) {
  const inner = drawIcon(Math.round(size * 0.62));
  const pen = new Pen(size);
  pen.fill([ccw([[0, 0], [DESIGN, 0], [DESIGN, DESIGN], [0, DESIGN]])],
    linear([0, 0], [0, DESIGN], [[0, [252, 253, 255]], [1, [226, 236, 246]]]));

  const off = Math.round((size - inner.w) / 2);
  for (let y = 0; y < inner.h; y++) {
    for (let x = 0; x < inner.w; x++) {
      const s = (y * inner.w + x) * 4;
      const d = ((y + off) * pen.cv.w + (x + off)) * 4;
      const a = inner.data[s + 3];
      const inv = 1 - a;
      for (let c = 0; c < 4; c++) {
        pen.cv.data[d + c] = inner.data[s + c] + pen.cv.data[d + c] * inv;
      }
    }
  }
  return pen.cv;
}

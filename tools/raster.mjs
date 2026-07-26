// A tiny dependency-free 2D rasteriser, just big enough to draw the app icon.
//
// Everything is anti-aliased by computing exact per-pixel coverage: each pixel
// row is sampled on SUBSAMPLES horizontal scanlines, and along each scanline the
// span endpoints contribute fractional coverage. That is accurate enough that
// icons can be rendered natively at every target size instead of being
// downscaled from one master bitmap, which keeps 16px edges crisp.

const SUBSAMPLES = 5;

/** RGBA canvas holding premultiplied floats in 0..1, so "over" is a lerp. */
export class Canvas {
  constructor(size) {
    this.w = size;
    this.h = size;
    this.data = new Float32Array(size * size * 4);
  }

  /** Straight-alpha 8-bit RGBA, the layout PNG wants. */
  toRGBA8() {
    const out = Buffer.alloc(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      const a = this.data[i * 4 + 3];
      for (let c = 0; c < 3; c++) {
        const v = a > 0 ? this.data[i * 4 + c] / a : 0;
        out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      out[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
    return out;
  }
}

// ---------------------------------------------------------------- paint types

// Colours are [r, g, b] or [r, g, b, a] with r/g/b in 0..255 and a in 0..1.
const rgba = (c) => [c[0], c[1], c[2], c[3] ?? 1];

export const solid = (c) => ({ kind: 'solid', rgb: rgba(c) });

/** Linear gradient between two points; stops are [offset, colour]. */
export const linear = (p0, p1, stops) => ({
  kind: 'linear',
  p0,
  p1,
  stops: stops.map(([t, c]) => [t, rgba(c)]),
});

function sampleStops(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    if (t > t1) continue;
    const [t0, c0] = stops[i - 1];
    const f = (t - t0) / (t1 - t0 || 1);
    return [
      c0[0] + (c1[0] - c0[0]) * f,
      c0[1] + (c1[1] - c0[1]) * f,
      c0[2] + (c1[2] - c0[2]) * f,
      c0[3] + (c1[3] - c0[3]) * f,
    ];
  }
  return last[1];
}

// ------------------------------------------------------------------ coverage

/**
 * Accumulate nonzero-winding coverage for a set of closed subpaths.
 * Overlapping subpaths wound the same way union cleanly, which is what lets
 * strokes be expressed as a pile of quads and discs.
 */
function coverage(subpaths, W, H) {
  const edges = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (const sp of subpaths) {
    const n = sp.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = sp[i];
      const [x1, y1] = sp[(i + 1) % n];
      if (x0 < minX) minX = x0;
      if (x0 > maxX) maxX = x0;
      if (y0 < minY) minY = y0;
      if (y0 > maxY) maxY = y0;
      if (y0 !== y1) edges.push([x0, y0, x1, y1]);
    }
  }
  if (!edges.length) return null;

  const y0i = Math.max(0, Math.floor(minY));
  const y1i = Math.min(H - 1, Math.ceil(maxY));
  const x0i = Math.max(0, Math.floor(minX));
  const x1i = Math.min(W - 1, Math.ceil(maxX));
  if (y1i < y0i || x1i < x0i) return null;

  const cw = x1i - x0i + 1;
  const ch = y1i - y0i + 1;
  const cov = new Float32Array(cw * ch);
  const weight = 1 / SUBSAMPLES;
  const xs = [];

  for (let py = y0i; py <= y1i; py++) {
    const row = (py - y0i) * cw;
    for (let s = 0; s < SUBSAMPLES; s++) {
      const sy = py + (s + 0.5) / SUBSAMPLES;
      xs.length = 0;
      for (const [ex0, ey0, ex1, ey1] of edges) {
        const down = ey1 > ey0;
        const top = down ? ey0 : ey1;
        const bot = down ? ey1 : ey0;
        if (sy < top || sy >= bot) continue;
        xs.push([ex0 + ((sy - ey0) * (ex1 - ex0)) / (ey1 - ey0), down ? 1 : -1]);
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);

      let winding = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        winding += xs[i][1];
        if (winding === 0) continue;
        const xa = Math.max(x0i, xs[i][0]);
        const xb = Math.min(x1i + 1, xs[i + 1][0]);
        if (xb <= xa) continue;
        for (let px = Math.floor(xa); px < xb; px++) {
          const part = Math.min(xb, px + 1) - Math.max(xa, px);
          if (part > 0) cov[row + (px - x0i)] += part * weight;
        }
      }
    }
  }
  return { cov, x0: x0i, y0: y0i, cw, ch };
}

// ------------------------------------------------------------------- drawing

export function fill(cv, subpaths, paint, alpha = 1) {
  const c = coverage(subpaths, cv.w, cv.h);
  if (!c) return;
  const { cov, x0, y0, cw, ch } = c;
  const flat = paint.kind === 'solid' ? paint.rgb : null;

  // Gradient lookup is a projection onto the p0->p1 axis.
  let ax = 0, ay = 0, alen2 = 1;
  if (paint.kind === 'linear') {
    ax = paint.p1[0] - paint.p0[0];
    ay = paint.p1[1] - paint.p0[1];
    alen2 = ax * ax + ay * ay || 1;
  }

  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const c = Math.min(1, cov[j * cw + i]);
      if (c <= 0.0002) continue;
      const rgb = flat ?? sampleStops(
        paint.stops,
        ((x0 + i + 0.5 - paint.p0[0]) * ax + (y0 + j + 0.5 - paint.p0[1]) * ay) / alen2,
      );
      const a = c * alpha * rgb[3];
      if (a <= 0.0002) continue;
      const o = ((y0 + j) * cv.w + (x0 + i)) * 4;
      const inv = 1 - a;
      cv.data[o] = (rgb[0] / 255) * a + cv.data[o] * inv;
      cv.data[o + 1] = (rgb[1] / 255) * a + cv.data[o + 1] * inv;
      cv.data[o + 2] = (rgb[2] / 255) * a + cv.data[o + 2] * inv;
      cv.data[o + 3] = a + cv.data[o + 3] * inv;
    }
  }
}

/** Coverage of `subpaths`, blurred, composited as a flat colour: a soft shadow. */
export function fillBlurred(cv, subpaths, rgb, alpha, radius) {
  const c = coverage(subpaths, cv.w, cv.h);
  if (!c) return;
  const pad = Math.ceil(radius * 3) + 2;
  const bw = c.cw + pad * 2;
  const bh = c.ch + pad * 2;
  let buf = new Float32Array(bw * bh);
  for (let j = 0; j < c.ch; j++) {
    for (let i = 0; i < c.cw; i++) {
      buf[(j + pad) * bw + i + pad] = Math.min(1, c.cov[j * c.cw + i]);
    }
  }
  // Three box passes approximate a Gaussian closely enough for a shadow.
  for (let pass = 0; pass < 3; pass++) {
    buf = boxBlur(buf, bw, bh, radius, true);
    buf = boxBlur(buf, bw, bh, radius, false);
  }
  for (let j = 0; j < bh; j++) {
    const py = c.y0 - pad + j;
    if (py < 0 || py >= cv.h) continue;
    for (let i = 0; i < bw; i++) {
      const px = c.x0 - pad + i;
      if (px < 0 || px >= cv.w) continue;
      const a = buf[j * bw + i] * alpha;
      if (a <= 0.0002) continue;
      const o = (py * cv.w + px) * 4;
      const inv = 1 - a;
      cv.data[o] = (rgb[0] / 255) * a + cv.data[o] * inv;
      cv.data[o + 1] = (rgb[1] / 255) * a + cv.data[o + 1] * inv;
      cv.data[o + 2] = (rgb[2] / 255) * a + cv.data[o + 2] * inv;
      cv.data[o + 3] = a + cv.data[o + 3] * inv;
    }
  }
}

function boxBlur(src, w, h, radius, horizontal) {
  const r = Math.max(1, Math.round(radius));
  const out = new Float32Array(w * h);
  const n = 2 * r + 1;
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const at = horizontal ? (o, i) => o * w + i : (o, i) => i * w + o;
  for (let o = 0; o < outer; o++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[at(o, Math.max(0, Math.min(inner - 1, i)))];
    for (let i = 0; i < inner; i++) {
      out[at(o, i)] = sum / n;
      sum -= src[at(o, Math.max(0, Math.min(inner - 1, i - r)))];
      sum += src[at(o, Math.max(0, Math.min(inner - 1, i + r + 1)))];
    }
  }
  return out;
}

// -------------------------------------------------------------------- shapes

export function ellipse(cx, cy, rx, ry, steps = 96) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return pts;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Nonzero winding unions only agree if every subpath turns the same way. */
export function ccw(pts) {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

/**
 * Outline a polyline as fillable geometry: one quad per segment plus a disc at
 * every joint. Cheaper and more robust than computing real miters, and at icon
 * sizes visually identical.
 */
export function stroke(points, width, closed = false) {
  const hw = width / 2;
  const out = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % n];
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const px = (-dy / len) * hw, py = (dx / len) * hw;
    out.push(ccw([
      [x0 + px, y0 + py], [x1 + px, y1 + py],
      [x1 - px, y1 - py], [x0 - px, y0 - py],
    ]));
  }
  const joints = closed ? n : n - 1;
  for (let i = closed ? 0 : 1; i <= joints; i++) {
    const [x, y] = points[i % n];
    out.push(ccw(ellipse(x, y, hw, hw, 20)));
  }
  return out;
}

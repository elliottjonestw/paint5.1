// Hand-rolled rasterizers. Everything writes hard, fully opaque pixels into a
// PixelBuffer's typed array. No canvas path API is ever used for content.

import { PixelBuffer } from './pixelbuffer';
import { luminance } from './color';

export type Plot = (x: number, y: number) => void;

/* ---------------- Bresenham line ---------------- */

export function bresenham(x0: number, y0: number, x1: number, y1: number, plot: Plot): void {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function line(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: number): void {
  bresenham(x0, y0, x1, y1, (x, y) => buf.setPixel(x, y, c));
}

/* ---------------- Pen stamps ---------------- */

/** Filled disc of diameter d centered at (cx,cy) — this is GDI's round pen tip. */
export function stampDisc(buf: PixelBuffer, cx: number, cy: number, d: number, c: number): void {
  if (d <= 1) { buf.setPixel(cx, cy, c); return; }
  const r = d / 2;
  const lo = Math.floor(-r), hi = Math.ceil(r);
  for (let y = lo; y <= hi; y++) {
    for (let x = lo; x <= hi; x++) {
      if ((x + 0.5) * (x + 0.5) + (y + 0.5) * (y + 0.5) <= r * r) {
        buf.setPixel(cx + x, cy + y, c);
      }
    }
  }
}

export function stampSquare(buf: PixelBuffer, cx: number, cy: number, d: number, c: number): void {
  const o = Math.floor(d / 2);
  buf.fillRect(cx - o, cy - o, d, d, c);
}

/** Diagonal slash stamp of length len, 1px thick. dir=+1 for '/', -1 for '\'. */
export function stampSlash(buf: PixelBuffer, cx: number, cy: number, len: number, dir: 1 | -1, c: number): void {
  const half = Math.floor(len / 2);
  for (let i = -half; i < len - half; i++) {
    buf.setPixel(cx + i, cy - i * dir, c);
  }
}

export type Stamper = (buf: PixelBuffer, x: number, y: number, c: number) => void;

/** Draw a stroke segment by stamping along the Bresenham path. */
export function stampLine(
  buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, c: number, stamp: Stamper,
): void {
  bresenham(x0, y0, x1, y1, (x, y) => stamp(buf, x, y, c));
}

/** Line of a given width (1 = pure Bresenham; >1 stamped round pen like GDI). */
export function thickLine(
  buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, w: number, c: number,
): void {
  if (w <= 1) { line(buf, x0, y0, x1, y1, c); return; }
  bresenham(x0, y0, x1, y1, (x, y) => stampDisc(buf, x, y, w, c));
}

/* ---------------- Rectangles ---------------- */

function norm(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

export function rectOutline(
  buf: PixelBuffer, xa: number, ya: number, xb: number, yb: number, w: number, c: number,
): void {
  const [x0, x1] = norm(xa, xb), [y0, y1] = norm(ya, yb);
  if (w <= 1) {
    for (let x = x0; x <= x1; x++) { buf.setPixel(x, y0, c); buf.setPixel(x, y1, c); }
    for (let y = y0; y <= y1; y++) { buf.setPixel(x0, y, c); buf.setPixel(x1, y, c); }
  } else {
    thickLine(buf, x0, y0, x1, y0, w, c);
    thickLine(buf, x1, y0, x1, y1, w, c);
    thickLine(buf, x1, y1, x0, y1, w, c);
    thickLine(buf, x0, y1, x0, y0, w, c);
  }
}

export function rectFill(
  buf: PixelBuffer, xa: number, ya: number, xb: number, yb: number, c: number,
): void {
  const [x0, x1] = norm(xa, xb), [y0, y1] = norm(ya, yb);
  buf.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, c);
}

/* ---------------- Ellipses ---------------- */
/* Zingl's rect-bounded midpoint ellipse: exact even/odd extents, matches GDI. */

function ellipseWalk(
  xa: number, ya: number, xb: number, yb: number, plot: Plot,
): void {
  let [x0, x1] = norm(xa, xb);
  let [y0, y1] = norm(ya, yb);
  const a = x1 - x0;
  const b = y1 - y0;
  if (a === 0 || b === 0) {
    // Degenerate: a line
    if (a === 0) for (let y = y0; y <= y1; y++) plot(x0, y);
    else for (let x = x0; x <= x1; x++) plot(x, y0);
    return;
  }
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let e2: number;
  y0 += Math.floor((b + 1) / 2);
  y1 = y0 - b1;
  const a8 = 8 * a * a;
  const b8 = 8 * b * b;
  do {
    plot(x1, y0);
    plot(x0, y0);
    plot(x0, y1);
    plot(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a8; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b8; }
  } while (x0 <= x1);
  while (y0 - y1 < b) {  // finish tip of flat (a≈1) ellipses
    plot(x0 - 1, y0);
    plot(x1 + 1, y0++);
    plot(x0 - 1, y1);
    plot(x1 + 1, y1--);
  }
}

/** Per-row outline extremes [xl, xr] keyed by y. */
function ellipseRowExtents(
  xa: number, ya: number, xb: number, yb: number,
): Map<number, [number, number]> {
  const rows = new Map<number, [number, number]>();
  ellipseWalk(xa, ya, xb, yb, (x, y) => {
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]);
    else {
      if (x < r[0]) r[0] = x;
      if (x > r[1]) r[1] = x;
    }
  });
  return rows;
}

export function ellipseFill(
  buf: PixelBuffer, xa: number, ya: number, xb: number, yb: number, c: number,
): void {
  for (const [y, [xl, xr]] of ellipseRowExtents(xa, ya, xb, yb)) {
    buf.fillRect(xl, y, xr - xl + 1, 1, c);
  }
}

export function ellipseOutline(
  buf: PixelBuffer, xa: number, ya: number, xb: number, yb: number, w: number, c: number,
): void {
  if (w <= 1) {
    ellipseWalk(xa, ya, xb, yb, (x, y) => buf.setPixel(x, y, c));
  } else {
    ellipseWalk(xa, ya, xb, yb, (x, y) => stampDisc(buf, x, y, w, c));
  }
}

/* ---------------- Rounded rectangle ---------------- */

export function roundRect(
  buf: PixelBuffer, xa: number, ya: number, xb: number, yb: number,
  w: number, outlineC: number | null, fillC: number | null,
): void {
  const [x0, x1] = norm(xa, xb), [y0, y1] = norm(ya, yb);
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  const r = Math.max(0, Math.min(8, Math.floor((Math.min(rw, rh) - 1) / 2)));
  // Quarter-circle x-inset per dy from the corner, via midpoint circle sampling.
  const inset: number[] = [];
  for (let dy = 0; dy <= r; dy++) {
    const t = r * r - (r - dy) * (r - dy);
    inset.push(r - Math.round(Math.sqrt(Math.max(0, t))));
  }
  const rowSpan = (y: number): [number, number] => {
    let ins = 0;
    if (y - y0 < r) ins = inset[y - y0];
    else if (y1 - y < r) ins = inset[y1 - y];
    return [x0 + ins, x1 - ins];
  };
  if (fillC !== null) {
    for (let y = y0; y <= y1; y++) {
      const [xl, xr] = rowSpan(y);
      buf.fillRect(xl, y, xr - xl + 1, 1, fillC);
    }
  }
  if (outlineC !== null) {
    const stamp = (x: number, y: number) =>
      w <= 1 ? buf.setPixel(x, y, outlineC) : stampDisc(buf, x, y, w, outlineC);
    let prev: [number, number] | null = null;
    for (let y = y0; y <= y1; y++) {
      const [xl, xr] = rowSpan(y);
      if (y === y0 || y === y1) {
        for (let x = xl; x <= xr; x++) stamp(x, y);
      } else {
        const [pl, pr] = prev!;
        for (let x = xl; x <= Math.max(xl, pl - 1); x++) stamp(x, y);
        for (let x = Math.min(xr, pr + 1); x <= xr; x++) stamp(x, y);
        stamp(xl, y); stamp(xr, y);
      }
      prev = [xl, xr];
    }
  }
}

/* ---------------- Polygon (even-odd scanline fill, like GDI ALTERNATE) ---------------- */

export function polygonFill(buf: PixelBuffer, pts: Array<[number, number]>, c: number): void {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(buf.height - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const yc = y + 0.5;
    for (let i = 0; i < pts.length; i++) {
      const [xa, ya] = pts[i];
      const [xb, yb] = pts[(i + 1) % pts.length];
      if ((ya <= yc && yb > yc) || (yb <= yc && ya > yc)) {
        xs.push(xa + (yc - ya) / (yb - ya) * (xb - xa));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xl = Math.ceil(xs[i] - 0.5), xr = Math.floor(xs[i + 1] - 0.5);
      if (xr >= xl) buf.fillRect(xl, y, xr - xl + 1, 1, c);
    }
  }
}

export function polygonOutline(
  buf: PixelBuffer, pts: Array<[number, number]>, w: number, c: number, close: boolean,
): void {
  const n = pts.length;
  for (let i = 0; i < (close ? n : n - 1); i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[(i + 1) % n];
    thickLine(buf, Math.round(xa), Math.round(ya), Math.round(xb), Math.round(yb), w, c);
  }
}

/** Point-in-polygon (even-odd), for free-form select masks. */
export function pointInPolygon(pts: Array<[number, number]>, x: number, y: number): boolean {
  let inside = false;
  const xc = x + 0.5, yc = y + 0.5;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > yc) !== (yj > yc) && xc < (xj - xi) * (yc - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/* ---------------- Cubic Bézier (Curve tool) ---------------- */

export function bezier(
  buf: PixelBuffer,
  p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number],
  w: number, c: number,
): void {
  const dist = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
    Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
    Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const steps = Math.max(8, Math.ceil(dist));
  let px = p0[0], py = p0[1];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
    const y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1];
    thickLine(buf, Math.round(px), Math.round(py), Math.round(x), Math.round(y), w, c);
    px = x; py = y;
  }
}

/* ---------------- Whole-image transforms ---------------- */

export function invert(buf: PixelBuffer): void {
  const u = buf.u32;
  for (let i = 0; i < u.length; i++) u[i] = (u[i] ^ 0x00ffffff) >>> 0;
  buf.touchAll();
}

export function flipH(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height);
  const w = buf.width;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < w; x++) out.u32[y * w + x] = buf.u32[y * w + (w - 1 - x)];
  }
  out.touchAll();
  return out;
}

export function flipV(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height);
  const w = buf.width, h = buf.height;
  for (let y = 0; y < h; y++) {
    out.u32.set(buf.u32.subarray((h - 1 - y) * w, (h - y) * w), y * w);
  }
  out.touchAll();
  return out;
}

export function rotate(buf: PixelBuffer, deg: 90 | 180 | 270): PixelBuffer {
  const w = buf.width, h = buf.height;
  if (deg === 180) {
    const out = new PixelBuffer(w, h);
    for (let i = 0; i < buf.u32.length; i++) out.u32[i] = buf.u32[buf.u32.length - 1 - i];
    out.touchAll();
    return out;
  }
  const out = new PixelBuffer(h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = buf.u32[y * w + x];
      if (deg === 90) out.u32[x * h + (h - 1 - y)] = c;
      else out.u32[(w - 1 - x) * h + y] = c;
    }
  }
  out.touchAll();
  return out;
}

/** Nearest-neighbor stretch by percentage (100 = unchanged). */
export function stretchNN(buf: PixelBuffer, pctX: number, pctY: number): PixelBuffer {
  const nw = Math.max(1, Math.round(buf.width * pctX / 100));
  const nh = Math.max(1, Math.round(buf.height * pctY / 100));
  const out = new PixelBuffer(nw, nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(buf.height - 1, Math.floor(y * buf.height / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(buf.width - 1, Math.floor(x * buf.width / nw));
      out.u32[y * nw + x] = buf.u32[sy * buf.width + sx];
    }
  }
  out.touchAll();
  return out;
}

/** Horizontal then vertical shear in degrees (-89..89), new area white. */
export function skew(buf: PixelBuffer, degH: number, degV: number): PixelBuffer {
  let cur = buf;
  if (degH !== 0) {
    const t = Math.tan(degH * Math.PI / 180);
    const shift = (y: number) => Math.round(t * y);
    const extra = Math.abs(shift(cur.height - 1));
    const out = new PixelBuffer(cur.width + extra, cur.height);
    const base = t < 0 ? extra : 0;
    for (let y = 0; y < cur.height; y++) {
      const dx = base + shift(y);
      for (let x = 0; x < cur.width; x++) {
        out.u32[y * out.width + x + dx] = cur.u32[y * cur.width + x];
      }
    }
    out.touchAll();
    cur = out;
  }
  if (degV !== 0) {
    const t = Math.tan(degV * Math.PI / 180);
    const shift = (x: number) => Math.round(t * x);
    const extra = Math.abs(shift(cur.width - 1));
    const out = new PixelBuffer(cur.width, cur.height + extra);
    const base = t < 0 ? extra : 0;
    for (let x = 0; x < cur.width; x++) {
      const dy = base + shift(x);
      for (let y = 0; y < cur.height; y++) {
        out.u32[(y + dy) * out.width + x] = cur.u32[y * cur.width + x];
      }
    }
    out.touchAll();
    cur = out;
  }
  return cur;
}

/* ---------------- 1-bit conversion (ordered dither, like the halftone brush) ---------------- */

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

export function ditherToMono(buf: PixelBuffer): void {
  const d = buf.data;
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const i = (y * buf.width + x) * 4;
      const lum = luminance(d[i], d[i + 1], d[i + 2]);
      const threshold = (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) * 4;
      const v = lum > threshold ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  buf.touchAll();
}

// The document's source of truth: an ImageData-backed RGBA buffer at exact
// pixel dimensions. Every pixel is fully opaque. The offscreen canvas exists
// only so the display surface can blit from it — tools never draw on a context.

const WHITE = 0xffffffff;

export class PixelBuffer {
  width: number;
  height: number;
  imageData: ImageData;
  data: Uint8ClampedArray;
  u32: Uint32Array;
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;

  constructor(width: number, height: number, source?: Uint8ClampedArray) {
    this.width = width;
    this.height = height;
    this.imageData = new ImageData(width, height);
    this.data = this.imageData.data;
    this.u32 = new Uint32Array(this.data.buffer);
    if (source) {
      this.data.set(source);
    } else {
      this.u32.fill(WHITE);
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  getPixel(x: number, y: number): number {
    return this.u32[y * this.width + x];
  }

  setPixel(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.u32[y * this.width + x] = c;
    this.touch(x, y, x + 1, y + 1);
  }

  /** Extend the pending dirty region (exclusive x1/y1). */
  touch(x0: number, y0: number, x1: number, y1: number): void {
    if (this.dirty) {
      if (x0 < this.dirty.x0) this.dirty.x0 = x0;
      if (y0 < this.dirty.y0) this.dirty.y0 = y0;
      if (x1 > this.dirty.x1) this.dirty.x1 = x1;
      if (y1 > this.dirty.y1) this.dirty.y1 = y1;
    } else {
      this.dirty = { x0, y0, x1, y1 };
    }
  }

  touchAll(): void {
    this.touch(0, 0, this.width, this.height);
  }

  /** Push pending dirty pixels to the offscreen canvas; returns the region synced. */
  sync(): { x: number; y: number; w: number; h: number } | null {
    if (!this.dirty) return null;
    const x = Math.max(0, this.dirty.x0);
    const y = Math.max(0, this.dirty.y0);
    const w = Math.min(this.width, this.dirty.x1) - x;
    const h = Math.min(this.height, this.dirty.y1) - y;
    this.dirty = null;
    if (w <= 0 || h <= 0) return null;
    this.ctx.putImageData(this.imageData, 0, 0, x, y, w, h);
    return { x, y, w, h };
  }

  snapshot(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.data);
  }

  restore(snap: Uint8ClampedArray): void {
    this.data.set(snap);
    this.touchAll();
  }

  /** Restore only a rectangular region from a full-buffer snapshot. */
  restoreRect(snap: Uint8ClampedArray, x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w), y1 = Math.min(this.height, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    const snap32 = new Uint32Array(snap.buffer, snap.byteOffset, snap.length >> 2);
    for (let yy = y0; yy < y1; yy++) {
      const off = yy * this.width;
      for (let xx = x0; xx < x1; xx++) this.u32[off + xx] = snap32[off + xx];
    }
    this.touch(x0, y0, x1, y1);
  }

  /** Copy a region out into a new standalone buffer (clipped to bounds; out-of-range fills white). */
  extract(x: number, y: number, w: number, h: number): PixelBuffer {
    const out = new PixelBuffer(w, h);
    for (let yy = 0; yy < h; yy++) {
      const sy = y + yy;
      if (sy < 0 || sy >= this.height) continue;
      for (let xx = 0; xx < w; xx++) {
        const sx = x + xx;
        if (sx < 0 || sx >= this.width) continue;
        out.u32[yy * w + xx] = this.u32[sy * this.width + sx];
      }
    }
    out.touchAll();
    out.sync();
    return out;
  }

  /**
   * Stamp another buffer into this one at (dx,dy).
   * transparentKey: pixels in src equal to this u32 are skipped (color-key masking, not alpha).
   * mask: optional per-pixel byte mask (same dimensions as src, non-zero = paint).
   */
  blit(src: PixelBuffer, dx: number, dy: number, transparentKey?: number, mask?: Uint8Array): void {
    const x0 = Math.max(0, dx), y0 = Math.max(0, dy);
    const x1 = Math.min(this.width, dx + src.width), y1 = Math.min(this.height, dy + src.height);
    if (x1 <= x0 || y1 <= y0) return;
    for (let yy = y0; yy < y1; yy++) {
      const srow = (yy - dy) * src.width;
      const drow = yy * this.width;
      for (let xx = x0; xx < x1; xx++) {
        const si = srow + (xx - dx);
        if (mask && !mask[si]) continue;
        const c = src.u32[si];
        if (transparentKey !== undefined && c === transparentKey) continue;
        this.u32[drow + xx] = c;
      }
    }
    this.touch(x0, y0, x1, y1);
  }

  /** Fill a rect (clipped) with a solid color. */
  fillRect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w), y1 = Math.min(this.height, y + h);
    if (x1 <= x0 || y1 <= y0) return;
    for (let yy = y0; yy < y1; yy++) {
      this.u32.fill(c, yy * this.width + x0, yy * this.width + x1);
    }
    this.touch(x0, y0, x1, y1);
  }

  clear(c: number = WHITE): void {
    this.u32.fill(c);
    this.touchAll();
  }

  /** Destructive resize: crop, or extend with white. Never interpolates. */
  static resized(src: PixelBuffer, w: number, h: number): PixelBuffer {
    const out = new PixelBuffer(w, h);
    const cw = Math.min(w, src.width), ch = Math.min(h, src.height);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        out.u32[y * w + x] = src.u32[y * src.width + x];
      }
    }
    out.touchAll();
    out.sync();
    return out;
  }

  static fromImageData(img: ImageData): PixelBuffer {
    const buf = new PixelBuffer(img.width, img.height, img.data);
    // Composite any alpha over white and force opaque — alpha is not a concept here.
    const d = buf.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a === 255) continue;
      d[i] = Math.round(d[i] * a / 255 + 255 - a);
      d[i + 1] = Math.round(d[i + 1] * a / 255 + 255 - a);
      d[i + 2] = Math.round(d[i + 2] * a / 255 + 255 - a);
      d[i + 3] = 255;
    }
    buf.touchAll();
    buf.sync();
    return buf;
  }
}

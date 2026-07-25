// Hand-rolled BMP reader/writer using DataView. Produces genuine
// BITMAPFILEHEADER + BITMAPINFOHEADER files at 1/4/8/24-bit depth with
// correct palettes, bottom-up row order, and 4-byte row padding.
// Reads 1/4/8/16/24/32-bit uncompressed plus RLE8/RLE4.

import { PixelBuffer } from '../core/pixelbuffer';
import { luminance } from '../core/color';
import { medianCut, nearestIndex } from './quant';

export type BmpDepth = 1 | 4 | 8 | 24;

/** Standard 16-color VGA palette used when 4-bit needs quantizing. */
const VGA16: number[] = [
  0x000000, 0x800000, 0x008000, 0x808000, 0x000080, 0x800080, 0x008080, 0x808080,
  0xC0C0C0, 0xFF0000, 0x00FF00, 0xFFFF00, 0x0000FF, 0xFF00FF, 0x00FFFF, 0xFFFFFF,
];

/** How many distinct colors does the image use (capped at limit+1)? */
export function countColors(buf: PixelBuffer, limit: number): number {
  const seen = new Set<number>();
  for (let i = 0; i < buf.u32.length; i++) {
    seen.add(buf.u32[i]);
    if (seen.size > limit) return limit + 1;
  }
  return seen.size;
}

export function encodeBMP(buf: PixelBuffer, depth: BmpDepth): Uint8Array {
  const w = buf.width, h = buf.height;

  let palette: number[] = [];           // 0xRRGGBB entries
  let indexOf: ((u32: number) => number) | null = null;

  if (depth !== 24) {
    const maxColors = depth === 8 ? 256 : depth === 4 ? 16 : 2;
    if (depth === 1) {
      palette = [0x000000, 0xFFFFFF];
      indexOf = (c: number) => {
        const r = c & 0xff, g = (c >>> 8) & 0xff, b = (c >>> 16) & 0xff;
        return luminance(r, g, b) >= 128 ? 1 : 0;
      };
    } else {
      // Use the image's own colors when they fit, else quantize.
      const seen = new Map<number, number>();
      for (let i = 0; i < buf.u32.length && seen.size <= maxColors; i++) {
        const c = buf.u32[i] & 0x00ffffff;
        if (!seen.has(c)) seen.set(c, seen.size);
      }
      if (seen.size <= maxColors) {
        const abgrList = [...seen.keys()];
        palette = abgrList.map(c => ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff));
        indexOf = (c: number) => seen.get(c & 0x00ffffff)!;
      } else if (depth === 4) {
        palette = [...VGA16];
        const cache = new Map<number, number>();
        indexOf = (c: number) => {
          let idx = cache.get(c);
          if (idx === undefined) {
            idx = nearestIndex(palette, c);
            cache.set(c, idx);
          }
          return idx;
        };
      } else {
        palette = medianCut(buf.u32, 256);
        const cache = new Map<number, number>();
        indexOf = (c: number) => {
          let idx = cache.get(c);
          if (idx === undefined) {
            idx = nearestIndex(palette, c);
            cache.set(c, idx);
          }
          return idx;
        };
      }
    }
  }

  const paletteCount = depth === 24 ? 0 : (depth === 1 ? 2 : depth === 4 ? 16 : 256);
  const bitsPerRow = w * depth;
  const rowSize = ((bitsPerRow + 31) >> 5) << 2;    // 4-byte aligned
  const imageSize = rowSize * h;
  const dataOffset = 14 + 40 + paletteCount * 4;
  const fileSize = dataOffset + imageSize;

  const out = new Uint8Array(fileSize);
  const dv = new DataView(out.buffer);

  // BITMAPFILEHEADER
  out[0] = 0x42; out[1] = 0x4D;                     // 'BM'
  dv.setUint32(2, fileSize, true);
  dv.setUint32(6, 0, true);
  dv.setUint32(10, dataOffset, true);

  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);                         // positive = bottom-up
  dv.setUint16(26, 1, true);                        // planes
  dv.setUint16(28, depth, true);
  dv.setUint32(30, 0, true);                        // BI_RGB
  dv.setUint32(34, imageSize, true);
  dv.setInt32(38, 2835, true);                      // 72 DPI in px/m
  dv.setInt32(42, 2835, true);
  dv.setUint32(46, paletteCount, true);
  dv.setUint32(50, 0, true);

  // Palette (BGRA quads)
  for (let i = 0; i < paletteCount; i++) {
    const rgb = i < palette.length ? palette[i] : 0;
    const o = 54 + i * 4;
    out[o] = rgb & 0xff;                            // B
    out[o + 1] = (rgb >>> 8) & 0xff;                // G
    out[o + 2] = (rgb >>> 16) & 0xff;               // R
    out[o + 3] = 0;
  }

  // Pixel data, bottom-up
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w;
    const dst = dataOffset + y * rowSize;
    if (depth === 24) {
      for (let x = 0; x < w; x++) {
        const c = buf.u32[srcRow + x];
        const o = dst + x * 3;
        out[o] = (c >>> 16) & 0xff;                 // B
        out[o + 1] = (c >>> 8) & 0xff;              // G
        out[o + 2] = c & 0xff;                      // R
      }
    } else if (depth === 8) {
      for (let x = 0; x < w; x++) {
        out[dst + x] = indexOf!(buf.u32[srcRow + x]);
      }
    } else if (depth === 4) {
      for (let x = 0; x < w; x++) {
        const idx = indexOf!(buf.u32[srcRow + x]) & 0x0f;
        const o = dst + (x >> 1);
        if ((x & 1) === 0) out[o] |= idx << 4;
        else out[o] |= idx;
      }
    } else {
      for (let x = 0; x < w; x++) {
        if (indexOf!(buf.u32[srcRow + x])) {
          out[dst + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
  }
  return out;
}

export function isBMP(bytes: Uint8Array): boolean {
  return bytes.length > 54 && bytes[0] === 0x42 && bytes[1] === 0x4D;
}

export function decodeBMP(bytes: Uint8Array): PixelBuffer {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4D) throw new Error('Not a BMP file');
  const dataOffset = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  if (headerSize < 40) throw new Error('Unsupported BMP header (OS/2)');
  const w = dv.getInt32(18, true);
  let h = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  let clrUsed = dv.getUint32(46, true);
  const topDown = h < 0;
  if (topDown) h = -h;
  if (w <= 0 || h <= 0 || w > 30000 || h > 30000) throw new Error('Invalid BMP dimensions');

  // Bitfield masks (BI_BITFIELDS) default to 565/888 as appropriate
  let maskR = 0, maskG = 0, maskB = 0;
  if (compression === 3) {
    maskR = dv.getUint32(headerSize >= 52 ? 54 : 14 + 40, true);
    maskG = dv.getUint32(headerSize >= 52 ? 58 : 14 + 44, true);
    maskB = dv.getUint32(headerSize >= 52 ? 62 : 14 + 48, true);
  } else if (bpp === 16) {
    maskR = 0x7C00; maskG = 0x03E0; maskB = 0x001F;   // default 555
  } else if (bpp === 32) {
    maskR = 0x00FF0000; maskG = 0x0000FF00; maskB = 0x000000FF;
  }

  // Palette
  let palette: number[] = [];
  if (bpp <= 8) {
    if (clrUsed === 0) clrUsed = 1 << bpp;
    const palOff = 14 + headerSize + (compression === 3 && headerSize === 40 ? 12 : 0);
    for (let i = 0; i < clrUsed; i++) {
      const o = palOff + i * 4;
      const b = bytes[o], g = bytes[o + 1], r = bytes[o + 2];
      palette.push((0xff000000 | (b << 16) | (g << 8) | r) >>> 0);
    }
  }

  const buf = new PixelBuffer(w, h);
  const rowSize = ((w * bpp + 31) >> 5) << 2;
  const putRowIdx = (fileRow: number) => topDown ? fileRow : h - 1 - fileRow;

  if (compression === 1 || compression === 2) {
    decodeRLE(bytes, dataOffset, buf, palette, compression === 2, topDown);
  } else {
    for (let fy = 0; fy < h; fy++) {
      const y = putRowIdx(fy);
      const src = dataOffset + fy * rowSize;
      if (src + rowSize > bytes.length && fy === h - 1) {
        // tolerate truncated final row padding
      }
      const drow = y * w;
      if (bpp === 24) {
        for (let x = 0; x < w; x++) {
          const o = src + x * 3;
          buf.u32[drow + x] = (0xff000000 | (bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]) >>> 0;
        }
      } else if (bpp === 32) {
        for (let x = 0; x < w; x++) {
          const v = dv.getUint32(src + x * 4, true);
          const r = maskScale(v, maskR), g = maskScale(v, maskG), b = maskScale(v, maskB);
          buf.u32[drow + x] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
        }
      } else if (bpp === 16) {
        for (let x = 0; x < w; x++) {
          const v = dv.getUint16(src + x * 2, true);
          const r = maskScale(v, maskR), g = maskScale(v, maskG), b = maskScale(v, maskB);
          buf.u32[drow + x] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
        }
      } else if (bpp === 8) {
        for (let x = 0; x < w; x++) {
          buf.u32[drow + x] = palette[bytes[src + x]] ?? 0xff000000;
        }
      } else if (bpp === 4) {
        for (let x = 0; x < w; x++) {
          const b = bytes[src + (x >> 1)];
          const idx = (x & 1) === 0 ? b >> 4 : b & 0x0f;
          buf.u32[drow + x] = palette[idx] ?? 0xff000000;
        }
      } else if (bpp === 1) {
        for (let x = 0; x < w; x++) {
          const idx = (bytes[src + (x >> 3)] >> (7 - (x & 7))) & 1;
          buf.u32[drow + x] = palette[idx] ?? 0xff000000;
        }
      } else {
        throw new Error(`Unsupported BMP bit depth: ${bpp}`);
      }
    }
  }
  buf.touchAll();
  buf.sync();
  return buf;
}

function maskScale(v: number, mask: number): number {
  if (mask === 0) return 0;
  let shift = 0;
  let m = mask;
  while ((m & 1) === 0) { m >>>= 1; shift++; }
  const val = (v & mask) >>> shift;
  const bits = 32 - Math.clz32(m);
  if (bits >= 8) return val >> (bits - 8);
  return Math.round(val * 255 / m);
}

function decodeRLE(
  bytes: Uint8Array, off: number, buf: PixelBuffer,
  palette: number[], rle4: boolean, topDown: boolean,
): void {
  const w = buf.width, h = buf.height;
  let x = 0, fy = 0;
  let i = off;
  const put = (idx: number) => {
    if (x < w && fy < h) {
      const y = topDown ? fy : h - 1 - fy;
      buf.u32[y * w + x] = palette[idx] ?? 0xff000000;
    }
    x++;
  };
  while (i + 1 < bytes.length && fy < h) {
    const count = bytes[i++];
    const value = bytes[i++];
    if (count > 0) {
      if (rle4) {
        for (let k = 0; k < count; k++) put((k & 1) === 0 ? value >> 4 : value & 0x0f);
      } else {
        for (let k = 0; k < count; k++) put(value);
      }
    } else if (value === 0) {
      x = 0; fy++;
    } else if (value === 1) {
      return;
    } else if (value === 2) {
      x += bytes[i++];
      fy += bytes[i++];
    } else {
      // absolute run of `value` pixels
      if (rle4) {
        for (let k = 0; k < value; k++) {
          const b = bytes[i + (k >> 1)];
          put((k & 1) === 0 ? b >> 4 : b & 0x0f);
        }
        i += Math.ceil(value / 2);
        if (Math.ceil(value / 2) & 1) i++;          // word-align
      } else {
        for (let k = 0; k < value; k++) put(bytes[i + k]);
        i += value;
        if (value & 1) i++;                          // word-align
      }
    }
  }
}

// Small pure-JS GIF codec: decodes the first frame of GIF87a/89a (LZW,
// interlace, transparency composited over white) and encodes a single-frame
// GIF89a with a median-cut palette.

import { PixelBuffer } from '../core/pixelbuffer';
import { medianCut, nearestIndex } from './quant';

export function isGIF(bytes: Uint8Array): boolean {
  return bytes.length > 13 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46;
}

/* ================= decode ================= */

export function decodeGIF(bytes: Uint8Array): PixelBuffer {
  if (!isGIF(bytes)) throw new Error('Not a GIF file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getUint16(6, true);
  const height = dv.getUint16(8, true);
  const packed = bytes[10];
  let pos = 13;

  let gct: number[] = [];
  if (packed & 0x80) {
    const n = 2 << (packed & 7);
    gct = readColorTable(bytes, pos, n);
    pos += n * 3;
  }

  let transparentIndex = -1;
  for (;;) {
    if (pos >= bytes.length) throw new Error('Truncated GIF');
    const block = bytes[pos++];
    if (block === 0x3B) throw new Error('GIF contains no image');
    if (block === 0x21) {
      const label = bytes[pos++];
      if (label === 0xF9) {
        const size = bytes[pos];
        if (size >= 4 && (bytes[pos + 1] & 1)) transparentIndex = bytes[pos + 4];
        pos += size + 1;
        pos++; // terminator
      } else {
        // skip sub-blocks
        for (;;) {
          const n = bytes[pos++];
          if (n === 0) break;
          pos += n;
        }
      }
      continue;
    }
    if (block !== 0x2C) throw new Error('Unexpected GIF block');
    break;
  }

  const ix = dv.getUint16(pos, true);
  const iy = dv.getUint16(pos + 2, true);
  const iw = dv.getUint16(pos + 4, true);
  const ih = dv.getUint16(pos + 6, true);
  const ipacked = bytes[pos + 8];
  pos += 9;

  let lct = gct;
  if (ipacked & 0x80) {
    const n = 2 << (ipacked & 7);
    lct = readColorTable(bytes, pos, n);
    pos += n * 3;
  }
  const interlaced = (ipacked & 0x40) !== 0;

  const minCodeSize = bytes[pos++];
  // Collect LZW data from sub-blocks
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const n = bytes[pos++];
    if (n === 0) break;
    chunks.push(bytes.subarray(pos, pos + n));
    total += n;
    pos += n;
  }
  const data = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { data.set(c, o); o += c.length; }

  const indices = lzwDecode(minCodeSize, data, iw * ih);

  const buf = new PixelBuffer(width, height);   // starts white
  const rowOrder: number[] = [];
  if (interlaced) {
    for (let y = 0; y < ih; y += 8) rowOrder.push(y);
    for (let y = 4; y < ih; y += 8) rowOrder.push(y);
    for (let y = 2; y < ih; y += 4) rowOrder.push(y);
    for (let y = 1; y < ih; y += 2) rowOrder.push(y);
  } else {
    for (let y = 0; y < ih; y++) rowOrder.push(y);
  }
  let src = 0;
  for (const y of rowOrder) {
    for (let x = 0; x < iw; x++, src++) {
      const idx = indices[src];
      if (idx === transparentIndex) continue;      // stays white
      const gx = ix + x, gy = iy + y;
      if (gx >= width || gy >= height) continue;
      buf.u32[gy * width + gx] = lct[idx] ?? 0xff000000;
    }
  }
  buf.touchAll();
  buf.sync();
  return buf;
}

function readColorTable(bytes: Uint8Array, pos: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = pos + i * 3;
    out.push((0xff000000 | (bytes[o + 2] << 16) | (bytes[o + 1] << 8) | bytes[o]) >>> 0);
  }
  return out;
}

function lzwDecode(minCodeSize: number, data: Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  let outPos = 0;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeLen = minCodeSize + 1;
  let next = eoi + 1;

  const MAX = 4096;
  const prefix = new Int32Array(MAX);
  const suffix = new Uint8Array(MAX);
  const stack = new Uint8Array(MAX + 1);

  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }

  let bitPos = 0;
  const readCode = (): number => {
    let v = 0;
    for (let i = 0; i < codeLen; i++) {
      const byte = bitPos >> 3;
      if (byte >= data.length) return eoi;
      if (data[byte] & (1 << (bitPos & 7))) v |= 1 << i;
      bitPos++;
    }
    return v;
  };

  let prev = -1;
  let first = 0;
  while (outPos < pixelCount) {
    const code = readCode();
    if (code === eoi) break;
    if (code === clear) {
      codeLen = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    let c = code;
    let sp = 0;
    if (c >= next) {
      // KwKwK case: expansion(prev) + firstByte(prev)
      if (prev < 0) break;
      stack[sp++] = first;
      c = prev;
    }
    while (c > eoi) {           // table entries are > eoi; base codes end the chain
      stack[sp++] = suffix[c];
      c = prefix[c];
    }
    stack[sp++] = c;            // base code
    first = c;
    for (let i = sp - 1; i >= 0 && outPos < pixelCount; i--) {
      out[outPos++] = stack[i];
    }
    if (prev >= 0 && next < MAX) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if (next === (1 << codeLen) && codeLen < 12) codeLen++;
    }
    prev = code;
  }
  return out;
}

/* ================= encode ================= */

export function encodeGIF(buf: PixelBuffer): Uint8Array {
  const palette = medianCut(buf.u32, 256);
  while (palette.length < 2) palette.push(0);
  let bits = 1;
  while ((1 << bits) < palette.length) bits++;
  const tableSize = 1 << bits;

  // Map pixels to palette indices
  const indices = new Uint8Array(buf.u32.length);
  const cache = new Map<number, number>();
  for (let i = 0; i < buf.u32.length; i++) {
    const c = buf.u32[i];
    let idx = cache.get(c);
    if (idx === undefined) {
      idx = nearestIndex(palette, c);
      cache.set(c, idx);
    }
    indices[i] = idx;
  }

  const out: number[] = [];
  const push16 = (v: number) => { out.push(v & 0xff, (v >> 8) & 0xff); };

  // Header + logical screen descriptor
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  push16(buf.width);
  push16(buf.height);
  out.push(0x80 | ((bits - 1) & 7) << 4 | (bits - 1)); // GCT present
  out.push(0, 0);

  for (let i = 0; i < tableSize; i++) {
    const p = i < palette.length ? palette[i] : 0;
    out.push((p >> 16) & 0xff, (p >> 8) & 0xff, p & 0xff);
  }

  // Image descriptor
  out.push(0x2C);
  push16(0); push16(0);
  push16(buf.width); push16(buf.height);
  out.push(0);

  // LZW-compressed data
  const minCodeSize = Math.max(2, bits);
  out.push(minCodeSize);
  const compressed = lzwEncode(minCodeSize, indices);
  for (let i = 0; i < compressed.length; i += 255) {
    const n = Math.min(255, compressed.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(compressed[i + j]);
  }
  out.push(0);
  out.push(0x3B);
  return new Uint8Array(out);
}

function lzwEncode(minCodeSize: number, indices: Uint8Array): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeLen = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();

  const bytes: number[] = [];
  let cur = 0, curBits = 0;
  const emit = (code: number) => {
    cur |= code << curBits;
    curBits += codeLen;
    while (curBits >= 8) {
      bytes.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };

  emit(clear);
  let prev = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prev * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prev = found;
      continue;
    }
    emit(prev);
    if (next < 4096) {
      dict.set(key, next);
      next++;
      if (next === (1 << codeLen) + 1 && codeLen < 12) codeLen++;
    } else {
      emit(clear);
      dict = new Map();
      codeLen = minCodeSize + 1;
      next = eoi + 1;
    }
    prev = k;
  }
  emit(prev);
  emit(eoi);
  if (curBits > 0) bytes.push(cur & 0xff);
  return new Uint8Array(bytes);
}

// Open/save orchestration: format sniffing and dispatch, depth-loss checks,
// recent files. BMP/GIF are hand-rolled; PNG/JPEG use the canvas encoders.

import { PixelBuffer } from '../core/pixelbuffer';
import { SaveFormat } from '../core/doc';
import { bridge } from '../platform/bridge';
import { decodeBMP, encodeBMP, isBMP, countColors, BmpDepth } from './bmp';
import { decodeGIF, encodeGIF, isGIF } from './gif';

export interface LoadedImage {
  buffer: PixelBuffer;
  name: string;
  path: string | null;
  format: SaveFormat;
}

export const FORMAT_LABELS: Array<{ format: SaveFormat; label: string; ext: string }> = [
  { format: 'bmp1', label: 'Monochrome Bitmap (*.bmp)', ext: 'bmp' },
  { format: 'bmp4', label: '16 Color Bitmap (*.bmp)', ext: 'bmp' },
  { format: 'bmp8', label: '256 Color Bitmap (*.bmp)', ext: 'bmp' },
  { format: 'bmp24', label: '24-bit Bitmap (*.bmp)', ext: 'bmp' },
  { format: 'jpeg', label: 'JPEG (*.jpg;*.jpeg)', ext: 'jpg' },
  { format: 'gif', label: 'GIF (*.gif)', ext: 'gif' },
  { format: 'png', label: 'PNG (*.png)', ext: 'png' },
];

export function formatForName(name: string): SaveFormat {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'gif') return 'gif';
  return 'bmp24';
}

/** Colors would be lost saving buf at this format? */
export function losesColor(buf: PixelBuffer, format: SaveFormat): boolean {
  if (format === 'bmp1') return countColors(buf, 2) > 2;
  if (format === 'bmp4') return countColors(buf, 16) > 16;
  if (format === 'bmp8' || format === 'gif') return countColors(buf, 256) > 256;
  return false;
}

export async function decodeBytes(bytes: Uint8Array, name: string): Promise<{ buffer: PixelBuffer; format: SaveFormat }> {
  if (isBMP(bytes)) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const bpp = dv.getUint16(28, true);
    const format: SaveFormat = bpp === 1 ? 'bmp1' : bpp === 4 ? 'bmp4' : bpp === 8 ? 'bmp8' : 'bmp24';
    return { buffer: decodeBMP(bytes), format };
  }
  if (isGIF(bytes)) {
    return { buffer: decodeGIF(bytes), format: 'gif' };
  }
  // PNG/JPEG (and anything else the browser can decode)
  const blob = new Blob([bytes as BlobPart]);
  const bitmap = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = bitmap.width;
  cv.height = bitmap.height;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { buffer: PixelBuffer.fromImageData(img), format: formatForName(name) };
}

export async function encodeFor(buf: PixelBuffer, format: SaveFormat): Promise<Uint8Array> {
  if (format.startsWith('bmp')) {
    const depth = parseInt(format.slice(3), 10) as BmpDepth;
    return encodeBMP(buf, depth);
  }
  if (format === 'gif') return encodeGIF(buf);
  buf.sync();
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob>((resolve, reject) => {
    buf.canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), mime, 0.92);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/* ---------- open ---------- */

export async function openImageFile(): Promise<LoadedImage | null> {
  if (bridge) {
    const res = await bridge.openFile();
    if (!res) return null;
    const { buffer, format } = await decodeBytes(res.bytes, res.name);
    return { buffer, name: res.name, path: res.path, format };
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bmp,.gif,.jpg,.jpeg,.png,image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const { buffer, format } = await decodeBytes(bytes, file.name);
        resolve({ buffer, name: file.name, path: null, format });
      } catch {
        resolve(null);
      }
    });
    // If the picker is cancelled we simply never resolve a file; resolve null on focus return.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function openImagePath(path: string): Promise<LoadedImage | null> {
  if (!bridge) return null;
  const res = await bridge.readFileAt(path);
  if (!res) return null;
  const { buffer, format } = await decodeBytes(res.bytes, res.name);
  return { buffer, name: res.name, path: res.path, format };
}

/* ---------- save ---------- */

export async function saveBytesAs(
  defaultName: string, bytes: Uint8Array, ext: string,
): Promise<{ path: string | null; name: string } | null> {
  if (bridge) {
    const res = await bridge.saveFileAs(defaultName, bytes, ext);
    return res ? { path: res.path, name: res.name } : null;
  }
  // Browser: download link
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { path: null, name: defaultName };
}

export async function saveBytesTo(path: string, bytes: Uint8Array): Promise<boolean> {
  if (!bridge) return false;
  return bridge.saveFileTo(path, bytes);
}

/* ---------- recent files ---------- */

const RECENT_KEY = 'xp-paint.recent';

export function recentFiles(): Array<{ name: string; path: string }> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function pushRecent(name: string, path: string | null): void {
  if (!path) return;
  const list = recentFiles().filter(r => r.path !== path);
  list.unshift({ name, path });
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 4)));
}

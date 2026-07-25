// System clipboard: Electron clipboard/nativeImage via the bridge, with an
// async Clipboard API fallback for the plain-browser build.

import { PixelBuffer } from '../core/pixelbuffer';
import { bridge } from '../platform/bridge';

function bufferToPngDataUrl(buf: PixelBuffer): string {
  buf.sync();
  return buf.canvas.toDataURL('image/png');
}

async function dataUrlToBuffer(dataUrl: string): Promise<PixelBuffer> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('clipboard decode failed'));
    img.src = dataUrl;
  });
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  return PixelBuffer.fromImageData(ctx.getImageData(0, 0, cv.width, cv.height));
}

export async function clipboardWrite(buf: PixelBuffer): Promise<void> {
  const dataUrl = bufferToPngDataUrl(buf);
  if (bridge) {
    await bridge.clipboardWriteImage(dataUrl);
    return;
  }
  const blob = await (await fetch(dataUrl)).blob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function clipboardRead(): Promise<PixelBuffer | null> {
  if (bridge) {
    const dataUrl = await bridge.clipboardReadImage();
    if (!dataUrl) return null;
    return dataUrlToBuffer(dataUrl);
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const bitmap = await createImageBitmap(blob);
      const cv = document.createElement('canvas');
      cv.width = bitmap.width;
      cv.height = bitmap.height;
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, 0, 0);
      return PixelBuffer.fromImageData(ctx.getImageData(0, 0, cv.width, cv.height));
    }
  } catch {
    return null;
  }
  return null;
}

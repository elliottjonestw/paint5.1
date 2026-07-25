import { PixelBuffer } from './pixelbuffer';

export type SaveFormat = 'bmp24' | 'bmp8' | 'bmp4' | 'bmp1' | 'png' | 'jpeg' | 'gif';

export class PaintDocument {
  buffer: PixelBuffer;
  fileName: string | null = null;   // display name, e.g. "untitled"
  filePath: string | null = null;   // full path when opened via Electron
  format: SaveFormat = 'bmp24';
  dirty = false;

  constructor(width: number, height: number) {
    this.buffer = new PixelBuffer(width, height);
    this.buffer.sync();
  }

  get displayName(): string {
    return this.fileName ?? 'untitled';
  }
}

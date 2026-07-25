// Pencil, Brush, Eraser / Color Eraser, Airbrush.

import { Tool, ToolContext, PointerInfo, BrushKind } from './tool';
import { bresenham, stampDisc, stampSquare, stampSlash } from '../core/raster';
import { PixelBuffer } from '../core/pixelbuffer';
import { CURSORS, eraserCursor } from '../ui/icons';

abstract class StrokeTool implements Tool {
  abstract readonly id: Tool['id'];
  abstract readonly hint: string;
  protected last: { x: number; y: number } | null = null;
  protected button: 'L' | 'R' = 'L';

  abstract cursor(ctx: ToolContext): string;
  protected abstract stampAt(ctx: ToolContext, x: number, y: number): void;

  protected color(ctx: ToolContext): number {
    return this.button === 'L' ? ctx.fg() : ctx.bg();
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    this.button = p.button;
    ctx.beginStroke();
    this.last = { x: p.x, y: p.y };
    this.stampAt(ctx, p.x, p.y);
    ctx.repaint();
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.last) return;
    // Continuous stroke: Bresenham between pointer samples, never raw density.
    bresenham(this.last.x, this.last.y, p.x, p.y, (x, y) => this.stampAt(ctx, x, y));
    this.last = { x: p.x, y: p.y };
    ctx.repaint();
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    if (!this.last) return;
    this.last = null;
    ctx.endStroke();
    ctx.repaint();
  }
}

export class PencilTool extends StrokeTool {
  readonly id = 'pencil' as const;
  readonly hint = 'Draws a free-form line one pixel wide.';
  cursor(): string { return CURSORS.pencil(); }
  protected stampAt(ctx: ToolContext, x: number, y: number): void {
    ctx.buf().setPixel(x, y, this.color(ctx));
  }
}

export function brushStamp(
  buf: PixelBuffer, x: number, y: number, kind: BrushKind, size: number, c: number,
): void {
  switch (kind) {
    case 'round': stampDisc(buf, x, y, size, c); break;
    case 'square': stampSquare(buf, x, y, size, c); break;
    case 'slash': stampSlash(buf, x, y, size, 1, c); break;
    case 'backslash': stampSlash(buf, x, y, size, -1, c); break;
  }
}

export class BrushTool extends StrokeTool {
  readonly id = 'brush' as const;
  readonly hint = 'Draws using a brush with the selected shape and size.';
  cursor(): string { return CURSORS.crosshair(); }
  protected stampAt(ctx: ToolContext, x: number, y: number): void {
    brushStamp(ctx.buf(), x, y, ctx.options.brushKind, ctx.options.brushSize, this.color(ctx));
  }
}

export class EraserTool extends StrokeTool {
  readonly id = 'eraser' as const;
  readonly hint = 'Erases a portion of the picture, using the selected eraser shape.';
  cursor(ctx: ToolContext): string {
    return eraserCursor(ctx.options.eraserSize, ctx.zoom());
  }
  protected stampAt(ctx: ToolContext, x: number, y: number): void {
    const buf = ctx.buf();
    const size = ctx.options.eraserSize;
    const o = Math.floor(size / 2);
    if (this.button === 'L') {
      buf.fillRect(x - o, y - o, size, size, ctx.bg());
    } else {
      // Color Eraser: only pixels matching the foreground become background.
      const fg = ctx.fg(), bg = ctx.bg();
      const x0 = Math.max(0, x - o), y0 = Math.max(0, y - o);
      const x1 = Math.min(buf.width, x - o + size), y1 = Math.min(buf.height, y - o + size);
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          if (buf.u32[yy * buf.width + xx] === fg) buf.u32[yy * buf.width + xx] = bg;
        }
      }
      if (x1 > x0 && y1 > y0) buf.touch(x0, y0, x1, y1);
    }
  }
}

export class AirbrushTool implements Tool {
  readonly id = 'airbrush' as const;
  readonly hint = 'Draws using an airbrush of the selected size.';
  private timer: number | null = null;
  private pos = { x: 0, y: 0 };
  private button: 'L' | 'R' = 'L';

  cursor(): string { return CURSORS.spray(); }

  private spray(ctx: ToolContext): void {
    const buf = ctx.buf();
    const c = this.button === 'L' ? ctx.fg() : ctx.bg();
    const r = ctx.options.airbrushSize / 2;
    const n = Math.max(6, Math.round(r * r / 4));
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.random() * r;          // linear → denser toward center
      const x = this.pos.x + Math.round(Math.cos(ang) * dist);
      const y = this.pos.y + Math.round(Math.sin(ang) * dist);
      buf.setPixel(x, y, c);
    }
    ctx.repaint();
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    this.button = p.button;
    this.pos = { x: p.x, y: p.y };
    ctx.beginStroke();
    this.spray(ctx);
    // Keeps spraying at ~10Hz even when the pointer is stationary.
    this.timer = window.setInterval(() => this.spray(ctx), 100);
  }

  onMove(_ctx: ToolContext, p: PointerInfo): void {
    this.pos = { x: p.x, y: p.y };
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    ctx.endStroke();
    ctx.repaint();
  }

  deactivate(ctx: ToolContext): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      ctx.endStroke();
    }
  }
}

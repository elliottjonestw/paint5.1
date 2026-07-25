// Select / Free-Form Select and the floating-selection state machine.
// "Transparent background" is a color-key against the current background
// color, evaluated at render/stamp time — never alpha blending.

import { Tool, ToolContext, PointerInfo } from './tool';
import { PixelBuffer } from '../core/pixelbuffer';
import { pointInPolygon } from '../core/raster';
import { CURSORS } from '../ui/icons';

export interface Rect { x: number; y: number; w: number; h: number; }

export class SelectionManager {
  /** Selection region before lifting (buffer coords). */
  rect: Rect | null = null;
  /** Free-form outline (pre-lift ants + lift mask). */
  lassoPts: Array<[number, number]> | null = null;
  /** Live lasso while dragging (ants only). */
  lassoLive: Array<[number, number]> | null = null;

  floating: PixelBuffer | null = null;
  mask: Uint8Array | null = null;
  pos = { x: 0, y: 0 };
  lifted = false;

  private renderCache: {
    canvas: HTMLCanvasElement; transparent: boolean; key: number; stamp: number;
  } | null = null;
  private stampCounter = 0;

  active(): boolean {
    return this.rect !== null || this.lifted || this.lassoLive !== null;
  }

  discard(): void {
    this.rect = null;
    this.lassoPts = null;
    this.lassoLive = null;
    this.floating = null;
    this.mask = null;
    this.lifted = false;
    this.renderCache = null;
  }

  setRect(r: Rect): void {
    this.rect = r;
    this.lassoPts = null;
    this.lassoLive = null;
  }

  setLasso(pts: Array<[number, number]>, bufW: number, bufH: number): boolean {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (y < y0) y0 = y;
      if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(bufW - 1, x1); y1 = Math.min(bufH - 1, y1);
    if (x1 - x0 < 1 || y1 - y0 < 1) return false;
    this.rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    this.lassoPts = pts;
    this.lassoLive = null;
    return true;
  }

  /** Lift the selected pixels off the canvas. Leaves bg color behind unless copying. */
  lift(buf: PixelBuffer, bgFill: number, copy: boolean): void {
    if (!this.rect) return;
    const { x, y, w, h } = this.rect;
    this.floating = buf.extract(x, y, w, h);
    if (this.lassoPts) {
      this.mask = new Uint8Array(w * h);
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          if (pointInPolygon(this.lassoPts, x + xx, y + yy)) this.mask[yy * w + xx] = 1;
        }
      }
    } else {
      this.mask = null;
    }
    if (!copy) {
      // Moving a selection leaves the background color behind, not white.
      if (this.mask) {
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            if (this.mask[yy * w + xx]) {
              buf.setPixel(x + xx, y + yy, bgFill);
            }
          }
        }
      } else {
        buf.fillRect(x, y, w, h, bgFill);
      }
    }
    this.pos = { x, y };
    this.lifted = true;
    this.stampCounter++;
  }

  /** Install pixels as a floating selection (paste, Paste From). */
  setFloating(pb: PixelBuffer, x: number, y: number): void {
    this.floating = pb;
    this.mask = null;
    this.lassoPts = null;
    this.lassoLive = null;
    this.pos = { x, y };
    this.rect = { x, y, w: pb.width, h: pb.height };
    this.lifted = true;
    this.stampCounter++;
    this.renderCache = null;
  }

  /** Floating pixels were mutated in place (invert, flip, stretch of a selection). */
  markDirty(): void {
    this.stampCounter++;
    this.renderCache = null;
    if (this.floating) {
      this.rect = { x: this.pos.x, y: this.pos.y, w: this.floating.width, h: this.floating.height };
    }
  }

  /** Stamp the floating pixels into the buffer at the current position. */
  stamp(buf: PixelBuffer, transparent: boolean, key: number): void {
    if (!this.floating) return;
    buf.blit(this.floating, this.pos.x, this.pos.y, transparent ? key : undefined, this.mask ?? undefined);
  }

  /** Canvas for display compositing, with mask/key pixels knocked out. */
  renderFor(transparent: boolean, key: number): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    if (!this.lifted || !this.floating) return null;
    const c = this.renderCache;
    if (!c || c.transparent !== transparent || c.key !== key || c.stamp !== this.stampCounter) {
      const f = this.floating;
      const img = new ImageData(f.width, f.height);
      const src = new Uint32Array(f.data.buffer);
      const dst = new Uint32Array(img.data.buffer);
      for (let i = 0; i < src.length; i++) {
        if (this.mask && !this.mask[i]) continue;
        if (transparent && src[i] === key) continue;
        dst[i] = src[i];
      }
      const canvas = document.createElement('canvas');
      canvas.width = f.width;
      canvas.height = f.height;
      canvas.getContext('2d')!.putImageData(img, 0, 0);
      this.renderCache = { canvas, transparent, key, stamp: this.stampCounter };
    }
    return { canvas: this.renderCache!.canvas, x: this.pos.x, y: this.pos.y };
  }

  /** Ants geometry for the view. */
  antsShape():
    | { kind: 'rect'; x: number; y: number; w: number; h: number }
    | { kind: 'poly'; pts: Array<[number, number]> }
    | null {
    if (this.lassoLive && this.lassoLive.length >= 2) {
      return { kind: 'poly', pts: this.lassoLive };
    }
    if (this.lifted && this.floating) {
      return { kind: 'rect', x: this.pos.x, y: this.pos.y, w: this.floating.width, h: this.floating.height };
    }
    if (this.rect) {
      if (this.lassoPts) return { kind: 'poly', pts: this.lassoPts };
      return { kind: 'rect', ...this.rect };
    }
    return null;
  }

  contains(x: number, y: number): boolean {
    if (this.lifted && this.floating) {
      return x >= this.pos.x && y >= this.pos.y &&
        x < this.pos.x + this.floating.width && y < this.pos.y + this.floating.height;
    }
    if (!this.rect) return false;
    if (this.lassoPts) return pointInPolygon(this.lassoPts, x, y);
    return x >= this.rect.x && y >= this.rect.y &&
      x < this.rect.x + this.rect.w && y < this.rect.y + this.rect.h;
  }
}

abstract class SelectBase implements Tool {
  abstract readonly id: Tool['id'];
  abstract readonly hint: string;
  protected abstract freeform: boolean;
  private mode: 'idle' | 'marquee' | 'lasso' | 'moving' = 'idle';
  private marqueeStart = { x: 0, y: 0 };
  private lassoBuf: Array<[number, number]> = [];
  private moveOffset = { x: 0, y: 0 };

  cursor(): string { return CURSORS.crosshair(); }

  private clampPt(ctx: ToolContext, x: number, y: number, forRect: boolean): [number, number] {
    const buf = ctx.buf();
    const mx = forRect ? buf.width : buf.width - 1;
    const my = forRect ? buf.height : buf.height - 1;
    return [Math.max(0, Math.min(mx, x)), Math.max(0, Math.min(my, y))];
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    const sel = ctx.selection();
    if (sel.active() && sel.contains(p.x, p.y)) {
      // Begin moving (or Option-copying) the selection.
      if (!sel.lifted) {
        ctx.beginStroke();
        sel.lift(ctx.buf(), ctx.bg(), p.alt);
      } else if (p.alt) {
        // Option-drag on a floating selection stamps a copy where it sits.
        sel.stamp(ctx.buf(), ctx.options.selectionTransparent, ctx.bg());
      }
      this.mode = 'moving';
      this.moveOffset = { x: p.x - sel.pos.x, y: p.y - sel.pos.y };
      ctx.repaint();
      return;
    }
    // Click-away: anchor any existing selection, then start a new one.
    if (sel.active()) ctx.anchorSelection();
    if (this.freeform) {
      this.mode = 'lasso';
      this.lassoBuf = [this.clampPt(ctx, p.x, p.y, false)];
      sel.lassoLive = this.lassoBuf;
    } else {
      this.mode = 'marquee';
      const [x, y] = this.clampPt(ctx, p.x, p.y, true);
      this.marqueeStart = { x, y };
      sel.rect = null;
    }
    ctx.renderOverlay();
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    const sel = ctx.selection();
    if (this.mode === 'marquee') {
      const [x, y] = this.clampPt(ctx, p.x, p.y, true);
      const x0 = Math.min(this.marqueeStart.x, x), y0 = Math.min(this.marqueeStart.y, y);
      const x1 = Math.max(this.marqueeStart.x, x), y1 = Math.max(this.marqueeStart.y, y);
      sel.rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      ctx.setStatusSize(`${x1 - x0}x${y1 - y0}`);
      ctx.renderOverlay();
    } else if (this.mode === 'lasso') {
      this.lassoBuf.push(this.clampPt(ctx, p.x, p.y, false));
      ctx.renderOverlay();
    } else if (this.mode === 'moving') {
      if (p.shift && sel.lifted) {
        // Shift-drag smears: stamp repeatedly along the drag path.
        sel.stamp(ctx.buf(), ctx.options.selectionTransparent, ctx.bg());
      }
      sel.pos = { x: p.x - this.moveOffset.x, y: p.y - this.moveOffset.y };
      ctx.repaint();
    } else {
      // Hover: show the move cursor over the selection like Paint did.
      ctx.setCursor(sel.active() && sel.contains(p.x, p.y) ? 'move' : CURSORS.crosshair());
    }
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    const sel = ctx.selection();
    if (this.mode === 'marquee') {
      ctx.setStatusSize('');
      if (!sel.rect || sel.rect.w < 1 || sel.rect.h < 1) {
        sel.discard();
      }
      ctx.renderOverlay();
    } else if (this.mode === 'lasso') {
      sel.lassoLive = null;
      if (!sel.setLasso(this.lassoBuf, ctx.buf().width, ctx.buf().height)) {
        sel.discard();
      }
      this.lassoBuf = [];
      ctx.renderOverlay();
    }
    this.mode = 'idle';
  }

  onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
    const sel = ctx.selection();
    if (!sel.active()) return false;
    if (e.key === 'Escape') {
      ctx.anchorSelection();
      return true;
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    if (arrows[e.key]) {
      if (!sel.lifted) {
        ctx.beginStroke();
        sel.lift(ctx.buf(), ctx.bg(), false);
      }
      sel.pos = { x: sel.pos.x + arrows[e.key][0], y: sel.pos.y + arrows[e.key][1] };
      ctx.repaint();
      return true;
    }
    return false;
  }

  deactivate(ctx: ToolContext): void {
    if (ctx.selection().active()) ctx.anchorSelection();
    this.mode = 'idle';
  }
}

export class SelectTool extends SelectBase {
  readonly id = 'select' as const;
  readonly hint = 'Selects a rectangular part of the picture to move, copy, or edit.';
  protected freeform = false;
}

export class FreeSelectTool extends SelectBase {
  readonly id = 'freeselect' as const;
  readonly hint = 'Selects a free-form part of the picture to move, copy, or edit.';
  protected freeform = true;
}

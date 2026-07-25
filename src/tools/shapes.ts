// Line, Rectangle, Rounded Rectangle, Ellipse, Curve, Polygon.
// Previews are real pixels drawn into the buffer, restored from the stroke
// snapshot between frames — exactly how Paint behaved.

import { Tool, ToolContext, PointerInfo, constrain45, constrainSquare } from './tool';
import {
  thickLine, rectOutline, rectFill, ellipseOutline, ellipseFill, roundRect,
  polygonOutline, polygonFill, bezier,
} from '../core/raster';
import { CURSORS } from '../ui/icons';

/** Union of the previous preview's bounds, padded for pen width. */
class DirtyTracker {
  private prev: { x: number; y: number; w: number; h: number } | null = null;

  restorePrev(ctx: ToolContext): void {
    if (this.prev) {
      ctx.restoreRect(this.prev.x, this.prev.y, this.prev.w, this.prev.h);
    }
  }

  mark(x0: number, y0: number, x1: number, y1: number, pad: number): void {
    const xa = Math.min(x0, x1) - pad, ya = Math.min(y0, y1) - pad;
    const xb = Math.max(x0, x1) + pad, yb = Math.max(y0, y1) + pad;
    this.prev = { x: xa, y: ya, w: xb - xa + 1, h: yb - ya + 1 };
  }

  markPts(pts: Array<[number, number]>, pad: number): void {
    let xa = Infinity, ya = Infinity, xb = -Infinity, yb = -Infinity;
    for (const [x, y] of pts) {
      if (x < xa) xa = x; if (y < ya) ya = y;
      if (x > xb) xb = x; if (y > yb) yb = y;
    }
    this.prev = { x: xa - pad, y: ya - pad, w: xb - xa + 1 + 2 * pad, h: yb - ya + 1 + 2 * pad };
  }

  reset(): void { this.prev = null; }
}

abstract class DragShapeTool implements Tool {
  abstract readonly id: Tool['id'];
  abstract readonly hint: string;
  protected start: { x: number; y: number } | null = null;
  protected button: 'L' | 'R' = 'L';
  protected dirty = new DirtyTracker();

  cursor(): string { return CURSORS.crosshair(); }

  /** Outline color for this drag (fg on left, bg on right). */
  protected oc(ctx: ToolContext): number { return this.button === 'L' ? ctx.fg() : ctx.bg(); }
  /** Fill color for this drag (bg on left, fg on right). */
  protected fc(ctx: ToolContext): number { return this.button === 'L' ? ctx.bg() : ctx.fg(); }

  protected abstract draw(ctx: ToolContext, x0: number, y0: number, x1: number, y1: number): void;
  protected constrainEnd(x0: number, y0: number, x1: number, y1: number): [number, number] {
    return constrainSquare(x0, y0, x1, y1);
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    this.button = p.button;
    this.start = { x: p.x, y: p.y };
    this.dirty.reset();
    ctx.beginStroke();
    this.draw(ctx, p.x, p.y, p.x, p.y);
    this.dirty.mark(p.x, p.y, p.x, p.y, ctx.options.lineWidth + 2);
    ctx.repaint();
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.start) return;
    let x1 = p.x, y1 = p.y;
    if (p.shift) [x1, y1] = this.constrainEnd(this.start.x, this.start.y, x1, y1);
    this.dirty.restorePrev(ctx);
    this.draw(ctx, this.start.x, this.start.y, x1, y1);
    this.dirty.mark(this.start.x, this.start.y, x1, y1, ctx.options.lineWidth + 2);
    ctx.setStatusSize(`${Math.abs(x1 - this.start.x) + 1}x${Math.abs(y1 - this.start.y) + 1}`);
    ctx.repaint();
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    if (!this.start) return;
    this.start = null;
    ctx.setStatusSize('');
    ctx.endStroke();
    ctx.repaint();
  }

  onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.start) {
      this.start = null;
      ctx.cancelStroke();
      ctx.setStatusSize('');
      ctx.repaint();
      return true;
    }
    return false;
  }
}

export class LineTool extends DragShapeTool {
  readonly id = 'line' as const;
  readonly hint = 'Draws a straight line with the selected line width.';
  protected constrainEnd(x0: number, y0: number, x1: number, y1: number): [number, number] {
    return constrain45(x0, y0, x1, y1);
  }
  protected draw(ctx: ToolContext, x0: number, y0: number, x1: number, y1: number): void {
    thickLine(ctx.buf(), x0, y0, x1, y1, ctx.options.lineWidth, this.oc(ctx));
  }
}

export class RectTool extends DragShapeTool {
  readonly id = 'rect' as const;
  readonly hint = 'Draws a rectangle with the selected fill style.';
  protected draw(ctx: ToolContext, x0: number, y0: number, x1: number, y1: number): void {
    const s = ctx.options.fillStyle;
    if (s !== 'outline') rectFill(ctx.buf(), x0, y0, x1, y1, this.fc(ctx));
    if (s !== 'fill') rectOutline(ctx.buf(), x0, y0, x1, y1, ctx.options.lineWidth, this.oc(ctx));
  }
}

export class RoundRectTool extends DragShapeTool {
  readonly id = 'roundrect' as const;
  readonly hint = 'Draws a rounded rectangle with the selected fill style.';
  protected draw(ctx: ToolContext, x0: number, y0: number, x1: number, y1: number): void {
    const s = ctx.options.fillStyle;
    roundRect(
      ctx.buf(), x0, y0, x1, y1, ctx.options.lineWidth,
      s !== 'fill' ? this.oc(ctx) : null,
      s !== 'outline' ? this.fc(ctx) : null,
    );
  }
}

export class EllipseTool extends DragShapeTool {
  readonly id = 'ellipse' as const;
  readonly hint = 'Draws an ellipse with the selected fill style.';
  protected draw(ctx: ToolContext, x0: number, y0: number, x1: number, y1: number): void {
    const s = ctx.options.fillStyle;
    if (s !== 'outline') ellipseFill(ctx.buf(), x0, y0, x1, y1, this.fc(ctx));
    if (s !== 'fill') ellipseOutline(ctx.buf(), x0, y0, x1, y1, ctx.options.lineWidth, this.oc(ctx));
  }
}

/** Curve: initial line drag, then exactly two control-point adjustments. */
export class CurveTool implements Tool {
  readonly id = 'curve' as const;
  readonly hint = 'Draws a curved line with the selected line width.';
  private phase: 0 | 1 | 2 = 0;
  private p0: [number, number] = [0, 0];
  private p3: [number, number] = [0, 0];
  private c1: [number, number] = [0, 0];
  private c2: [number, number] = [0, 0];
  private button: 'L' | 'R' = 'L';
  private dragging = false;
  private dirty = new DirtyTracker();

  cursor(): string { return CURSORS.crosshair(); }

  private color(ctx: ToolContext): number {
    return this.button === 'L' ? ctx.fg() : ctx.bg();
  }

  private allPts(): Array<[number, number]> {
    return [this.p0, this.p3, this.c1, this.c2];
  }

  private render(ctx: ToolContext): void {
    this.dirty.restorePrev(ctx);
    const w = ctx.options.lineWidth, c = this.color(ctx);
    if (this.phase === 0) {
      thickLine(ctx.buf(), this.p0[0], this.p0[1], this.p3[0], this.p3[1], w, c);
    } else if (this.phase === 1) {
      bezier(ctx.buf(), this.p0, this.c1, this.c1, this.p3, w, c);
    } else {
      bezier(ctx.buf(), this.p0, this.c1, this.c2, this.p3, w, c);
    }
    this.dirty.markPts(this.allPts(), w + 2);
    ctx.repaint();
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    this.dragging = true;
    if (this.phase === 0) {
      this.button = p.button;
      ctx.beginStroke();
      this.p0 = [p.x, p.y];
      this.p3 = [p.x, p.y];
      this.c1 = [p.x, p.y];
      this.c2 = [p.x, p.y];
      this.dirty.reset();
    } else if (this.phase === 1) {
      this.c1 = [p.x, p.y];
      this.c2 = [p.x, p.y];
    } else {
      this.c2 = [p.x, p.y];
    }
    this.render(ctx);
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.dragging) return;
    if (this.phase === 0) {
      let x1 = p.x, y1 = p.y;
      if (p.shift) [x1, y1] = constrain45(this.p0[0], this.p0[1], x1, y1);
      this.p3 = [x1, y1];
      this.c1 = [...this.p0];
      this.c2 = [x1, y1];
    } else if (this.phase === 1) {
      this.c1 = [p.x, p.y];
      this.c2 = [p.x, p.y];
    } else {
      this.c2 = [p.x, p.y];
    }
    this.render(ctx);
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.phase === 0) {
      this.phase = 1;
    } else if (this.phase === 1) {
      this.phase = 2;
    } else {
      // Second adjustment done: commit.
      this.phase = 0;
      ctx.endStroke();
      ctx.repaint();
    }
  }

  onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.phase !== 0) {
      this.phase = 0;
      this.dragging = false;
      ctx.cancelStroke();
      ctx.repaint();
      return true;
    }
    return false;
  }

  deactivate(ctx: ToolContext): void {
    // Switching tools commits the curve as currently shown.
    if (this.phase !== 0 || this.dragging) {
      this.phase = 0;
      this.dragging = false;
      ctx.endStroke();
      ctx.repaint();
    }
  }
}

/** Polygon: drag the first edge, click to add vertices, double-click to close. */
export class PolygonTool implements Tool {
  readonly id = 'polygon' as const;
  readonly hint = 'Draws a polygon with the selected fill style.';
  private pts: Array<[number, number]> = [];
  private button: 'L' | 'R' = 'L';
  private dragging = false;
  private cur: [number, number] | null = null;
  private dirty = new DirtyTracker();

  cursor(): string { return CURSORS.crosshair(); }

  private oc(ctx: ToolContext): number { return this.button === 'L' ? ctx.fg() : ctx.bg(); }
  private fc(ctx: ToolContext): number { return this.button === 'L' ? ctx.bg() : ctx.fg(); }

  private previewWidth(ctx: ToolContext): number {
    return ctx.options.fillStyle === 'fill' ? 1 : ctx.options.lineWidth;
  }

  private renderPreview(ctx: ToolContext): void {
    this.dirty.restorePrev(ctx);
    const pts = this.cur ? [...this.pts, this.cur] : this.pts;
    if (pts.length >= 2) {
      polygonOutline(ctx.buf(), pts, this.previewWidth(ctx), this.oc(ctx), false);
    }
    this.dirty.markPts(pts, this.previewWidth(ctx) + 2);
    ctx.repaint();
  }

  private close(ctx: ToolContext): void {
    if (this.pts.length < 2) {
      this.pts = [];
      this.cur = null;
      ctx.cancelStroke();
      ctx.repaint();
      return;
    }
    this.dirty.restorePrev(ctx);
    const s = ctx.options.fillStyle;
    if (s !== 'outline') polygonFill(ctx.buf(), this.pts, this.fc(ctx));
    if (s !== 'fill') polygonOutline(ctx.buf(), this.pts, ctx.options.lineWidth, this.oc(ctx), true);
    this.pts = [];
    this.cur = null;
    this.dirty.reset();
    ctx.endStroke();
    ctx.repaint();
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    if (this.pts.length === 0) {
      this.button = p.button;
      ctx.beginStroke();
      this.pts.push([p.x, p.y]);
      this.dirty.reset();
    } else {
      // Clicking at the origin closes the polygon.
      const [ox, oy] = this.pts[0];
      if (Math.abs(p.x - ox) <= 2 && Math.abs(p.y - oy) <= 2) {
        this.close(ctx);
        return;
      }
    }
    this.dragging = true;
    this.cur = [p.x, p.y];
    this.renderPreview(ctx);
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.dragging || this.pts.length === 0) return;
    let x = p.x, y = p.y;
    if (p.shift) {
      const last = this.pts[this.pts.length - 1];
      [x, y] = constrain45(last[0], last[1], x, y);
    }
    this.cur = [x, y];
    this.renderPreview(ctx);
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    if (!this.dragging || this.pts.length === 0) return;
    this.dragging = false;
    if (this.cur) this.pts.push(this.cur);
    this.cur = null;
  }

  onDblClick(ctx: ToolContext, _p: PointerInfo): void {
    if (this.pts.length > 0) this.close(ctx);
  }

  onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.pts.length > 0) {
      this.pts = [];
      this.cur = null;
      this.dragging = false;
      ctx.cancelStroke();
      ctx.repaint();
      return true;
    }
    return false;
  }

  deactivate(ctx: ToolContext): void {
    if (this.pts.length > 0) this.close(ctx);
  }
}

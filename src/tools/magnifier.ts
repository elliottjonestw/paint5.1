import { Tool, ToolContext, PointerInfo } from './tool';
import { CURSORS } from '../ui/icons';

export class MagnifierTool implements Tool {
  readonly id = 'magnifier' as const;
  readonly hint = 'Changes the magnification.';
  private hover: { x: number; y: number } | null = null;

  cursor(): string { return CURSORS.magnifier(); }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button === 'R') {
      ctx.setZoom(1);
      return;
    }
    const target = ctx.options.magnifierZoom;
    if (ctx.zoom() === 1 && target > 1) {
      ctx.setZoom(target, { x: p.x, y: p.y });
    } else if (ctx.zoom() !== 1) {
      ctx.setZoom(1);
    } else {
      ctx.setZoom(target, { x: p.x, y: p.y });
    }
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    this.hover = { x: p.x, y: p.y };
    ctx.renderOverlay();
  }

  onUp(): void { /* nothing */ }

  drawOverlay(
    ctx: ToolContext, octx: CanvasRenderingContext2D,
    toCss: (bx: number, by: number) => { x: number; y: number },
  ): void {
    // At 1x, preview the region that the viewport would show when zoomed.
    if (!this.hover || ctx.zoom() !== 1) return;
    const target = ctx.options.magnifierZoom;
    if (target <= 1) return;
    const buf = ctx.buf();
    const viewW = octx.canvas.clientWidth || octx.canvas.width;
    const viewH = octx.canvas.clientHeight || octx.canvas.height;
    const w = Math.min(buf.width, Math.floor(viewW / target));
    const h = Math.min(buf.height, Math.floor(viewH / target));
    let x = Math.max(0, Math.min(buf.width - w, this.hover.x - Math.floor(w / 2)));
    let y = Math.max(0, Math.min(buf.height - h, this.hover.y - Math.floor(h / 2)));
    const a = toCss(x, y);
    const b = toCss(x + w, y + h);
    octx.strokeStyle = '#000000';
    octx.lineWidth = 1;
    octx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x - 1, b.y - a.y - 1);
  }

  deactivate(): void {
    this.hover = null;
  }
}

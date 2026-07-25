import { Tool, ToolContext, PointerInfo } from './tool';
import { u32ToHex } from '../core/color';
import { CURSORS } from '../ui/icons';

/** Pick Color: samples one pixel, then reverts to the previously selected tool. */
export class PickerTool implements Tool {
  readonly id = 'picker' as const;
  readonly hint = 'Picks up a color from the picture for drawing.';
  private down = false;
  private button: 'L' | 'R' = 'L';

  cursor(): string { return CURSORS.picker(); }

  private sample(ctx: ToolContext, p: PointerInfo): void {
    const buf = ctx.buf();
    if (p.x < 0 || p.y < 0 || p.x >= buf.width || p.y >= buf.height) return;
    const hex = u32ToHex(buf.getPixel(p.x, p.y));
    if (this.button === 'L') ctx.setFgHex(hex);
    else ctx.setBgHex(hex);
  }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    this.down = true;
    this.button = p.button;
    this.sample(ctx, p);
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    if (this.down) this.sample(ctx, p);
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    this.down = false;
    ctx.selectTool(ctx.previousToolId());
  }
}

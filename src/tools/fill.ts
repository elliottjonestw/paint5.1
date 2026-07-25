import { Tool, ToolContext, PointerInfo } from './tool';
import { floodFill } from '../core/flood';
import { CURSORS } from '../ui/icons';

export class FillTool implements Tool {
  readonly id = 'fill' as const;
  readonly hint = 'Fills an area with the current drawing color.';

  cursor(): string { return CURSORS.fill(); }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    const c = p.button === 'L' ? ctx.fg() : ctx.bg();
    ctx.beginStroke();
    const changed = floodFill(ctx.buf(), p.x, p.y, c);
    if (changed) {
      ctx.endStroke();
      ctx.repaint();
    } else {
      ctx.cancelStroke();
    }
  }

  onMove(): void { /* nothing */ }
  onUp(): void { /* nothing */ }
}

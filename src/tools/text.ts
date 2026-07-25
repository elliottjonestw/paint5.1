// Text tool. Live editing happens in a DOM overlay; on commit the text is
// rendered to a scratch canvas and the alpha channel is thresholded (>=128 →
// solid foreground, else untouched) so committed glyphs have hard edges only.

import { Tool, ToolContext, PointerInfo } from './tool';
import { u32ToHex } from '../core/color';
import { CURSORS } from '../ui/icons';
import { FontBar } from '../ui/fontbar';

const MARGIN = 3;

interface FrameRect { x: number; y: number; w: number; h: number; }

export class TextTool implements Tool {
  readonly id = 'text' as const;
  readonly hint = 'Inserts text into the picture.';
  private fontbar: FontBar;
  private getExtent: () => HTMLElement;
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private frame: FrameRect | null = null;
  private editor: HTMLDivElement | null = null;
  private ctxRef: ToolContext | null = null;

  constructor(fontbar: FontBar, getExtent: () => HTMLElement) {
    this.fontbar = fontbar;
    this.getExtent = getExtent;
    fontbar.onChange = () => {
      this.applyEditorStyle();
    };
  }

  cursor(): string { return CURSORS.ibeam(); }

  get editing(): boolean { return this.editor !== null; }

  onDown(ctx: ToolContext, p: PointerInfo): void {
    this.ctxRef = ctx;
    if (this.editor) {
      this.commit(ctx);
    }
    this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    ctx.renderOverlay();
  }

  onMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.drag) return;
    this.drag.x1 = p.x;
    this.drag.y1 = p.y;
    ctx.setStatusSize(`${Math.abs(this.drag.x1 - this.drag.x0) + 1}x${Math.abs(this.drag.y1 - this.drag.y0) + 1}`);
    ctx.renderOverlay();
  }

  onUp(ctx: ToolContext, _p: PointerInfo): void {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    ctx.setStatusSize('');
    const buf = ctx.buf();
    let x0 = Math.max(0, Math.min(d.x0, d.x1));
    let y0 = Math.max(0, Math.min(d.y0, d.y1));
    let x1 = Math.min(buf.width, Math.max(d.x0, d.x1));
    let y1 = Math.min(buf.height, Math.max(d.y0, d.y1));
    if (x1 - x0 < 8 || y1 - y0 < 8) {
      ctx.renderOverlay();
      return;
    }
    this.frame = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    this.openEditor(ctx);
    ctx.renderOverlay();
  }

  drawOverlay(
    _ctx: ToolContext, octx: CanvasRenderingContext2D,
    toCss: (bx: number, by: number) => { x: number; y: number },
  ): void {
    if (!this.drag) return;
    const a = toCss(Math.min(this.drag.x0, this.drag.x1), Math.min(this.drag.y0, this.drag.y1));
    const b = toCss(Math.max(this.drag.x0, this.drag.x1), Math.max(this.drag.y0, this.drag.y1));
    octx.strokeStyle = '#808080';
    octx.lineWidth = 1;
    octx.setLineDash([2, 2]);
    octx.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x - 1, b.y - a.y - 1);
    octx.setLineDash([]);
  }

  /* ---------- editor ---------- */

  private openEditor(ctx: ToolContext): void {
    const div = document.createElement('div');
    div.id = 'text-editor';
    div.contentEditable = 'plaintext-only';
    this.editor = div;
    this.getExtent().appendChild(div);
    this.applyEditorStyle();
    this.fontbar.show();
    div.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        if (this.ctxRef) this.commit(this.ctxRef);
      }
    });
    div.addEventListener('pointerdown', e => e.stopPropagation());
    setTimeout(() => div.focus(), 0);
  }

  /** Reposition/restyle the editor (also called when zoom changes mid-edit). */
  applyEditorStyle(): void {
    if (!this.editor || !this.frame || !this.ctxRef) return;
    const ctx = this.ctxRef;
    const z = ctx.zoom();
    const f = this.frame;
    const st = this.editor.style;
    st.left = `${MARGIN + f.x * z}px`;
    st.top = `${MARGIN + f.y * z}px`;
    st.width = `${f.w}px`;
    st.height = `${f.h}px`;
    st.transform = `scale(${z})`;
    const px = this.fontbar.sizePx();
    st.font = this.fontbar.cssFont(px);
    st.lineHeight = `${Math.round(px * 1.2)}px`;
    st.textDecoration = this.fontbar.style.underline ? 'underline' : 'none';
    st.color = u32ToHex(ctx.fg());
    st.background = ctx.options.selectionTransparent ? 'transparent' : u32ToHex(ctx.bg());
    (st as CSSStyleDeclaration & { writingMode: string }).writingMode =
      this.fontbar.style.vertical ? 'vertical-rl' : 'horizontal-tb';
  }

  /* ---------- commit ---------- */

  commit(ctx: ToolContext): void {
    if (!this.editor || !this.frame) return;
    const text = this.editor.innerText.replace(/\n$/, '');
    const frame = this.frame;
    this.editor.remove();
    this.editor = null;
    this.frame = null;
    this.fontbar.hide();
    if (text.trim() === '' && ctx.options.selectionTransparent) return;

    ctx.beginStroke();
    const buf = ctx.buf();
    const opaque = !ctx.options.selectionTransparent;
    if (opaque) {
      buf.fillRect(frame.x, frame.y, frame.w, frame.h, ctx.bg());
    }
    if (text !== '') {
      const vertical = this.fontbar.style.vertical;
      const w = vertical ? frame.h : frame.w;
      const h = vertical ? frame.w : frame.h;
      const alpha = this.rasterizeText(text, w, h);
      const fg = ctx.fg();
      // Threshold alpha: >=128 becomes solid foreground; hard edges only.
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (alpha[y * w + x] < 128) continue;
          if (vertical) {
            // rotate 90° CW into the frame
            buf.setPixel(frame.x + (h - 1 - y), frame.y + x, fg);
          } else {
            buf.setPixel(frame.x + x, frame.y + y, fg);
          }
        }
      }
    }
    ctx.endStroke();
    ctx.repaint();
  }

  /** Render wrapped text into a scratch canvas; returns its alpha channel. */
  private rasterizeText(text: string, w: number, h: number): Uint8ClampedArray {
    const scratch = document.createElement('canvas');
    scratch.width = Math.max(1, w);
    scratch.height = Math.max(1, h);
    const sctx = scratch.getContext('2d')!;
    const px = this.fontbar.sizePx();
    const lineH = Math.round(px * 1.2);
    sctx.font = this.fontbar.cssFont(px);
    sctx.fillStyle = '#000';
    sctx.textBaseline = 'top';

    const lines: string[] = [];
    for (const para of text.split('\n')) {
      if (para === '') { lines.push(''); continue; }
      const words = para.split(/(\s+)/);
      let cur = '';
      for (const word of words) {
        const attempt = cur + word;
        if (sctx.measureText(attempt).width <= w || cur === '') {
          cur = attempt;
        } else {
          lines.push(cur);
          cur = word.trimStart();
          // Break overlong words per character.
          while (sctx.measureText(cur).width > w && cur.length > 1) {
            let i = 1;
            while (i < cur.length && sctx.measureText(cur.slice(0, i + 1)).width <= w) i++;
            lines.push(cur.slice(0, i));
            cur = cur.slice(i);
          }
        }
      }
      lines.push(cur);
    }

    let y = 0;
    for (const ln of lines) {
      if (y >= h) break;
      sctx.fillText(ln, 0, y);
      if (this.fontbar.style.underline && ln.length > 0) {
        const tw = Math.min(w, Math.ceil(sctx.measureText(ln).width));
        sctx.fillRect(0, Math.min(h - 1, y + px), tw, Math.max(1, Math.round(px / 14)));
      }
      y += lineH;
    }

    const img = sctx.getImageData(0, 0, scratch.width, scratch.height);
    const alpha = new Uint8ClampedArray(scratch.width * scratch.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
    return alpha;
  }

  onKey(ctx: ToolContext, e: KeyboardEvent): boolean {
    if (this.editor && e.key === 'Escape') {
      this.commit(ctx);
      return true;
    }
    return false;
  }

  deactivate(ctx: ToolContext): void {
    if (this.editor) this.commit(ctx);
    this.drag = null;
    this.fontbar.hide();
  }
}

// The tool-options pane beneath the tool box. Contents swap per tool.
// Selected options render inverted (white glyph on the highlight blue).

import { ToolId, ToolOptions, BrushKind } from '../tools/tool';

type Changed = () => void;

function cell(w: number, h: number, selected: boolean,
  draw: (ctx: CanvasRenderingContext2D, fgColor: string) => void,
  onClick: () => void): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'opt-cell' + (selected ? ' selected' : '');
  div.style.width = `${w}px`;
  div.style.height = `${h}px`;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  draw(ctx, selected ? '#FFFFFF' : '#000000');
  div.appendChild(cv);
  div.addEventListener('pointerdown', onClick);
  return div;
}

/** Deterministic pseudo-random spray pattern for the airbrush option icons. */
function sprayDots(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const n = Math.round(r * r / 2.2);
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = rand() * r;
    ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1, 1);
  }
}

export class OptionsPane {
  private el: HTMLElement;
  private options: ToolOptions;
  private changed: Changed;

  constructor(el: HTMLElement, options: ToolOptions, changed: Changed) {
    this.el = el;
    this.options = options;
    this.changed = changed;
  }

  render(tool: ToolId): void {
    const el = this.el;
    el.innerHTML = '';
    el.style.gridTemplateColumns = '';
    el.style.gap = '1px';
    const o = this.options;
    const redraw = () => { this.render(tool); this.changed(); };

    switch (tool) {
      case 'select':
      case 'freeselect':
      case 'text': {
        // Opaque / transparent background modes.
        const drawIcon = (transparent: boolean) =>
          (ctx: CanvasRenderingContext2D, fg: string) => {
            // back shape: teal square
            ctx.fillStyle = '#008080';
            ctx.fillRect(6, 3, 14, 10);
            // front "sticker": red diagonal cross, optionally on a white card
            if (!transparent) {
              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(16, 6, 14, 10);
            }
            ctx.strokeStyle = '#FF0000';
            ctx.fillStyle = '#FF0000';
            for (let i = 0; i < 8; i++) {
              ctx.fillRect(18 + i, 7 + i, 1, 1);
              ctx.fillRect(25 - i, 7 + i, 1, 1);
            }
            ctx.strokeStyle = fg;
            ctx.strokeRect(0.5, 0.5, 35, 15);
          };
        el.appendChild(cell(36, 17, !o.selectionTransparent, drawIcon(false), () => {
          o.selectionTransparent = false;
          redraw();
        }));
        el.appendChild(cell(36, 17, o.selectionTransparent, drawIcon(true), () => {
          o.selectionTransparent = true;
          redraw();
        }));
        break;
      }

      case 'eraser': {
        for (const size of [4, 6, 8, 10]) {
          el.appendChild(cell(36, 13, o.eraserSize === size, (ctx, fg) => {
            ctx.fillStyle = fg;
            ctx.fillRect(Math.floor((36 - size) / 2), Math.floor((13 - size) / 2), size, size);
          }, () => { o.eraserSize = size; redraw(); }));
        }
        break;
      }

      case 'magnifier': {
        for (const z of [1, 2, 6, 8]) {
          el.appendChild(cell(36, 13, o.magnifierZoom === z, (ctx, fg) => {
            ctx.fillStyle = fg;
            ctx.font = '10px Tahoma, Verdana, sans-serif';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${z}x`, 12, 7);
          }, () => { o.magnifierZoom = z; redraw(); }));
        }
        break;
      }

      case 'brush': {
        el.style.gridTemplateColumns = '15px 15px 15px';
        const rows: Array<[BrushKind, number[]]> = [
          ['round', [8, 5, 2]],
          ['square', [8, 5, 2]],
          ['slash', [8, 5, 2]],
          ['backslash', [8, 5, 2]],
        ];
        for (const [kind, sizes] of rows) {
          for (const size of sizes) {
            const sel = o.brushKind === kind && o.brushSize === size;
            el.appendChild(cell(15, 13, sel, (ctx, fg) => {
              ctx.fillStyle = fg;
              const cx = 7, cy = 6;
              if (kind === 'round') {
                const r = size / 2;
                for (let y = -4; y <= 4; y++) {
                  for (let x = -4; x <= 4; x++) {
                    if ((x + 0.5) ** 2 + (y + 0.5) ** 2 <= r * r) ctx.fillRect(cx + x, cy + y, 1, 1);
                  }
                }
              } else if (kind === 'square') {
                ctx.fillRect(cx - Math.floor(size / 2), cy - Math.floor(size / 2), size, size);
              } else {
                const dir = kind === 'slash' ? 1 : -1;
                const half = Math.floor(size / 2);
                for (let i = -half; i < size - half; i++) {
                  ctx.fillRect(cx + i, cy - i * dir, 1, 1);
                }
              }
            }, () => { o.brushKind = kind; o.brushSize = size; redraw(); }));
          }
        }
        break;
      }

      case 'airbrush': {
        for (const size of [8, 16, 24]) {
          const h = size >= 24 ? 24 : 16;
          el.appendChild(cell(36, h, o.airbrushSize === size, (ctx, fg) => {
            sprayDots(ctx, 18, h / 2, size / 2, fg);
          }, () => { o.airbrushSize = size; redraw(); }));
        }
        break;
      }

      case 'line':
      case 'curve': {
        for (let w = 1; w <= 5; w++) {
          el.appendChild(cell(36, 9, o.lineWidth === w, (ctx, fg) => {
            ctx.fillStyle = fg;
            ctx.fillRect(3, Math.floor((9 - w) / 2), 30, w);
          }, () => { o.lineWidth = w; redraw(); }));
        }
        break;
      }

      case 'rect':
      case 'roundrect':
      case 'ellipse':
      case 'polygon': {
        const styles: Array<ToolOptions['fillStyle']> = ['outline', 'both', 'fill'];
        for (const s of styles) {
          el.appendChild(cell(36, 17, o.fillStyle === s, (ctx, fg) => {
            const stroke = fg === '#FFFFFF' ? '#FFFFFF' : '#000000';
            const fill = fg === '#FFFFFF' ? '#C0C0C0' : '#808080';
            if (s !== 'outline') {
              ctx.fillStyle = fill;
              ctx.fillRect(7, 3, 22, 11);
            }
            if (s !== 'fill') {
              ctx.strokeStyle = stroke;
              ctx.strokeRect(7.5, 3.5, 21, 10);
            }
          }, () => { o.fillStyle = s; redraw(); }));
        }
        break;
      }

      default:
        // Pencil, Fill, Pick Color: empty pane.
        break;
    }
  }
}

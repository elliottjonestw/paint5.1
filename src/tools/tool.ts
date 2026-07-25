// Tool interface + the context tools operate through. Tools draw real pixels
// into the document buffer during drags (Paint previews were real pixels);
// the stroke snapshot taken at pointer-down doubles as the undo record.

import { PixelBuffer } from '../core/pixelbuffer';
import type { SelectionManager } from './select';

export type ToolId =
  | 'freeselect' | 'select'
  | 'eraser' | 'fill'
  | 'picker' | 'magnifier'
  | 'pencil' | 'brush'
  | 'airbrush' | 'text'
  | 'line' | 'curve'
  | 'rect' | 'polygon'
  | 'ellipse' | 'roundrect';

export type FillStyle = 'outline' | 'both' | 'fill';
export type BrushKind = 'round' | 'square' | 'slash' | 'backslash';

export interface ToolOptions {
  selectionTransparent: boolean;      // false = Draw Opaque (the default)
  eraserSize: number;                 // 4 | 6 | 8 | 10
  magnifierZoom: number;              // 1 | 2 | 6 | 8
  brushKind: BrushKind;
  brushSize: number;                  // 8 | 5 | 2 per kind
  airbrushSize: number;               // 8 | 16 | 24 (spray diameter)
  lineWidth: number;                  // 1..5
  fillStyle: FillStyle;
}

export function defaultOptions(): ToolOptions {
  return {
    selectionTransparent: false,
    eraserSize: 8,
    magnifierZoom: 8,
    brushKind: 'round',
    brushSize: 5,
    airbrushSize: 16,
    lineWidth: 1,
    fillStyle: 'outline',
  };
}

export interface PointerInfo {
  x: number;            // buffer coords (may be outside the bitmap during capture)
  y: number;
  button: 'L' | 'R';
  shift: boolean;
  alt: boolean;
  raw: PointerEvent;
}

/** What tools are allowed to touch. Implemented by the App. */
export interface ToolContext {
  buf(): PixelBuffer;
  fg(): number;                        // u32
  bg(): number;
  setFgHex(hex: string): void;
  setBgHex(hex: string): void;
  options: ToolOptions;

  /** Snapshot the buffer: preview-restore source + pending undo record. */
  beginStroke(): void;
  /** Restore a rect of the buffer from the stroke snapshot. */
  restoreRect(x: number, y: number, w: number, h: number): void;
  restoreAll(): void;
  /** Push the pending snapshot onto the undo stack; marks the doc dirty. */
  endStroke(): void;
  /** Abandon: restore the whole snapshot, push nothing. */
  cancelStroke(): void;
  strokeActive(): boolean;

  repaint(): void;
  setStatusSize(text: string): void;
  setStatusHint(text: string): void;

  zoom(): number;
  setZoom(z: number, centerOn?: { x: number; y: number }): void;

  currentTool(): ToolId;
  selectTool(id: ToolId): void;
  previousToolId(): ToolId;

  /** Ask the view to redraw its overlay (ants, previews). */
  renderOverlay(): void;

  selection(): SelectionManager;
  /** Stamp floating pixels + finish the selection stroke (click-away, tool change). */
  anchorSelection(): void;
  setCursor(cursor: string): void;
}

export interface Tool {
  readonly id: ToolId;
  readonly hint: string;               // status-bar help text
  cursor(ctx: ToolContext): string;    // CSS cursor value
  onDown(ctx: ToolContext, p: PointerInfo): void;
  onMove(ctx: ToolContext, p: PointerInfo): void;
  onUp(ctx: ToolContext, p: PointerInfo): void;
  onDblClick?(ctx: ToolContext, p: PointerInfo): void;
  onKey?(ctx: ToolContext, e: KeyboardEvent): boolean;  // true = handled
  /** Draw display-only decorations. cssRect maps buffer px → overlay CSS px. */
  drawOverlay?(ctx: ToolContext, octx: CanvasRenderingContext2D,
    toCss: (bx: number, by: number) => { x: number; y: number }): void;
  activate?(ctx: ToolContext): void;
  deactivate?(ctx: ToolContext): void;
}

/** Snap a drag vector to 45° increments (Shift constraint). */
export function constrain45(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0, dy = y1 - y0;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const diag = ((oct % 2) + 2) % 2 === 1;
  const len = diag ? Math.min(adx, ady) : Math.max(adx, ady);
  // atan2 octant → unit direction (octants are -4..4)
  const table: Record<number, [number, number]> = {
    0: [1, 0], 1: [1, 1], 2: [0, 1], 3: [-1, 1], 4: [-1, 0],
    [-1]: [1, -1], [-2]: [0, -1], [-3]: [-1, -1], [-4]: [-1, 0],
  };
  const [ux, uy] = table[oct] ?? [1, 0];
  return [x0 + ux * len, y0 + uy * len];
}

/** Constrain a rect drag to a square (Shift on Rectangle/Ellipse). */
export function constrainSquare(x0: number, y0: number, x1: number, y1: number): [number, number] {
  const dx = x1 - x0, dy = y1 - y0;
  const side = Math.min(Math.abs(dx), Math.abs(dy));
  return [x0 + side * Math.sign(dx || 1), y0 + side * Math.sign(dy || 1)];
}

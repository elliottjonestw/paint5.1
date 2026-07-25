// The 2×8 tool box. Buttons are flat, raise on hover, and sink when selected.

import { ToolId } from '../tools/tool';
import {
  spriteCanvas,
  ICON_FREESELECT, ICON_SELECT, ICON_ERASER, ICON_FILL, ICON_PICKER,
  ICON_MAGNIFIER, ICON_PENCIL, ICON_BRUSH, ICON_AIRBRUSH, ICON_TEXT,
  ICON_LINE, ICON_CURVE, ICON_RECT, ICON_POLYGON, ICON_ELLIPSE, ICON_ROUNDRECT,
} from './icons';

/** Exact XP order: left column then right column, row by row. */
const TOOLS: Array<[ToolId, string[], string]> = [
  ['freeselect', ICON_FREESELECT, 'Free-Form Select'],
  ['select', ICON_SELECT, 'Select'],
  ['eraser', ICON_ERASER, 'Eraser/Color Eraser'],
  ['fill', ICON_FILL, 'Fill With Color'],
  ['picker', ICON_PICKER, 'Pick Color'],
  ['magnifier', ICON_MAGNIFIER, 'Magnifier'],
  ['pencil', ICON_PENCIL, 'Pencil'],
  ['brush', ICON_BRUSH, 'Brush'],
  ['airbrush', ICON_AIRBRUSH, 'Airbrush'],
  ['text', ICON_TEXT, 'Text'],
  ['line', ICON_LINE, 'Line'],
  ['curve', ICON_CURVE, 'Curve'],
  ['rect', ICON_RECT, 'Rectangle'],
  ['polygon', ICON_POLYGON, 'Polygon'],
  ['ellipse', ICON_ELLIPSE, 'Ellipse'],
  ['roundrect', ICON_ROUNDRECT, 'Rounded Rectangle'],
];

export class ToolBox {
  private buttons = new Map<ToolId, HTMLDivElement>();

  constructor(el: HTMLElement, onSelect: (id: ToolId) => void, onHint: (text: string) => void) {
    for (const [id, icon, name] of TOOLS) {
      const btn = document.createElement('div');
      btn.className = 'tool-btn';
      btn.title = name;
      btn.appendChild(spriteCanvas(icon));
      btn.addEventListener('pointerdown', () => onSelect(id));
      btn.addEventListener('pointerenter', () => onHint(name));
      btn.addEventListener('pointerleave', () => onHint(''));
      el.appendChild(btn);
      this.buttons.set(id, btn);
    }
  }

  setSelected(id: ToolId): void {
    for (const [tid, btn] of this.buttons) {
      btn.classList.toggle('selected', tid === id);
    }
  }
}

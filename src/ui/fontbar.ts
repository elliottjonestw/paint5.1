// The floating "Fonts" toolbar shown while a text frame is active.

import { isTouchUI } from '../platform/uiscale';

export interface TextStyle {
  family: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  vertical: boolean;
}

const FAMILIES = [
  'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact',
  'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

export class FontBar {
  el: HTMLDivElement;
  style: TextStyle = {
    family: 'Arial', sizePt: 12, bold: false, italic: false, underline: false, vertical: false,
  };
  onChange: (() => void) | null = null;
  private toggles: Record<string, HTMLDivElement> = {};

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'fontbar';

    const famSel = document.createElement('select');
    for (const f of FAMILIES) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      famSel.appendChild(o);
    }
    famSel.value = this.style.family;
    famSel.addEventListener('change', () => {
      this.style.family = famSel.value;
      this.changed();
    });

    const sizeSel = document.createElement('select');
    for (const s of SIZES) {
      const o = document.createElement('option');
      o.value = String(s);
      o.textContent = String(s);
      sizeSel.appendChild(o);
    }
    sizeSel.value = String(this.style.sizePt);
    sizeSel.addEventListener('change', () => {
      this.style.sizePt = parseInt(sizeSel.value, 10);
      this.changed();
    });

    this.el.appendChild(famSel);
    this.el.appendChild(sizeSel);
    this.makeToggle('B', 'bold', 'font-weight: bold');
    this.makeToggle('I', 'italic', 'font-style: italic');
    this.makeToggle('U', 'underline', 'text-decoration: underline');
    this.makeToggle('⇩', 'vertical', '');

    // Drag the bar around by its face.
    let drag: { x: number; y: number; l: number; t: number } | null = null;
    this.el.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if ((e.target as HTMLElement).classList.contains('fb-toggle')) return;
      drag = { x: e.clientX, y: e.clientY, l: this.el.offsetLeft, t: this.el.offsetTop };
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', e => {
      if (!drag) return;
      this.el.style.left = `${drag.l + e.clientX - drag.x}px`;
      this.el.style.top = `${drag.t + e.clientY - drag.y}px`;
    });
    this.el.addEventListener('pointerup', () => { drag = null; });

    this.el.style.left = '120px';
    this.el.style.top = '60px';
    document.body.appendChild(this.el);
  }

  private makeToggle(label: string, key: keyof TextStyle, styleAttr: string): void {
    const t = document.createElement('div');
    t.className = 'fb-toggle';
    t.textContent = label;
    if (styleAttr) t.setAttribute('style', styleAttr);
    t.addEventListener('pointerdown', e => e.stopPropagation());
    t.addEventListener('click', () => {
      (this.style[key] as boolean) = !this.style[key];
      t.classList.toggle('on', this.style[key] as boolean);
      this.changed();
    });
    this.toggles[key] = t;
    this.el.appendChild(t);
  }

  private changed(): void {
    if (this.onChange) this.onChange();
  }

  get visible(): boolean { return this.el.classList.contains('visible'); }

  show(): void {
    this.el.classList.add('visible');
    // It was last dropped where a desktop window had room for it.
    if (isTouchUI) {
      const maxL = document.documentElement.clientWidth - this.el.offsetWidth - 2;
      const maxT = document.documentElement.clientHeight - this.el.offsetHeight - 2;
      this.el.style.left = `${Math.max(2, Math.min(this.el.offsetLeft, maxL))}px`;
      this.el.style.top = `${Math.max(2, Math.min(this.el.offsetTop, maxT))}px`;
    }
  }
  hide(): void { this.el.classList.remove('visible'); }

  /** CSS font shorthand at a given px size. */
  cssFont(sizePx: number): string {
    const it = this.style.italic ? 'italic ' : '';
    const b = this.style.bold ? 'bold ' : '';
    return `${it}${b}${sizePx}px "${this.style.family}"`;
  }

  sizePx(): number {
    return Math.round(this.style.sizePt * 96 / 72);
  }
}

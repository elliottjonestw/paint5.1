// In-window, DOM-rendered, classic Windows-styled dialogs. The only native
// dialogs anywhere in the app are the file open/save panels.

import { MSG_ICONS } from './icons';

export interface DialogButton {
  label: string;
  id: string;
  default?: boolean;
  cancel?: boolean;
}

export class DialogHost {
  private root = document.getElementById('dialoghost')!;
  private stack: HTMLDivElement[] = [];

  get open(): boolean { return this.stack.length > 0; }

  show(title: string, body: HTMLElement, buttons: DialogButton[], opts?: { width?: number }): Promise<string> {
    return new Promise(resolve => {
      const shade = document.createElement('div');
      shade.className = 'dlg-shade';

      const dlg = document.createElement('div');
      dlg.className = 'dialog';
      if (opts?.width) dlg.style.width = `${opts.width}px`;

      const tb = document.createElement('div');
      tb.className = 'dlg-titlebar';
      const tt = document.createElement('div');
      tt.className = 'dlg-title';
      tt.textContent = title;
      tb.appendChild(tt);
      const close = document.createElement('div');
      close.className = 'dlg-close';
      close.textContent = '✕';
      tb.appendChild(close);
      dlg.appendChild(tb);

      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'dlg-body';
      bodyWrap.appendChild(body);

      const btnRow = document.createElement('div');
      btnRow.className = 'dlg-buttons';
      const finish = (id: string) => {
        shade.remove();
        this.stack = this.stack.filter(s => s !== shade);
        if (this.stack.length === 0) this.root.classList.remove('active');
        document.removeEventListener('keydown', keyHandler, true);
        resolve(id);
      };
      const cancelId = buttons.find(b => b.cancel)?.id ?? buttons[buttons.length - 1]?.id ?? 'cancel';
      const defaultId = buttons.find(b => b.default)?.id ?? buttons[0]?.id;
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.className = 'btn' + (b.default ? ' default' : '');
        btn.textContent = b.label;
        btn.addEventListener('click', () => finish(b.id));
        btnRow.appendChild(btn);
      }
      bodyWrap.appendChild(btnRow);
      dlg.appendChild(bodyWrap);
      close.addEventListener('click', () => finish(cancelId));

      const keyHandler = (e: KeyboardEvent) => {
        if (this.stack[this.stack.length - 1] !== shade) return;
        if (e.key === 'Escape') { e.stopPropagation(); finish(cancelId); }
        else if (e.key === 'Enter' && defaultId) {
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== 'BUTTON' && tag !== 'SELECT') {
            e.stopPropagation();
            finish(defaultId);
          }
        }
      };
      document.addEventListener('keydown', keyHandler, true);

      shade.appendChild(dlg);
      this.root.appendChild(shade);
      this.root.classList.add('active');
      this.stack.push(shade);

      // center, then allow dragging by the title bar
      const cw = document.documentElement.clientWidth;
      const ch = document.documentElement.clientHeight;
      dlg.style.left = `${Math.max(10, Math.round((cw - dlg.offsetWidth) / 2))}px`;
      dlg.style.top = `${Math.max(10, Math.round((ch - dlg.offsetHeight) / 3))}px`;
      let drag: { x: number; y: number; l: number; t: number } | null = null;
      tb.addEventListener('pointerdown', e => {
        if (e.target === close) return;
        drag = { x: e.clientX, y: e.clientY, l: dlg.offsetLeft, t: dlg.offsetTop };
        tb.setPointerCapture(e.pointerId);
      });
      tb.addEventListener('pointermove', e => {
        if (!drag) return;
        dlg.style.left = `${drag.l + e.clientX - drag.x}px`;
        dlg.style.top = `${drag.t + e.clientY - drag.y}px`;
      });
      tb.addEventListener('pointerup', () => { drag = null; });

      const firstInput = body.querySelector<HTMLInputElement>('input.edit');
      if (firstInput) setTimeout(() => { firstInput.focus(); firstInput.select(); }, 0);
    });
  }

  msgBox(
    title: string, text: string,
    icon: 'warning' | 'question' | 'info' | null,
    buttons: DialogButton[],
  ): Promise<string> {
    const body = document.createElement('div');
    body.className = 'msgbox-body';
    if (icon) {
      const ic = document.createElement('div');
      ic.className = 'msgbox-icon';
      ic.appendChild(MSG_ICONS[icon]());
      body.appendChild(ic);
    }
    const tx = document.createElement('div');
    tx.className = 'msgbox-text';
    text.split('\n').forEach((line, i) => {
      if (i > 0) tx.appendChild(document.createElement('br'));
      tx.appendChild(document.createTextNode(line));
    });
    body.appendChild(tx);
    return this.show(title, body, buttons);
  }

  alert(text: string, title = 'Paint'): Promise<string> {
    return this.msgBox(title, text, 'info', [{ label: 'OK', id: 'ok', default: true, cancel: true }]);
  }
}

/* ---------- classic control builders ---------- */

export function mkEdit(value: string, widthPx: number): HTMLInputElement {
  const e = document.createElement('input');
  e.className = 'edit';
  e.value = value;
  e.style.width = `${widthPx}px`;
  e.addEventListener('keydown', ev => ev.stopPropagation());
  return e;
}

export function mkLabel(text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

export function mkRow(...children: Array<HTMLElement | string>): HTMLDivElement {
  const d = document.createElement('div');
  d.style.display = 'flex';
  d.style.alignItems = 'center';
  d.style.gap = '6px';
  d.style.margin = '4px 0';
  for (const c of children) {
    d.appendChild(typeof c === 'string' ? mkLabel(c) : c);
  }
  return d;
}

export function mkGroupBox(label: string, ...children: HTMLElement[]): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'groupbox';
  const l = document.createElement('div');
  l.className = 'gb-label';
  l.textContent = label;
  g.appendChild(l);
  for (const c of children) g.appendChild(c);
  return g;
}

export interface RadioGroup<T> {
  el: HTMLDivElement;
  get(): T;
  set(v: T): void;
  onChange?: (v: T) => void;
}

export function mkRadioGroup<T>(
  items: Array<{ label: string; value: T; el?: HTMLElement }>,
  initial: T,
  layout: 'v' | 'h' = 'v',
): RadioGroup<T> {
  const el = document.createElement('div');
  if (layout === 'h') {
    el.style.display = 'flex';
    el.style.gap = '14px';
  }
  let current = initial;
  const glyphs: HTMLDivElement[] = [];
  const group: RadioGroup<T> = {
    el,
    get: () => current,
    set: (v: T) => {
      current = v;
      items.forEach((it, i) => glyphs[i].classList.toggle('on', it.value === v));
    },
  };
  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'radio-row';
    const glyph = document.createElement('div');
    glyph.className = 'radio-glyph' + (it.value === initial ? ' on' : '');
    glyphs.push(glyph);
    row.appendChild(glyph);
    row.appendChild(mkLabel(it.label));
    if (it.el) row.appendChild(it.el);
    row.addEventListener('pointerdown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      group.set(it.value);
      if (group.onChange) group.onChange(it.value);
    });
    el.appendChild(row);
  });
  return group;
}

export interface CheckBox {
  el: HTMLDivElement;
  get(): boolean;
  set(v: boolean): void;
}

export function mkCheckBox(label: string, initial: boolean): CheckBox {
  const row = document.createElement('div');
  row.className = 'check-row';
  const glyph = document.createElement('div');
  glyph.className = 'check-glyph' + (initial ? ' on' : '');
  row.appendChild(glyph);
  row.appendChild(mkLabel(label));
  let val = initial;
  row.addEventListener('pointerdown', () => {
    val = !val;
    glyph.classList.toggle('on', val);
  });
  return { el: row, get: () => val, set: v => { val = v; glyph.classList.toggle('on', v); } };
}

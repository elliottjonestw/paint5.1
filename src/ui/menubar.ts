// Classic in-window menu bar: square popups, 1px borders, drop shadows,
// underlined access keys, checkmarks/bullets, right-aligned accelerator text.

import { isTouchUI } from '../platform/uiscale';

export interface MenuItem {
  label?: string;              // '&' marks the access key
  id?: string;
  accel?: string;              // display only (e.g. "Ctrl+Z")
  sep?: boolean;
  sub?: MenuItem[];
  hint?: string;
  enabled?: () => boolean;
  checked?: () => boolean;
  radio?: boolean;
  dynamic?: () => MenuItem[];  // e.g. recent files
}

export interface Menu {
  title: string;               // '&File'
  items: MenuItem[];
}

function labelHtml(label: string): string {
  const i = label.indexOf('&');
  if (i === -1) return escapeHtml(label);
  return escapeHtml(label.slice(0, i)) +
    '<u>' + escapeHtml(label[i + 1]) + '</u>' +
    escapeHtml(label.slice(i + 2));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class MenuBar {
  private el: HTMLElement;
  private menus: Menu[];
  private exec: (id: string) => void;
  private hint: (text: string) => void;
  private openIndex: number | null = null;
  private titleEls: HTMLDivElement[] = [];
  private popups: HTMLDivElement[] = [];

  constructor(el: HTMLElement, menus: Menu[], exec: (id: string) => void, hint: (text: string) => void) {
    this.el = el;
    this.menus = menus;
    this.exec = exec;
    this.hint = hint;

    menus.forEach((menu, idx) => {
      const t = document.createElement('div');
      t.className = 'menu-title hoverable';
      t.innerHTML = labelHtml(menu.title);
      t.addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (this.openIndex === idx) this.closeAll();
        else this.open(idx);
      });
      t.addEventListener('pointerenter', () => {
        if (this.openIndex !== null && this.openIndex !== idx) this.open(idx);
      });
      el.appendChild(t);
      this.titleEls.push(t);
    });

    document.addEventListener('pointerdown', () => this.closeAll());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.openIndex !== null) this.closeAll();
    });
  }

  private open(idx: number): void {
    this.closeAll();
    this.openIndex = idx;
    const t = this.titleEls[idx];
    t.classList.add('open');
    const popup = this.buildPopup(this.menus[idx].items);
    popup.style.left = `${t.offsetLeft}px`;
    popup.style.top = `${this.el.offsetTop + this.el.offsetHeight - 1}px`;
    this.el.appendChild(popup);
    this.popups.push(popup);
    // A phone-width window is narrower than "Colors" is far to the right.
    if (isTouchUI) {
      const max = document.documentElement.clientWidth - popup.offsetWidth - 2;
      popup.style.left = `${Math.max(2, Math.min(t.offsetLeft, max))}px`;
    }
  }

  private buildPopup(items: MenuItem[]): HTMLDivElement {
    const popup = document.createElement('div');
    popup.className = 'menu-popup';
    popup.addEventListener('pointerdown', e => e.stopPropagation());

    const expand = (list: MenuItem[]): MenuItem[] => {
      const out: MenuItem[] = [];
      for (const it of list) {
        if (it.dynamic) out.push(...it.dynamic());
        else out.push(it);
      }
      return out;
    };

    let openSub: { el: HTMLDivElement; item: HTMLDivElement } | null = null;

    for (const item of expand(items)) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'menu-sep';
        popup.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'menu-item';
      const enabled = item.enabled ? item.enabled() : true;
      if (!enabled) row.classList.add('disabled');

      const check = document.createElement('span');
      check.className = 'mi-check';
      if (item.checked && item.checked()) check.textContent = item.radio ? '•' : '✓';
      row.appendChild(check);

      const lbl = document.createElement('span');
      lbl.className = 'mi-label';
      lbl.innerHTML = labelHtml(item.label ?? '');
      row.appendChild(lbl);

      if (item.accel) {
        const acc = document.createElement('span');
        acc.className = 'mi-accel';
        acc.textContent = item.accel;
        row.appendChild(acc);
      }
      if (item.sub) {
        const arrow = document.createElement('span');
        arrow.className = 'mi-sub';
        arrow.textContent = '▶';
        row.appendChild(arrow);
      }

      row.addEventListener('pointerenter', () => {
        popup.querySelectorAll('.menu-item').forEach(r => r.classList.remove('hilite'));
        row.classList.add('hilite');
        this.hint(item.hint ?? '');
        if (openSub && openSub.item !== row) {
          openSub.el.remove();
          openSub = null;
        }
        if (item.sub && enabled && !openSub) {
          const sub = this.buildPopup(item.sub);
          sub.style.left = `${popup.offsetLeft + popup.offsetWidth - 3}px`;
          sub.style.top = `${popup.offsetTop + row.offsetTop - 2}px`;
          this.el.appendChild(sub);
          // Out of room to the right: open it to the left, as Windows does.
          if (isTouchUI &&
              sub.offsetLeft + sub.offsetWidth > document.documentElement.clientWidth - 2) {
            sub.style.left = `${Math.max(2, popup.offsetLeft - sub.offsetWidth + 3)}px`;
          }
          this.popups.push(sub);
          openSub = { el: sub, item: row };
        }
      });
      row.addEventListener('pointerleave', () => {
        row.classList.remove('hilite');
        this.hint('');
      });
      if (!item.sub) {
        row.addEventListener('pointerup', () => {
          if (!enabled || !item.id) return;
          this.closeAll();
          this.exec(item.id);
        });
      }
      popup.appendChild(row);
    }
    return popup;
  }

  closeAll(): void {
    this.openIndex = null;
    for (const t of this.titleEls) t.classList.remove('open');
    for (const p of this.popups) p.remove();
    this.popups = [];
    this.hint('');
  }
}

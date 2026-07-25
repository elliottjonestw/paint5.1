// The color box: overlapping fg/bg swatch indicator, 2×14 fixed palette,
// 2×14 custom slots. Left-click sets foreground, right-click background,
// double-click opens Edit Colors for that cell.

import { DEFAULT_COLORS, hexToU32 } from '../core/color';
import { isTouchUI } from '../platform/uiscale';

export class Palette {
  fgHex = '#000000';
  bgHex = '#FFFFFF';
  colors: string[] = [...DEFAULT_COLORS];
  custom: string[] = new Array(28).fill('#FFFFFF');
  onChange: (() => void) | null = null;
  /**
   * Touch has no second mouse button, so the swatch indicator arms the
   * background color instead: whichever swatch sits in front is what a stroke
   * paints with, which is what the indicator has always meant.
   */
  secondary = false;

  get fg(): number { return hexToU32(this.fgHex); }
  get bg(): number { return hexToU32(this.bgHex); }

  setFg(hex: string): void { this.fgHex = hex.toUpperCase(); this.changed(); }
  setBg(hex: string): void { this.bgHex = hex.toUpperCase(); this.changed(); }

  changed(): void { if (this.onChange) this.onChange(); }
}

export class ColorBox {
  private fgSwatch!: HTMLDivElement;
  private bgSwatch!: HTMLDivElement;
  private palette: Palette;

  constructor(
    el: HTMLElement,
    palette: Palette,
    onEditCell: (index: number, isCustom: boolean) => void,
  ) {
    this.palette = palette;

    const indicator = document.createElement('div');
    indicator.id = 'swatch-indicator';
    const mk = (id: string) => {
      const s = document.createElement('div');
      s.className = 'swatch';
      s.id = id;
      const inner = document.createElement('div');
      inner.className = 'swatch-inner';
      s.appendChild(inner);
      indicator.appendChild(s);
      return inner as HTMLDivElement;
    };
    this.fgSwatch = mk('swatch-fg');
    this.bgSwatch = mk('swatch-bg');
    if (isTouchUI) {
      indicator.addEventListener('pointerdown', () => {
        palette.secondary = !palette.secondary;
        this.refresh();
      });
    }
    this.indicator = indicator;
    el.appendChild(indicator);

    const makeGrid = (colors: string[], isCustom: boolean) => {
      const grid = document.createElement('div');
      grid.className = 'color-grid';
      colors.forEach((hex, i) => {
        const c = document.createElement('div');
        c.className = 'color-cell';
        const inner = document.createElement('div');
        inner.className = 'cc-inner';
        inner.style.background = hex;
        c.appendChild(inner);
        c.addEventListener('pointerdown', e => {
          const current = (isCustom ? palette.custom : palette.colors)[i];
          if (e.button === 2 || e.ctrlKey || palette.secondary) palette.setBg(current);
          else palette.setFg(current);
        });
        c.addEventListener('dblclick', () => onEditCell(i, isCustom));
        grid.appendChild(c);
      });
      el.appendChild(grid);
      return grid;
    };
    this.grids = [makeGrid(palette.colors, false), makeGrid(palette.custom, true)];

    this.refresh();
  }

  private grids: HTMLDivElement[] = [];
  private indicator!: HTMLDivElement;

  refresh(): void {
    this.fgSwatch.style.background = this.palette.fgHex;
    this.bgSwatch.style.background = this.palette.bgHex;
    this.indicator.classList.toggle('secondary', this.palette.secondary);
    const paint = (grid: HTMLDivElement, colors: string[]) => {
      const cells = grid.querySelectorAll<HTMLDivElement>('.cc-inner');
      cells.forEach((cell, i) => { cell.style.background = colors[i]; });
    };
    paint(this.grids[0], this.palette.colors);
    paint(this.grids[1], this.palette.custom);
  }
}

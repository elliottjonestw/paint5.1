// The Windows "Edit Colors" dialog: 48 basic colors, 16 custom slots, and the
// "Define Custom Colors >>" expansion with the 2D hue/saturation field, the
// luminance strip, and Windows-scale (0–239/0–240) HSL plus RGB numeric entry.

import { DialogHost, mkEdit, mkLabel } from './dialogs';
import { hexToRgb, rgbToHex, rgbToHsl240, hsl240ToRgb, RGB, HSL240 } from '../core/color';

/** The classic comdlg32 basic palette, 8 columns × 6 rows. */
const BASIC_COLORS = [
  '#FF8080', '#FFFF80', '#80FF80', '#00FF80', '#80FFFF', '#0080FF', '#FF80C0', '#FF80FF',
  '#FF0000', '#FFFF00', '#80FF00', '#00FF40', '#00FFFF', '#0080C0', '#8080C0', '#FF00FF',
  '#804040', '#FF8040', '#00FF00', '#008080', '#004080', '#8080FF', '#800040', '#FF0080',
  '#800000', '#FF8000', '#008000', '#008040', '#0000FF', '#0000A0', '#800080', '#8000FF',
  '#400000', '#804000', '#004000', '#004040', '#000080', '#000040', '#400040', '#400080',
  '#000000', '#808000', '#808040', '#808080', '#408080', '#C0C0C0', '#400040', '#FFFFFF',
];

const FIELD_W = 180, FIELD_H = 152;
const LUM_W = 12, LUM_H = 152;

export async function editColorsDialog(
  host: DialogHost,
  initialHex: string,
  customColors: string[],          // 16 entries, mutated in place
): Promise<string | null> {
  let rgb: RGB = hexToRgb(initialHex);
  let hsl: HSL240 = rgbToHsl240(rgb);
  let expanded = false;
  let customIndex = 0;

  const body = document.createElement('div');
  body.style.display = 'flex';
  body.style.gap = '12px';

  const left = document.createElement('div');
  const right = document.createElement('div');
  right.style.display = 'none';
  body.appendChild(left);
  body.appendChild(right);

  /* ---------- left: palettes ---------- */

  const mkPalette = (colors: string[], cols: number, clickable: (i: number) => void) => {
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = `repeat(${cols}, 18px)`;
    grid.style.gap = '3px';
    grid.style.margin = '4px 0 10px 0';
    const cells: HTMLDivElement[] = [];
    colors.forEach((hex, i) => {
      const c = document.createElement('div');
      c.style.width = '18px';
      c.style.height = '14px';
      c.style.background = hex;
      c.style.boxShadow = 'inset 1px 1px 0 #716F64, inset -1px -1px 0 #FFFFFF';
      c.addEventListener('pointerdown', () => clickable(i));
      grid.appendChild(c);
      cells.push(c);
    });
    return { grid, cells };
  };

  left.appendChild(mkLabel('Basic colors:'));
  const basic = mkPalette(BASIC_COLORS, 8, i => {
    setColor(hexToRgb(BASIC_COLORS[i]));
  });
  left.appendChild(basic.grid);

  left.appendChild(mkLabel('Custom colors:'));
  const custom = mkPalette(customColors.slice(0, 16), 8, i => {
    customIndex = i;
    setColor(hexToRgb(customColors[i]));
  });
  left.appendChild(custom.grid);

  const defineBtn = document.createElement('button');
  defineBtn.className = 'btn';
  defineBtn.style.width = '178px';
  defineBtn.style.marginTop = '6px';
  defineBtn.textContent = 'Define Custom Colors >>';
  defineBtn.addEventListener('click', () => {
    expanded = true;
    right.style.display = 'block';
    defineBtn.disabled = true;
    defineBtn.classList.add('disabled');
    redrawAll();
  });
  left.appendChild(defineBtn);

  /* ---------- right: define custom colors ---------- */

  const fieldWrap = document.createElement('div');
  fieldWrap.style.display = 'flex';
  fieldWrap.style.gap = '8px';

  const field = document.createElement('canvas');
  field.width = FIELD_W;
  field.height = FIELD_H;
  field.style.imageRendering = 'pixelated';
  const fctx = field.getContext('2d')!;

  const lum = document.createElement('canvas');
  lum.width = LUM_W + 8;
  lum.height = LUM_H;
  const lctx = lum.getContext('2d')!;

  fieldWrap.appendChild(field);
  fieldWrap.appendChild(lum);
  right.appendChild(fieldWrap);

  // preview + numeric entry
  const bottom = document.createElement('div');
  bottom.style.display = 'flex';
  bottom.style.gap = '10px';
  bottom.style.marginTop = '8px';

  const previewWrap = document.createElement('div');
  const preview = document.createElement('div');
  preview.style.width = '60px';
  preview.style.height = '34px';
  preview.style.boxShadow = 'inset 1px 1px 0 #716F64, inset -1px -1px 0 #FFFFFF';
  previewWrap.appendChild(preview);
  const pvLabel = document.createElement('div');
  pvLabel.style.textAlign = 'center';
  pvLabel.textContent = 'Color|Solid';
  previewWrap.appendChild(pvLabel);
  bottom.appendChild(previewWrap);

  const numCol1 = document.createElement('div');
  const numCol2 = document.createElement('div');
  const edits: Record<string, HTMLInputElement> = {};
  const numRow = (label: string, key: string, col: HTMLElement) => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'flex-end';
    row.style.gap = '4px';
    row.style.margin = '2px 0';
    row.appendChild(mkLabel(label));
    const e = mkEdit('0', 28);
    edits[key] = e;
    row.appendChild(e);
    col.appendChild(row);
  };
  numRow('Hue:', 'h', numCol1);
  numRow('Sat:', 's', numCol1);
  numRow('Lum:', 'l', numCol1);
  numRow('Red:', 'r', numCol2);
  numRow('Green:', 'g', numCol2);
  numRow('Blue:', 'b', numCol2);
  bottom.appendChild(numCol1);
  bottom.appendChild(numCol2);
  right.appendChild(bottom);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.style.width = '100%';
  addBtn.style.marginTop = '8px';
  addBtn.textContent = 'Add to Custom Colors';
  addBtn.addEventListener('click', () => {
    customColors[customIndex] = rgbToHex(rgb);
    custom.cells[customIndex].style.background = customColors[customIndex];
    customIndex = (customIndex + 1) % 16;
  });
  right.appendChild(addBtn);

  /* ---------- drawing + state sync ---------- */

  let fieldImage: ImageData | null = null;
  const drawField = () => {
    if (!fieldImage) {
      fieldImage = fctx.createImageData(FIELD_W, FIELD_H);
      const d = fieldImage.data;
      for (let y = 0; y < FIELD_H; y++) {
        for (let x = 0; x < FIELD_W; x++) {
          const c = hsl240ToRgb({
            h: Math.round(x / (FIELD_W - 1) * 239),
            s: Math.round((1 - y / (FIELD_H - 1)) * 240),
            l: 120,
          });
          const i = (y * FIELD_W + x) * 4;
          d[i] = c.r; d[i + 1] = c.g; d[i + 2] = c.b; d[i + 3] = 255;
        }
      }
    }
    fctx.putImageData(fieldImage, 0, 0);
    // crosshair marker
    const mx = Math.round(hsl.h / 239 * (FIELD_W - 1));
    const my = Math.round((1 - hsl.s / 240) * (FIELD_H - 1));
    fctx.fillStyle = '#000000';
    fctx.fillRect(mx - 1, my - 9, 3, 6);
    fctx.fillRect(mx - 1, my + 4, 3, 6);
    fctx.fillRect(mx - 9, my - 1, 6, 3);
    fctx.fillRect(mx + 4, my - 1, 6, 3);
  };

  const drawLum = () => {
    lctx.clearRect(0, 0, lum.width, lum.height);
    for (let y = 0; y < LUM_H; y++) {
      const c = hsl240ToRgb({ h: hsl.h, s: hsl.s, l: Math.round((1 - y / (LUM_H - 1)) * 240) });
      lctx.fillStyle = rgbToHex(c);
      lctx.fillRect(0, y, LUM_W, 1);
    }
    // arrow marker
    const my = Math.round((1 - hsl.l / 240) * (LUM_H - 1));
    lctx.fillStyle = '#000000';
    for (let i = 0; i < 5; i++) {
      lctx.fillRect(LUM_W + 2 + i, my - i, 1, i * 2 + 1);
    }
  };

  const syncEdits = () => {
    edits.h.value = String(hsl.h);
    edits.s.value = String(hsl.s);
    edits.l.value = String(hsl.l);
    edits.r.value = String(rgb.r);
    edits.g.value = String(rgb.g);
    edits.b.value = String(rgb.b);
  };

  const redrawAll = () => {
    preview.style.background = rgbToHex(rgb);
    if (expanded) {
      drawField();
      drawLum();
    }
    syncEdits();
  };

  const setColor = (c: RGB) => {
    rgb = c;
    hsl = rgbToHsl240(c);
    redrawAll();
  };
  const setHsl = (h: HSL240) => {
    hsl = h;
    rgb = hsl240ToRgb(h);
    redrawAll();
  };

  // field/lum pointer handling
  const fieldPick = (e: PointerEvent) => {
    // Measured through the rect rather than assuming 1:1, so picking still
    // lands where the finger is when the dialog is scaled down to fit a phone.
    const r = field.getBoundingClientRect();
    const x = Math.max(0, Math.min(FIELD_W - 1, (e.clientX - r.left) * (FIELD_W / r.width)));
    const y = Math.max(0, Math.min(FIELD_H - 1, (e.clientY - r.top) * (FIELD_H / r.height)));
    setHsl({
      h: Math.round(x / (FIELD_W - 1) * 239),
      s: Math.round((1 - y / (FIELD_H - 1)) * 240),
      l: hsl.l,
    });
  };
  let fieldDown = false;
  field.addEventListener('pointerdown', e => { fieldDown = true; field.setPointerCapture(e.pointerId); fieldPick(e); });
  field.addEventListener('pointermove', e => { if (fieldDown) fieldPick(e); });
  field.addEventListener('pointerup', () => { fieldDown = false; });

  const lumPick = (e: PointerEvent) => {
    const r = lum.getBoundingClientRect();
    const y = Math.max(0, Math.min(LUM_H - 1, (e.clientY - r.top) * (LUM_H / r.height)));
    setHsl({ h: hsl.h, s: hsl.s, l: Math.round((1 - y / (LUM_H - 1)) * 240) });
  };
  let lumDown = false;
  lum.addEventListener('pointerdown', e => { lumDown = true; lum.setPointerCapture(e.pointerId); lumPick(e); });
  lum.addEventListener('pointermove', e => { if (lumDown) lumPick(e); });
  lum.addEventListener('pointerup', () => { lumDown = false; });

  // numeric entry
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, isNaN(v) ? 0 : v));
  for (const key of ['h', 's', 'l']) {
    edits[key].addEventListener('change', () => {
      setHsl({
        h: clamp(parseInt(edits.h.value, 10), 239),
        s: clamp(parseInt(edits.s.value, 10), 240),
        l: clamp(parseInt(edits.l.value, 10), 240),
      });
    });
  }
  for (const key of ['r', 'g', 'b']) {
    edits[key].addEventListener('change', () => {
      setColor({
        r: clamp(parseInt(edits.r.value, 10), 255),
        g: clamp(parseInt(edits.g.value, 10), 255),
        b: clamp(parseInt(edits.b.value, 10), 255),
      });
    });
  }

  redrawAll();

  const id = await host.show('Edit Colors', body, [
    { label: 'OK', id: 'ok', default: true },
    { label: 'Cancel', id: 'cancel', cancel: true },
  ]);
  return id === 'ok' ? rgbToHex(rgb) : null;
}

// Image-menu dialogs: Attributes, Flip/Rotate, Stretch/Skew, Custom Zoom.

import { DialogHost, mkEdit, mkRow, mkGroupBox, mkRadioGroup, mkLabel } from './dialogs';

const DPI = 96;

export interface AttributesResult {
  width: number;
  height: number;
  mono: boolean;
}

export async function attributesDialog(
  host: DialogHost,
  cur: { width: number; height: number; mono: boolean; fileInfo: string },
): Promise<AttributesResult | null> {
  const body = document.createElement('div');
  body.style.width = '300px';

  const info = document.createElement('div');
  info.style.marginBottom = '8px';
  info.innerHTML = '';
  for (const line of [cur.fileInfo, `Resolution: ${DPI} x ${DPI} dots per inch`]) {
    const d = document.createElement('div');
    d.textContent = line;
    d.style.margin = '2px 0';
    info.appendChild(d);
  }
  body.appendChild(info);

  const wEdit = mkEdit(String(cur.width), 60);
  const hEdit = mkEdit(String(cur.height), 60);
  body.appendChild(mkRow('Width:', wEdit, 'Height:', hEdit));

  let units: 'in' | 'cm' | 'px' = 'px';
  const toUnits = (px: number, u: string): string => {
    if (u === 'in') return (px / DPI).toFixed(2);
    if (u === 'cm') return (px / DPI * 2.54).toFixed(2);
    return String(px);
  };
  const fromUnits = (v: string, u: string): number => {
    const n = parseFloat(v);
    if (isNaN(n)) return NaN;
    if (u === 'in') return Math.round(n * DPI);
    if (u === 'cm') return Math.round(n / 2.54 * DPI);
    return Math.round(n);
  };
  const unitGroup = mkRadioGroup(
    [
      { label: 'Inches', value: 'in' as const },
      { label: 'Cm', value: 'cm' as const },
      { label: 'Pixels', value: 'px' as const },
    ],
    'px', 'h',
  );
  unitGroup.onChange = (u) => {
    const w = fromUnits(wEdit.value, units);
    const h = fromUnits(hEdit.value, units);
    units = u;
    if (!isNaN(w)) wEdit.value = toUnits(w, u);
    if (!isNaN(h)) hEdit.value = toUnits(h, u);
  };
  body.appendChild(mkGroupBox('Units', unitGroup.el));

  const colorGroup = mkRadioGroup(
    [
      { label: 'Black and white', value: true },
      { label: 'Colors', value: false },
    ],
    cur.mono, 'h',
  );
  body.appendChild(mkGroupBox('Colors', colorGroup.el));

  const defBtn = document.createElement('button');
  defBtn.className = 'btn';
  defBtn.textContent = 'Default';
  defBtn.style.marginTop = '8px';
  defBtn.addEventListener('click', () => {
    units = 'px';
    unitGroup.set('px');
    wEdit.value = '512';
    hEdit.value = '384';
  });
  body.appendChild(defBtn);

  const id = await host.show('Attributes', body, [
    { label: 'OK', id: 'ok', default: true },
    { label: 'Cancel', id: 'cancel', cancel: true },
  ]);
  if (id !== 'ok') return null;
  const w = fromUnits(wEdit.value, units);
  const h = fromUnits(hEdit.value, units);
  if (isNaN(w) || isNaN(h) || w < 1 || h < 1 || w > 10000 || h > 10000) {
    await host.alert('Bitmap size must be between 1 and 10,000 pixels in each direction.');
    return null;
  }
  return { width: w, height: h, mono: colorGroup.get() };
}

export type FlipRotateResult =
  | { kind: 'flipH' } | { kind: 'flipV' }
  | { kind: 'rotate'; deg: 90 | 180 | 270 };

export async function flipRotateDialog(host: DialogHost): Promise<FlipRotateResult | null> {
  const body = document.createElement('div');
  body.style.width = '230px';

  const angleGroup = mkRadioGroup(
    [
      { label: '90°', value: 90 as const },
      { label: '180°', value: 180 as const },
      { label: '270°', value: 270 as const },
    ],
    90,
  );
  angleGroup.el.style.marginLeft = '22px';

  const mainGroup = mkRadioGroup(
    [
      { label: 'Flip horizontal', value: 'flipH' as const },
      { label: 'Flip vertical', value: 'flipV' as const },
      { label: 'Rotate by angle', value: 'rotate' as const },
    ],
    'flipH',
  );
  const setAngleEnabled = (v: string) => {
    angleGroup.el.style.opacity = v === 'rotate' ? '1' : '0.5';
    angleGroup.el.style.pointerEvents = v === 'rotate' ? 'auto' : 'none';
  };
  mainGroup.onChange = setAngleEnabled;
  setAngleEnabled('flipH');

  body.appendChild(mkGroupBox('Flip or rotate', mainGroup.el, angleGroup.el));

  const id = await host.show('Flip and Rotate', body, [
    { label: 'OK', id: 'ok', default: true },
    { label: 'Cancel', id: 'cancel', cancel: true },
  ]);
  if (id !== 'ok') return null;
  const kind = mainGroup.get();
  if (kind === 'rotate') return { kind: 'rotate', deg: angleGroup.get() };
  return { kind };
}

export interface StretchSkewResult {
  stretchH: number;
  stretchV: number;
  skewH: number;
  skewV: number;
}

export async function stretchSkewDialog(host: DialogHost): Promise<StretchSkewResult | null> {
  const body = document.createElement('div');
  body.style.width = '260px';

  const sh = mkEdit('100', 40), sv = mkEdit('100', 40);
  const kh = mkEdit('0', 40), kv = mkEdit('0', 40);
  body.appendChild(mkGroupBox('Stretch',
    mkRow(mkLabel('Horizontal:'), sh, mkLabel('%')),
    mkRow(mkLabel('Vertical:'), sv, mkLabel('%')),
  ));
  body.appendChild(mkGroupBox('Skew',
    mkRow(mkLabel('Horizontal:'), kh, mkLabel('Degrees')),
    mkRow(mkLabel('Vertical:'), kv, mkLabel('Degrees')),
  ));

  for (;;) {
    const id = await host.show('Stretch and Skew', body, [
      { label: 'OK', id: 'ok', default: true },
      { label: 'Cancel', id: 'cancel', cancel: true },
    ]);
    if (id !== 'ok') return null;
    const stretchH = parseInt(sh.value, 10), stretchV = parseInt(sv.value, 10);
    const skewH = parseInt(kh.value, 10), skewV = parseInt(kv.value, 10);
    if (isNaN(stretchH) || isNaN(stretchV) || stretchH < 1 || stretchV < 1 ||
      stretchH > 500 || stretchV > 500) {
      await host.alert('The stretch amount must be an integer between 1 and 500.');
      continue;
    }
    if (isNaN(skewH) || isNaN(skewV) || Math.abs(skewH) > 89 || Math.abs(skewV) > 89) {
      await host.alert('The skew amount must be an integer between -89 and 89.');
      continue;
    }
    return { stretchH, stretchV, skewH, skewV };
  }
}

export async function customZoomDialog(host: DialogHost, currentZoom: number): Promise<number | null> {
  const body = document.createElement('div');
  body.style.width = '280px';
  const cur = document.createElement('div');
  cur.textContent = `Current zoom: ${currentZoom * 100}%`;
  cur.style.marginBottom = '6px';
  body.appendChild(cur);

  const group = mkRadioGroup(
    [
      { label: '100%', value: 1 },
      { label: '200%', value: 2 },
      { label: '400%', value: 4 },
      { label: '600%', value: 6 },
      { label: '800%', value: 8 },
    ],
    currentZoom, 'h',
  );
  group.el.style.flexWrap = 'wrap';
  group.el.style.gap = '8px';
  body.appendChild(mkGroupBox('Zoom to', group.el));

  const id = await host.show('Custom Zoom', body, [
    { label: 'OK', id: 'ok', default: true },
    { label: 'Cancel', id: 'cancel', cancel: true },
  ]);
  return id === 'ok' ? group.get() : null;
}

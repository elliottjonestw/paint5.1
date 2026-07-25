// About, Page Setup, Print Preview.

import { DialogHost, mkRow, mkEdit, mkGroupBox, mkRadioGroup, mkLabel } from './dialogs';
import { spriteCanvas, ICON_BRUSH } from './icons';

export interface PageSetup {
  paper: 'letter' | 'a4';
  landscape: boolean;
  marginsIn: { l: number; r: number; t: number; b: number };
}

export function defaultPageSetup(): PageSetup {
  return { paper: 'letter', landscape: false, marginsIn: { l: 0.75, r: 0.75, t: 1, b: 1 } };
}

export async function aboutDialog(host: DialogHost): Promise<void> {
  const body = document.createElement('div');
  body.style.width = '330px';

  const banner = document.createElement('div');
  banner.style.display = 'flex';
  banner.style.alignItems = 'center';
  banner.style.gap = '10px';
  banner.style.padding = '6px';
  banner.style.background = '#FFFFFF';
  banner.style.boxShadow = 'inset 1px 1px 0 #ACA899, inset -1px -1px 0 #FFFFFF';
  const icon = spriteCanvas(ICON_BRUSH, 2);
  banner.appendChild(icon);
  const title = document.createElement('div');
  title.innerHTML = '<b>Paint</b><br>Version 5.1 (recreation)';
  banner.appendChild(title);
  body.appendChild(banner);

  const text = document.createElement('div');
  text.style.marginTop = '10px';
  text.style.lineHeight = '1.5';
  const lines = [
    'A faithful recreation of the Windows XP Paint application.',
    'All artwork recreated from scratch. Not affiliated with Microsoft.',
    '',
    'This product is licensed to:',
    'You',
  ];
  for (const l of lines) {
    const d = document.createElement('div');
    d.textContent = l;
    text.appendChild(d);
  }
  body.appendChild(text);

  await host.show('About Paint', body, [{ label: 'OK', id: 'ok', default: true, cancel: true }]);
}

export async function pageSetupDialog(host: DialogHost, cur: PageSetup): Promise<PageSetup | null> {
  const body = document.createElement('div');
  body.style.width = '280px';

  const paperGroup = mkRadioGroup(
    [
      { label: 'Letter (8.5 x 11 in)', value: 'letter' as const },
      { label: 'A4 (210 x 297 mm)', value: 'a4' as const },
    ],
    cur.paper,
  );
  body.appendChild(mkGroupBox('Paper', paperGroup.el));

  const orientGroup = mkRadioGroup(
    [
      { label: 'Portrait', value: false },
      { label: 'Landscape', value: true },
    ],
    cur.landscape, 'h',
  );
  body.appendChild(mkGroupBox('Orientation', orientGroup.el));

  const l = mkEdit(String(cur.marginsIn.l), 36), r = mkEdit(String(cur.marginsIn.r), 36);
  const t = mkEdit(String(cur.marginsIn.t), 36), b = mkEdit(String(cur.marginsIn.b), 36);
  body.appendChild(mkGroupBox('Margins (inches)',
    mkRow(mkLabel('Left:'), l, mkLabel('Right:'), r),
    mkRow(mkLabel('Top:'), t, mkLabel('Bottom:'), b),
  ));

  const id = await host.show('Page Setup', body, [
    { label: 'OK', id: 'ok', default: true },
    { label: 'Cancel', id: 'cancel', cancel: true },
  ]);
  if (id !== 'ok') return null;
  const num = (e: HTMLInputElement, d: number) => {
    const v = parseFloat(e.value);
    return isNaN(v) || v < 0 || v > 4 ? d : v;
  };
  return {
    paper: paperGroup.get(),
    landscape: orientGroup.get(),
    marginsIn: { l: num(l, 0.75), r: num(r, 0.75), t: num(t, 1), b: num(b, 1) },
  };
}

export async function printPreviewDialog(
  host: DialogHost, imageCanvas: HTMLCanvasElement, setup: PageSetup,
): Promise<'print' | null> {
  const body = document.createElement('div');

  const paperIn = setup.paper === 'letter' ? { w: 8.5, h: 11 } : { w: 8.27, h: 11.69 };
  const pw = setup.landscape ? paperIn.h : paperIn.w;
  const ph = setup.landscape ? paperIn.w : paperIn.h;
  const scale = 420 / ph;

  const page = document.createElement('div');
  page.style.width = `${Math.round(pw * scale)}px`;
  page.style.height = `${Math.round(ph * scale)}px`;
  page.style.background = '#FFFFFF';
  page.style.margin = '0 auto';
  page.style.position = 'relative';
  page.style.boxShadow = '2px 2px 4px rgba(0,0,0,0.4), inset 0 0 0 1px #716F64';

  // Image placed at 96dpi inside the margins, like Paint printed it.
  const m = setup.marginsIn;
  const availW = (pw - m.l - m.r) * 96;
  const availH = (ph - m.t - m.b) * 96;
  const fit = Math.min(1, availW / imageCanvas.width, availH / imageCanvas.height);
  const img = document.createElement('canvas');
  const iw = Math.max(1, Math.round(imageCanvas.width * fit * scale / 96));
  const ih = Math.max(1, Math.round(imageCanvas.height * fit * scale / 96));
  img.width = iw;
  img.height = ih;
  const ictx = img.getContext('2d')!;
  ictx.imageSmoothingEnabled = false;
  ictx.drawImage(imageCanvas, 0, 0, iw, ih);
  img.style.position = 'absolute';
  img.style.left = `${Math.round(m.l * scale)}px`;
  img.style.top = `${Math.round(m.t * scale)}px`;
  page.appendChild(img);
  body.appendChild(page);

  const id = await host.show('Print Preview', body, [
    { label: 'Print...', id: 'print', default: true },
    { label: 'Close', id: 'close', cancel: true },
  ]);
  return id === 'print' ? 'print' : null;
}

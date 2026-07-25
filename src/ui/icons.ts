// All icons and cursors are hand-authored pixel art defined as ASCII sprite
// maps and rendered to canvases/data URIs at runtime. Nothing is extracted
// from Microsoft resources.

export const PAL: Record<string, string> = {
  k: '#000000',
  w: '#FFFFFF',
  g: '#808080',
  s: '#C0C0C0',
  y: '#FFFF00',
  e: '#FFFFC0',
  d: '#804000',
  p: '#FF80C0',
  r: '#FF0000',
  b: '#0000FF',
  c: '#00FFFF',
  t: '#008080',
  n: '#000080',
  o: '#FF8040',
  f: '#ECE9D8',
  h: '#ACA899',
};

export function spriteCanvas(rows: string[], scale = 1): HTMLCanvasElement {
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const cv = document.createElement('canvas');
  cv.width = w * scale;
  cv.height = h * scale;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      ctx.fillStyle = PAL[ch] ?? '#000';
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return cv;
}

export function spriteDataURL(rows: string[], scale = 1): string {
  return spriteCanvas(rows, scale).toDataURL('image/png');
}

export function cursorStyle(rows: string[], hx: number, hy: number): string {
  return `url(${spriteDataURL(rows)}) ${hx} ${hy}, auto`;
}

/* ================= Tool icons (16×16) ================= */

export const ICON_FREESELECT = [
  '................',
  '....k.k.kk......',
  '...k......k.k...',
  '..k............k',
  '...............k',
  '.k..............',
  '...............k',
  '.k..............',
  '...............k',
  '.k..............',
  '..............k.',
  '..k.........k...',
  '...k.k.k.k.k....',
  '................',
  '................',
  '................',
];

export const ICON_SELECT = [
  '................',
  '..k.k.k.k.k.k...',
  '................',
  '..k.........k...',
  '................',
  '..k.........k...',
  '................',
  '..k.........k...',
  '................',
  '..k.........k...',
  '................',
  '..k.k.k.k.k.k...',
  '................',
  '................',
  '................',
  '................',
];

export const ICON_ERASER = [
  '................',
  '................',
  '................',
  '....kkkkkkkk....',
  '...kwwwwwwwkk...',
  '..kwwwwwwwkpk...',
  '.kkkkkkkkkppk...',
  '.kpppppppkppk...',
  '.kpppppppkpk....',
  '.kpppppppkk.....',
  '.kkkkkkkkk......',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export const ICON_FILL = [
  '................',
  '..........kk....',
  '.........k..k...',
  '.........k..k...',
  '........k..k....',
  '....kkksk.k.....',
  '...ksssssssk....',
  '..ksssssssssk...',
  '.kbsssssssssk...',
  'bbbksssssssk....',
  'bbb.ksssssk.....',
  'bb...kssk.......',
  '.b....kk........',
  '................',
  '................',
  '................',
];

export const ICON_PICKER = [
  '................',
  '...........kk...',
  '..........kkkk..',
  '..........kkkk..',
  '.........kkkk...',
  '........kkk.....',
  '.......kwkk.....',
  '......kwk.......',
  '.....kwk........',
  '....kwk.........',
  '...kwk..........',
  '..kwk...........',
  '..kk............',
  '.k..............',
  '................',
  '................',
];

export const ICON_MAGNIFIER = [
  '................',
  '....kkkk........',
  '..kk....kk......',
  '..k......k......',
  '.k........k.....',
  '.k........k.....',
  '.k........k.....',
  '.k........k.....',
  '..k......k......',
  '..kk....kk......',
  '....kkkk.k......',
  '..........kk....',
  '...........kk...',
  '............kk..',
  '.............k..',
  '................',
];

export const ICON_PENCIL = [
  '................',
  '...........kk...',
  '..........keek..',
  '.........keyk...',
  '........keyk....',
  '.......keyk.....',
  '......keyk......',
  '.....keyk.......',
  '....keyk........',
  '...keyk.........',
  '..kkyk..........',
  '..kkk...........',
  '.kk.............',
  '................',
  '................',
  '................',
];

export const ICON_BRUSH = [
  '................',
  '...........kk...',
  '..........kddk..',
  '.........kddk...',
  '........kddk....',
  '.......kddk.....',
  '......kddk......',
  '......kdk.......',
  '....sssk........',
  '...sssss........',
  '..kksss.........',
  '.kkkkk..........',
  '.kkkk...........',
  '.kkk............',
  '................',
  '................',
];

export const ICON_AIRBRUSH = [
  '..k..k..........',
  '.k..k..kkk......',
  '..k..k.ksk......',
  '.k..k.kkkkk.....',
  '..k..ksssssk....',
  '.k...ksssssk....',
  '..k..ksssssk....',
  '.....ksssssk....',
  '.....ksssssk....',
  '.....ksssssk....',
  '.....kkkkkkk....',
  '................',
  '................',
  '................',
  '................',
  '................',
];

export const ICON_TEXT = [
  '................',
  '................',
  '......kk........',
  '......kk........',
  '.....kkkk.......',
  '.....k..k.......',
  '....kk..kk......',
  '....k....k......',
  '...kkkkkkkk.....',
  '...k......k.....',
  '..kk......kk....',
  '..k........k....',
  '.kkk......kkk...',
  '................',
  '................',
  '................',
];

export const ICON_LINE = [
  '................',
  '................',
  '.............k..',
  '............k...',
  '...........k....',
  '..........k.....',
  '.........k......',
  '........k.......',
  '.......k........',
  '......k.........',
  '.....k..........',
  '....k...........',
  '...k............',
  '..k.............',
  '................',
  '................',
];

export const ICON_CURVE = [
  '................',
  '...........kk...',
  '..........k.....',
  '.........k......',
  '.........k......',
  '.........k......',
  '..........k.....',
  '...........k....',
  '............k...',
  '..k.........k...',
  '.k..........k...',
  '.k .........k...',
  '.k.........k....',
  '..k.......k.....',
  '...kkkkkkk......',
  '................',
];

export const ICON_RECT = [
  '................',
  '................',
  '................',
  '..kkkkkkkkkkkk..',
  '..k..........k..',
  '..k..........k..',
  '..k..........k..',
  '..k..........k..',
  '..k..........k..',
  '..k..........k..',
  '..k..........k..',
  '..k..........k..',
  '..kkkkkkkkkkkk..',
  '................',
  '................',
  '................',
];

export const ICON_POLYGON = [
  '................',
  '................',
  '..k.........k...',
  '..kk.......kk...',
  '..k.k.....k.k...',
  '..k..k...k..k...',
  '..k...k.k...k...',
  '..k....k....k...',
  '..k.........k...',
  '..k.........k...',
  '..k.........k...',
  '..kkkkkkkkkkk...',
  '................',
  '................',
  '................',
  '................',
];

export const ICON_ELLIPSE = [
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '...kk......kk...',
  '..k..........k..',
  '.k............k.',
  '.k............k.',
  '.k............k.',
  '..k..........k..',
  '...kk......kk...',
  '.....kkkkkk.....',
  '................',
  '................',
  '................',
  '................',
];

export const ICON_ROUNDRECT = [
  '................',
  '................',
  '................',
  '...kkkkkkkkkk...',
  '..k..........k..',
  '.k............k.',
  '.k............k.',
  '.k............k.',
  '.k............k.',
  '.k............k.',
  '.k............k.',
  '..k..........k..',
  '...kkkkkkkkkk...',
  '................',
  '................',
  '................',
];

/* ================= Cursors ================= */

const CUR_CROSSHAIR = [
  '......www......',
  '......wkw......',
  '......wkw......',
  '......wkw......',
  '......wkw......',
  '......wkw......',
  'wwwwwwwkwwwwwww',
  'wkkkkkkkkkkkkkw',
  'wwwwwwwkwwwwwww',
  '......wkw......',
  '......wkw......',
  '......wkw......',
  '......wkw......',
  '......wkw......',
  '......www......',
];

const CUR_PENCIL = [
  '............kk..',
  '...........keek.',
  '..........keyk..',
  '.........keyk...',
  '........keyk....',
  '.......keyk.....',
  '......keyk......',
  '.....keyk.......',
  '....keyk........',
  '...keyk.........',
  '..keyk..........',
  '.kkyk...........',
  '.kkk............',
  'kkk.............',
  'kk..............',
  'k...............',
];

const CUR_FILL = [
  '..........kk....',
  '.........k..k...',
  '.........k..k...',
  '........k..k....',
  '....kkksk.k.....',
  '...ksssssssk....',
  '..ksssssssssk...',
  '.kwsssssssssk...',
  'kwwksssssssk....',
  'kww.ksssssk.....',
  'kw...kssk.......',
  'k.....kk........',
  'k...............',
  '................',
  '................',
  '................',
];

const CUR_SPRAY = [
  '..k..k..........',
  '.k..k..kkk......',
  '..k..k.ksk......',
  '.k..k.kkkkk.....',
  '..k..kwwwwwk....',
  '.k...kwwwwwk....',
  '..k..kwwwwwk....',
  '.....kwwwwwk....',
  '.....kwwwwwk....',
  '.....kkkkkkk....',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const CUR_MAGNIFIER = [
  '....kkkk........',
  '..kk....kk......',
  '..k......k......',
  '.k........k.....',
  '.k........k.....',
  '.k........k.....',
  '.k........k.....',
  '..k......k......',
  '..kk....kk......',
  '....kkkk.k......',
  '..........kk....',
  '...........kk...',
  '............kk..',
  '.............k..',
  '................',
  '................',
];

const CUR_IBEAM = [
  '.kkk.kkk.',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '....k....',
  '.kkk.kkk.',
];

const CUR_PICKER = [
  '...........kk...',
  '..........kkkk..',
  '..........kkkk..',
  '.........kkkk...',
  '........kkk.....',
  '.......kwkk.....',
  '......kwk.......',
  '.....kwk........',
  '....kwk.........',
  '...kwk..........',
  '..kwk...........',
  '.kwk............',
  '.kk.............',
  'k...............',
  '................',
  '................',
];

/** Cursors are built once and reused — tools ask for them on every pointer move. */
function memo(fn: () => string): () => string {
  let cached: string | null = null;
  return () => (cached ??= fn());
}

export const CURSORS = {
  crosshair: memo(() => cursorStyle(CUR_CROSSHAIR, 7, 7)),
  pencil: memo(() => cursorStyle(CUR_PENCIL, 0, 15)),
  fill: memo(() => cursorStyle(CUR_FILL, 0, 12)),
  spray: memo(() => cursorStyle(CUR_SPRAY, 8, 6)),
  magnifier: memo(() => cursorStyle(CUR_MAGNIFIER, 5, 4)),
  ibeam: memo(() => cursorStyle(CUR_IBEAM, 4, 7)),
  picker: memo(() => cursorStyle(CUR_PICKER, 0, 13)),
};

const eraserCursorCache = new Map<string, string>();

/** Square outline cursor for the Eraser, sized to the eraser at current zoom. */
export function eraserCursor(size: number, zoom: number): string {
  const key = `${size}:${zoom}`;
  const hit = eraserCursorCache.get(key);
  if (hit) return hit;
  const px = Math.max(3, size * zoom);
  const cv = document.createElement('canvas');
  const dim = Math.min(64, px + 2);
  cv.width = dim;
  cv.height = dim;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(1, 1, dim - 2, dim - 2);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, dim, 1);
  ctx.fillRect(0, dim - 1, dim, 1);
  ctx.fillRect(0, 0, 1, dim);
  ctx.fillRect(dim - 1, 0, 1, dim);
  const h = Math.floor(dim / 2);
  const css = `url(${cv.toDataURL('image/png')}) ${h} ${h}, auto`;
  eraserCursorCache.set(key, css);
  return css;
}

/* ================= Message box icons (32×32) ================= */

function iconWarning(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000000';
  for (let y = 0; y < 30; y++) {
    const half = Math.floor((y * 16) / 30) + 1;
    ctx.fillRect(16 - half, y + 1, half * 2, 1);
  }
  ctx.fillStyle = '#FFFF00';
  for (let y = 2; y < 29; y++) {
    const half = Math.max(0, Math.floor(((y - 2) * 16) / 30));
    ctx.fillRect(16 - half, y + 1, half * 2, 1);
  }
  ctx.fillStyle = '#000000';
  ctx.fillRect(14, 10, 4, 11);
  ctx.fillRect(14, 24, 4, 4);
  return cv;
}

function iconQuestionOrInfo(ch: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // circle
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 15.5, dy = y - 15.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 15) {
        ctx.fillStyle = d > 14 ? '#000080' : '#FFFFFF';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  ctx.fillStyle = '#000080';
  ctx.font = 'bold 20px Times, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch, 16, 17);
  return cv;
}

export const MSG_ICONS = {
  warning: iconWarning,
  question: () => iconQuestionOrInfo('?'),
  info: () => iconQuestionOrInfo('i'),
};

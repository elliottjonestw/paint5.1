// Color math and the fixed XP Paint palette.
// Pixels are handled as little-endian u32: 0xAABBGGRR (alpha always 0xFF).

export interface RGB { r: number; g: number; b: number; }

/** The 28 default palette colors, top row then bottom row, left to right. */
export const DEFAULT_COLORS: string[] = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080',
  '#800080', '#808040', '#004040', '#0080FF', '#004080', '#8000FF', '#804000',
  '#FFFFFF', '#C0C0C0', '#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF',
  '#FF00FF', '#FFFF80', '#00FF80', '#80FFFF', '#8080FF', '#FF0080', '#FF8040',
];

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex(c: RGB): string {
  return '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function rgbToU32(c: RGB): number {
  return (0xff000000 | (c.b << 16) | (c.g << 8) | c.r) >>> 0;
}

export function u32ToRgb(u: number): RGB {
  return { r: u & 0xff, g: (u >>> 8) & 0xff, b: (u >>> 16) & 0xff };
}

export function hexToU32(hex: string): number {
  return rgbToU32(hexToRgb(hex));
}

export function u32ToHex(u: number): string {
  return rgbToHex(u32ToRgb(u));
}

/* ---- Windows HSL: hue 0-239, sat 0-240, lum 0-240 (as in the Edit Colors dialog) ---- */

export interface HSL240 { h: number; s: number; l: number; }

export function rgbToHsl240(c: RGB): HSL240 {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return {
    h: Math.min(239, Math.round(h * 240)),
    s: Math.round(s * 240),
    l: Math.round(l * 240),
  };
}

export function hsl240ToRgb(hsl: HSL240): RGB {
  const h = (hsl.h % 240) / 240, s = hsl.s / 240, l = hsl.l / 240;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(h + 1 / 3) * 255),
    g: Math.round(hue2rgb(h) * 255),
    b: Math.round(hue2rgb(h - 1 / 3) * 255),
  };
}

export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

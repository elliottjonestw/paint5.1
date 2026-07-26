// Regenerates every icon the project ships, from one drawing.
//
//   npm run icons
//
// Outputs are committed so that packaging and the Pages build never depend on
// running this script.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { drawIcon, drawMaskable } from './icon-art.mjs';
import { encodePNG, encodeICO, encodeICNS } from './encode.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ASSETS = join(ROOT, 'assets');
const WEB = join(ASSETS, 'web');

mkdirSync(WEB, { recursive: true });

const rendered = new Map();
const render = (size) => {
  if (!rendered.has(size)) rendered.set(size, drawIcon(size).toRGBA8());
  return rendered.get(size);
};

const written = [];
const write = (path, buf) => {
  writeFileSync(path, buf);
  written.push([path.slice(ROOT.length), buf.length]);
};
const png = (size) => encodePNG(render(size), size, size);

// --- macOS -------------------------------------------------------------------
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];
write(join(ASSETS, 'icon.icns'),
  encodeICNS(new Map(ICNS_SIZES.map(s => [s, png(s)]))));

// --- Windows -----------------------------------------------------------------
// electron-builder requires a 256px entry in the .ico it embeds.
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
write(join(ASSETS, 'icon.ico'),
  encodeICO(ICO_SIZES.map(size => ({ size, rgba: render(size) }))));

// --- Web / PWA ---------------------------------------------------------------
write(join(WEB, 'favicon.ico'),
  encodeICO([16, 24, 32, 48].map(size => ({ size, rgba: render(size) }))));
write(join(WEB, 'favicon-16.png'), png(16));
write(join(WEB, 'favicon-32.png'), png(32));
write(join(WEB, 'apple-touch-icon.png'), png(180));
write(join(WEB, 'icon-192.png'), png(192));
write(join(WEB, 'icon-512.png'), png(512));

const maskable = drawMaskable(512);
write(join(WEB, 'icon-maskable-512.png'), encodePNG(maskable.toRGBA8(), 512, 512));

// Master, handy for README and for any future re-export.
write(join(ASSETS, 'icon-1024.png'), png(1024));

const pad = Math.max(...written.map(([p]) => p.length));
for (const [path, bytes] of written) {
  console.log(`  ${path.padEnd(pad)}  ${(bytes / 1024).toFixed(1)} KB`);
}

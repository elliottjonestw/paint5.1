// Writes sample image files using the app's own encoders, so they can be
// opened in Preview and other applications to verify real-world compatibility.
// Run: node dist/makesamples.cjs <outdir>

import './domshim';
import * as fs from 'fs';
import * as path from 'path';
import { PixelBuffer } from '../src/core/pixelbuffer';
import { ellipseFill, ellipseOutline, line, rectFill } from '../src/core/raster';
import { hexToU32, DEFAULT_COLORS } from '../src/core/color';
import { encodeBMP, decodeBMP } from '../src/io/bmp';
import { encodeGIF, decodeGIF } from '../src/io/gif';

const outDir = process.argv[2] ?? '.';
fs.mkdirSync(outDir, { recursive: true });

const W = 97, H = 61;
const buf = new PixelBuffer(W, H);

// Color bars across the top from the XP palette.
for (let x = 0; x < W; x++) {
  const hex = DEFAULT_COLORS[Math.min(27, Math.floor(x / W * 28))];
  rectFill(buf, x, 0, x, 19, hexToU32(hex));
}
// A blue filled ellipse with a black outline, and a red diagonal.
ellipseFill(buf, 10, 25, 45, 55, hexToU32('#0000FF'));
ellipseOutline(buf, 10, 25, 45, 55, 1, hexToU32('#000000'));
line(buf, 50, 58, 95, 24, hexToU32('#FF0000'));

const written: string[] = [];
for (const depth of [24, 8, 4, 1] as const) {
  const bytes = encodeBMP(buf, depth);
  const p = path.join(outDir, `sample-${depth}bit.bmp`);
  fs.writeFileSync(p, bytes);
  // Verify our own decoder reads back what we wrote.
  const back = decodeBMP(new Uint8Array(fs.readFileSync(p)));
  const dims = back.width === W && back.height === H;
  written.push(`${path.basename(p)}  ${bytes.length} bytes  reread=${dims ? 'ok' : 'FAILED'}`);
}

const gif = encodeGIF(buf);
const gp = path.join(outDir, 'sample.gif');
fs.writeFileSync(gp, gif);
const gback = decodeGIF(new Uint8Array(fs.readFileSync(gp)));
written.push(`sample.gif  ${gif.length} bytes  reread=${gback.width === W && gback.height === H ? 'ok' : 'FAILED'}`);

for (const w of written) console.log(w);

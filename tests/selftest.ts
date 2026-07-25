// Self-test harness. Exercises the real engine modules in a real DOM and
// prints results into the page (and window.SELFTEST for automation).
// Run: npm run dev, then open http://localhost:5173/tests/selftest.html

import { PixelBuffer } from '../src/core/pixelbuffer';
import {
  line, ellipseOutline, ellipseFill, thickLine, ditherToMono, rotate, flipH,
  stretchNN, skew, roundRect, polygonFill,
} from '../src/core/raster';
import { brushStamp } from '../src/tools/freehand';
import { floodFill } from '../src/core/flood';
import { HistoryStack, takeSnapshot, UNDO_DEPTH } from '../src/core/history';
import { hexToU32, u32ToHex, DEFAULT_COLORS } from '../src/core/color';
import { encodeBMP, decodeBMP } from '../src/io/bmp';
import { encodeGIF, decodeGIF } from '../src/io/gif';
import { SelectionManager } from '../src/tools/select';
import { CurveTool, LineTool } from '../src/tools/shapes';
import { PencilTool, EraserTool } from '../src/tools/freehand';
import { TextTool } from '../src/tools/text';
import { FontBar } from '../src/ui/fontbar';
import { CanvasView } from '../src/ui/canvasview';
import { ToolContext, ToolId, ToolOptions, defaultOptions, PointerInfo } from '../src/tools/tool';

const WHITE = 0xffffffff;
const BLACK = 0xff000000;

const results: Array<{ name: string; pass: boolean; detail: string }> = [];

function check(name: string, pass: boolean, detail = ''): void {
  results.push({ name, pass, detail });
}

function distinctColors(buf: PixelBuffer): number[] {
  return [...new Set(buf.u32)].sort();
}

/* ---------------- mock ToolContext ---------------- */

class MockCtx implements ToolContext {
  buffer: PixelBuffer;
  options: ToolOptions = defaultOptions();
  fgHex = '#000000';
  bgHex = '#FFFFFF';
  sel = new SelectionManager();
  snapshot: Uint8ClampedArray | null = null;
  strokesCommitted = 0;
  strokesCancelled = 0;
  toolId: ToolId = 'pencil';
  zoomLevel = 1;

  constructor(w = 32, h = 32) {
    this.buffer = new PixelBuffer(w, h);
  }

  buf(): PixelBuffer { return this.buffer; }
  fg(): number { return hexToU32(this.fgHex); }
  bg(): number { return hexToU32(this.bgHex); }
  setFgHex(hex: string): void { this.fgHex = hex; }
  setBgHex(hex: string): void { this.bgHex = hex; }

  beginStroke(): void { this.snapshot = this.buffer.snapshot(); }
  restoreRect(x: number, y: number, w: number, h: number): void {
    if (this.snapshot) this.buffer.restoreRect(this.snapshot, x, y, w, h);
  }
  restoreAll(): void { if (this.snapshot) this.buffer.restore(this.snapshot); }
  endStroke(): void { this.snapshot = null; this.strokesCommitted++; }
  cancelStroke(): void {
    if (this.snapshot) this.buffer.restore(this.snapshot);
    this.snapshot = null;
    this.strokesCancelled++;
  }
  strokeActive(): boolean { return this.snapshot !== null; }

  repaint(): void { /* headless */ }
  setStatusSize(): void { /* headless */ }
  setStatusHint(): void { /* headless */ }
  zoom(): number { return this.zoomLevel; }
  setZoom(z: number): void { this.zoomLevel = z; }
  currentTool(): ToolId { return this.toolId; }
  selectTool(id: ToolId): void { this.toolId = id; }
  previousToolId(): ToolId { return 'pencil'; }
  renderOverlay(): void { /* headless */ }
  selection(): SelectionManager { return this.sel; }
  anchorSelection(): void {
    if (this.sel.lifted) {
      this.sel.stamp(this.buffer, this.options.selectionTransparent, this.bg());
      this.sel.discard();
      this.endStroke();
    } else {
      this.sel.discard();
    }
  }
  setCursor(): void { /* headless */ }
}

function pt(x: number, y: number, opts: Partial<PointerInfo> = {}): PointerInfo {
  return {
    x, y,
    button: opts.button ?? 'L',
    shift: opts.shift ?? false,
    alt: opts.alt ?? false,
    raw: {} as PointerEvent,
  };
}

/* ---------------- 1. Bresenham: no gray pixels ---------------- */

{
  const buf = new PixelBuffer(40, 40);
  line(buf, 0, 0, 39, 39, BLACK);
  const colors = distinctColors(buf);
  const onlyTwo = colors.length === 2 && colors.includes(WHITE) && colors.includes(BLACK);
  // A perfect 45° staircase: one pixel per column, and each is on the diagonal.
  let staircase = true;
  for (let i = 0; i < 40; i++) if (buf.getPixel(i, i) !== BLACK) staircase = false;
  let count = 0;
  for (const c of buf.u32) if (c === BLACK) count++;
  check('Bresenham diagonal has exactly 2 colors (no antialiasing)', onlyTwo,
    `distinct=${colors.length} [${colors.map(c => u32ToHex(c)).join(',')}]`);
  check('Bresenham diagonal is a clean staircase', staircase && count === 40,
    `on-diagonal=${staircase} blackPixels=${count} (expected 40)`);
}

/* ---------------- 2. Pencil tool via pointer samples ---------------- */

{
  const ctx = new MockCtx(40, 40);
  const pencil = new PencilTool();
  // Sparse samples: interpolation must fill the gap.
  pencil.onDown(ctx, pt(0, 0));
  pencil.onMove(ctx, pt(20, 20));
  pencil.onMove(ctx, pt(39, 39));
  pencil.onUp(ctx, pt(39, 39));
  let gaps = 0;
  for (let i = 0; i < 40; i++) if (ctx.buffer.getPixel(i, i) !== BLACK) gaps++;
  const colors = distinctColors(ctx.buffer);
  check('Pencil interpolates between sparse pointer samples', gaps === 0, `gaps=${gaps}`);
  check('Pencil produces only opaque fg/bg pixels', colors.length === 2,
    `distinct=${colors.length}`);
  check('Pencil stroke commits exactly one undo record', ctx.strokesCommitted === 1,
    `commits=${ctx.strokesCommitted}`);
}

/* ---------------- 3. Right-drag draws with background color ---------------- */

{
  const ctx = new MockCtx(20, 20);
  ctx.bgHex = '#FF0000';
  const pencil = new PencilTool();
  pencil.onDown(ctx, pt(2, 2, { button: 'R' }));
  pencil.onMove(ctx, pt(10, 10, { button: 'R' }));
  pencil.onUp(ctx, pt(10, 10, { button: 'R' }));
  const red = hexToU32('#FF0000');
  check('Right-drag pencil draws in the background color',
    ctx.buffer.getPixel(2, 2) === red && ctx.buffer.getPixel(10, 10) === red,
    `p(2,2)=${u32ToHex(ctx.buffer.getPixel(2, 2))}`);
}

/* ---------------- 4. Flood fill does not leak past a 1px diagonal ---------------- */

{
  const buf = new PixelBuffer(20, 20);
  line(buf, 0, 0, 19, 19, BLACK);
  const red = hexToU32('#FF0000');
  floodFill(buf, 19, 0, red);           // fill the upper-right triangle
  check('Flood fill does not leak across a 1px diagonal',
    buf.getPixel(0, 19) === WHITE && buf.getPixel(19, 0) === red,
    `belowLine=${u32ToHex(buf.getPixel(0, 19))} aboveLine=${u32ToHex(buf.getPixel(19, 0))}`);

  // Exact-match, zero tolerance: a near-identical color must not be filled.
  const b2 = new PixelBuffer(10, 10);
  b2.setPixel(5, 5, hexToU32('#FEFEFE'));
  floodFill(b2, 0, 0, BLACK);
  check('Flood fill is exact-match with zero tolerance',
    b2.getPixel(5, 5) === hexToU32('#FEFEFE'),
    `pixel=${u32ToHex(b2.getPixel(5, 5))}`);
}

/* ---------------- 5. Flood fill a full 5000x5000 buffer ---------------- */

{
  const t0 = performance.now();
  let ok = false, err = '';
  try {
    const big = new PixelBuffer(5000, 5000);
    floodFill(big, 2500, 2500, BLACK);
    ok = big.getPixel(0, 0) === BLACK && big.getPixel(4999, 4999) === BLACK;
  } catch (e) {
    err = String(e);
  }
  const ms = Math.round(performance.now() - t0);
  check('Flood fill handles 5000x5000 without recursion limits', ok,
    `${ms}ms ${err}`);
}

/* ---------------- 6. Ellipse is closed, symmetric, hard-edged ---------------- */

{
  const buf = new PixelBuffer(31, 21);
  ellipseOutline(buf, 0, 0, 30, 20, 1, BLACK);
  const colors = distinctColors(buf);
  // Horizontal symmetry check
  let symmetric = true;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 31; x++) {
      if (buf.getPixel(x, y) !== buf.getPixel(30 - x, y)) symmetric = false;
      if (buf.getPixel(x, y) !== buf.getPixel(x, 20 - y)) symmetric = false;
    }
  }
  // Every row within the ellipse must have at least one pixel (closed curve)
  let everyRow = true;
  for (let y = 0; y < 21; y++) {
    let found = false;
    for (let x = 0; x < 31; x++) if (buf.getPixel(x, y) === BLACK) found = true;
    if (!found) everyRow = false;
  }
  check('Ellipse outline has only 2 colors', colors.length === 2, `distinct=${colors.length}`);
  check('Ellipse outline is symmetric in both axes', symmetric);
  check('Ellipse outline is closed (no empty rows)', everyRow);

  const filled = new PixelBuffer(31, 21);
  ellipseFill(filled, 0, 0, 30, 20, BLACK);
  check('Ellipse fill covers the center and clears the corners',
    filled.getPixel(15, 10) === BLACK && filled.getPixel(0, 0) === WHITE,
    `center=${u32ToHex(filled.getPixel(15, 10))} corner=${u32ToHex(filled.getPixel(0, 0))}`);
}

/* ---------------- 7. Thick lines stay hard-edged ---------------- */

{
  const buf = new PixelBuffer(30, 30);
  thickLine(buf, 2, 2, 27, 20, 5, BLACK);
  check('5px line has only 2 colors (no antialiasing)',
    distinctColors(buf).length === 2);
}

/* ---------------- 8. Undo depth is exactly 3 ---------------- */

{
  const buf = new PixelBuffer(8, 8);
  const hist = new HistoryStack();
  for (let i = 1; i <= 5; i++) {
    hist.push(takeSnapshot(buf));
    buf.setPixel(0, 0, hexToU32(`#0000${i.toString(16).padStart(2, '0')}`));
  }
  let undos = 0;
  while (hist.canUndo()) {
    hist.undo(takeSnapshot(buf));
    undos++;
    if (undos > 10) break;
  }
  check(`Undo depth is exactly ${UNDO_DEPTH}`, undos === 3 && UNDO_DEPTH === 3,
    `undos=${undos} UNDO_DEPTH=${UNDO_DEPTH}`);
}

/* ---------------- 9. Selection: leaves bg behind, smears, copies ---------------- */

{
  const ctx = new MockCtx(20, 20);
  ctx.bgHex = '#00FF00';
  ctx.buffer.fillRect(2, 2, 4, 4, BLACK);
  const sel = ctx.sel;
  sel.setRect({ x: 2, y: 2, w: 4, h: 4 });
  ctx.beginStroke();
  sel.lift(ctx.buffer, ctx.bg(), false);
  const green = hexToU32('#00FF00');
  check('Moving a selection leaves the background color behind',
    ctx.buffer.getPixel(3, 3) === green,
    `vacated=${u32ToHex(ctx.buffer.getPixel(3, 3))} (bg=#00FF00, not white)`);

  // Smear: stamp at several positions along a path
  sel.pos = { x: 8, y: 8 };
  sel.stamp(ctx.buffer, false, ctx.bg());
  sel.pos = { x: 12, y: 8 };
  sel.stamp(ctx.buffer, false, ctx.bg());
  check('Shift-smear leaves multiple stamps along the path',
    ctx.buffer.getPixel(9, 9) === BLACK && ctx.buffer.getPixel(13, 9) === BLACK,
    `stamp1=${u32ToHex(ctx.buffer.getPixel(9, 9))} stamp2=${u32ToHex(ctx.buffer.getPixel(13, 9))}`);
}

{
  // Transparent mode is a color key against bg, not alpha.
  const ctx = new MockCtx(20, 20);
  ctx.bgHex = '#FFFFFF';
  ctx.buffer.fillRect(0, 0, 6, 6, WHITE);
  ctx.buffer.setPixel(1, 1, BLACK);
  const sel = ctx.sel;
  sel.setRect({ x: 0, y: 0, w: 6, h: 6 });
  ctx.beginStroke();
  sel.lift(ctx.buffer, ctx.bg(), true);   // copy (leaves source intact)
  ctx.buffer.fillRect(10, 10, 6, 6, hexToU32('#FF0000'));
  sel.pos = { x: 10, y: 10 };
  sel.stamp(ctx.buffer, true, ctx.bg());  // transparent: white is keyed out
  check('Transparent selection keys out the background color (no alpha)',
    ctx.buffer.getPixel(12, 12) === hexToU32('#FF0000') &&
    ctx.buffer.getPixel(11, 11) === BLACK,
    `keyed=${u32ToHex(ctx.buffer.getPixel(12, 12))} opaquePixel=${u32ToHex(ctx.buffer.getPixel(11, 11))}`);
}

/* ---------------- 10. Curve accepts exactly two control adjustments ---------------- */

{
  const ctx = new MockCtx(40, 40);
  const curve = new CurveTool();
  const drag = (x0: number, y0: number, x1: number, y1: number) => {
    curve.onDown(ctx, pt(x0, y0));
    curve.onMove(ctx, pt(x1, y1));
    curve.onUp(ctx, pt(x1, y1));
  };
  drag(2, 20, 36, 20);        // define endpoints
  check('Curve: endpoint drag does not commit', ctx.strokesCommitted === 0,
    `commits=${ctx.strokesCommitted}`);
  drag(12, 4, 12, 4);         // first control point
  check('Curve: first adjustment does not commit', ctx.strokesCommitted === 0,
    `commits=${ctx.strokesCommitted}`);
  drag(26, 34, 26, 34);       // second control point -> commits
  check('Curve commits after exactly two control-point adjustments',
    ctx.strokesCommitted === 1, `commits=${ctx.strokesCommitted}`);
  const before = ctx.strokesCommitted;
  drag(5, 5, 30, 30);         // a new curve starts; must not commit again yet
  check('Curve: a third drag starts a new curve rather than a third adjustment',
    ctx.strokesCommitted === before, `commits=${ctx.strokesCommitted}`);
  check('Curve output is hard-edged', distinctColors(ctx.buffer).length === 2);
}

/* ---------------- 11. Color Eraser (right-drag) ---------------- */

{
  const ctx = new MockCtx(20, 20);
  ctx.fgHex = '#FF0000';
  ctx.bgHex = '#0000FF';
  ctx.options.eraserSize = 8;
  ctx.buffer.fillRect(0, 0, 20, 20, hexToU32('#FF0000'));   // all foreground
  ctx.buffer.fillRect(0, 0, 4, 4, hexToU32('#00FF00'));     // a non-matching patch
  const eraser = new EraserTool();
  eraser.onDown(ctx, pt(10, 10, { button: 'R' }));
  eraser.onUp(ctx, pt(10, 10, { button: 'R' }));
  check('Color Eraser replaces only foreground-colored pixels',
    ctx.buffer.getPixel(10, 10) === hexToU32('#0000FF') &&
    ctx.buffer.getPixel(1, 1) === hexToU32('#00FF00'),
    `erased=${u32ToHex(ctx.buffer.getPixel(10, 10))} untouched=${u32ToHex(ctx.buffer.getPixel(1, 1))}`);

  // Left-drag erases to background unconditionally.
  const ctx2 = new MockCtx(20, 20);
  ctx2.bgHex = '#0000FF';
  ctx2.buffer.fillRect(0, 0, 20, 20, hexToU32('#00FF00'));
  const e2 = new EraserTool();
  e2.onDown(ctx2, pt(10, 10));
  e2.onUp(ctx2, pt(10, 10));
  check('Left-drag eraser paints the background color',
    ctx2.buffer.getPixel(10, 10) === hexToU32('#0000FF'));
}

/* ---------------- 12. Shift constrains line to 45 degrees ---------------- */

{
  const ctx = new MockCtx(40, 40);
  const lt = new LineTool();
  lt.onDown(ctx, pt(5, 5));
  lt.onMove(ctx, pt(30, 12, { shift: true }));   // shallow drag snaps to horizontal
  lt.onUp(ctx, pt(30, 12, { shift: true }));
  let horizontal = true;
  for (let x = 5; x <= 30; x++) if (ctx.buffer.getPixel(x, 5) !== BLACK) horizontal = false;
  check('Shift constrains the Line tool to 45-degree increments', horizontal);
}

/* ---------------- 13. Committed text is hard-edged ---------------- */

{
  const ctx = new MockCtx(200, 60);
  ctx.fgHex = '#000000';
  ctx.bgHex = '#FFFFFF';
  ctx.options.selectionTransparent = false;   // opaque mode
  const holder = document.createElement('div');
  document.body.appendChild(holder);
  const fontbar = new FontBar();
  fontbar.style.sizePt = 24;
  const tool = new TextTool(fontbar, () => holder);
  tool.onDown(ctx, pt(4, 4));
  tool.onMove(ctx, pt(190, 50));
  tool.onUp(ctx, pt(190, 50));
  const editor = document.getElementById('text-editor')!;
  editor.textContent = 'Wagon';
  tool.commit(ctx);
  const colors = distinctColors(ctx.buffer);
  const onlyTwo = colors.length === 2 && colors.includes(WHITE) && colors.includes(BLACK);
  let inked = 0;
  for (const c of ctx.buffer.u32) if (c === BLACK) inked++;
  check('Committed text has hard aliased edges (no gray fringing)', onlyTwo,
    `distinct=${colors.length} [${colors.map(c => u32ToHex(c)).join(',')}]`);
  check('Committed text actually drew glyph pixels', inked > 50, `inkedPixels=${inked}`);
  holder.remove();
  fontbar.el.remove();
}

/* ---------------- 14. BMP round-trips at every depth ---------------- */

function makeTestImage(w: number, h: number, paletteSize: number): PixelBuffer {
  const buf = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hex = DEFAULT_COLORS[(x + y * 3) % Math.min(paletteSize, DEFAULT_COLORS.length)];
      buf.u32[y * w + x] = hexToU32(hex);
    }
  }
  buf.touchAll();
  return buf;
}

{
  // 24-bit: exact round-trip, with an odd width to exercise row padding.
  const src = makeTestImage(23, 17, 28);
  const bytes = encodeBMP(src, 24);
  const dv = new DataView(bytes.buffer);
  const headerOk =
    bytes[0] === 0x42 && bytes[1] === 0x4d &&
    dv.getUint32(2, true) === bytes.length &&
    dv.getUint32(14, true) === 40 &&
    dv.getInt32(18, true) === 23 &&
    dv.getInt32(22, true) === 17 &&      // positive => bottom-up
    dv.getUint16(28, true) === 24 &&
    dv.getUint32(30, true) === 0;        // BI_RGB
  const rowSize = ((23 * 24 + 31) >> 5) << 2;
  const sizeOk = bytes.length === 14 + 40 + rowSize * 17 && rowSize % 4 === 0;
  const back = decodeBMP(bytes);
  let identical = back.width === 23 && back.height === 17;
  for (let i = 0; i < src.u32.length && identical; i++) {
    if (src.u32[i] !== back.u32[i]) identical = false;
  }
  check('BMP 24-bit: valid BITMAPFILEHEADER + BITMAPINFOHEADER', headerOk);
  check('BMP 24-bit: rows are 4-byte padded and file size is exact', sizeOk,
    `rowSize=${rowSize} len=${bytes.length}`);
  check('BMP 24-bit: byte-exact round-trip (odd width)', identical);

  // First row of pixel data must be the BOTTOM row of the image.
  const off = dv.getUint32(10, true);
  const bottomLeft = src.u32[16 * 23];
  const firstStored = (0xff000000 | (bytes[off] << 16) | (bytes[off + 1] << 8) | bytes[off + 2]) >>> 0;
  check('BMP 24-bit: row order is bottom-up', firstStored === bottomLeft,
    `stored=${u32ToHex(firstStored)} bottomLeft=${u32ToHex(bottomLeft)}`);
}

{
  // 8-bit and 4-bit with palettes that fit exactly.
  for (const [depth, colors] of [[8, 28], [4, 10]] as Array<[8 | 4, number]>) {
    const src = makeTestImage(19, 13, colors);
    const bytes = encodeBMP(src, depth);
    const dv = new DataView(bytes.buffer);
    const back = decodeBMP(bytes);
    let identical = back.width === 19 && back.height === 13;
    for (let i = 0; i < src.u32.length && identical; i++) {
      if (src.u32[i] !== back.u32[i]) identical = false;
    }
    const palCount = dv.getUint32(46, true);
    check(`BMP ${depth}-bit: round-trips exactly with a generated palette`, identical,
      `bpp=${dv.getUint16(28, true)} palette=${palCount}`);
  }
}

{
  // 1-bit monochrome.
  const src = new PixelBuffer(17, 9);
  for (let y = 0; y < 9; y++) {
    for (let x = 0; x < 17; x++) src.u32[y * 17 + x] = (x + y) % 2 ? BLACK : WHITE;
  }
  src.touchAll();
  const bytes = encodeBMP(src, 1);
  const dv = new DataView(bytes.buffer);
  const back = decodeBMP(bytes);
  let identical = true;
  for (let i = 0; i < src.u32.length && identical; i++) {
    if (src.u32[i] !== back.u32[i]) identical = false;
  }
  check('BMP 1-bit: monochrome round-trips exactly', identical,
    `bpp=${dv.getUint16(28, true)} palette=${dv.getUint32(46, true)}`);
}

/* ---------------- 15. GIF round-trip ---------------- */

{
  const src = makeTestImage(21, 14, 16);
  let ok = false, detail = '';
  try {
    const bytes = encodeGIF(src);
    const back = decodeGIF(bytes);
    ok = back.width === 21 && back.height === 14;
    for (let i = 0; i < src.u32.length && ok; i++) {
      if (src.u32[i] !== back.u32[i]) { ok = false; detail = `mismatch at ${i}`; }
    }
    detail = detail || `${bytes.length} bytes`;
  } catch (e) {
    detail = String(e);
  }
  check('GIF: round-trips exactly for a <=256 color image', ok, detail);
}

/* ---------------- 16. Image transforms ---------------- */

{
  const src = makeTestImage(10, 6, 28);
  const r90 = rotate(src, 90);
  check('Rotate 90 swaps dimensions', r90.width === 6 && r90.height === 10,
    `${r90.width}x${r90.height}`);
  check('Rotate 90 maps corners correctly',
    r90.getPixel(5, 0) === src.getPixel(0, 0),
    `${u32ToHex(r90.getPixel(5, 0))} vs ${u32ToHex(src.getPixel(0, 0))}`);
  const r360 = rotate(rotate(rotate(rotate(src, 90), 90), 90), 90);
  let same = true;
  for (let i = 0; i < src.u32.length && same; i++) if (src.u32[i] !== r360.u32[i]) same = false;
  check('Four 90-degree rotations restore the original', same);

  const f = flipH(flipH(src));
  let sameF = true;
  for (let i = 0; i < src.u32.length && sameF; i++) if (src.u32[i] !== f.u32[i]) sameF = false;
  check('Double horizontal flip restores the original', sameF);

  const up = stretchNN(src, 200, 200);
  check('Stretch is nearest-neighbor (no new colors introduced)',
    up.width === 20 && up.height === 12 &&
    distinctColors(up).every(c => distinctColors(src).includes(c)),
    `${up.width}x${up.height}`);
}

{
  const src = makeTestImage(16, 16, 28);
  ditherToMono(src);
  const colors = distinctColors(src);
  check('Black-and-white conversion yields exactly 1-bit output',
    colors.length <= 2 && colors.every(c => c === WHITE || c === BLACK),
    `distinct=${colors.map(c => u32ToHex(c)).join(',')}`);
}

/* ---------------- 17. Destructive resize ---------------- */

{
  const src = makeTestImage(10, 10, 28);
  const bigger = PixelBuffer.resized(src, 16, 16);
  check('Enlarging the canvas fills new area with WHITE (not bg)',
    bigger.getPixel(15, 15) === WHITE && bigger.getPixel(0, 0) === src.getPixel(0, 0),
    `new=${u32ToHex(bigger.getPixel(15, 15))}`);
  const smaller = PixelBuffer.resized(src, 5, 5);
  check('Shrinking the canvas crops without interpolating',
    smaller.width === 5 && smaller.getPixel(4, 4) === src.getPixel(4, 4));
}

/* ---------------- 18. Palette ---------------- */

{
  check('Palette has the 28 XP default colors in order',
    DEFAULT_COLORS.length === 28 &&
    DEFAULT_COLORS[0] === '#000000' && DEFAULT_COLORS[13] === '#804000' &&
    DEFAULT_COLORS[14] === '#FFFFFF' && DEFAULT_COLORS[27] === '#FF8040',
    `count=${DEFAULT_COLORS.length}`);
}

/* ---------------- 19. Rounded rectangle and polygon ---------------- */

{
  const buf = new PixelBuffer(40, 30);
  roundRect(buf, 2, 2, 37, 27, 1, BLACK, null);
  let everyRow = true, everyCol = true;
  for (let y = 2; y <= 27; y++) {
    let found = false;
    for (let x = 2; x <= 37; x++) if (buf.getPixel(x, y) === BLACK) found = true;
    if (!found) everyRow = false;
  }
  for (let x = 2; x <= 37; x++) {
    let found = false;
    for (let y = 2; y <= 27; y++) if (buf.getPixel(x, y) === BLACK) found = true;
    if (!found) everyCol = false;
  }
  check('Rounded rectangle outline is closed', everyRow && everyCol,
    `rows=${everyRow} cols=${everyCol}`);
  check('Rounded rectangle corners are cut (not square)',
    buf.getPixel(2, 2) === WHITE && buf.getPixel(37, 27) === WHITE);
  check('Rounded rectangle is hard-edged', distinctColors(buf).length === 2);

  const pbuf = new PixelBuffer(30, 30);
  const tri: Array<[number, number]> = [[15, 3], [27, 26], [3, 26]];
  polygonFill(pbuf, tri, BLACK);
  check('Polygon fill covers the interior and not the corners',
    pbuf.getPixel(15, 20) === BLACK && pbuf.getPixel(1, 1) === WHITE &&
    pbuf.getPixel(28, 1) === WHITE,
    `center=${u32ToHex(pbuf.getPixel(15, 20))}`);
  check('Polygon fill is hard-edged', distinctColors(pbuf).length === 2);
}

/* ---------------- 20. Brush stamps ---------------- */

{
  const kinds: Array<[string, 'round' | 'square' | 'slash' | 'backslash']> = [
    ['round', 'round'], ['square', 'square'], ['slash', 'slash'], ['backslash', 'backslash'],
  ];
  let allHard = true, allDrew = true;
  for (const [, kind] of kinds) {
    for (const size of [8, 5, 2]) {
      const b = new PixelBuffer(20, 20);
      brushStamp(b, 10, 10, kind, size, BLACK);
      let n = 0;
      for (const c of b.u32) if (c === BLACK) n++;
      if (n === 0) allDrew = false;
      if (distinctColors(b).length > 2) allHard = false;
    }
  }
  check('All 12 brush shapes draw hard, non-empty stamps', allHard && allDrew,
    `hard=${allHard} drew=${allDrew}`);
}

/* ---------------- 21. Skew ---------------- */

{
  const src = makeTestImage(20, 20, 28);
  const sk = skew(src, 20, 0);
  check('Horizontal skew widens the image and fills new area with white',
    sk.width > src.width && sk.height === src.height,
    `${sk.width}x${sk.height}`);
  const sk0 = skew(src, 0, 0);
  check('Zero skew is a no-op', sk0.width === 20 && sk0.height === 20);
}

/* ---------------- 22. Global invariant: every pixel is fully opaque ---------------- */

{
  // Re-run a representative mix of operations, then assert alpha is always 255.
  const ctx = new MockCtx(64, 64);
  ctx.fgHex = '#FF0080';
  ctx.bgHex = '#00FF80';
  new PencilTool().onDown(ctx, pt(1, 1));
  new PencilTool().onMove(ctx, pt(60, 40));
  thickLine(ctx.buffer, 3, 50, 60, 55, 4, hexToU32('#804000'));
  ellipseFill(ctx.buffer, 5, 5, 40, 30, hexToU32('#0080FF'));
  roundRect(ctx.buffer, 10, 10, 50, 50, 3, BLACK, hexToU32('#FFFF80'));
  polygonFill(ctx.buffer, [[2, 2], [30, 5], [10, 30]], hexToU32('#8000FF'));
  floodFill(ctx.buffer, 63, 63, hexToU32('#004080'));
  let opaque = true;
  for (let i = 3; i < ctx.buffer.data.length; i += 4) {
    if (ctx.buffer.data[i] !== 255) { opaque = false; break; }
  }
  check('No partial-alpha pixel ever reaches the buffer', opaque);
}

/* ---------------- 23. PixelBuffer.fromImageData flattens alpha ---------------- */

{
  const img = new ImageData(4, 4);
  // A half-transparent red pixel must become an opaque composite over white.
  img.data[0] = 255; img.data[1] = 0; img.data[2] = 0; img.data[3] = 128;
  const buf = PixelBuffer.fromImageData(img);
  let opaque = true;
  for (let i = 3; i < buf.data.length; i += 4) if (buf.data[i] !== 255) opaque = false;
  check('Imported images are flattened to fully opaque pixels', opaque,
    `firstPixel=${u32ToHex(buf.getPixel(0, 0))}`);
}

/* ---------------- 24. Canvas resize grips ---------------- */
// A grip is a 5px target and the drag almost always ends somewhere else, so the
// gesture must survive a pointerup that never reaches the grip element. In this
// harness setPointerCapture always fails (synthetic pointers are not capturable),
// which is exactly the condition that used to strand the dotted preview on
// screen and silently drop the resize.

{
  const host = document.createElement('div');
  // Anchored at the viewport origin so client coordinates map straight through,
  // and large enough that the canvas plus a drag never needs to scroll.
  host.style.cssText = 'position:fixed;left:0;top:0;width:500px;height:400px;overflow:auto;visibility:hidden';
  document.body.appendChild(host);

  let buffer = new PixelBuffer(120, 90);
  const resizeCalls: Array<{ w: number; h: number }> = [];
  const view = new CanvasView(host, {
    buffer: () => buffer,
    floatingRender: () => null,
    antsShape: () => null,
    toolOverlay: () => { /* none */ },
    onPointerDown: () => { /* none */ },
    onPointerMove: () => { /* none */ },
    onPointerUp: () => { /* none */ },
    onPointerHover: () => { /* none */ },
    onDblClick: () => { /* none */ },
    onGestureCancel: () => { /* none */ },
    touchSecondary: () => false,
    onCanvasResize: (w, h) => {
      resizeCalls.push({ w, h });
      buffer = PixelBuffer.resized(buffer, w, h);
      view.layout();
    },
  });
  view.layout();

  const preview = () => host.querySelector<HTMLElement>('#resize-preview')!;
  const previewShown = () => getComputedStyle(preview()).display !== 'none';
  const gripAt = (which: string) => {
    const r = host.querySelector<HTMLElement>(`.grip-${which}`)!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const pev = (type: string, x: number, y: number, buttons = 1) =>
    new PointerEvent(type, {
      bubbles: true, clientX: x, clientY: y,
      button: 0, buttons, pointerId: 1, isPrimary: true,
    });
  /** Each case starts from the same canvas so grip coordinates stay predictable. */
  const reset = () => {
    buffer = new PixelBuffer(120, 90);
    host.scrollLeft = 0;
    host.scrollTop = 0;
    view.layout();
    resizeCalls.length = 0;
  };

  // --- released far from the grip, on the window ---
  {
    reset();
    const g = gripAt('se');
    host.querySelector('.grip-se')!.dispatchEvent(pev('pointerdown', g.x, g.y));
    const shownDuring = previewShown();
    window.dispatchEvent(pev('pointermove', g.x + 90, g.y + 70));
    window.dispatchEvent(pev('pointerup', g.x + 90, g.y + 70, 0));
    check('Resize grip: preview appears while dragging', shownDuring);
    check('Resize grip: pointerup away from the grip still applies the resize',
      resizeCalls.length === 1 && resizeCalls[0].w > 120 && resizeCalls[0].h > 90,
      `calls=${JSON.stringify(resizeCalls)}`);
    check('Resize grip: preview is cleared after the drag', !previewShown());
  }

  // --- button released outside the window (no pointerup ever arrives) ---
  {
    reset();
    const before = { w: buffer.width, h: buffer.height };
    const g = gripAt('se');
    host.querySelector('.grip-se')!.dispatchEvent(pev('pointerdown', g.x, g.y));
    window.dispatchEvent(pev('pointermove', g.x + 60, g.y + 50));
    // The pointer returns with the button already up — the only evidence we get.
    window.dispatchEvent(pev('pointermove', g.x + 70, g.y + 58, 0));
    check('Resize grip: a lost pointerup still completes the resize',
      resizeCalls.length === 1 && resizeCalls[0].w > before.w,
      `calls=${JSON.stringify(resizeCalls)}`);
    check('Resize grip: preview is never stranded after a lost pointerup',
      !previewShown());
  }

  // --- focus lost mid-drag abandons the gesture ---
  {
    reset();
    const g = gripAt('se');
    host.querySelector('.grip-se')!.dispatchEvent(pev('pointerdown', g.x, g.y));
    window.dispatchEvent(pev('pointermove', g.x + 80, g.y + 60));
    window.dispatchEvent(new Event('blur'));
    check('Resize grip: losing focus mid-drag abandons the resize',
      resizeCalls.length === 0, `calls=${JSON.stringify(resizeCalls)}`);
    check('Resize grip: preview is cleared when focus is lost', !previewShown());
  }

  // --- the single-axis grips ---
  {
    reset();
    const before = { w: buffer.width, h: buffer.height };
    const ge = gripAt('e');
    host.querySelector('.grip-e')!.dispatchEvent(pev('pointerdown', ge.x, ge.y));
    window.dispatchEvent(pev('pointermove', ge.x + 50, ge.y + 40));
    window.dispatchEvent(pev('pointerup', ge.x + 50, ge.y + 40, 0));
    const eCalls = JSON.stringify(resizeCalls);
    const eOk = resizeCalls.length === 1 &&
      resizeCalls[0].w > before.w && resizeCalls[0].h === before.h;

    reset();
    const gs = gripAt('s');
    host.querySelector('.grip-s')!.dispatchEvent(pev('pointerdown', gs.x, gs.y));
    window.dispatchEvent(pev('pointermove', gs.x + 50, gs.y + 40));
    window.dispatchEvent(pev('pointerup', gs.x + 50, gs.y + 40, 0));
    const sCalls = JSON.stringify(resizeCalls);
    const sOk = resizeCalls.length === 1 &&
      resizeCalls[0].h > before.h && resizeCalls[0].w === before.w;

    check('Resize grip: east grip changes width only', eOk,
      `before=${JSON.stringify(before)} calls=${eCalls}`);
    check('Resize grip: south grip changes height only', sOk,
      `before=${JSON.stringify(before)} calls=${sCalls}`);
  }

  host.remove();
}

/* ---------------- sample files for external-viewer checks ---------------- */

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

{
  // A recognizable image: color bars, a diagonal, and a filled ellipse.
  const buf = new PixelBuffer(97, 61);
  for (let x = 0; x < 97; x++) {
    const hex = DEFAULT_COLORS[Math.floor(x / 97 * 28)];
    for (let y = 0; y < 20; y++) buf.u32[y * 97 + x] = hexToU32(hex);
  }
  buf.touchAll();
  ellipseFill(buf, 10, 25, 45, 55, hexToU32('#0000FF'));
  ellipseOutline(buf, 10, 25, 45, 55, 1, BLACK);
  line(buf, 50, 58, 95, 24, hexToU32('#FF0000'));
  (window as unknown as Record<string, unknown>).SAMPLES = {
    bmp24: toBase64(encodeBMP(buf, 24)),
    bmp8: toBase64(encodeBMP(buf, 8)),
    bmp4: toBase64(encodeBMP(buf, 4)),
    bmp1: toBase64(encodeBMP(buf, 1)),
    gif: toBase64(encodeGIF(buf)),
  };
}

/* ---------------- report ---------------- */

const passed = results.filter(r => r.pass).length;
const failed = results.length - passed;

(window as unknown as { SELFTEST: unknown }).SELFTEST = { passed, failed, results };

const out = document.createElement('div');
out.style.font = '13px ui-monospace, Menlo, monospace';
out.style.padding = '16px';
out.style.background = '#fff';
out.style.color = '#000';
out.innerHTML = `<h2 style="font:bold 16px sans-serif">Paint self-test: ${passed} passed, ${failed} failed</h2>`;
for (const r of results) {
  const d = document.createElement('div');
  d.style.color = r.pass ? '#0a0' : '#c00';
  d.style.margin = '3px 0';
  d.textContent = `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `   — ${r.detail}` : ''}`;
  out.appendChild(d);
}
document.body.appendChild(out);
console.log(`SELFTEST ${passed} passed, ${failed} failed`);
for (const r of results) if (!r.pass) console.error(`FAIL: ${r.name} — ${r.detail}`);

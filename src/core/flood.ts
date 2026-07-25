// 4-connected scanline flood fill. Exact u32 match, zero tolerance, iterative
// with an explicit span stack — fills 5000×5000 without touching the JS stack.

import { PixelBuffer } from './pixelbuffer';

export function floodFill(buf: PixelBuffer, sx: number, sy: number, fill: number): boolean {
  const w = buf.width, h = buf.height;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;
  const u = buf.u32;
  const target = u[sy * w + sx];
  if (target === fill) return false;

  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  // Each stack entry: [xLeft, xRight, y, parentDir] — scan seeds row by row.
  const stack: number[] = [sx, sx, sy, 0];

  while (stack.length) {
    const dir = stack.pop()!;
    const y = stack.pop()!;
    let x2 = stack.pop()!;
    let x1 = stack.pop()!;
    void dir;
    let x = x1;
    // Extend left from x1
    if (u[y * w + x] === target) {
      while (x > 0 && u[y * w + x - 1] === target) x--;
    }
    let start = x;
    while (start <= x2) {
      // Find start of a fillable span
      while (start <= x2 && u[y * w + start] !== target) start++;
      if (start > x2) break;
      let end = start;
      while (end < w - 1 && u[y * w + end + 1] === target) end++;
      // Fill the span
      u.fill(fill, y * w + start, y * w + end + 1);
      if (start < minX) minX = start;
      if (end > maxX) maxX = end;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      // Seed rows above and below across this span
      if (y > 0) stack.push(start, end, y - 1, 0);
      if (y < h - 1) stack.push(start, end, y + 1, 0);
      start = end + 1;
    }
  }
  buf.touch(minX, minY, maxX + 1, maxY + 1);
  return true;
}

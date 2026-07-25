// Median-cut color quantization, shared by the GIF encoder and low-depth BMP.

/** Reduce the image's colors to at most maxColors; returns 0xRRGGBB entries. */
export function medianCut(u32: Uint32Array, maxColors: number): number[] {
  // Histogram of unique colors (as 0xRRGGBB with counts).
  const hist = new Map<number, number>();
  for (let i = 0; i < u32.length; i++) {
    const c = u32[i];
    const rgb = ((c & 0xff) << 16) | (c & 0xff00) | ((c >>> 16) & 0xff);
    hist.set(rgb, (hist.get(rgb) ?? 0) + 1);
  }
  if (hist.size <= maxColors) return [...hist.keys()];

  interface Box { colors: Array<[number, number]>; }   // [rgb, count]
  const boxes: Box[] = [{ colors: [...hist.entries()] }];

  const channelOf = (rgb: number, ch: number) => (rgb >>> (16 - ch * 8)) & 0xff;

  while (boxes.length < maxColors) {
    // Split the box with the largest channel range.
    let bestBox = -1, bestRange = -1, bestCh = 0;
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].colors.length < 2) continue;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const [rgb] of boxes[b].colors) {
          const v = channelOf(rgb, ch);
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > bestRange) { bestRange = hi - lo; bestBox = b; bestCh = ch; }
      }
    }
    if (bestBox === -1) break;
    const box = boxes[bestBox];
    box.colors.sort((a, b) => channelOf(a[0], bestCh) - channelOf(b[0], bestCh));
    // Split at the median by pixel weight.
    const total = box.colors.reduce((s, [, n]) => s + n, 0);
    let acc = 0, cut = 0;
    for (; cut < box.colors.length - 1; cut++) {
      acc += box.colors[cut][1];
      if (acc >= total / 2) break;
    }
    const right = { colors: box.colors.splice(cut + 1) };
    if (right.colors.length > 0) boxes.push(right);
  }

  return boxes.map(box => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const [rgb, count] of box.colors) {
      r += ((rgb >> 16) & 0xff) * count;
      g += ((rgb >> 8) & 0xff) * count;
      b += (rgb & 0xff) * count;
      n += count;
    }
    return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
  });
}

/** Nearest palette entry (palette entries are 0xRRGGBB; c is buffer u32 ABGR). */
export function nearestIndex(palette: number[], c: number): number {
  const r = c & 0xff, g = (c >>> 8) & 0xff, b = (c >>> 16) & 0xff;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - ((p >> 16) & 0xff), dg = g - ((p >> 8) & 0xff), db = b - (p & 0xff);
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

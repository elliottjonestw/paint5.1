// Minimal DOM shim so the pixel/codec modules can run under plain Node for
// command-line checks. Only what PixelBuffer touches: ImageData and a canvas
// whose 2D context is a no-op (encoders read the typed array, not the canvas).

const g = globalThis as unknown as Record<string, unknown>;

if (typeof g.ImageData === 'undefined') {
  g.ImageData = class {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
      if (typeof a === 'number') {
        this.width = a;
        this.height = b;
        this.data = new Uint8ClampedArray(a * b * 4);
      } else {
        this.data = a;
        this.width = b;
        this.height = c!;
      }
    }
  };
}

if (typeof g.document === 'undefined') {
  g.document = {
    createElement(tag: string) {
      if (tag !== 'canvas') return {};
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: false,
          putImageData: () => { /* no-op */ },
          drawImage: () => { /* no-op */ },
          getImageData: () => new (g.ImageData as new (w: number, h: number) => unknown)(1, 1),
          fillRect: () => { /* no-op */ },
        }),
      };
    },
  };
}

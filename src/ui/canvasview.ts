// Display layer. The visible canvas is viewport-sized in device pixels and is
// only ever blitted from the document's offscreen buffer with smoothing off —
// nearest-neighbor integer scaling, crisp on Retina. An overlay canvas carries
// display-only decorations (marching ants, previews); the pixel grid is drawn
// on the display pass in device space so it aligns exactly with pixel edges.

import { PixelBuffer } from '../core/pixelbuffer';
import { PointerInfo } from '../tools/tool';
import { deviceScale } from '../platform/uiscale';

export interface ViewDelegate {
  buffer(): PixelBuffer;
  /** Floating selection render, or null. */
  floatingRender(): { canvas: HTMLCanvasElement; x: number; y: number } | null;
  /** Ants geometry to draw, in buffer coords. */
  antsShape(): { kind: 'rect'; x: number; y: number; w: number; h: number }
    | { kind: 'poly'; pts: Array<[number, number]> }
    | null;
  toolOverlay(octx: CanvasRenderingContext2D,
    toCss: (bx: number, by: number) => { x: number; y: number }): void;
  onPointerDown(p: PointerInfo): void;
  onPointerMove(p: PointerInfo): void;
  onPointerUp(p: PointerInfo): void;
  onPointerHover(p: PointerInfo | null): void;   // status bar position
  onDblClick(p: PointerInfo): void;
  onCanvasResize(w: number, h: number): void;    // grip drag finished
  /** A second finger arrived: abandon whatever the first one was drawing. */
  onGestureCancel(): void;
  /** Touch draws with the background color (the color box's swap is armed). */
  touchSecondary(): boolean;
}

const MARGIN = 3;
const GRID_MIN_ZOOM = 4;

export class CanvasView {
  zoom = 1;
  showGrid = false;

  private workspace: HTMLElement;
  private extent: HTMLDivElement;
  private display: HTMLCanvasElement;
  private overlay: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private grips: { se: HTMLDivElement; e: HTMLDivElement; s: HTMLDivElement };
  private resizePreview: HTMLDivElement;
  private delegate: ViewDelegate;
  private antsPhase = 0;
  private antsTimer: number;
  private dragButton: 'L' | 'R' | null = null;
  /** Live touch points, for the two-finger pan gesture. */
  private touches = new Map<number, { x: number; y: number }>();
  private pan: { x: number; y: number; sl: number; st: number } | null = null;
  private gripDrag: {
    grip: 'se' | 'e' | 's';
    /** Latest previewed size, used when the drag ends without a usable event. */
    last: { w: number; h: number } | null;
  } | null = null;
  private gripListeners: {
    onMove: (e: PointerEvent) => void;
    onUp: (e: PointerEvent) => void;
    onCancel: () => void;
    onBlur: () => void;
  } | null = null;
  private thumb: { box: HTMLDivElement; canvas: HTMLCanvasElement } | null = null;
  thumbnailVisible = false;

  constructor(workspace: HTMLElement, delegate: ViewDelegate) {
    this.workspace = workspace;
    this.delegate = delegate;

    this.extent = document.createElement('div');
    this.extent.id = 'canvas-extent';
    workspace.appendChild(this.extent);

    this.display = document.createElement('canvas');
    this.display.id = 'display-canvas';
    this.overlay = document.createElement('canvas');
    this.overlay.id = 'overlay-canvas';
    this.extent.appendChild(this.display);
    this.extent.appendChild(this.overlay);
    this.dctx = this.display.getContext('2d')!;
    this.octx = this.overlay.getContext('2d')!;

    this.resizePreview = document.createElement('div');
    this.resizePreview.id = 'resize-preview';
    this.extent.appendChild(this.resizePreview);

    this.grips = {
      se: this.makeGrip('se'),
      e: this.makeGrip('e'),
      s: this.makeGrip('s'),
    };

    workspace.addEventListener('scroll', () => this.render());
    new ResizeObserver(() => this.render()).observe(workspace);

    this.overlay.addEventListener('pointerdown', e => this.pointerDown(e));
    this.overlay.addEventListener('pointermove', e => this.pointerMove(e));
    this.overlay.addEventListener('pointerup', e => this.pointerUp(e));
    this.overlay.addEventListener('pointercancel', e => this.pointerUp(e));
    this.overlay.addEventListener('pointerleave', () => {
      if (!this.dragButton) this.delegate.onPointerHover(null);
    });
    this.overlay.addEventListener('dblclick', e => {
      this.delegate.onDblClick(this.info(e as PointerEvent, this.dragButton ?? 'L'));
    });

    this.antsTimer = window.setInterval(() => {
      if (this.delegate.antsShape()) {
        this.antsPhase = (this.antsPhase + 1) % 8;
        this.renderOverlay();
      }
    }, 150);
    void this.antsTimer;
  }

  setCursor(cursor: string): void {
    this.overlay.style.cursor = cursor;
  }

  /** The scrolling content div; the text editor overlay is parented here. */
  get extentEl(): HTMLElement {
    return this.extent;
  }

  /* ---------- geometry ---------- */

  private info(e: PointerEvent, button: 'L' | 'R'): PointerInfo {
    const r = this.workspace.getBoundingClientRect();
    const cssX = e.clientX - r.left + this.workspace.scrollLeft - MARGIN;
    const cssY = e.clientY - r.top + this.workspace.scrollTop - MARGIN;
    return {
      x: Math.floor(cssX / this.zoom),
      y: Math.floor(cssY / this.zoom),
      button,
      shift: e.shiftKey,
      alt: e.altKey,
      raw: e,
    };
  }

  toCss = (bx: number, by: number): { x: number; y: number } => {
    return {
      x: MARGIN + bx * this.zoom - this.workspace.scrollLeft,
      y: MARGIN + by * this.zoom - this.workspace.scrollTop,
    };
  };

  visibleCenter(): { x: number; y: number } {
    const buf = this.delegate.buffer();
    const cx = (this.workspace.scrollLeft + this.workspace.clientWidth / 2 - MARGIN) / this.zoom;
    const cy = (this.workspace.scrollTop + this.workspace.clientHeight / 2 - MARGIN) / this.zoom;
    return {
      x: Math.max(0, Math.min(buf.width, Math.round(cx))),
      y: Math.max(0, Math.min(buf.height, Math.round(cy))),
    };
  }

  /** Top-left visible corner in buffer coords (for paste placement). */
  visibleTopLeft(): { x: number; y: number } {
    return {
      x: Math.max(0, Math.floor((this.workspace.scrollLeft - MARGIN) / this.zoom)),
      y: Math.max(0, Math.floor((this.workspace.scrollTop - MARGIN) / this.zoom)),
    };
  }

  viewportSize(): { w: number; h: number } {
    return { w: this.workspace.clientWidth, h: this.workspace.clientHeight };
  }

  setZoom(z: number, centerOn?: { x: number; y: number }): void {
    this.zoom = z;
    this.layout();
    if (centerOn) {
      this.workspace.scrollLeft = MARGIN + centerOn.x * z - this.workspace.clientWidth / 2;
      this.workspace.scrollTop = MARGIN + centerOn.y * z - this.workspace.clientHeight / 2;
    }
    this.render();
  }

  /* ---------- layout ---------- */

  layout(): void {
    const buf = this.delegate.buffer();
    const w = buf.width * this.zoom, h = buf.height * this.zoom;
    this.extent.style.width = `${MARGIN + w + 10}px`;
    this.extent.style.height = `${MARGIN + h + 10}px`;
    const g = this.grips;
    g.se.style.left = `${MARGIN + w + 1}px`;
    g.se.style.top = `${MARGIN + h + 1}px`;
    g.e.style.left = `${MARGIN + w + 1}px`;
    g.e.style.top = `${MARGIN + Math.floor(h / 2) - 2}px`;
    g.s.style.left = `${MARGIN + Math.floor(w / 2) - 2}px`;
    g.s.style.top = `${MARGIN + h + 1}px`;
    this.render();
  }

  /* ---------- rendering ---------- */

  render(): void {
    const buf = this.delegate.buffer();
    const dpr = deviceScale();
    const viewW = this.workspace.clientWidth;
    const viewH = this.workspace.clientHeight;
    if (viewW === 0 || viewH === 0) return;
    const sl = this.workspace.scrollLeft, st = this.workspace.scrollTop;

    for (const cv of [this.display, this.overlay]) {
      const bw = Math.round(viewW * dpr), bh = Math.round(viewH * dpr);
      if (cv.width !== bw) cv.width = bw;
      if (cv.height !== bh) cv.height = bh;
      cv.style.width = `${viewW}px`;
      cv.style.height = `${viewH}px`;
      cv.style.left = `${sl}px`;
      cv.style.top = `${st}px`;
    }

    const ctx = this.dctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, this.display.width, this.display.height);

    const z = this.zoom;
    const sx0 = Math.max(0, Math.floor((sl - MARGIN) / z));
    const sy0 = Math.max(0, Math.floor((st - MARGIN) / z));
    const sx1 = Math.min(buf.width, Math.ceil((sl - MARGIN + viewW) / z));
    const sy1 = Math.min(buf.height, Math.ceil((st - MARGIN + viewH) / z));
    const dx = Math.round((MARGIN + sx0 * z - sl) * dpr);
    const dy = Math.round((MARGIN + sy0 * z - st) * dpr);

    // Sunken 1px border around the bitmap
    const bx = Math.round((MARGIN - sl) * dpr), by = Math.round((MARGIN - st) * dpr);
    const bw = buf.width * z * dpr, bh = buf.height * z * dpr;
    ctx.fillStyle = '#ACA899';
    ctx.fillRect(bx - dpr, by - dpr, bw + dpr, dpr);
    ctx.fillRect(bx - dpr, by - dpr, dpr, bh + dpr);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(bx, by + bh, bw + dpr, dpr);
    ctx.fillRect(bx + bw, by, dpr, bh + dpr);

    if (sx1 > sx0 && sy1 > sy0) {
      ctx.drawImage(
        buf.canvas,
        sx0, sy0, sx1 - sx0, sy1 - sy0,
        dx, dy, (sx1 - sx0) * z * dpr, (sy1 - sy0) * z * dpr,
      );
    }

    // Floating selection composited on top (display only — buffer untouched).
    const float = this.delegate.floatingRender();
    if (float) {
      ctx.drawImage(
        float.canvas,
        Math.round((MARGIN + float.x * z - sl) * dpr),
        Math.round((MARGIN + float.y * z - st) * dpr),
        float.canvas.width * z * dpr,
        float.canvas.height * z * dpr,
      );
    }

    // Pixel grid at >= 4x (display only, device space, aligned with dx/dy).
    if (this.showGrid && z >= GRID_MIN_ZOOM) {
      ctx.fillStyle = '#808080';
      const gx0 = Math.round((MARGIN - sl) * dpr);
      const gy0 = Math.round((MARGIN - st) * dpr);
      for (let i = sx0; i <= sx1; i++) {
        ctx.fillRect(gx0 + i * z * dpr, by, dpr, bh);
      }
      for (let j = sy0; j <= sy1; j++) {
        ctx.fillRect(bx, gy0 + j * z * dpr, bw, dpr);
      }
    }

    this.renderOverlay();
    this.renderThumbnail();
  }

  renderOverlay(): void {
    const ctx = this.octx;
    const dpr = deviceScale();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const ants = this.delegate.antsShape();
    if (ants) this.drawAnts(ctx, ants);
    this.delegate.toolOverlay(ctx, this.toCss);
  }

  private drawAnts(
    ctx: CanvasRenderingContext2D,
    shape: { kind: 'rect'; x: number; y: number; w: number; h: number }
      | { kind: 'poly'; pts: Array<[number, number]> },
  ): void {
    ctx.lineWidth = 1;
    const trace = () => {
      ctx.beginPath();
      if (shape.kind === 'rect') {
        const a = this.toCss(shape.x, shape.y);
        const b = this.toCss(shape.x + shape.w, shape.y + shape.h);
        ctx.rect(a.x + 0.5, a.y + 0.5, b.x - a.x - 1, b.y - a.y - 1);
      } else {
        const pts = shape.pts;
        if (pts.length < 2) return;
        const p0 = this.toCss(pts[0][0], pts[0][1]);
        ctx.moveTo(p0.x + 0.5, p0.y + 0.5);
        for (let i = 1; i < pts.length; i++) {
          const p = this.toCss(pts[i][0], pts[i][1]);
          ctx.lineTo(p.x + 0.5, p.y + 0.5);
        }
        ctx.closePath();
      }
    };
    ctx.strokeStyle = '#FFFFFF';
    ctx.setLineDash([]);
    trace();
    ctx.stroke();
    ctx.strokeStyle = '#000000';
    ctx.setLineDash([3, 3]);
    ctx.lineDashOffset = this.antsPhase;
    trace();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /* ---------- thumbnail ---------- */

  setThumbnailVisible(v: boolean): void {
    this.thumbnailVisible = v;
    if (!this.thumb) {
      const box = document.createElement('div');
      box.id = 'thumbnail';
      const canvas = document.createElement('canvas');
      box.appendChild(canvas);
      document.body.appendChild(box);
      this.thumb = { box, canvas };
      // draggable
      let drag: { x: number; y: number; l: number; t: number } | null = null;
      box.addEventListener('pointerdown', e => {
        drag = { x: e.clientX, y: e.clientY, l: box.offsetLeft, t: box.offsetTop };
        box.setPointerCapture(e.pointerId);
      });
      box.addEventListener('pointermove', e => {
        if (!drag) return;
        box.style.left = `${drag.l + e.clientX - drag.x}px`;
        box.style.top = `${drag.t + e.clientY - drag.y}px`;
      });
      box.addEventListener('pointerup', () => { drag = null; });
      box.style.right = '30px';
      box.style.top = '60px';
      box.style.left = 'auto';
    }
    this.thumb.box.style.display = v ? 'block' : 'none';
    if (v) this.renderThumbnail();
  }

  private renderThumbnail(): void {
    if (!this.thumbnailVisible || !this.thumb) return;
    const buf = this.delegate.buffer();
    const maxDim = 108;
    const scale = Math.min(1, maxDim / buf.width, maxDim / buf.height);
    const w = Math.max(1, Math.round(buf.width * scale));
    const h = Math.max(1, Math.round(buf.height * scale));
    const cv = this.thumb.canvas;
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    const tctx = cv.getContext('2d')!;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(buf.canvas, 0, 0, w, h);
  }

  /* ---------- pointer routing ---------- */

  /**
   * One finger draws, so the workspace can never be flick-scrolled the way a
   * web page is (the overlay sets touch-action: none). Two fingers pan it
   * instead, which is the only gesture the mouse build has no equivalent for.
   */
  private midpoint(): { x: number; y: number } {
    let x = 0, y = 0;
    for (const p of this.touches.values()) { x += p.x; y += p.y; }
    const n = Math.max(1, this.touches.size);
    return { x: x / n, y: y / n };
  }

  private beginPan(): void {
    if (this.dragButton) {
      this.dragButton = null;
      this.delegate.onGestureCancel();
    }
    const m = this.midpoint();
    this.pan = { x: m.x, y: m.y, sl: this.workspace.scrollLeft, st: this.workspace.scrollTop };
  }

  private pointerDown(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size > 1) {
        this.beginPan();
        return;
      }
      if (this.pan) return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const secondary = e.pointerType !== 'mouse' && this.delegate.touchSecondary();
    const button: 'L' | 'R' = (e.button === 2 || e.ctrlKey || secondary) ? 'R' : 'L';
    this.dragButton = button;
    // Capture keeps drags alive outside the canvas, but must never be able to
    // swallow the stroke itself if the pointer is no longer capturable.
    try {
      this.overlay.setPointerCapture(e.pointerId);
    } catch {
      /* drag still works, it just stops tracking outside the element */
    }
    this.delegate.onPointerDown(this.info(e, button));
  }

  private pointerMove(e: PointerEvent): void {
    if (e.pointerType !== 'mouse' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.pan) {
      const m = this.midpoint();
      this.workspace.scrollLeft = this.pan.sl + (this.pan.x - m.x);
      this.workspace.scrollTop = this.pan.st + (this.pan.y - m.y);
      return;
    }
    const p = this.info(e, this.dragButton ?? 'L');
    this.delegate.onPointerHover(p);
    this.delegate.onPointerMove(p);
  }

  private pointerUp(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') this.touches.delete(e.pointerId);
    if (this.pan) {
      // Lifting one of two fingers must not hand the stroke to the other one;
      // stay in pan mode until the last finger goes, re-basing so it doesn't jump.
      if (this.touches.size === 0) this.pan = null;
      else this.beginPan();
      return;
    }
    if (!this.dragButton) return;
    const p = this.info(e, this.dragButton);
    this.dragButton = null;
    this.delegate.onPointerUp(p);
  }

  /* ---------- resize grips ---------- */

  /**
   * A grip is a 5px target and the drag routinely ends far away from it — past
   * the workspace edge, or even outside the window. Tracking the drag on the
   * grip element alone means a missed pointerup strands the dotted preview
   * on screen and never applies the resize, so the whole gesture is tracked on
   * `window` instead, with several independent ways to end it.
   */
  private makeGrip(which: 'se' | 'e' | 's'): HTMLDivElement {
    const g = document.createElement('div');
    g.className = `grip grip-${which}`;
    this.extent.appendChild(g);

    const onMove = (e: PointerEvent) => {
      if (!this.gripDrag) return;
      // The button was released somewhere we never heard about (most often
      // outside the window). Treat the first button-less move as the release.
      if (e.buttons === 0) {
        this.finishGripDrag(e, true);
        return;
      }
      this.updateResizePreview(e);
    };
    const onUp = (e: PointerEvent) => this.finishGripDrag(e, true);
    const onCancel = () => this.finishGripDrag(null, false);
    const onBlur = () => this.finishGripDrag(null, false);

    g.addEventListener('pointerdown', e => {
      e.stopPropagation();
      e.preventDefault();
      if (this.gripDrag) this.finishGripDrag(null, false);
      this.gripDrag = { grip: which, last: null };
      // Must be recorded here, not at grip-creation time: each grip builds its
      // own closures, and removeEventListener needs these exact references.
      this.gripListeners = { onMove, onUp, onCancel, onBlur };
      try {
        g.setPointerCapture(e.pointerId);
      } catch {
        /* window-level listeners below carry the drag regardless */
      }
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onCancel, true);
      window.addEventListener('blur', onBlur);
      this.resizePreview.style.display = 'block';
      this.updateResizePreview(e);
    });
    return g;
  }

  /** End a grip drag. `apply` commits the resize; otherwise it is abandoned. */
  private finishGripDrag(e: PointerEvent | null, apply: boolean): void {
    const drag = this.gripDrag;
    if (!drag) return;
    const size = e ? this.previewSize(e) : drag.last;
    this.gripDrag = null;
    this.resizePreview.style.display = 'none';
    const l = this.gripListeners;
    if (l) {
      window.removeEventListener('pointermove', l.onMove, true);
      window.removeEventListener('pointerup', l.onUp, true);
      window.removeEventListener('pointercancel', l.onCancel, true);
      window.removeEventListener('blur', l.onBlur);
    }
    if (apply && size) this.delegate.onCanvasResize(size.w, size.h);
  }

  private previewSize(e: PointerEvent): { w: number; h: number } {
    const buf = this.delegate.buffer();
    const r = this.workspace.getBoundingClientRect();
    const cssX = e.clientX - r.left + this.workspace.scrollLeft - MARGIN;
    const cssY = e.clientY - r.top + this.workspace.scrollTop - MARGIN;
    let w = buf.width, h = buf.height;
    const grip = this.gripDrag!.grip;
    if (grip === 'se' || grip === 'e') w = Math.max(1, Math.round(cssX / this.zoom));
    if (grip === 'se' || grip === 's') h = Math.max(1, Math.round(cssY / this.zoom));
    return { w, h };
  }

  private updateResizePreview(e: PointerEvent): void {
    const { w, h } = this.previewSize(e);
    if (this.gripDrag) this.gripDrag.last = { w, h };
    this.resizePreview.style.left = `${MARGIN - 1}px`;
    this.resizePreview.style.top = `${MARGIN - 1}px`;
    this.resizePreview.style.width = `${w * this.zoom}px`;
    this.resizePreview.style.height = `${h * this.zoom}px`;
  }
}

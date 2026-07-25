// Application wiring: owns the document, palette, options, history and view,
// implements ToolContext and ViewDelegate, and dispatches every menu command.

import { PaintDocument, SaveFormat } from './core/doc';
import { PixelBuffer } from './core/pixelbuffer';
import { HistoryStack, takeSnapshot, Snapshot } from './core/history';
import {
  invert, flipH, flipV, rotate, stretchNN, skew, ditherToMono,
} from './core/raster';
import { Tool, ToolId, ToolContext, ToolOptions, defaultOptions, PointerInfo } from './tools/tool';
import { PencilTool, BrushTool, EraserTool, AirbrushTool } from './tools/freehand';
import { LineTool, RectTool, RoundRectTool, EllipseTool, CurveTool, PolygonTool } from './tools/shapes';
import { FillTool } from './tools/fill';
import { PickerTool } from './tools/picker';
import { MagnifierTool } from './tools/magnifier';
import { SelectTool, FreeSelectTool, SelectionManager } from './tools/select';
import { TextTool } from './tools/text';

import { CanvasView, ViewDelegate } from './ui/canvasview';
import { ToolBox } from './ui/toolbox';
import { OptionsPane } from './ui/optionspane';
import { ColorBox, Palette } from './ui/colorbox';
import { StatusBar } from './ui/statusbar';
import { MenuBar, Menu, MenuItem } from './ui/menubar';
import { buildMenus, MenuState } from './ui/menudef';
import { DialogHost, mkEdit, mkRow } from './ui/dialogs';
import { attributesDialog, flipRotateDialog, stretchSkewDialog, customZoomDialog } from './ui/dlg_image';
import { aboutDialog, pageSetupDialog, printPreviewDialog, defaultPageSetup, PageSetup } from './ui/dlg_misc';
import { editColorsDialog } from './ui/dlg_colors';
import { FontBar } from './ui/fontbar';

import {
  openImageFile, openImagePath, encodeFor, saveBytesAs, saveBytesTo, formatForName,
  losesColor, recentFiles, pushRecent, FORMAT_LABELS,
} from './io/fileio';
import { clipboardRead, clipboardWrite } from './io/clipboard';
import { bridge, isElectron } from './platform/bridge';

const DEFAULT_W = 512;
const DEFAULT_H = 384;

/** Cmd-based accelerators for the native (OS-level) menu. */
const NATIVE_ACCELS: Record<string, string> = {
  'file.new': 'CmdOrCtrl+N',
  'file.open': 'CmdOrCtrl+O',
  'file.save': 'CmdOrCtrl+S',
  'file.print': 'CmdOrCtrl+P',
  'edit.undo': 'CmdOrCtrl+Z',
  'edit.repeat': 'CmdOrCtrl+Y',
  'edit.cut': 'CmdOrCtrl+X',
  'edit.copy': 'CmdOrCtrl+C',
  'edit.paste': 'CmdOrCtrl+V',
  'edit.selectall': 'CmdOrCtrl+A',
  'view.toolbox': 'CmdOrCtrl+T',
  'view.colorbox': 'CmdOrCtrl+L',
  'view.zoom.normal': 'CmdOrCtrl+PageUp',
  'view.zoom.large': 'CmdOrCtrl+PageDown',
  'view.zoom.grid': 'CmdOrCtrl+G',
  'view.viewbitmap': 'CmdOrCtrl+F',
  'image.fliprotate': 'CmdOrCtrl+R',
  'image.stretchskew': 'CmdOrCtrl+W',
  'image.invert': 'CmdOrCtrl+I',
  'image.attributes': 'CmdOrCtrl+E',
  'image.clear': 'CmdOrCtrl+Shift+N',
};

/** Renderer-side keyboard accelerators: [key, needsShift] → command id. */
const KEY_COMMANDS: Array<{ key: string; shift?: boolean; id: string }> = [
  { key: 'n', id: 'file.new' },
  { key: 'n', shift: true, id: 'image.clear' },
  { key: 'o', id: 'file.open' },
  { key: 's', id: 'file.save' },
  { key: 'p', id: 'file.print' },
  { key: 'z', id: 'edit.undo' },
  { key: 'y', id: 'edit.repeat' },
  { key: 'x', id: 'edit.cut' },
  { key: 'c', id: 'edit.copy' },
  { key: 'v', id: 'edit.paste' },
  { key: 'a', id: 'edit.selectall' },
  { key: 't', id: 'view.toolbox' },
  { key: 'l', id: 'view.colorbox' },
  { key: 'g', id: 'view.zoom.grid' },
  { key: 'f', id: 'view.viewbitmap' },
  { key: 'r', id: 'image.fliprotate' },
  { key: 'w', id: 'image.stretchskew' },
  { key: 'i', id: 'image.invert' },
  { key: 'e', id: 'image.attributes' },
  { key: 'pageup', id: 'view.zoom.normal' },
  { key: 'pagedown', id: 'view.zoom.large' },
];

class App implements ToolContext, ViewDelegate, MenuState {
  doc = new PaintDocument(DEFAULT_W, DEFAULT_H);
  palette = new Palette();
  options: ToolOptions = defaultOptions();
  history = new HistoryStack();
  sel = new SelectionManager();
  dialogs = new DialogHost();
  fontbar = new FontBar();
  statusbar = new StatusBar();

  private view!: CanvasView;
  private toolbox!: ToolBox;
  private optionsPane!: OptionsPane;
  private colorbox!: ColorBox;
  private menubar!: MenuBar;
  private menus!: Menu[];

  private tools = new Map<ToolId, Tool>();
  private toolId: ToolId = 'pencil';
  private prevToolId: ToolId = 'pencil';

  private pendingSnapshot: Snapshot | null = null;
  private mono = false;
  private pageSetup: PageSetup = defaultPageSetup();
  private viewBitmapEl: HTMLDivElement | null = null;

  constructor() {
    const workspace = document.getElementById('workspace')!;

    const textTool = new TextTool(this.fontbar, () => this.view.extentEl);
    for (const t of [
      new FreeSelectTool(), new SelectTool(),
      new EraserTool(), new FillTool(),
      new PickerTool(), new MagnifierTool(),
      new PencilTool(), new BrushTool(),
      new AirbrushTool(), textTool,
      new LineTool(), new CurveTool(),
      new RectTool(), new PolygonTool(),
      new EllipseTool(), new RoundRectTool(),
    ] as Tool[]) {
      this.tools.set(t.id, t);
    }

    this.view = new CanvasView(workspace, this);
    this.toolbox = new ToolBox(
      document.getElementById('toolbox')!,
      id => this.selectTool(id),
      text => this.statusbar.setHint(text),
    );
    this.optionsPane = new OptionsPane(
      document.getElementById('tooloptions')!,
      this.options,
      () => this.onOptionsChanged(),
    );
    this.colorbox = new ColorBox(
      document.getElementById('colorbox')!,
      this.palette,
      (i, custom) => this.editColorCell(i, custom),
    );
    this.palette.onChange = () => {
      this.colorbox.refresh();
      const tool = this.tools.get(this.toolId);
      if (tool?.id === 'text') (tool as TextTool).applyEditorStyle();
    };

    this.menus = buildMenus(this);
    this.menubar = new MenuBar(
      document.getElementById('menubar')!,
      this.menus,
      id => void this.exec(id),
      text => this.statusbar.setHint(text),
    );

    this.installGlobalHandlers();
    this.selectTool('pencil', true);
    this.view.layout();
    this.updateTitle();
    this.pushNativeMenu();
  }

  /* ================= ToolContext ================= */

  buf(): PixelBuffer { return this.doc.buffer; }
  fg(): number { return this.palette.fg; }
  bg(): number { return this.palette.bg; }
  setFgHex(hex: string): void { this.palette.setFg(hex); }
  setBgHex(hex: string): void { this.palette.setBg(hex); }

  beginStroke(): void {
    this.pendingSnapshot = takeSnapshot(this.doc.buffer);
  }

  restoreRect(x: number, y: number, w: number, h: number): void {
    if (!this.pendingSnapshot) return;
    this.doc.buffer.restoreRect(this.pendingSnapshot.data, x, y, w, h);
  }

  restoreAll(): void {
    if (this.pendingSnapshot) this.doc.buffer.restore(this.pendingSnapshot.data);
  }

  endStroke(): void {
    if (!this.pendingSnapshot) return;
    this.history.push(this.pendingSnapshot);
    this.pendingSnapshot = null;
    this.doc.dirty = true;
    this.pushNativeMenu();
  }

  cancelStroke(): void {
    if (!this.pendingSnapshot) return;
    this.doc.buffer.restore(this.pendingSnapshot.data);
    this.pendingSnapshot = null;
  }

  strokeActive(): boolean { return this.pendingSnapshot !== null; }

  repaint(): void {
    this.doc.buffer.sync();
    this.view.render();
  }

  setStatusSize(text: string): void { this.statusbar.setSize(text); }
  setStatusHint(text: string): void { this.statusbar.setHint(text); }

  zoom(): number { return this.view.zoom; }

  setZoom(z: number, centerOn?: { x: number; y: number }): void {
    this.view.setZoom(z, centerOn ?? this.view.visibleCenter());
    this.refreshCursor();
    const tool = this.tools.get(this.toolId);
    if (tool?.id === 'text') (tool as TextTool).applyEditorStyle();
    this.pushNativeMenu();
  }

  currentTool(): ToolId { return this.toolId; }
  previousToolId(): ToolId { return this.prevToolId; }
  selection(): SelectionManager { return this.sel; }
  renderOverlay(): void { this.view.renderOverlay(); }
  setCursor(cursor: string): void { this.view.setCursor(cursor); }

  selectTool(id: ToolId, force = false): void {
    if (id === this.toolId && !force) return;
    const old = this.tools.get(this.toolId);
    if (!force) old?.deactivate?.(this);
    if (this.toolId !== 'picker') this.prevToolId = this.toolId;
    this.toolId = id;
    const tool = this.tools.get(id)!;
    tool.activate?.(this);
    this.toolbox.setSelected(id);
    this.optionsPane.render(id);
    this.statusbar.setToolHint(tool.hint);
    this.refreshCursor();
    this.view.render();
    this.pushNativeMenu();
  }

  anchorSelection(): void {
    const sel = this.sel;
    if (sel.lifted) {
      sel.stamp(this.doc.buffer, this.options.selectionTransparent, this.palette.bg);
      sel.discard();
      this.endStroke();
      this.repaint();
    } else {
      sel.discard();
      this.cancelStroke();
      this.view.renderOverlay();
    }
    this.pushNativeMenu();
  }

  /* ================= ViewDelegate ================= */

  buffer(): PixelBuffer { return this.doc.buffer; }

  floatingRender(): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    return this.sel.renderFor(this.options.selectionTransparent, this.palette.bg);
  }

  antsShape() { return this.sel.antsShape(); }

  toolOverlay(
    octx: CanvasRenderingContext2D,
    toCss: (bx: number, by: number) => { x: number; y: number },
  ): void {
    this.tools.get(this.toolId)?.drawOverlay?.(this, octx, toCss);
  }

  onPointerDown(p: PointerInfo): void {
    if (this.dialogs.open) return;
    this.tools.get(this.toolId)!.onDown(this, p);
  }

  onPointerMove(p: PointerInfo): void {
    if (this.dialogs.open) return;
    this.tools.get(this.toolId)!.onMove(this, p);
  }

  onPointerUp(p: PointerInfo): void {
    if (this.dialogs.open) return;
    this.tools.get(this.toolId)!.onUp(this, p);
    this.pushNativeMenu();
  }

  onDblClick(p: PointerInfo): void {
    if (this.dialogs.open) return;
    this.tools.get(this.toolId)!.onDblClick?.(this, p);
  }

  onPointerHover(p: PointerInfo | null): void {
    const buf = this.doc.buffer;
    if (!p || p.x < 0 || p.y < 0 || p.x >= buf.width || p.y >= buf.height) {
      this.statusbar.setPos('');
    } else {
      this.statusbar.setPos(`${p.x},${p.y}`);
    }
  }

  onCanvasResize(w: number, h: number): void {
    if (w === this.doc.buffer.width && h === this.doc.buffer.height) return;
    // Destructive: crop, or extend with white. Never interpolate.
    this.replaceBuffer(PixelBuffer.resized(this.doc.buffer, w, h));
  }

  /* ================= MenuState ================= */

  canUndo(): boolean { return this.history.canUndo(); }
  canRedo(): boolean { return this.history.canRedo(); }
  hasSelection(): boolean { return this.sel.lifted || this.sel.rect !== null; }
  clipboardMaybeAvailable(): boolean { return true; }
  toolboxVisible(): boolean { return !document.getElementById('leftpanel')!.hidden; }
  colorboxVisible(): boolean { return !document.getElementById('colorrow')!.hidden; }
  statusbarVisible(): boolean { return !document.getElementById('statusbar')!.hidden; }
  textToolbarAvailable(): boolean { return this.toolId === 'text'; }
  textToolbarVisible(): boolean { return this.fontbar.visible; }
  showGrid(): boolean { return this.view.showGrid; }
  showThumbnail(): boolean { return this.view.thumbnailVisible; }
  drawOpaque(): boolean { return !this.options.selectionTransparent; }
  recentFiles(): string[] { return recentFiles().map(r => r.name); }

  /* ================= plumbing ================= */

  private onOptionsChanged(): void {
    this.refreshCursor();
    this.view.render();
    const tool = this.tools.get(this.toolId);
    if (tool?.id === 'text') (tool as TextTool).applyEditorStyle();
    this.pushNativeMenu();
  }

  private refreshCursor(): void {
    this.view.setCursor(this.tools.get(this.toolId)!.cursor(this));
  }

  private updateTitle(): void {
    const title = `${this.doc.displayName} - Paint`;
    document.title = title;
    bridge?.setTitle(title);
  }

  private applySnapshot(snap: Snapshot): void {
    const buf = this.doc.buffer;
    if (snap.width !== buf.width || snap.height !== buf.height) {
      this.doc.buffer = new PixelBuffer(snap.width, snap.height, snap.data);
      this.doc.buffer.sync();
      this.view.layout();
    } else {
      buf.restore(snap.data);
    }
    this.repaint();
  }

  /** Replace the whole buffer (dimension-changing ops), recording undo. */
  private replaceBuffer(nb: PixelBuffer, recordUndo = true): void {
    if (recordUndo) this.history.push(takeSnapshot(this.doc.buffer));
    this.doc.buffer = nb;
    nb.touchAll();
    nb.sync();
    this.doc.dirty = true;
    this.view.layout();
    this.repaint();
    this.pushNativeMenu();
  }

  private installGlobalHandlers(): void {
    // No context menu, ever — right-drag is a drawing gesture.
    document.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('dragstart', e => e.preventDefault());

    document.addEventListener('keydown', e => this.onKeyDown(e));

    window.addEventListener('resize', () => this.view.render());

    if (bridge) {
      bridge.onMenuCommand(id => void this.exec(id));
      bridge.onCloseRequest(() => void this.handleCloseRequest());
      bridge.onOpenPath(p => void this.openPath(p));
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.viewBitmapEl) {
      this.hideViewBitmap();
      e.preventDefault();
      return;
    }
    if (this.dialogs.open) return;

    const target = e.target as HTMLElement | null;
    const inEditor = !!target && (target.isContentEditable || target.tagName === 'INPUT');

    // Let the active tool see plain keys first (Escape, arrows).
    if (!inEditor && !e.metaKey && !e.ctrlKey) {
      if (this.tools.get(this.toolId)!.onKey?.(this, e)) {
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.hasSelection()) {
          e.preventDefault();
          void this.exec('edit.clear');
        }
        return;
      }
    }

    if (!e.metaKey && !e.ctrlKey) return;
    // In Electron the native menu owns Cmd combos; Ctrl combos stay here.
    if (isElectron && e.metaKey) return;
    // While editing text, leave every combo to the editor's own handling.
    if (inEditor) return;

    const key = e.key.toLowerCase();
    for (const k of KEY_COMMANDS) {
      if (k.key !== key) continue;
      if (!!k.shift !== !!e.shiftKey) continue;
      e.preventDefault();
      void this.exec(k.id);
      return;
    }
    // Crop to selection: not in XP's menus, exposed as a shortcut only. See README.
    if (key === 'x' && e.shiftKey) {
      e.preventDefault();
      void this.exec('edit.crop');
    }
  }

  /* ================= native menu ================= */

  private nativeMenuTimer: number | null = null;

  private pushNativeMenu(): void {
    if (!bridge) return;
    if (this.nativeMenuTimer !== null) return;
    const b = bridge;
    this.nativeMenuTimer = window.setTimeout(() => {
      this.nativeMenuTimer = null;
      b.setNativeMenu(this.menus.map(m => this.nativeMenu(m)));
    }, 0);
  }

  private nativeMenu(menu: Menu): unknown {
    return {
      label: menu.title.replace(/&/g, ''),
      submenu: this.nativeItems(menu.items),
    };
  }

  private nativeItems(items: MenuItem[]): unknown[] {
    const out: unknown[] = [];
    for (const raw of items) {
      const list = raw.dynamic ? raw.dynamic() : [raw];
      for (const it of list) {
        if (it.sep) { out.push({ type: 'separator' }); continue; }
        const node: Record<string, unknown> = {
          label: (it.label ?? '').replace(/&/g, ''),
          enabled: it.enabled ? it.enabled() : true,
        };
        if (it.id) node.id = it.id;
        if (it.sub) node.submenu = this.nativeItems(it.sub);
        if (it.checked) {
          node.type = it.radio ? 'radio' : 'checkbox';
          node.checked = it.checked();
        }
        if (it.id && NATIVE_ACCELS[it.id]) node.accelerator = NATIVE_ACCELS[it.id];
        out.push(node);
      }
    }
    return out;
  }

  /* ================= command dispatch ================= */

  async exec(id: string): Promise<void> {
    if (id.startsWith('file.recent.')) {
      const idx = parseInt(id.slice('file.recent.'.length), 10);
      const entry = recentFiles()[idx];
      if (entry) await this.openPath(entry.path);
      return;
    }
    switch (id) {
      /* ---- File ---- */
      case 'file.new': await this.newDocument(); break;
      case 'file.open': await this.openDocument(); break;
      case 'file.save': await this.save(); break;
      case 'file.saveas': await this.saveAs(); break;
      case 'file.pagesetup': {
        const r = await pageSetupDialog(this.dialogs, this.pageSetup);
        if (r) this.pageSetup = r;
        break;
      }
      case 'file.printpreview': {
        this.doc.buffer.sync();
        const r = await printPreviewDialog(this.dialogs, this.doc.buffer.canvas, this.pageSetup);
        if (r === 'print') await this.print();
        break;
      }
      case 'file.print': await this.print(); break;
      case 'file.wallpaper.tiled':
      case 'file.wallpaper.centered':
        await this.dialogs.alert(
          'Setting the desktop background is not available in this recreation.',
          'Paint',
        );
        break;
      case 'file.exit': await this.handleCloseRequest(); break;

      /* ---- Edit ---- */
      case 'edit.undo': this.undo(); break;
      case 'edit.repeat': this.redo(); break;
      // While a text frame has focus these act on the text, as in Paint.
      case 'edit.cut':
        if (this.textEditorFocused()) { document.execCommand('cut'); break; }
        await this.cut();
        break;
      case 'edit.copy':
        if (this.textEditorFocused()) { document.execCommand('copy'); break; }
        await this.copy();
        break;
      case 'edit.paste':
        if (this.textEditorFocused()) { document.execCommand('paste'); break; }
        await this.paste();
        break;
      case 'edit.clear': this.clearSelection(); break;
      case 'edit.selectall':
        if (this.textEditorFocused()) { document.execCommand('selectAll'); break; }
        this.selectAll();
        break;
      case 'edit.copyto': await this.copyTo(); break;
      case 'edit.pastefrom': await this.pasteFrom(); break;
      case 'edit.crop': this.cropToSelection(); break;

      /* ---- View ---- */
      case 'view.toolbox': this.togglePanel('leftpanel'); break;
      case 'view.colorbox': this.togglePanel('colorrow'); break;
      case 'view.statusbar': this.togglePanel('statusbar'); break;
      case 'view.textbar':
        if (this.fontbar.visible) this.fontbar.hide();
        else this.fontbar.show();
        this.pushNativeMenu();
        break;
      case 'view.zoom.normal': this.setZoom(1); break;
      case 'view.zoom.large': this.setZoom(4); break;
      case 'view.zoom.custom': {
        const z = await customZoomDialog(this.dialogs, this.view.zoom);
        if (z) this.setZoom(z);
        break;
      }
      case 'view.zoom.grid':
        if (this.view.zoom >= 4) {
          this.view.showGrid = !this.view.showGrid;
          this.view.render();
          this.pushNativeMenu();
        }
        break;
      case 'view.zoom.thumbnail':
        this.view.setThumbnailVisible(!this.view.thumbnailVisible);
        this.pushNativeMenu();
        break;
      case 'view.viewbitmap': this.showViewBitmap(); break;

      /* ---- Image ---- */
      case 'image.fliprotate': await this.flipRotate(); break;
      case 'image.stretchskew': await this.stretchSkew(); break;
      case 'image.invert': this.invertColors(); break;
      case 'image.attributes': await this.attributes(); break;
      case 'image.clear': this.clearImage(); break;
      case 'image.drawopaque':
        this.options.selectionTransparent = !this.options.selectionTransparent;
        this.optionsPane.render(this.toolId);
        this.view.render();
        this.pushNativeMenu();
        break;

      /* ---- Colors / Help ---- */
      case 'colors.edit': await this.editColorCell(-1, false); break;
      case 'help.topics':
        await this.dialogs.alert('Help is not available in this recreation.', 'Paint');
        break;
      case 'help.about': await aboutDialog(this.dialogs); break;
    }
  }

  private textEditorFocused(): boolean {
    const a = document.activeElement as HTMLElement | null;
    return !!a && a.id === 'text-editor';
  }

  private togglePanel(elId: string): void {
    const el = document.getElementById(elId)!;
    el.hidden = !el.hidden;
    this.view.render();
    this.pushNativeMenu();
  }

  /* ================= history ================= */

  private undo(): void {
    if (this.sel.lifted) {
      // Discard the floating selection first, like Paint's undo of a move.
      this.sel.discard();
      this.cancelStroke();
      this.repaint();
      this.pushNativeMenu();
      return;
    }
    this.sel.discard();
    const snap = this.history.undo(takeSnapshot(this.doc.buffer));
    if (!snap) return;
    this.applySnapshot(snap);
    this.pushNativeMenu();
  }

  private redo(): void {
    this.sel.discard();
    const snap = this.history.redo(takeSnapshot(this.doc.buffer));
    if (!snap) return;
    this.applySnapshot(snap);
    this.pushNativeMenu();
  }

  /* ================= document lifecycle ================= */

  private async confirmDiscard(): Promise<boolean> {
    if (!this.doc.dirty) return true;
    const r = await this.dialogs.msgBox(
      'Paint',
      `Save changes to ${this.doc.displayName}?`,
      'warning',
      [
        { label: 'Yes', id: 'yes', default: true },
        { label: 'No', id: 'no' },
        { label: 'Cancel', id: 'cancel', cancel: true },
      ],
    );
    if (r === 'cancel') return false;
    if (r === 'yes') return this.save();
    return true;
  }

  private async newDocument(): Promise<void> {
    if (!await this.confirmDiscard()) return;
    this.sel.discard();
    this.pendingSnapshot = null;
    this.history.clear();
    this.mono = false;
    this.doc = new PaintDocument(DEFAULT_W, DEFAULT_H);
    // Zoom is not remembered across documents.
    this.view.zoom = 1;
    this.view.showGrid = false;
    this.view.layout();
    this.repaint();
    this.updateTitle();
    this.pushNativeMenu();
  }

  private async openDocument(): Promise<void> {
    if (!await this.confirmDiscard()) return;
    let loaded;
    try {
      loaded = await openImageFile();
    } catch {
      await this.dialogs.alert('Paint cannot read this file.\nThis is not a valid bitmap file, or its format is not currently supported.');
      return;
    }
    if (!loaded) return;
    this.adoptLoaded(loaded.buffer, loaded.name, loaded.path, loaded.format);
  }

  private async openPath(path: string): Promise<void> {
    if (!await this.confirmDiscard()) return;
    const loaded = await openImagePath(path);
    if (!loaded) {
      await this.dialogs.alert('Paint cannot read this file.');
      return;
    }
    this.adoptLoaded(loaded.buffer, loaded.name, loaded.path, loaded.format);
  }

  private adoptLoaded(
    buffer: PixelBuffer, name: string, path: string | null, format: SaveFormat,
  ): void {
    this.sel.discard();
    this.pendingSnapshot = null;
    this.history.clear();
    this.mono = format === 'bmp1';
    this.doc = new PaintDocument(1, 1);
    this.doc.buffer = buffer;
    this.doc.fileName = name;
    this.doc.filePath = path;
    this.doc.format = format;
    this.doc.dirty = false;
    this.view.zoom = 1;
    this.view.showGrid = false;
    this.view.layout();
    this.repaint();
    this.updateTitle();
    pushRecent(name, path);
    this.pushNativeMenu();
  }

  /* ================= save ================= */

  private async warnDepthLoss(format: SaveFormat): Promise<boolean> {
    if (!losesColor(this.doc.buffer, format)) return true;
    const r = await this.dialogs.msgBox(
      'Paint',
      'Saving into this format may cause some loss of color information.\nAre you sure you want to save in this format?',
      'warning',
      [
        { label: 'Yes', id: 'yes', default: true },
        { label: 'No', id: 'no', cancel: true },
      ],
    );
    return r === 'yes';
  }

  private async save(): Promise<boolean> {
    this.anchorIfSelected();
    if (!this.doc.filePath || !bridge) return this.saveAs();
    if (!await this.warnDepthLoss(this.doc.format)) return false;
    const bytes = await encodeFor(this.doc.buffer, this.doc.format);
    const ok = await saveBytesTo(this.doc.filePath, bytes);
    if (ok) {
      this.doc.dirty = false;
      this.updateTitle();
    }
    return ok;
  }

  private async saveAs(): Promise<boolean> {
    this.anchorIfSelected();
    const defaultName = `${this.doc.displayName.replace(/\.[^.]+$/, '')}.bmp`;
    if (bridge) {
      const chosen = await bridge.chooseSavePath(defaultName);
      if (!chosen) return false;
      let format = formatForName(chosen.name);
      // Every BMP depth shares the .bmp extension, so the native panel cannot
      // distinguish them; keep the depth this document is already using.
      if (format === 'bmp24' && this.doc.format.startsWith('bmp')) format = this.doc.format;
      if (!await this.warnDepthLoss(format)) return false;
      const bytes = await encodeFor(this.doc.buffer, format);
      const ok = await saveBytesTo(chosen.path, bytes);
      if (ok) {
        this.doc.fileName = chosen.name;
        this.doc.filePath = chosen.path;
        this.doc.format = format;
        this.doc.dirty = false;
        this.updateTitle();
        pushRecent(chosen.name, chosen.path);
      }
      return ok;
    }
    // Browser build: no native save panel, so pick name + format in-window.
    const picked = await this.browserSaveAsDialog(defaultName);
    if (!picked) return false;
    if (!await this.warnDepthLoss(picked.format)) return false;
    const bytes = await encodeFor(this.doc.buffer, picked.format);
    await saveBytesAs(picked.name, bytes, picked.name.split('.').pop() ?? 'bmp');
    this.doc.fileName = picked.name;
    this.doc.format = picked.format;
    this.doc.dirty = false;
    this.updateTitle();
    return true;
  }

  private async browserSaveAsDialog(
    defaultName: string,
  ): Promise<{ name: string; format: SaveFormat } | null> {
    const body = document.createElement('div');
    body.style.width = '300px';
    const nameEdit = mkEdit(defaultName.replace(/\.[^.]+$/, ''), 170);
    const select = document.createElement('select');
    select.className = 'edit';
    select.style.width = '230px';
    for (const f of FORMAT_LABELS) {
      const o = document.createElement('option');
      o.value = f.format;
      o.textContent = f.label;
      select.appendChild(o);
    }
    select.value = 'bmp24';
    body.appendChild(mkRow('File name:', nameEdit));
    body.appendChild(mkRow('Save as type:', select));
    const id = await this.dialogs.show('Save As', body, [
      { label: 'Save', id: 'ok', default: true },
      { label: 'Cancel', id: 'cancel', cancel: true },
    ]);
    if (id !== 'ok') return null;
    const format = select.value as SaveFormat;
    const ext = FORMAT_LABELS.find(f => f.format === format)!.ext;
    const base = nameEdit.value.trim() || 'untitled';
    return { name: `${base}.${ext}`, format };
  }

  private async print(): Promise<void> {
    this.anchorIfSelected();
    this.doc.buffer.sync();
    const dataUrl = this.doc.buffer.canvas.toDataURL('image/png');
    if (bridge) {
      await bridge.printImage(dataUrl, { landscape: this.pageSetup.landscape });
      return;
    }
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<style>@page{margin:0.5in}body{margin:0}img{image-rendering:pixelated;max-width:100%}</style>` +
      `<img src="${dataUrl}" onload="window.print()">`,
    );
    w.document.close();
  }

  /* ================= clipboard / selection edits ================= */

  private anchorIfSelected(): void {
    if (this.sel.lifted) this.anchorSelection();
  }

  /** The selected pixels as a standalone buffer (lasso gaps become bg). */
  private selectionBuffer(): PixelBuffer | null {
    const sel = this.sel;
    if (sel.lifted && sel.floating) {
      const out = sel.floating.extract(0, 0, sel.floating.width, sel.floating.height);
      if (sel.mask) {
        for (let i = 0; i < out.u32.length; i++) {
          if (!sel.mask[i]) out.u32[i] = this.palette.bg;
        }
        out.touchAll();
      }
      return out;
    }
    if (!sel.rect) return null;
    const { x, y, w, h } = sel.rect;
    const out = this.doc.buffer.extract(x, y, w, h);
    if (sel.lassoPts) {
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const inside = sel.contains(x + xx, y + yy);
          if (!inside) out.u32[yy * w + xx] = this.palette.bg;
        }
      }
      out.touchAll();
    }
    return out;
  }

  private async copy(): Promise<void> {
    const pb = this.selectionBuffer();
    if (!pb) return;
    try {
      await clipboardWrite(pb);
    } catch {
      await this.dialogs.alert('The Clipboard is not available.');
    }
  }

  private async cut(): Promise<void> {
    await this.copy();
    this.clearSelection();
  }

  private clearSelection(): void {
    const sel = this.sel;
    if (!this.hasSelection()) return;
    if (sel.lifted) {
      // Pixels were already replaced with the background color when lifted.
      sel.discard();
      this.endStroke();
    } else if (sel.rect) {
      this.beginStroke();
      const { x, y, w, h } = sel.rect;
      if (sel.lassoPts) {
        for (let yy = 0; yy < h; yy++) {
          for (let xx = 0; xx < w; xx++) {
            if (sel.contains(x + xx, y + yy)) {
              this.doc.buffer.setPixel(x + xx, y + yy, this.palette.bg);
            }
          }
        }
      } else {
        this.doc.buffer.fillRect(x, y, w, h, this.palette.bg);
      }
      sel.discard();
      this.endStroke();
    }
    this.repaint();
    this.pushNativeMenu();
  }

  private async paste(): Promise<void> {
    let pb: PixelBuffer | null = null;
    try {
      pb = await clipboardRead();
    } catch {
      pb = null;
    }
    if (!pb) {
      await this.dialogs.alert('There is nothing on the Clipboard that Paint can paste.');
      return;
    }
    const buf = this.doc.buffer;
    if (pb.width > buf.width || pb.height > buf.height) {
      const r = await this.dialogs.msgBox(
        'Paint',
        'The image in the clipboard is larger than the bitmap.\nWould you like the bitmap enlarged?',
        'question',
        [
          { label: 'Yes', id: 'yes', default: true },
          { label: 'No', id: 'no' },
          { label: 'Cancel', id: 'cancel', cancel: true },
        ],
      );
      if (r === 'cancel') return;
      if (r === 'yes') {
        this.replaceBuffer(PixelBuffer.resized(
          this.doc.buffer,
          Math.max(buf.width, pb.width),
          Math.max(buf.height, pb.height),
        ));
      }
    }
    this.anchorIfSelected();
    this.sel.discard();
    this.selectTool('select');
    this.beginStroke();
    const tl = this.view.visibleTopLeft();
    this.sel.setFloating(pb, tl.x, tl.y);
    this.repaint();
    this.pushNativeMenu();
  }

  private selectAll(): void {
    this.anchorIfSelected();
    this.selectTool('select');
    this.sel.discard();
    this.sel.setRect({ x: 0, y: 0, w: this.doc.buffer.width, h: this.doc.buffer.height });
    this.view.renderOverlay();
    this.pushNativeMenu();
  }

  private cropToSelection(): void {
    const pb = this.selectionBuffer();
    if (!pb) return;
    this.sel.discard();
    this.pendingSnapshot = null;
    this.replaceBuffer(pb);
  }

  private async copyTo(): Promise<void> {
    const pb = this.selectionBuffer();
    if (!pb) return;
    const bytes = await encodeFor(pb, 'bmp24');
    await saveBytesAs('selection.bmp', bytes, 'bmp');
  }

  private async pasteFrom(): Promise<void> {
    const loaded = await openImageFile();
    if (!loaded) return;
    this.anchorIfSelected();
    this.sel.discard();
    this.selectTool('select');
    this.beginStroke();
    const tl = this.view.visibleTopLeft();
    this.sel.setFloating(loaded.buffer, tl.x, tl.y);
    this.repaint();
    this.pushNativeMenu();
  }

  /* ================= image operations ================= */

  /** Apply a transform to the floating selection if there is one, else the image. */
  private transform(fn: (b: PixelBuffer) => PixelBuffer): void {
    const sel = this.sel;
    if (sel.rect && !sel.lifted) {
      this.beginStroke();
      sel.lift(this.doc.buffer, this.palette.bg, false);
    }
    if (sel.lifted && sel.floating) {
      sel.floating = fn(sel.floating);
      sel.mask = null;
      sel.markDirty();
      this.repaint();
      return;
    }
    this.replaceBuffer(fn(this.doc.buffer));
  }

  private async flipRotate(): Promise<void> {
    const r = await flipRotateDialog(this.dialogs);
    if (!r) return;
    if (r.kind === 'flipH') this.transform(flipH);
    else if (r.kind === 'flipV') this.transform(flipV);
    else this.transform(b => rotate(b, r.deg));
  }

  private async stretchSkew(): Promise<void> {
    const r = await stretchSkewDialog(this.dialogs);
    if (!r) return;
    this.transform(b => {
      let out = b;
      if (r.stretchH !== 100 || r.stretchV !== 100) out = stretchNN(out, r.stretchH, r.stretchV);
      if (r.skewH !== 0 || r.skewV !== 0) out = skew(out, r.skewH, r.skewV);
      return out;
    });
  }

  private invertColors(): void {
    const sel = this.sel;
    if (sel.rect && !sel.lifted) {
      this.beginStroke();
      sel.lift(this.doc.buffer, this.palette.bg, false);
    }
    if (sel.lifted && sel.floating) {
      invert(sel.floating);
      sel.markDirty();
      this.repaint();
      return;
    }
    this.beginStroke();
    invert(this.doc.buffer);
    this.endStroke();
    this.repaint();
  }

  private clearImage(): void {
    if (this.hasSelection()) {
      this.clearSelection();
      return;
    }
    this.beginStroke();
    this.doc.buffer.clear(this.palette.bg);
    this.endStroke();
    this.repaint();
  }

  private async attributes(): Promise<void> {
    this.anchorIfSelected();
    const buf = this.doc.buffer;
    const fileInfo = this.doc.filePath
      ? `File Last Saved: ${this.doc.displayName}`
      : 'File Last Saved: Not Available';
    const r = await attributesDialog(this.dialogs, {
      width: buf.width, height: buf.height, mono: this.mono, fileInfo,
    });
    if (!r) return;

    if (r.mono && !this.mono) {
      const ok = await this.dialogs.msgBox(
        'Paint',
        'This is a conversion from color to black and white.\nThis process cannot be reversed. Are you sure you want to convert this bitmap?',
        'warning',
        [
          { label: 'Yes', id: 'yes', default: true },
          { label: 'No', id: 'no', cancel: true },
        ],
      );
      if (ok !== 'yes') return;
    }

    if (r.width !== buf.width || r.height !== buf.height) {
      // Enlarging fills the new area with white, never the background color.
      this.replaceBuffer(PixelBuffer.resized(this.doc.buffer, r.width, r.height));
    }

    if (r.mono && !this.mono) {
      ditherToMono(this.doc.buffer);
      this.mono = true;
      this.doc.format = 'bmp1';
      this.doc.dirty = true;
      // Immediate and irreversible: not recoverable through undo.
      this.history.clear();
      this.pendingSnapshot = null;
      this.repaint();
    } else if (!r.mono && this.mono) {
      this.mono = false;
      this.doc.format = 'bmp24';
    }
    this.pushNativeMenu();
  }

  /* ================= colors ================= */

  private async editColorCell(index: number, isCustom: boolean): Promise<void> {
    const target = index < 0
      ? this.palette.fgHex
      : (isCustom ? this.palette.custom : this.palette.colors)[index];
    const result = await editColorsDialog(this.dialogs, target, this.palette.custom);
    if (!result) return;
    if (index >= 0) {
      if (isCustom) this.palette.custom[index] = result;
      else this.palette.colors[index] = result;
    }
    this.palette.setFg(result);
    this.colorbox.refresh();
  }

  /* ================= View Bitmap ================= */

  private showViewBitmap(): void {
    this.menubar.closeAll();
    this.anchorIfSelected();
    this.doc.buffer.sync();
    const el = document.createElement('div');
    el.id = 'viewbitmap';
    el.style.display = 'block';
    const cv = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    const buf = this.doc.buffer;
    cv.width = Math.round(buf.width * dpr);
    cv.height = Math.round(buf.height * dpr);
    cv.style.width = `${buf.width}px`;
    cv.style.height = `${buf.height}px`;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf.canvas, 0, 0, cv.width, cv.height);
    el.appendChild(cv);
    document.body.appendChild(el);
    this.viewBitmapEl = el;
    // Dismiss on any input.
    el.addEventListener('pointerdown', () => this.hideViewBitmap());
    el.addEventListener('wheel', () => this.hideViewBitmap());
  }

  private hideViewBitmap(): void {
    this.viewBitmapEl?.remove();
    this.viewBitmapEl = null;
  }

  /* ================= close ================= */

  private async handleCloseRequest(): Promise<void> {
    if (!await this.confirmDiscard()) return;
    if (bridge) bridge.confirmClose();
  }
}

// Kick off once the DOM is parsed (the bundle is loaded at the end of <body>).
new App();

// Feature-detected Electron bridge. When absent (plain browser), callers fall
// back to <input type="file">, download links, and the async Clipboard API.

export interface OpenResult {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export interface PaintBridge {
  openFile(): Promise<OpenResult | null>;
  /** Returns chosen path, or null if cancelled. */
  saveFileAs(defaultName: string, bytes: Uint8Array, filterExt: string): Promise<{ path: string; name: string } | null>;
  saveFileTo(path: string, bytes: Uint8Array): Promise<boolean>;
  /** Native save panel that only picks a destination; format comes from the extension. */
  chooseSavePath(defaultName: string): Promise<{ path: string; name: string } | null>;
  readFileAt(path: string): Promise<OpenResult | null>;
  clipboardWriteImage(pngDataUrl: string): Promise<void>;
  clipboardReadImage(): Promise<string | null>; // PNG data URL or null
  setTitle(title: string): void;
  setNativeMenu(template: unknown): void;
  onMenuCommand(cb: (id: string) => void): void;
  onCloseRequest(cb: () => void): void;
  /** A file opened from Finder or the command line. */
  onOpenPath(cb: (path: string) => void): void;
  confirmClose(): void;
  printImage(pngDataUrl: string, opts: { landscape: boolean }): Promise<void>;
  quit(): void;
}

declare global {
  interface Window { paintBridge?: PaintBridge; }
}

export const bridge: PaintBridge | undefined = window.paintBridge;
export const isElectron = !!bridge;

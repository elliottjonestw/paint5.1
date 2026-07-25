// Electron main process. Native window, native file panels, system clipboard,
// native application menu, printing. No native modules — plain Node only.

import {
  app, BrowserWindow, ipcMain, dialog, clipboard, nativeImage, Menu,
  MenuItemConstructorOptions,
} from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const isMac = process.platform === 'darwin';

let win: BrowserWindow | null = null;
let allowClose = false;
/** A file passed on the command line / via Finder before the window was ready. */
let pendingOpenPath: string | null = null;

const IMAGE_FILTERS = [
  { name: 'All Picture Files', extensions: ['bmp', 'dib', 'gif', 'jpg', 'jpeg', 'png'] },
  { name: 'Bitmap Files', extensions: ['bmp', 'dib'] },
  { name: 'GIF', extensions: ['gif'] },
  { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { name: 'PNG', extensions: ['png'] },
  { name: 'All Files', extensions: ['*'] },
];

const SAVE_FILTERS = [
  { name: '24-bit Bitmap', extensions: ['bmp'] },
  { name: 'PNG', extensions: ['png'] },
  { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { name: 'GIF', extensions: ['gif'] },
];

function createWindow(): void {
  win = new BrowserWindow({
    width: 800,
    height: 620,
    minWidth: 420,
    minHeight: 320,
    title: 'untitled - Paint',
    titleBarStyle: 'default',
    backgroundColor: '#ECE9D8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'index.html'));

  // The renderer owns the "Save changes?" prompt, so intercept the close.
  win.on('close', e => {
    if (allowClose) return;
    e.preventDefault();
    win?.webContents.send('close-request');
  });

  win.on('closed', () => { win = null; });

  win.webContents.on('did-finish-load', () => {
    if (pendingOpenPath) {
      win?.webContents.send('open-path', pendingOpenPath);
      pendingOpenPath = null;
    }
  });
}

/* ---------- file open/save ---------- */

ipcMain.handle('open-file', async () => {
  if (!win) return null;
  const res = await dialog.showOpenDialog(win, {
    title: 'Open',
    properties: ['openFile'],
    filters: IMAGE_FILTERS,
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  const p = res.filePaths[0];
  const buf = await fs.readFile(p);
  return { path: p, name: path.basename(p), bytes: new Uint8Array(buf) };
});

ipcMain.handle('read-file-at', async (_e, p: string) => {
  try {
    const buf = await fs.readFile(p);
    return { path: p, name: path.basename(p), bytes: new Uint8Array(buf) };
  } catch {
    return null;
  }
});

ipcMain.handle('choose-save-path', async (_e, defaultName: string) => {
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, {
    title: 'Save As',
    defaultPath: defaultName,
    filters: SAVE_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  return { path: res.filePath, name: path.basename(res.filePath) };
});

ipcMain.handle('save-file-as', async (_e, defaultName: string, bytes: Uint8Array) => {
  if (!win) return null;
  const res = await dialog.showSaveDialog(win, {
    title: 'Save As',
    defaultPath: defaultName,
    filters: SAVE_FILTERS,
  });
  if (res.canceled || !res.filePath) return null;
  await fs.writeFile(res.filePath, Buffer.from(bytes));
  return { path: res.filePath, name: path.basename(res.filePath) };
});

ipcMain.handle('save-file-to', async (_e, p: string, bytes: Uint8Array) => {
  try {
    await fs.writeFile(p, Buffer.from(bytes));
    return true;
  } catch {
    return false;
  }
});

/* ---------- clipboard ---------- */

ipcMain.handle('clipboard-write-image', (_e, dataUrl: string) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
});

ipcMain.handle('clipboard-read-image', () => {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : img.toDataURL();
});

/* ---------- window / menu ---------- */

ipcMain.on('set-title', (_e, title: string) => {
  win?.setTitle(title);
});

ipcMain.on('confirm-close', () => {
  allowClose = true;
  win?.close();
});

ipcMain.on('quit', () => {
  allowClose = true;
  app.quit();
});

interface MenuNode {
  label?: string;
  id?: string;
  type?: 'separator' | 'checkbox' | 'radio';
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
  submenu?: MenuNode[];
}

function toTemplate(nodes: MenuNode[]): MenuItemConstructorOptions[] {
  return nodes.map(n => {
    if (n.type === 'separator') return { type: 'separator' } as MenuItemConstructorOptions;
    const item: MenuItemConstructorOptions = {
      label: n.label,
      enabled: n.enabled !== false,
    };
    if (n.type) item.type = n.type;
    if (n.checked !== undefined) item.checked = n.checked;
    if (n.accelerator) item.accelerator = n.accelerator;
    if (n.submenu) item.submenu = toTemplate(n.submenu);
    else if (n.id) {
      item.click = () => win?.webContents.send('menu-command', n.id);
    }
    return item;
  });
}

ipcMain.on('set-native-menu', (_e, nodes: MenuNode[]) => {
  // On Windows and Linux the in-window menu bar *is* the menu, exactly as it was
  // in XP. Electron's own bar is already suppressed at startup, so there is
  // nothing to sync here; the renderer handles the Ctrl accelerators itself.
  if (!isMac) return;
  // macOS requires the first menu to be the application menu.
  const appMenu: MenuItemConstructorOptions = {
    label: 'Paint',
    submenu: [
      { label: 'About Paint', click: () => win?.webContents.send('menu-command', 'help.about') },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      {
        label: 'Quit Paint',
        accelerator: 'Cmd+Q',
        click: () => win?.webContents.send('menu-command', 'file.exit'),
      },
    ],
  };
  const template = [appMenu, ...toTemplate(nodes)];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
});

/* ---------- printing ---------- */

ipcMain.handle('print-image', async (_e, dataUrl: string, opts: { landscape: boolean }) => {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { margin: 0.5in; }
  html, body { margin: 0; padding: 0; }
  img { image-rendering: pixelated; max-width: 100%; }
</style></head><body><img src="${dataUrl}"></body></html>`;
  const tmp = path.join(os.tmpdir(), `paint-print-${Date.now()}.html`);
  await fs.writeFile(tmp, html, 'utf8');

  const printWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await printWin.loadFile(tmp);
  await new Promise<void>(resolve => {
    printWin.webContents.print({ silent: false, landscape: opts.landscape }, () => resolve());
  });
  printWin.destroy();
  await fs.unlink(tmp).catch(() => { /* best effort */ });
});

/* ---------- lifecycle ---------- */

// macOS only: a file double-clicked in Finder before the app finished starting.
// Windows passes the path in argv instead, which is handled just below.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win) win.webContents.send('open-path', p);
  else pendingOpenPath = p;
});

const argPath = process.argv.slice(1).find(a => !a.startsWith('-') && /\.(bmp|gif|jpe?g|png)$/i.test(a));
if (argPath) pendingOpenPath = argPath;

app.whenReady().then(() => {
  // Drop Electron's stock menu bar on Windows/Linux before the window appears,
  // so the default File/Edit/View bar never flashes above our own.
  if (!isMac) Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

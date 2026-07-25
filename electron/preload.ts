// Bridges the renderer to the main process. The renderer feature-detects this
// object and falls back to browser APIs when it is absent.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('paintBridge', {
  openFile: () => ipcRenderer.invoke('open-file'),
  readFileAt: (p: string) => ipcRenderer.invoke('read-file-at', p),
  chooseSavePath: (defaultName: string) => ipcRenderer.invoke('choose-save-path', defaultName),
  saveFileAs: (defaultName: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('save-file-as', defaultName, bytes),
  saveFileTo: (p: string, bytes: Uint8Array) => ipcRenderer.invoke('save-file-to', p, bytes),

  clipboardWriteImage: (dataUrl: string) => ipcRenderer.invoke('clipboard-write-image', dataUrl),
  clipboardReadImage: () => ipcRenderer.invoke('clipboard-read-image'),

  setTitle: (title: string) => ipcRenderer.send('set-title', title),
  setNativeMenu: (template: unknown) => ipcRenderer.send('set-native-menu', template),
  onMenuCommand: (cb: (id: string) => void) => {
    ipcRenderer.on('menu-command', (_e, id: string) => cb(id));
  },
  onCloseRequest: (cb: () => void) => {
    ipcRenderer.on('close-request', () => cb());
  },
  onOpenPath: (cb: (p: string) => void) => {
    ipcRenderer.on('open-path', (_e, p: string) => cb(p));
  },
  confirmClose: () => ipcRenderer.send('confirm-close'),
  printImage: (dataUrl: string, opts: { landscape: boolean }) =>
    ipcRenderer.invoke('print-image', dataUrl, opts),
  quit: () => ipcRenderer.send('quit'),
});

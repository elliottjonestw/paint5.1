// The complete XP Paint menu tree. Accelerators are displayed in original
// Windows form (Ctrl+…) for visual fidelity; both Cmd and Ctrl bindings work.

import { Menu } from './menubar';

/** What the menu definition needs to ask the app. */
export interface MenuState {
  canUndo(): boolean;
  canRedo(): boolean;
  hasSelection(): boolean;
  clipboardMaybeAvailable(): boolean;
  toolboxVisible(): boolean;
  colorboxVisible(): boolean;
  statusbarVisible(): boolean;
  textToolbarAvailable(): boolean;
  textToolbarVisible(): boolean;
  zoom(): number;
  showGrid(): boolean;
  showThumbnail(): boolean;
  drawOpaque(): boolean;
  recentFiles(): string[];
}

export function buildMenus(s: MenuState): Menu[] {
  return [
    {
      title: '&File',
      items: [
        { label: '&New', id: 'file.new', accel: 'Ctrl+N', hint: 'Creates a new document.' },
        { label: '&Open...', id: 'file.open', accel: 'Ctrl+O', hint: 'Opens an existing document.' },
        { label: '&Save', id: 'file.save', accel: 'Ctrl+S', hint: 'Saves the active document.' },
        { label: 'Save &As...', id: 'file.saveas', hint: 'Saves the active document with a new name.' },
        { sep: true },
        { label: 'Print Pre&view', id: 'file.printpreview', hint: 'Displays full pages.' },
        { label: 'Page Se&tup...', id: 'file.pagesetup', hint: 'Changes the page layout.' },
        { label: '&Print...', id: 'file.print', accel: 'Ctrl+P', hint: 'Prints the active document and sets printing options.' },
        { sep: true },
        { label: 'Set As Bac&kground (Tiled)', id: 'file.wallpaper.tiled', hint: 'Tiles this bitmap as the desktop background.' },
        { label: 'Set As Back&ground (Centered)', id: 'file.wallpaper.centered', hint: 'Centers this bitmap as the desktop background.' },
        { sep: true },
        {
          dynamic: () => {
            const recents = s.recentFiles();
            if (recents.length === 0) {
              return [{ label: 'Recent File', enabled: () => false }];
            }
            return recents.map((name, i) => ({
              label: `&${i + 1} ${name.length > 36 ? '…' + name.slice(-35) : name}`,
              id: `file.recent.${i}`,
              hint: 'Opens this document.',
            }));
          },
        },
        { sep: true },
        { label: 'E&xit', id: 'file.exit', hint: 'Quits Paint.' },
      ],
    },
    {
      title: '&Edit',
      items: [
        { label: '&Undo', id: 'edit.undo', accel: 'Ctrl+Z', enabled: () => s.canUndo(), hint: 'Undoes the last action.' },
        { label: '&Repeat', id: 'edit.repeat', accel: 'Ctrl+Y', enabled: () => s.canRedo(), hint: 'Redoes the previously undone action.' },
        { sep: true },
        { label: 'Cu&t', id: 'edit.cut', accel: 'Ctrl+X', enabled: () => s.hasSelection(), hint: 'Cuts the selection and puts it on the Clipboard.' },
        { label: '&Copy', id: 'edit.copy', accel: 'Ctrl+C', enabled: () => s.hasSelection(), hint: 'Copies the selection and puts it on the Clipboard.' },
        { label: '&Paste', id: 'edit.paste', accel: 'Ctrl+V', enabled: () => s.clipboardMaybeAvailable(), hint: 'Inserts the contents of the Clipboard.' },
        { label: 'C&lear Selection', id: 'edit.clear', accel: 'Del', enabled: () => s.hasSelection(), hint: 'Deletes the selection.' },
        { label: 'Select &All', id: 'edit.selectall', accel: 'Ctrl+A', hint: 'Selects everything.' },
        { sep: true },
        { label: 'C&opy To...', id: 'edit.copyto', enabled: () => s.hasSelection(), hint: 'Copies the selection to a file.' },
        { label: 'Paste &From...', id: 'edit.pastefrom', hint: 'Pastes a file into the selection.' },
      ],
    },
    {
      title: '&View',
      items: [
        { label: '&Tool Box', id: 'view.toolbox', accel: 'Ctrl+T', checked: () => s.toolboxVisible(), hint: 'Shows or hides the tool box.' },
        { label: '&Color Box', id: 'view.colorbox', accel: 'Ctrl+L', checked: () => s.colorboxVisible(), hint: 'Shows or hides the color box.' },
        { label: '&Status Bar', id: 'view.statusbar', checked: () => s.statusbarVisible(), hint: 'Shows or hides the status bar.' },
        { label: 'T&ext Toolbar', id: 'view.textbar', enabled: () => s.textToolbarAvailable(), checked: () => s.textToolbarVisible(), hint: 'Shows or hides the text toolbar.' },
        { sep: true },
        {
          label: '&Zoom',
          sub: [
            { label: '&Normal Size', id: 'view.zoom.normal', accel: 'Ctrl+PgUp', radio: true, checked: () => s.zoom() === 1, hint: 'Zooms the picture to 100%.' },
            { label: '&Large Size', id: 'view.zoom.large', accel: 'Ctrl+PgDn', radio: true, checked: () => s.zoom() === 4, hint: 'Zooms the picture to 400%.' },
            { label: 'C&ustom...', id: 'view.zoom.custom', hint: 'Zooms the picture.' },
            { sep: true },
            { label: 'Show &Grid', id: 'view.zoom.grid', accel: 'Ctrl+G', enabled: () => s.zoom() >= 4, checked: () => s.showGrid(), hint: 'Shows or hides the grid.' },
            { label: 'Show T&humbnail', id: 'view.zoom.thumbnail', checked: () => s.showThumbnail(), hint: 'Shows or hides the thumbnail.' },
          ],
        },
        { label: '&View Bitmap', id: 'view.viewbitmap', accel: 'Ctrl+F', hint: 'Displays the entire picture.' },
      ],
    },
    {
      title: '&Image',
      items: [
        { label: '&Flip/Rotate...', id: 'image.fliprotate', accel: 'Ctrl+R', hint: 'Flips or rotates the picture or a selection.' },
        { label: '&Stretch/Skew...', id: 'image.stretchskew', accel: 'Ctrl+W', hint: 'Stretches or skews the picture or a selection.' },
        { label: '&Invert Colors', id: 'image.invert', accel: 'Ctrl+I', hint: 'Inverts the colors of the picture or a selection.' },
        { label: '&Attributes...', id: 'image.attributes', accel: 'Ctrl+E', hint: 'Changes the attributes of the picture.' },
        { label: '&Clear Image', id: 'image.clear', accel: 'Ctrl+Shft+N', hint: 'Clears the picture.' },
        { label: '&Draw Opaque', id: 'image.drawopaque', checked: () => s.drawOpaque(), hint: 'Makes the current selection either opaque or transparent.' },
      ],
    },
    {
      title: '&Colors',
      items: [
        { label: '&Edit Colors...', id: 'colors.edit', hint: 'Creates a new color.' },
      ],
    },
    {
      title: '&Help',
      items: [
        { label: '&Help Topics', id: 'help.topics', hint: 'Displays Help for the current task or command.' },
        { sep: true },
        { label: '&About Paint', id: 'help.about', hint: 'Displays program information, version number, and copyright.' },
      ],
    },
  ];
}

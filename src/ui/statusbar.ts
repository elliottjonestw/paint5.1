// Three sunken panes: contextual hint, cursor position, selection/shape size.

export class StatusBar {
  private hintEl = document.getElementById('sb-hint')!;
  private posEl = document.getElementById('sb-pos')!;
  private sizeEl = document.getElementById('sb-size')!;
  private defaultHint = 'For Help, click Help Topics on the Help Menu.';
  private toolHint = '';

  constructor() {
    this.hintEl.textContent = this.defaultHint;
  }

  /** Transient hint (menu hover, tool hover); empty restores the tool hint. */
  setHint(text: string): void {
    this.hintEl.textContent = text || this.toolHint || this.defaultHint;
  }

  /** The persistent hint for the active tool. */
  setToolHint(text: string): void {
    this.toolHint = text;
    this.hintEl.textContent = text || this.defaultHint;
  }

  setPos(text: string): void {
    this.posEl.textContent = text;
  }

  setSize(text: string): void {
    this.sizeEl.textContent = text;
  }
}

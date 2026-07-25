// Undo history: full-buffer snapshots, exactly 3 deep — as shipped in XP Paint.

import { PixelBuffer } from './pixelbuffer';

/** Paint 5.1's undo depth. A single constant so it can be changed, shipped at 3. */
export const UNDO_DEPTH = 3;

export interface Snapshot {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function takeSnapshot(buf: PixelBuffer): Snapshot {
  return { data: buf.snapshot(), width: buf.width, height: buf.height };
}

export class HistoryStack {
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  /** Record the pre-change state. Clears the redo (Repeat) stack. */
  push(snap: Snapshot): void {
    this.undoStack.push(snap);
    while (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    this.redoStack = [];
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  /** Swap current state for the top undo snapshot; returns what to restore. */
  undo(current: Snapshot): Snapshot | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push(current);
    while (this.redoStack.length > UNDO_DEPTH) this.redoStack.shift();
    return snap;
  }

  redo(current: Snapshot): Snapshot | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push(current);
    while (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
    return snap;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}

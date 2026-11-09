/** Editable level document with snapshot-based undo / redo. */
import { cloneLevel, type Level } from '../core/level';

const MAX_HISTORY = 200;

export class LevelDoc {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private strokeOpen = false;
  private listeners: (() => void)[] = [];
  dirty = false;

  constructor(public level: Level) {}

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Replace the whole level (load / new). Clears history. */
  load(level: Level): void {
    this.level = cloneLevel(level);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit();
  }

  /** Apply one undoable edit. Inside a stroke, only the first edit records a snapshot. */
  edit(fn: (level: Level) => void): void {
    if (!this.strokeOpen || !this.strokeRecorded) {
      this.undoStack.push(JSON.stringify(this.level));
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
      this.redoStack = [];
      if (this.strokeOpen) this.strokeRecorded = true;
    }
    fn(this.level);
    this.dirty = true;
    this.emit();
  }

  private strokeRecorded = false;

  /** Group a drag (many edits) into one undo step. */
  beginStroke(): void {
    this.strokeOpen = true;
    this.strokeRecorded = false;
  }

  endStroke(): void {
    this.strokeOpen = false;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(JSON.stringify(this.level));
    this.level = JSON.parse(prev);
    this.dirty = true;
    this.emit();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(JSON.stringify(this.level));
    this.level = JSON.parse(next);
    this.dirty = true;
    this.emit();
  }
}

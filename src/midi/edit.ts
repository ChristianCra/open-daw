// Pure note-editing operations for the piano roll: move, transpose,
// duplicate, paste and rectangle selection. Notes are edited in place and
// selections are sets of note objects, so they survive re-sorting.

import type { Note } from "../model";

/** Smallest note length in beats (1/16 note). */
export const MIN_LEN = 0.25;

/** Start and end (in beats) spanned by a set of notes. */
export function span(notes: Iterable<Note>): { start: number; end: number } | null {
  let start = Infinity;
  let end = -Infinity;
  for (const n of notes) {
    start = Math.min(start, n.start);
    end = Math.max(end, n.start + n.length);
  }
  return start === Infinity ? null : { start, end };
}

/**
 * Clamps a time offset so that all `notes` stay inside [0, clipLength).
 * Returns the allowed offset.
 */
export function clampShift(notes: Iterable<Note>, dBeat: number, clipLength: number): number {
  let first = Infinity;
  let lastStart = -Infinity;
  for (const n of notes) {
    first = Math.min(first, n.start);
    lastStart = Math.max(lastStart, n.start);
  }
  if (first === Infinity) return 0;
  return Math.max(-first, Math.min(dBeat, clipLength - MIN_LEN - lastStart));
}

/** Moves notes in time (clamped to the clip), keeping their lengths inside the clip. */
export function shiftNotes(notes: Iterable<Note>, dBeat: number, clipLength: number): void {
  const list = [...notes];
  const d = clampShift(list, dBeat, clipLength);
  for (const n of list) {
    n.start = round(n.start + d);
    n.length = Math.min(n.length, clipLength - n.start);
  }
}

/**
 * Moves notes by `steps` rows of the editor. `rows` lists the pitches shown,
 * top to bottom. Notes keep their relative spacing; the move is clamped so no
 * note leaves the visible rows. Notes on hidden rows move by semitones instead.
 */
export function moveRows(notes: Iterable<Note>, steps: number, rows: number[]): void {
  const list = [...notes];
  if (!list.length || !steps || !rows.length) return;
  const idx = list.map((n) => rows.indexOf(n.pitch));
  // Positive steps move up (to lower row indices).
  let d = steps;
  for (const i of idx) {
    if (i < 0) continue;
    d = Math.max(Math.min(d, i), i - (rows.length - 1));
  }
  list.forEach((n, k) => {
    const i = idx[k];
    n.pitch = i < 0 ? clampPitch(n.pitch + d) : rows[i - d];
  });
}

/** Transposes notes by semitones, clamped to the MIDI range. */
export function transpose(notes: Iterable<Note>, semitones: number): void {
  const list = [...notes];
  let lo = 127;
  let hi = 0;
  for (const n of list) {
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  const d = Math.max(-lo, Math.min(semitones, 127 - hi));
  for (const n of list) n.pitch += d;
}

/** Sets the length of notes so they end at `end`-relative positions (resize by delta), min 1/16. */
export function resizeNotes(notes: Iterable<Note>, dLength: number, clipLength: number): void {
  for (const n of notes) n.length = round(Math.max(MIN_LEN, Math.min(n.length + dLength, clipLength - n.start)));
}

/**
 * Copies `selected` right after the end of their span (rounded up to the
 * grid `grid` beats) and appends them to `notes`. Copies that would start past
 * the clip end are dropped. Returns the new notes.
 */
export function duplicateNotes(notes: Note[], selected: Iterable<Note>, clipLength: number, grid = MIN_LEN): Note[] {
  const list = [...selected];
  const s = span(list);
  if (!s) return [];
  const offset = Math.ceil(round(s.end - s.start) / grid) * grid;
  return pasteNotes(notes, list, s.start + offset, clipLength);
}

/**
 * Pastes copies of `clipboard` so the earliest one starts at `at`. Notes past
 * the clip end are dropped, lengths are cut at the clip end. Returns the new notes.
 */
export function pasteNotes(notes: Note[], clipboard: Note[], at: number, clipLength: number): Note[] {
  const s = span(clipboard);
  if (!s) return [];
  const added: Note[] = [];
  for (const n of clipboard) {
    const start = round(at + (n.start - s.start));
    if (start < 0 || start >= clipLength) continue;
    const copy: Note = { ...n, start, length: Math.min(n.length, clipLength - start) };
    notes.push(copy);
    added.push(copy);
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return added;
}

/** Notes overlapping a rectangle in beats × row indices (inclusive rows). */
export function notesInRect(notes: Note[], rows: number[], b0: number, b1: number, r0: number, r1: number): Note[] {
  const [bl, bh] = b0 <= b1 ? [b0, b1] : [b1, b0];
  const [rl, rh] = r0 <= r1 ? [r0, r1] : [r1, r0];
  return notes.filter((n) => {
    const row = rows.indexOf(n.pitch);
    return row >= rl && row <= rh && n.start < bh && n.start + n.length > bl;
  });
}

const clampPitch = (p: number) => Math.max(0, Math.min(127, p));
/** Avoids float drift like 0.30000000000000004 in stored positions. */
const round = (x: number) => Math.round(x * 1e6) / 1e6;

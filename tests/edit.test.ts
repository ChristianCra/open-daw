import { describe, expect, it } from "vitest";
import { clampShift, duplicateNotes, moveRows, notesInRect, pasteNotes, resizeNotes, shiftNotes, span, transpose } from "../src/midi/edit";
import type { Note } from "../src/model";

const n = (pitch: number, start: number, length = 0.25): Note => ({ pitch, start, length, velocity: 0.8 });

describe("note editing", () => {
  it("computes the span of notes", () => {
    expect(span([n(60, 1, 1), n(62, 0.5, 0.25)])).toEqual({ start: 0.5, end: 2 });
    expect(span([])).toBeNull();
  });

  it("moves notes in time, clamped to the clip", () => {
    const a = n(60, 1);
    const b = n(62, 2, 1);
    shiftNotes([a, b], 0.5, 4);
    expect([a.start, b.start]).toEqual([1.5, 2.5]);
    shiftNotes([a, b], -10, 4);
    expect([a.start, b.start]).toEqual([0, 1]);
    shiftNotes([a, b], 10, 4);
    expect([a.start, b.start]).toEqual([2.75, 3.75]);
    expect(b.length).toBe(0.25); // cut at the clip end
    expect(clampShift([], 3, 4)).toBe(0);
  });

  it("moves notes along the visible rows", () => {
    const rows = [72, 71, 69, 67, 65, 64, 62, 60]; // C major, top to bottom
    const a = n(60, 0);
    const b = n(64, 0);
    moveRows([a, b], 1, rows);
    expect([a.pitch, b.pitch]).toEqual([62, 65]);
    moveRows([a, b], 10, rows); // clamped at the top row
    expect([a.pitch, b.pitch]).toEqual([69, 72]);
    moveRows([a, b], -100, rows);
    expect([a.pitch, b.pitch]).toEqual([60, 64]);
  });

  it("transposes within the MIDI range", () => {
    const a = n(120, 0);
    const b = n(100, 0);
    transpose([a, b], 12);
    expect([a.pitch, b.pitch]).toEqual([127, 107]);
  });

  it("resizes notes with a 1/16 minimum and the clip end as maximum", () => {
    const a = n(60, 3, 0.5);
    resizeNotes([a], -2, 4);
    expect(a.length).toBe(0.25);
    resizeNotes([a], 5, 4);
    expect(a.length).toBe(1);
  });

  it("duplicates a selection right after itself", () => {
    const notes = [n(60, 0, 0.5), n(64, 0.5, 0.5), n(67, 3)];
    const copies = duplicateNotes(notes, [notes[0], notes[1]], 4);
    expect(copies.map((c) => [c.pitch, c.start])).toEqual([
      [60, 1],
      [64, 1.5],
    ]);
    expect(notes).toHaveLength(5);
    expect(notes.map((x) => x.start)).toEqual([0, 0.5, 1, 1.5, 3]);
    // Copies are new objects
    copies[0].pitch = 10;
    expect(notes.find((x) => x.start === 0)!.pitch).toBe(60);
  });

  it("pastes at a position and drops notes past the clip end", () => {
    const notes: Note[] = [];
    const added = pasteNotes(notes, [n(60, 1, 2), n(62, 3)], 2.5, 4);
    expect(added.map((c) => [c.pitch, c.start, c.length])).toEqual([[60, 2.5, 1.5]]);
  });

  it("finds notes in a rectangle", () => {
    const rows = [64, 62, 60];
    const notes = [n(64, 0, 1), n(62, 1, 1), n(60, 3, 1)];
    expect(notesInRect(notes, rows, 0.5, 1.5, 0, 1).map((x) => x.pitch)).toEqual([64, 62]);
    expect(notesInRect(notes, rows, 4, 2, 2, 2).map((x) => x.pitch)).toEqual([60]);
    expect(notesInRect(notes, rows, 2, 2.9, 0, 2)).toEqual([]);
  });
});

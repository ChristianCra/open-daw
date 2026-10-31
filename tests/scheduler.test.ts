import { describe, expect, it } from "vitest";
import { advanceTrack, clipNotesInWindow, emptyPlayState, quantize, type ScheduledNote } from "../src/engine/scheduler";
import type { Clip } from "../src/model";

const clip: Clip = {
  name: "t",
  length: 4,
  notes: [
    { pitch: 60, start: 0, length: 1, velocity: 1 },
    { pitch: 62, start: 2, length: 1, velocity: 1 },
  ],
};

describe("quantize", () => {
  it("rounds up to the next bar", () => {
    expect(quantize(0.1)).toBe(4);
    expect(quantize(4)).toBe(4);
    expect(quantize(7.99)).toBe(8);
    expect(quantize(5, 1)).toBe(5);
  });
});

describe("clipNotesInWindow", () => {
  it("loops the clip", () => {
    const evs = clipNotesInWindow(clip, 0, 0, 12);
    expect(evs.map((e) => e.beat)).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it("respects a clip start offset and window edges", () => {
    const evs = clipNotesInWindow(clip, 8, 6, 10.5);
    expect(evs.map((e) => e.beat)).toEqual([8, 10]);
  });
  it("excludes the window end", () => {
    expect(clipNotesInWindow(clip, 0, 0, 2).map((e) => e.beat)).toEqual([0]);
  });
});

describe("advanceTrack", () => {
  it("starts a queued clip at its launch beat and continues across windows", () => {
    const st = emptyPlayState();
    st.queued = { scene: 0, atBeat: 4 };
    const out: ScheduledNote[] = [];
    advanceTrack(0, [clip], st, 0, 3, out);
    expect(out).toHaveLength(0);
    advanceTrack(0, [clip], st, 3, 7, out);
    expect(out.map((n) => n.beat)).toEqual([4, 6]);
    expect(st.playing).toEqual({ scene: 0, startBeat: 4 });
  });

  it("stops at a queued stop and truncates ringing notes", () => {
    const long: Clip = { name: "l", length: 4, notes: [{ pitch: 60, start: 3, length: 4, velocity: 1 }] };
    const st = emptyPlayState();
    st.playing = { scene: 0, startBeat: 0 };
    st.queued = { scene: null, atBeat: 4 };
    const out: ScheduledNote[] = [];
    advanceTrack(0, [long], st, 0, 8, out);
    expect(out).toHaveLength(1);
    expect(out[0].length).toBe(1);
    expect(st.playing).toBeNull();
  });

  it("switches clips at the boundary", () => {
    const other: Clip = { name: "o", length: 2, notes: [{ pitch: 70, start: 0, length: 0.5, velocity: 1 }] };
    const st = emptyPlayState();
    st.playing = { scene: 0, startBeat: 0 };
    st.queued = { scene: 1, atBeat: 4 };
    const out: ScheduledNote[] = [];
    advanceTrack(0, [clip, other], st, 0, 8, out);
    expect(out.map((n) => [n.beat, n.note.pitch])).toEqual([
      [0, 60],
      [2, 62],
      [4, 70],
      [6, 70],
    ]);
  });
});

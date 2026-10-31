import { describe, expect, it } from "vitest";
import { arrangementNotesInWindow, linearToTimeline, timelineSegments } from "../src/engine/scheduler";
import { createDemoProject, parseProject, serializeProject, trimOverlaps, type ArrangementClip, type Clip } from "../src/model";

const clip: Clip = {
  name: "c",
  length: 4,
  notes: [
    { pitch: 60, start: 0, length: 1, velocity: 1 },
    { pitch: 62, start: 3, length: 2, velocity: 1 },
  ],
};
const ac = (start: number, length: number, offset = 0): ArrangementClip => ({ start, length, offset, clip });

describe("arrangementNotesInWindow", () => {
  it("loops clip content to fill the placed length and cuts notes at the end", () => {
    const out = arrangementNotesInWindow(0, [ac(8, 6)], 0, 100);
    expect(out.map((n) => [n.beat, n.note.pitch, n.length])).toEqual([
      [8, 60, 1],
      [11, 62, 2],
      [12, 60, 1],
    ]);
  });
  it("honours the window and content offset", () => {
    const out = arrangementNotesInWindow(0, [ac(0, 8, 3)], 0, 2);
    // Offset 3: playback enters the loop at beat 3 (the D), then the loop restarts at beat 1.
    expect(out.map((n) => [n.beat, n.note.pitch])).toEqual([
      [0, 62],
      [1, 60],
    ]);
  });
  it("ignores clips outside the window", () => {
    expect(arrangementNotesInWindow(0, [ac(16, 4)], 0, 16)).toHaveLength(0);
  });
});

describe("loop mapping", () => {
  const loop = { enabled: true, start: 4, end: 12 };
  it("wraps once the loop end is passed", () => {
    expect(linearToTimeline(0, 0, loop)).toBe(0);
    expect(linearToTimeline(11, 0, loop)).toBe(11);
    expect(linearToTimeline(12, 0, loop)).toBe(4);
    expect(linearToTimeline(21, 0, loop)).toBe(5);
  });
  it("does not loop when playback starts after the loop", () => {
    expect(linearToTimeline(4, 16, loop)).toBe(20);
  });
  it("splits scheduling windows at the loop end", () => {
    const segs = timelineSegments(10, 14, 0, loop);
    expect(segs).toEqual([
      { linFrom: 10, linTo: 12, tlFrom: 10, wraps: true },
      { linFrom: 12, linTo: 14, tlFrom: 4, wraps: false },
    ]);
  });
  it("returns a single segment without a loop", () => {
    expect(timelineSegments(0, 3, 8, { enabled: false, start: 0, end: 4 })).toEqual([{ linFrom: 0, linTo: 3, tlFrom: 8, wraps: false }]);
  });
});

describe("trimOverlaps", () => {
  it("removes covered clips and shortens partial overlaps", () => {
    const a = ac(0, 8);
    const b = ac(8, 4);
    const c = ac(14, 4);
    const placed = ac(6, 10);
    const list = [a, b, c, placed];
    trimOverlaps(list, placed);
    expect(list).not.toContain(b);
    expect(a.length).toBe(6);
    expect(c.start).toBe(16);
    expect(c.length).toBe(2);
    expect(c.offset).toBe(2);
  });
  it("splits a clip that fully contains the placed one", () => {
    const big = ac(0, 16);
    const placed = ac(4, 4);
    const list = [big, placed];
    trimOverlaps(list, placed);
    const tail = list.find((x) => x !== big && x !== placed);
    expect(big.length).toBe(4);
    expect(tail).toMatchObject({ start: 8, length: 8, offset: 8 });
  });
});

describe("project files with arrangement", () => {
  it("round-trips arrangement clips and loop settings", () => {
    const p = createDemoProject();
    p.tracks[0].arrangement.push({ start: 4, length: 8, offset: 1, clip });
    p.loop = { enabled: true, start: 4, end: 20 };
    const back = parseProject(serializeProject(p));
    expect(back.tracks[0].arrangement).toHaveLength(1);
    expect(back.tracks[0].arrangement[0]).toMatchObject({ start: 4, length: 8, offset: 1, clip: { name: "c", length: 4 } });
    expect(back.tracks[0].arrangement[0].clip.notes).toHaveLength(2);
    expect(back.loop).toEqual({ enabled: true, start: 4, end: 20 });
  });
  it("defaults missing arrangement data", () => {
    const p = parseProject(JSON.stringify({ version: 1, bpm: 120, tracks: [{ instrument: "drums" }] }));
    expect(p.tracks[0].arrangement).toEqual([]);
    expect(p.loop.enabled).toBe(false);
  });
});

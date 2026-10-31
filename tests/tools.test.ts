import { describe, expect, it } from "vitest";
import { applyMidiTool, euclid, midiTools, seededRandom, type MidiToolContext } from "../src/midi/tools";
import type { Note } from "../src/model";
import { inScale } from "../src/music/scales";

const key = { root: 0, scale: "minor" };
const ctx = (seed = 1, length = 4): MidiToolContext => ({ key, length, rng: seededRandom(seed), basePitch: 60 });
const tool = (id: string) => {
  const t = midiTools().find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};
const chord: Note[] = [60, 63, 67].map((pitch) => ({ pitch, start: 0, length: 1, velocity: 0.8 }));

describe("euclid", () => {
  it("produces classic patterns", () => {
    expect(euclid(8, 3).map(Number).join("")).toBe("10010010");
    expect(euclid(16, 4).filter(Boolean)).toHaveLength(4);
    expect(euclid(8, 3, 1).map(Number).join("")).toBe("01001001");
  });
});

describe("generators", () => {
  it("are deterministic for a seed and stay in key", () => {
    const a = applyMidiTool(tool("gen-melody"), [], {}, ctx(7));
    const b = applyMidiTool(tool("gen-melody"), [], {}, ctx(7));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((n) => inScale(n.pitch, key))).toBe(true);
    expect(a.every((n) => n.start >= 0 && n.start + n.length <= 4 + 1e-9)).toBe(true);
  });
  it("chords fill the clip with one chord per step of the progression", () => {
    const notes = applyMidiTool(tool("gen-chords"), [], { progression: "I-V-vi-IV", voices: 3 }, ctx(1, 8));
    expect(notes).toHaveLength(12);
    expect(new Set(notes.map((n) => n.start))).toEqual(new Set([0, 2, 4, 6]));
  });
  it("rhythm generator places euclidean hits", () => {
    const notes = applyMidiTool(tool("gen-rhythm"), [], { steps: 16, pulses: 4, pitch: 36 }, ctx());
    expect(notes.map((n) => n.start)).toEqual([0, 1, 2, 3]);
  });
});

describe("transforms", () => {
  it("arpeggiate turns a chord into a sequence", () => {
    const out = applyMidiTool(tool("tr-arpeggiate"), chord, { style: "up", rate: "0.25" }, ctx());
    expect(out.map((n) => n.pitch)).toEqual([60, 63, 67, 60]);
    expect(out.map((n) => n.start)).toEqual([0, 0.25, 0.5, 0.75]);
  });
  it("strum offsets chord notes in order", () => {
    const out = applyMidiTool(tool("tr-strum"), chord, { time: 0.1, direction: "down" }, ctx());
    expect(out.map((n) => [n.pitch, Number(n.start.toFixed(3))])).toEqual([
      [60, 0],
      [63, 0.05],
      [67, 0.1],
    ]);
  });
  it("time warp keeps notes inside the clip and preserves order", () => {
    const notes: Note[] = [0, 1, 2, 3].map((s) => ({ pitch: 60, start: s, length: 0.5, velocity: 1 }));
    const out = applyMidiTool(tool("tr-timewarp"), notes, { curve: 1 }, ctx());
    expect(out[0].start).toBe(0);
    const starts = out.map((n) => n.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    // Slowing down: gaps get bigger towards the end.
    expect(starts[3] - starts[2]).toBeGreaterThan(starts[1] - starts[0]);
  });
  it("probability 'set' writes the value to every note", () => {
    const out = applyMidiTool(tool("tr-probability"), chord, { mode: "set", value: 0.4 }, ctx());
    expect(out.every((n) => n.probability === 0.4)).toBe(true);
  });
  it("transpose in scale moves by scale degrees", () => {
    const out = applyMidiTool(tool("tr-transpose"), [{ pitch: 60, start: 0, length: 1, velocity: 1 }], { degrees: 2 }, ctx());
    expect(out[0].pitch).toBe(63); // C -> Eb in C minor
  });
  it("every tool runs on an empty and a filled clip without throwing", () => {
    for (const t of midiTools()) {
      expect(() => applyMidiTool(t, [], {}, ctx())).not.toThrow();
      expect(() => applyMidiTool(t, chord, {}, ctx())).not.toThrow();
    }
  });
});

import { describe, expect, it } from "vitest";
import { makeDriveCurve } from "../src/engine/drive";
import { parseMidiMessage } from "../src/engine/midi-input";
import { clipToMidiFile } from "../src/midi/smf";
import { createDemoProject, parseProject, serializeProject } from "../src/model";

describe("project files", () => {
  it("round-trips the demo project", () => {
    const p = createDemoProject();
    expect(parseProject(serializeProject(p))).toEqual(parseProject(serializeProject(parseProject(serializeProject(p)))));
    const back = parseProject(serializeProject(p));
    expect(back.tracks).toHaveLength(p.tracks.length);
    expect(back.tracks[0].clips[0]?.notes.length).toBe(p.tracks[0].clips[0]?.notes.length);
    expect(back.key).toEqual(p.key);
  });
  it("rejects bad input", () => {
    expect(() => parseProject("{}")).toThrow();
    expect(() => parseProject(JSON.stringify({ version: 1, bpm: 5, tracks: [] }))).toThrow();
  });
  it("fills defaults for older/partial files", () => {
    const p = parseProject(JSON.stringify({ version: 1, bpm: 100, tracks: [{ instrument: "synth", clips: [] }] }));
    expect(p.tracks[0].fx.drive.enabled).toBe(false);
    expect(p.tuning.system).toBe("12-tet");
  });
});

describe("MIDI", () => {
  it("parses note on/off, running zero-velocity note-off and pitch bend", () => {
    expect(parseMidiMessage([0x91, 60, 127])).toEqual({ type: "noteon", channel: 1, pitch: 60, velocity: 1 });
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: "noteoff", channel: 0, pitch: 60 });
    expect(parseMidiMessage([0x80, 61, 40])).toEqual({ type: "noteoff", channel: 0, pitch: 61 });
    expect(parseMidiMessage([0xe0, 0x00, 0x40])).toEqual({ type: "bend", channel: 0, value: 0 });
    expect(parseMidiMessage([0xe2, 0x7f, 0x7f])).toEqual({ type: "bend", channel: 2, value: 1 });
    expect(parseMidiMessage([0xf8])).toBeNull();
  });
  it("writes a valid standard MIDI file header", () => {
    const p = createDemoProject();
    const bytes = clipToMidiFile(p.tracks[0].clips[0]!, 120);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("MThd");
    expect(String.fromCharCode(...bytes.slice(14, 18))).toBe("MTrk");
    const len = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
    expect(bytes.length).toBe(22 + len);
    expect([...bytes.slice(-3)]).toEqual([0xff, 0x2f, 0x00]);
  });
});

describe("drive curves", () => {
  it("stay within ±1 and are odd-symmetric", () => {
    for (const shape of ["soft", "hard", "fold"] as const) {
      const c = makeDriveCurve(0.7, shape, 101);
      expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(1 + 1e-6);
      expect(c[0]).toBeCloseTo(-c[100]);
      expect(c[50]).toBeCloseTo(0);
    }
  });
});

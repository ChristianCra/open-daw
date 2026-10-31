import { describe, expect, it } from "vitest";
import { degreeToPitch, inScale, pitchToDegree, snapToScale } from "../src/music/scales";
import { getTuning } from "../src/music/tuning";

const cMajor = { root: 0, scale: "major" };
const aMinor = { root: 9, scale: "minor" };

describe("scales", () => {
  it("detects scale membership", () => {
    expect(inScale(60, cMajor)).toBe(true);
    expect(inScale(61, cMajor)).toBe(false);
    expect(inScale(69, aMinor)).toBe(true);
    expect(inScale(68, aMinor)).toBe(false);
  });
  it("snaps to the nearest scale tone", () => {
    expect(snapToScale(61, cMajor)).toBe(60);
    expect(snapToScale(66, cMajor)).toBe(65);
  });
  it("maps degrees to pitches and back", () => {
    expect([0, 1, 2, 7, -1].map((d) => degreeToPitch(d, cMajor))).toEqual([60, 62, 64, 72, 59]);
    for (const d of [-3, 0, 4, 9]) expect(pitchToDegree(degreeToPitch(d, aMinor), aMinor)).toBe(d);
  });
});

describe("tuning", () => {
  it("12-TET keeps A4 = 440 Hz", () => {
    expect(getTuning("12-tet").toFreq(69, cMajor)).toBeCloseTo(440);
    expect(getTuning("12-tet").toFreq(81, cMajor)).toBeCloseTo(880);
  });
  it("just intonation uses pure ratios from the root", () => {
    const t = getTuning("just");
    const root = t.toFreq(60, cMajor);
    expect(t.toFreq(67, cMajor) / root).toBeCloseTo(1.5);
    expect(t.toFreq(64, cMajor) / root).toBeCloseTo(1.25);
    expect(t.toFreq(72, cMajor) / root).toBeCloseTo(2);
  });
  it("EDO tunings divide the octave evenly", () => {
    const t = getTuning("24-edo");
    expect(t.toFreq(69 + 24, cMajor)).toBeCloseTo(880);
    expect(t.toFreq(70, cMajor) / t.toFreq(69, cMajor)).toBeCloseTo(Math.pow(2, 1 / 24));
  });
});

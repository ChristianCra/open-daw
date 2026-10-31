import { describe, expect, it } from "vitest";
import { AUTOMATION_PARAMS, automationParam, pointsBetween, setPoint, valueAt } from "../src/automation/automation";
import { createDemoProject, parseProject, serializeProject, type AutomationPoint } from "../src/model";

describe("valueAt", () => {
  const pts: AutomationPoint[] = [
    { beat: 4, value: 0 },
    { beat: 8, value: 1 },
    { beat: 12, value: 0.5 },
  ];
  it("holds the first/last value outside the envelope", () => {
    expect(valueAt(pts, 0)).toBe(0);
    expect(valueAt(pts, 100)).toBe(0.5);
  });
  it("interpolates linearly between points", () => {
    expect(valueAt(pts, 6)).toBeCloseTo(0.5);
    expect(valueAt(pts, 10)).toBeCloseTo(0.75);
  });
  it("returns null without points", () => {
    expect(valueAt([], 3)).toBeNull();
    expect(valueAt(undefined, 3)).toBeNull();
  });
});

describe("setPoint / pointsBetween", () => {
  it("inserts sorted and replaces points on the same beat", () => {
    const pts: AutomationPoint[] = [];
    setPoint(pts, 8, 0.2);
    setPoint(pts, 2, 0.4);
    setPoint(pts, 8, 0.9);
    expect(pts).toEqual([
      { beat: 2, value: 0.4 },
      { beat: 8, value: 0.9 },
    ]);
    expect(setPoint(pts, 4, 3).value).toBe(1);
    expect(pointsBetween(pts, 2, 8).map((p) => p.beat)).toEqual([4]);
  });
});

describe("parameter mapping", () => {
  it("round-trips real values through the normalised range", () => {
    for (const def of AUTOMATION_PARAMS) {
      for (const n of [0, 0.25, 0.5, 1]) expect(def.toNorm(def.fromNorm(n))).toBeCloseTo(n);
    }
    expect(automationParam("cutoff").fromNorm(0)).toBeCloseTo(40);
    expect(automationParam("cutoff").fromNorm(1)).toBeCloseTo(18000);
    expect(automationParam("pan").fromNorm(0.5)).toBe(0);
  });
});

describe("project files with automation", () => {
  it("round-trips and sanitises automation points", () => {
    const p = createDemoProject();
    p.tracks[1].automation.volume = [
      { beat: 0, value: 0.2 },
      { beat: 16, value: 0.9 },
    ];
    const back = parseProject(serializeProject(p));
    expect(back.tracks[1].automation.volume).toEqual(p.tracks[1].automation.volume);
    const raw = JSON.parse(serializeProject(p));
    raw.tracks[1].automation = { volume: [{ beat: 8, value: 5 }, { beat: 1, value: -1 }], bogus: [] };
    const fixed = parseProject(JSON.stringify(raw));
    expect(fixed.tracks[1].automation).toEqual({ volume: [{ beat: 1, value: 0 }, { beat: 8, value: 1 }] });
  });
});

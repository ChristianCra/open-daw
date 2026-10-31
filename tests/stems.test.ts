import { formatDuration } from "../src/audio/stem-separator";
import { describe, expect, it } from "vitest";
import { chunkInput, makeWindow, OverlapAdd, planChunks } from "../src/audio/stems";

describe("stem separation chunking", () => {
  it("plans overlapping chunks that cover the input", () => {
    expect(planChunks(10, 8, 2)).toEqual([0, 6]);
    expect(planChunks(5, 8, 2)).toEqual([0]);
    expect(planChunks(0, 8, 2)).toEqual([0]);
    expect(planChunks(12, 8, 2)).toEqual([0, 6]);
    expect(planChunks(13, 8, 2)).toEqual([0, 6, 12]);
  });

  it("fades the window in and out over the overlap", () => {
    expect([...makeWindow(8, 2)].map((v) => +v.toFixed(3))).toEqual([0.333, 0.667, 1, 1, 1, 1, 0.667, 0.333]);
  });

  it("builds zero-padded model input", () => {
    const l = new Float32Array([1, 2, 3, 4, 5]);
    const r = new Float32Array([6, 7, 8, 9, 10]);
    expect([...chunkInput(l, r, 3, 4)]).toEqual([4, 5, 0, 0, 9, 10, 0, 0]);
  });

  it("reconstructs a signal exactly through overlap-add of an identity model", () => {
    const seg = 16;
    const ov = 4;
    const total = 50;
    const left = Float32Array.from({ length: total }, (_, i) => Math.sin(i));
    const right = Float32Array.from({ length: total }, (_, i) => Math.cos(i));
    const oa = new OverlapAdd(total, 2, seg, ov);
    for (const start of planChunks(total, seg, ov)) {
      const input = chunkInput(left, right, start, seg);
      // "Model": stem 0 = input, stem 1 = input * 0.5
      const out = new Float32Array(2 * 2 * seg);
      out.set(input, 0);
      out.set(input.map((v) => v * 0.5), 2 * seg);
      oa.add(out, start);
    }
    const [s0, s1] = oa.finish();
    for (let i = 0; i < total; i++) {
      expect(s0[0][i]).toBeCloseTo(left[i], 5);
      expect(s0[1][i]).toBeCloseTo(right[i], 5);
      expect(s1[0][i]).toBeCloseTo(left[i] * 0.5, 5);
    }
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(0.2)).toBe("1 s");
    expect(formatDuration(44.6)).toBe("45 s");
    expect(formatDuration(150)).toBe("3 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });
});

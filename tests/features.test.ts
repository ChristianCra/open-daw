import { describe, expect, it } from "vitest";
import { extractFeatures, FEATURE_NAMES, fft, mixdown, rankSimilar } from "../src/audio/features";

const SR = 44100;

function tone(freq: number, seconds: number, decay = 0, harmonics = 1): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (let h = 1; h <= harmonics; h++) v += Math.sin(2 * Math.PI * freq * h * t) / h;
    out[i] = v * Math.exp(-decay * t) * 0.5;
  }
  return out;
}

function noise(seconds: number, decay = 0, seed = 1): Float32Array {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rnd() * Math.exp((-decay * i) / SR) * 0.5;
  return out;
}

describe("FFT", () => {
  it("finds the frequency of a sine", () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 64 * i) / n);
    fft(re, im);
    const mags = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    expect(mags.indexOf(Math.max(...mags))).toBe(64);
    expect(mags[64]).toBeCloseTo(n / 2, 3);
  });
});

describe("audio features", () => {
  it("has one value per feature name and no NaNs, also for silence", () => {
    const f = extractFeatures(tone(220, 0.5), SR);
    expect(f).toHaveLength(FEATURE_NAMES.length);
    expect(f.every(Number.isFinite)).toBe(true);
    expect(extractFeatures(new Float32Array(1000), SR).every(Number.isFinite)).toBe(true);
    expect(extractFeatures(new Float32Array(0), SR).every(Number.isFinite)).toBe(true);
  });

  it("is independent of loudness", () => {
    const a = tone(220, 0.5, 4, 3);
    const b = a.map((v) => v * 0.1);
    const fa = extractFeatures(a, SR);
    const fb = extractFeatures(b, SR);
    fa.forEach((v, i) => expect(fb[i]).toBeCloseTo(v, 1));
  });

  it("brighter sounds have a higher spectral centroid", () => {
    const dark = extractFeatures(tone(110, 0.5), SR);
    const bright = extractFeatures(noise(0.5), SR);
    const c = FEATURE_NAMES.indexOf("centroid");
    expect(bright[c]).toBeGreaterThan(dark[c]);
  });

  it("ranks similar sounds first", () => {
    const lib = [
      { name: "bass A", features: extractFeatures(tone(55, 1, 3, 4), SR) },
      { name: "bass B", features: extractFeatures(tone(62, 1.1, 3.5, 4), SR) },
      { name: "hat A", features: extractFeatures(noise(0.15, 40, 1), SR) },
      { name: "hat B", features: extractFeatures(noise(0.12, 45, 7), SR) },
      { name: "pad", features: extractFeatures(tone(440, 3, 0, 2), SR) },
    ];
    const near = (name: string) => {
      const t = lib.find((x) => x.name === name)!;
      return rankSimilar(t.features, lib.filter((x) => x !== t)).map((r) => r.item.name);
    };
    expect(near("bass A")[0]).toBe("bass B");
    expect(near("hat A")[0]).toBe("hat B");
    expect(near("hat B")[0]).toBe("hat A");
    const scores = rankSimilar(lib[0].features, lib).map((r) => r.score);
    expect(scores[0]).toBeCloseTo(1); // itself
    expect(scores.every((s, i) => i === 0 || s <= scores[i - 1])).toBe(true);
  });

  it("mixes channels to mono", () => {
    expect([...mixdown([new Float32Array([1, 0]), new Float32Array([0, 1])])]).toEqual([0.5, 0.5]);
  });
});

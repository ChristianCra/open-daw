// Audio features for "find similar samples". Everything runs locally: a
// short-time spectrum gives timbre (spectral shape, band energies), the
// envelope gives the shape over time. Similarity is the distance between
// standardized feature vectors.

const FRAME = 1024;
const HOP = 512;
/** Analyse at most this many seconds (the start of a sample defines its character). */
const MAX_SECONDS = 8;
const BANDS = 12;

/** Names of the vector entries, for debugging and tests. */
export const FEATURE_NAMES = [
  "centroid",
  "centroidSd",
  "rolloff",
  "flatness",
  "zcr",
  "attack",
  "decay",
  "loudnessSd",
  "length",
  ...Array.from({ length: BANDS }, (_, i) => `band${i}`),
];

/** In-place iterative radix-2 FFT. `re`/`im` lengths must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Mixes channels down to mono. */
export function mixdown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const len = channels[0]?.length ?? 0;
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Log-spaced band edges in Hz from 40 Hz to 16 kHz. */
function bandEdges(): number[] {
  const lo = Math.log(40);
  const hi = Math.log(16000);
  return Array.from({ length: BANDS + 1 }, (_, i) => Math.exp(lo + ((hi - lo) * i) / BANDS));
}

/**
 * Feature vector of a (mono) signal. All entries are roughly scale-free so
 * that loudness alone doesn't make samples "different".
 */
export function extractFeatures(signal: Float32Array, sampleRate: number): number[] {
  const total = Math.min(signal.length, Math.floor(MAX_SECONDS * sampleRate));
  const x = signal.subarray(0, total);
  const window = new Float64Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  const edges = bandEdges();
  const binHz = sampleRate / FRAME;
  const bandOf = new Int16Array(FRAME / 2).map((_, k) => {
    const f = k * binHz;
    if (f < edges[0] || f >= edges[BANDS]) return -1;
    let b = 0;
    while (b < BANDS - 1 && f >= edges[b + 1]) b++;
    return b;
  });

  const centroids: number[] = [];
  const weights: number[] = [];
  const rms: number[] = [];
  const bands = new Float64Array(BANDS);
  let rolloffSum = 0;
  let flatSum = 0;
  let specWeight = 0;
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const frames = Math.max(1, Math.floor((total - FRAME) / HOP) + 1);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let energy = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = x[off + i] ?? 0;
      energy += v * v;
      re[i] = v * window[i];
      im[i] = 0;
    }
    rms.push(Math.sqrt(energy / FRAME));
    fft(re, im);
    let sum = 0;
    let weighted = 0;
    let logSum = 0;
    const mags = new Float64Array(FRAME / 2);
    for (let k = 1; k < FRAME / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      mags[k] = m;
      sum += m;
      weighted += m * k * binHz;
      logSum += Math.log(m + 1e-12);
      const b = bandOf[k];
      if (b >= 0) bands[b] += m * m;
    }
    if (sum < 1e-9) continue;
    const w = Math.sqrt(energy);
    centroids.push(weighted / sum);
    weights.push(w);
    // 85 % roll-off frequency
    let acc = 0;
    let k = 1;
    for (; k < FRAME / 2 && acc < 0.85 * sum; k++) acc += mags[k];
    rolloffSum += w * k * binHz;
    flatSum += w * (Math.exp(logSum / (FRAME / 2 - 1)) / (sum / (FRAME / 2 - 1)));
    specWeight += w;
  }

  // Zero crossing rate
  let zc = 0;
  for (let i = 1; i < total; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) zc++;
  const zcr = total > 1 ? (zc / (total - 1)) * sampleRate : 0;

  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const centroid = centroids.reduce((a, c, i) => a + c * weights[i], 0) / wsum;
  const centroidSd = Math.sqrt(centroids.reduce((a, c, i) => a + (c - centroid) ** 2 * weights[i], 0) / wsum);

  // Envelope: time to peak, and how fast it decays after the peak (relative to length)
  const peak = Math.max(...rms, 1e-9);
  const peakIdx = rms.indexOf(peak);
  const hopSec = HOP / sampleRate;
  const attack = peakIdx * hopSec;
  let decayIdx = peakIdx;
  while (decayIdx < rms.length - 1 && rms[decayIdx] > peak * 0.25) decayIdx++;
  const decay = (decayIdx - peakIdx) * hopSec;
  const loudDb = rms.map((r) => 20 * Math.log10(r / peak + 1e-6));
  const meanDb = loudDb.reduce((a, b) => a + b, 0) / loudDb.length;
  const loudnessSd = Math.sqrt(loudDb.reduce((a, b) => a + (b - meanDb) ** 2, 0) / loudDb.length);

  const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;
  const bandShape = [...bands].map((b) => Math.log10(b / bandTotal + 1e-6));

  const log = (v: number) => Math.log(1 + v);
  return [
    log(centroid),
    log(centroidSd),
    log(specWeight ? rolloffSum / specWeight : 0),
    specWeight ? flatSum / specWeight : 0,
    log(zcr),
    log(attack * 1000),
    log(decay * 1000),
    loudnessSd / 20,
    log((signal.length / sampleRate) * 1000),
    ...bandShape,
  ].map((v) => (Number.isFinite(v) ? v : 0));
}

/** Per-dimension mean and standard deviation over a set of vectors. */
export function featureStats(vectors: number[][]): { mean: number[]; sd: number[] } {
  const dim = vectors[0]?.length ?? 0;
  const mean = new Array<number>(dim).fill(0);
  const sd = new Array<number>(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i] / vectors.length;
  for (const v of vectors) for (let i = 0; i < dim; i++) sd[i] += (v[i] - mean[i]) ** 2 / vectors.length;
  return { mean, sd: sd.map((s) => Math.sqrt(s) || 1) };
}

/** Relative weight of the feature groups (timbre matters most). */
const WEIGHTS = FEATURE_NAMES.map((n) => (n.startsWith("band") ? 0.6 : n === "length" ? 0.5 : 1));

/**
 * Ranks candidates by similarity to `target`. Features are standardized over
 * the whole library so every dimension counts comparably. Returns the
 * candidates with a 0..1 score (1 = identical), most similar first.
 */
export function rankSimilar<T extends { features?: number[] }>(target: number[], candidates: T[], library: number[][] = candidates.flatMap((c) => (c.features ? [c.features] : []))): { item: T; score: number }[] {
  const { mean, sd } = featureStats([...library, target]);
  const z = (v: number[]) => v.map((x, i) => (x - mean[i]) / sd[i]);
  const t = z(target);
  const out: { item: T; score: number }[] = [];
  for (const item of candidates) {
    if (!item.features || item.features.length !== target.length) continue;
    const c = z(item.features);
    let d = 0;
    let wsum = 0;
    for (let i = 0; i < c.length; i++) {
      const w = WEIGHTS[i] ?? 1;
      d += w * (c[i] - t[i]) ** 2;
      wsum += w;
    }
    out.push({ item, score: 1 / (1 + Math.sqrt(d / wsum)) });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Stem separation helpers: chunking and overlap-add for the separation model.
// The model (HT-Demucs, MIT, exported to ONNX) takes 7.8 s of stereo audio at
// 44.1 kHz and returns four stems. Longer audio is cut into overlapping
// chunks whose results are cross-faded back together.

export const STEM_SAMPLE_RATE = 44100;
/** Samples per model call (7.8 s) */
export const SEGMENT = 343980;
/** Overlap between consecutive chunks */
export const OVERLAP = Math.floor(SEGMENT / 4);
/** Output order of the model */
export const STEM_NAMES = ["drums", "bass", "other", "vocals"] as const;
export type StemName = (typeof STEM_NAMES)[number];
export const STEM_LABELS: Record<StemName, string> = { drums: "Drums", bass: "Bass", other: "Rest", vocals: "Gesang" };

/** Start offsets of the chunks that cover `total` samples. */
export function planChunks(total: number, segment = SEGMENT, overlap = OVERLAP): number[] {
  const stride = segment - overlap;
  const n = Math.max(1, Math.ceil(total / stride));
  return Array.from({ length: n }, (_, i) => i * stride);
}

/** Cross-fade window: linear fade-in and fade-out over `overlap` samples, 1 in between. */
export function makeWindow(segment = SEGMENT, overlap = OVERLAP): Float32Array {
  const w = new Float32Array(segment).fill(1);
  for (let i = 0; i < overlap && i < segment; i++) {
    const v = (i + 1) / (overlap + 1);
    w[i] = Math.min(w[i], v);
    w[segment - 1 - i] = Math.min(w[segment - 1 - i], v);
  }
  return w;
}

/** Copies one chunk of a stereo signal into the model's input layout [1, 2, segment], zero-padded. */
export function chunkInput(left: Float32Array, right: Float32Array, start: number, segment = SEGMENT): Float32Array {
  const out = new Float32Array(2 * segment);
  const n = Math.max(0, Math.min(segment, left.length - start));
  out.set(left.subarray(start, start + n), 0);
  out.set(right.subarray(start, start + n), segment);
  return out;
}

/** Accumulates model outputs ([1, stems, 2, segment], flattened) into full-length stems. */
export class OverlapAdd {
  readonly stems: Float32Array[][];
  private weight: Float32Array;
  private window: Float32Array;

  constructor(
    private total: number,
    private stemCount: number = STEM_NAMES.length,
    private segment = SEGMENT,
    overlap = OVERLAP,
  ) {
    this.stems = Array.from({ length: stemCount }, () => [new Float32Array(total), new Float32Array(total)]);
    this.weight = new Float32Array(total);
    this.window = makeWindow(segment, overlap);
  }

  add(output: Float32Array, start: number) {
    const seg = this.segment;
    const n = Math.max(0, Math.min(seg, this.total - start));
    for (let s = 0; s < this.stemCount; s++) {
      for (let c = 0; c < 2; c++) {
        const src = output.subarray((s * 2 + c) * seg, (s * 2 + c + 1) * seg);
        const dst = this.stems[s][c];
        for (let i = 0; i < n; i++) dst[start + i] += src[i] * this.window[i];
      }
    }
    for (let i = 0; i < n; i++) this.weight[start + i] += this.window[i];
  }

  /** Divides by the summed window weights. Call once after all chunks. */
  finish(): Float32Array[][] {
    for (const stem of this.stems) for (const ch of stem) for (let i = 0; i < ch.length; i++) ch[i] /= Math.max(this.weight[i], 1e-8);
    return this.stems;
  }
}

// Minimal RIFF/WAVE encoder (PCM 16/24 bit, IEEE float 32 bit) and helpers.

export type WavFormat = "pcm16" | "pcm24" | "float32";

/** Encodes planar channel data as a WAV file. Samples are clipped to [-1, 1] for PCM. */
export function encodeWav(channels: Float32Array[], sampleRate: number, format: WavFormat = "pcm16"): ArrayBuffer {
  const numCh = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytes = format === "pcm16" ? 2 : format === "pcm24" ? 3 : 4;
  const blockAlign = numCh * bytes;
  const dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, format === "float32" ? 3 : 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bytes * 8, true);
  str(36, "data");
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const x = channels[c]?.[i] ?? 0;
      if (format === "float32") {
        v.setFloat32(o, x, true);
      } else {
        const clipped = Math.max(-1, Math.min(1, x));
        if (format === "pcm16") v.setInt16(o, Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff), true);
        else {
          const n = Math.round(clipped < 0 ? clipped * 0x800000 : clipped * 0x7fffff);
          v.setUint8(o, n & 0xff);
          v.setUint8(o + 1, (n >> 8) & 0xff);
          v.setUint8(o + 2, (n >> 16) & 0xff);
        }
      }
      o += bytes;
    }
  }
  return buf;
}

/** Highest absolute sample value over all channels. */
export function peakLevel(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  return peak;
}

/** Scales all channels so the peak sits at `target` (linear). Silent input stays silent. */
export function normalize(channels: Float32Array[], target = 0.98): void {
  const peak = peakLevel(channels);
  if (peak <= 0) return;
  const g = target / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

/**
 * Number of frames at the end that are (nearly) silent, so render tails can be
 * trimmed. Never trims below `minFrames`.
 */
export function trailingSilence(channels: Float32Array[], threshold = 1e-4, minFrames = 0): number {
  const len = channels[0]?.length ?? 0;
  let last = len - 1;
  for (; last >= minFrames; last--) {
    if (channels.some((ch) => Math.abs(ch[last]) > threshold)) break;
  }
  return len - 1 - Math.max(last, minFrames - 1);
}

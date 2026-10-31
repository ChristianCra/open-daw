import { describe, expect, it } from "vitest";
import { encodeWav, normalize, peakLevel, trailingSilence } from "../src/audio/wav";
import { prepareRenderProject, samplesUsed } from "../src/engine/render";
import { createAudioClip, createDemoProject } from "../src/model";

const text = (b: ArrayBuffer, o: number, n: number) => String.fromCharCode(...new Uint8Array(b, o, n));

describe("WAV encoder", () => {
  it("writes a valid 16-bit stereo header and interleaved data", () => {
    const l = new Float32Array([0, 1, -1]);
    const r = new Float32Array([0.5, -0.5, 2]);
    const buf = encodeWav([l, r], 48000, "pcm16");
    const v = new DataView(buf);
    expect(text(buf, 0, 4)).toBe("RIFF");
    expect(text(buf, 8, 4)).toBe("WAVE");
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 4);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(3 * 4);
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect([s(0), s(1), s(2), s(3), s(4), s(5)]).toEqual([0, 16384, 32767, -16384, -32768, 32767]);
  });

  it("writes 24-bit little-endian samples", () => {
    const buf = encodeWav([new Float32Array([1, -1, 0.5])], 44100, "pcm24");
    const v = new DataView(buf);
    expect(v.getUint16(32, true)).toBe(3);
    expect(v.getUint16(34, true)).toBe(24);
    const s24 = (i: number) => {
      const o = 44 + i * 3;
      const n = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
      return n & 0x800000 ? n - 0x1000000 : n;
    };
    expect([s24(0), s24(1), s24(2)]).toEqual([0x7fffff, -0x800000, Math.round(0.5 * 0x7fffff)]);
  });

  it("writes 32-bit float without clipping", () => {
    const buf = encodeWav([new Float32Array([1.5, -0.25])], 44100, "float32");
    const v = new DataView(buf);
    expect(v.getUint16(20, true)).toBe(3); // IEEE float
    expect(v.getFloat32(44, true)).toBe(1.5);
    expect(v.getFloat32(48, true)).toBe(-0.25);
  });
});

describe("render helpers", () => {
  it("normalizes to the target peak", () => {
    const ch = [new Float32Array([0.1, -0.25]), new Float32Array([0.2, 0])];
    normalize(ch, 1);
    expect(peakLevel(ch)).toBeCloseTo(1);
    expect(ch[0][0]).toBeCloseTo(0.4);
    const silent = [new Float32Array(4)];
    normalize(silent);
    expect([...silent[0]]).toEqual([0, 0, 0, 0]);
  });

  it("measures trailing silence but keeps the minimum length", () => {
    const ch = [new Float32Array([0.5, 0.2, 0, 0, 0, 0])];
    expect(trailingSilence(ch)).toBe(4);
    expect(trailingSilence(ch, 1e-4, 4)).toBe(2);
    expect(trailingSilence([new Float32Array([0, 0, 0])])).toBe(3);
  });

  it("prepares a render copy: loop off, only selected tracks audible, unity master", () => {
    const p = createDemoProject();
    p.loop = { enabled: true, start: 0, end: 8 };
    p.tracks[0].solo = true;
    p.tracks[2].mute = true;
    const r = prepareRenderProject(p, { tracks: [2], unityMaster: true });
    expect(r.loop.enabled).toBe(false);
    expect(r.masterVolume).toBe(1);
    expect(r.tracks.map((t) => t.mute)).toEqual(p.tracks.map((_, i) => i !== 2));
    expect(r.tracks.every((t) => !t.solo)).toBe(true);
    // The original project is untouched.
    expect(p.loop.enabled).toBe(true);
    expect(p.tracks[0].solo).toBe(true);
  });

  it("lists samples used on the arrangement", () => {
    const p = createDemoProject();
    p.tracks[0].arrangement.push({ start: 0, length: 4, clip: createAudioClip("a", "s1", 2, 120) });
    p.tracks[1].arrangement.push({ start: 0, length: 4, clip: createAudioClip("b", "s2", 2, 120) });
    expect(samplesUsed(p).sort()).toEqual(["s1", "s2"]);
    expect(samplesUsed(p, [1])).toEqual(["s2"]);
  });
});

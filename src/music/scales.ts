// Scales and key handling. Intervals are semitones above the root.

import type { KeySignature } from "../model";

export interface ScaleDef {
  id: string;
  name: string;
  intervals: number[];
}

export const SCALES: ScaleDef[] = [
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "locrian", name: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "harmonic-minor", name: "Harmonic Minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor", name: "Melodic Minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "major-pentatonic", name: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", name: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", name: "Blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "whole-tone", name: "Whole Tone", intervals: [0, 2, 4, 6, 8, 10] },
  { id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export function getScale(id: string): ScaleDef {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

export function inScale(pitch: number, key: KeySignature): boolean {
  return getScale(key.scale).intervals.includes(mod(pitch - key.root, 12));
}

export function isRoot(pitch: number, key: KeySignature): boolean {
  return mod(pitch - key.root, 12) === 0;
}

/** Nearest in-scale pitch (ties resolve downwards). */
export function snapToScale(pitch: number, key: KeySignature): number {
  for (let d = 0; d < 12; d++) {
    if (inScale(pitch - d, key)) return pitch - d;
    if (inScale(pitch + d, key)) return pitch + d;
  }
  return pitch;
}

/**
 * Pitch of a scale degree. Degree 0 is the root in the octave that contains
 * `basePitch`'s root; negative and large degrees wrap into other octaves.
 */
export function degreeToPitch(degree: number, key: KeySignature, basePitch = 60): number {
  const iv = getScale(key.scale).intervals;
  const octave = Math.floor(degree / iv.length);
  const baseRoot = basePitch - mod(basePitch - key.root, 12);
  return baseRoot + octave * 12 + iv[mod(degree, iv.length)];
}

/** Scale degree index of an in-scale pitch relative to `basePitch`'s root octave (snaps first). */
export function pitchToDegree(pitch: number, key: KeySignature, basePitch = 60): number {
  const iv = getScale(key.scale).intervals;
  const p = snapToScale(pitch, key);
  const baseRoot = basePitch - mod(basePitch - key.root, 12);
  const rel = p - baseRoot;
  const octave = Math.floor(rel / 12);
  return octave * iv.length + iv.indexOf(mod(rel, 12));
}

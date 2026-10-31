// Tuning systems. A tuning maps a MIDI note number to a frequency.
// Equal divisions of the octave (EDO) map consecutive keys to consecutive
// steps of the division, the usual layout for microtonal keyboards.

import type { KeySignature } from "../model";

export interface TuningDef {
  id: string;
  name: string;
  toFreq(pitch: number, key: KeySignature): number;
}

function edo(divisions: number): TuningDef {
  return {
    id: divisions === 12 ? "12-tet" : `${divisions}-edo`,
    name: divisions === 12 ? "12-TET (Standard)" : `${divisions}-EDO`,
    toFreq: (pitch) => 440 * Math.pow(2, (pitch - 69) / divisions),
  };
}

const JUST_RATIOS = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
const PYTHAGOREAN_RATIOS = [1, 256 / 243, 9 / 8, 32 / 27, 81 / 64, 4 / 3, 729 / 512, 3 / 2, 128 / 81, 27 / 16, 16 / 9, 243 / 128];

/** 12-note ratio tuning anchored on the key root (root keeps its 12-TET frequency). */
function ratioTuning(id: string, name: string, ratios: number[]): TuningDef {
  return {
    id,
    name,
    toFreq(pitch, key) {
      const rel = pitch - key.root;
      const octave = Math.floor(rel / 12);
      const degree = rel - octave * 12;
      const rootFreq = 440 * Math.pow(2, (key.root - 69) / 12);
      return rootFreq * Math.pow(2, octave) * ratios[degree];
    },
  };
}

export const TUNINGS: TuningDef[] = [
  edo(12),
  ratioTuning("just", "Just Intonation (5-limit)", JUST_RATIOS),
  ratioTuning("pythagorean", "Pythagorean", PYTHAGOREAN_RATIOS),
  edo(19),
  edo(24),
  edo(31),
];

export function getTuning(id: string): TuningDef {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

// MIDI Tools: generators create notes, transforms rewrite existing notes.
// Every tool is a pure function of (notes, params, context) so tools are easy
// to test and third parties can add their own by calling registerMidiTool().

import { STEPS_PER_BEAT, type KeySignature, type Note } from "../model";
import { degreeToPitch, pitchToDegree, snapToScale } from "../music/scales";

export type ParamSpec =
  | { id: string; label: string; type: "number"; min: number; max: number; step: number; default: number }
  | { id: string; label: string; type: "select"; options: { value: string; label: string }[]; default: string };

export type ParamValues = Record<string, number | string>;

export interface MidiToolContext {
  key: KeySignature;
  /** Clip length in beats */
  length: number;
  /** Deterministic random source in [0, 1) */
  rng: () => number;
  /** Pitch range hint (e.g. drum pitches or the editor's centre) */
  basePitch: number;
}

export interface MidiTool {
  id: string;
  name: string;
  kind: "generator" | "transform";
  params: ParamSpec[];
  run(notes: Note[], params: ParamValues, ctx: MidiToolContext): Note[];
}

/** Small seeded PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (p: ParamValues, id: string) => Number(p[id]);
const str = (p: ParamValues, id: string) => String(p[id]);
const STEP = 1 / STEPS_PER_BEAT;
const sortNotes = (notes: Note[]) => notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
const clone = (notes: Note[]) => notes.map((n) => ({ ...n }));

/** Euclidean rhythm: distributes `pulses` hits as evenly as possible over `steps`. */
export function euclid(steps: number, pulses: number, rotation = 0): boolean[] {
  const n = Math.max(1, Math.round(steps));
  const k = Math.max(0, Math.min(n, Math.round(pulses)));
  const base = Array.from({ length: n }, (_, i) => (i * k) % n < k && k > 0);
  const r = ((Math.round(rotation) % n) + n) % n;
  return base.map((_, i) => base[(i - r + n) % n]);
}

/** Groups notes that start together (within a 32nd) into chords. */
export function groupChords(notes: Note[]): Note[][] {
  const sorted = sortNotes(clone(notes));
  const groups: Note[][] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].start - n.start) < 1 / 8) g.push(n);
    else groups.push([n]);
  }
  return groups;
}

// ---------------------------------------------------------------- generators

const rhythmGenerator: MidiTool = {
  id: "gen-rhythm",
  name: "Rhythm (Euclidean)",
  kind: "generator",
  params: [
    { id: "steps", label: "Steps", type: "number", min: 2, max: 32, step: 1, default: 16 },
    { id: "pulses", label: "Hits", type: "number", min: 0, max: 32, step: 1, default: 5 },
    { id: "rotation", label: "Rotation", type: "number", min: 0, max: 31, step: 1, default: 0 },
    { id: "pitch", label: "Pitch", type: "number", min: 0, max: 127, step: 1, default: 36 },
    { id: "accent", label: "Accent", type: "number", min: 0, max: 1, step: 0.05, default: 0.3 },
  ],
  run(notes, p, ctx) {
    const steps = num(p, "steps");
    const pattern = euclid(steps, num(p, "pulses"), num(p, "rotation"));
    const stepLen = STEP;
    const out = clone(notes);
    const repeats = Math.ceil(ctx.length / (steps * stepLen));
    for (let rep = 0; rep < repeats; rep++) {
      pattern.forEach((on, i) => {
        const start = (rep * steps + i) * stepLen;
        if (on && start < ctx.length) {
          const accent = i === 0 ? 1 : 1 - num(p, "accent");
          out.push({ pitch: num(p, "pitch"), start, length: stepLen, velocity: 0.9 * accent, probability: 1 });
        }
      });
    }
    return sortNotes(out);
  },
};

const melodyGenerator: MidiTool = {
  id: "gen-melody",
  name: "Melody",
  kind: "generator",
  params: [
    { id: "density", label: "Density", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.5 },
    { id: "range", label: "Range (degrees)", type: "number", min: 2, max: 21, step: 1, default: 7 },
    { id: "leap", label: "Max leap", type: "number", min: 1, max: 7, step: 1, default: 2 },
    { id: "grid", label: "Grid", type: "select", options: [{ value: "0.25", label: "1/16" }, { value: "0.5", label: "1/8" }, { value: "1", label: "1/4" }], default: "0.25" },
    { id: "octave", label: "Octave", type: "number", min: 1, max: 7, step: 1, default: 4 },
  ],
  run(notes, p, ctx) {
    const grid = Number(str(p, "grid"));
    const range = num(p, "range");
    const base = (num(p, "octave") + 1) * 12 + ctx.key.root;
    const out = clone(notes);
    let degree = 0;
    let lastNote: Note | null = null;
    for (let t = 0; t < ctx.length - 1e-9; t += grid) {
      if (ctx.rng() > num(p, "density")) {
        if (lastNote && ctx.rng() < 0.5) lastNote.length += grid; // sometimes tie over rests
        continue;
      }
      const leap = Math.round((ctx.rng() * 2 - 1) * num(p, "leap"));
      degree = Math.max(0, Math.min(range - 1, degree + leap));
      lastNote = { pitch: degreeToPitch(degree, ctx.key, base), start: t, length: grid, velocity: 0.6 + ctx.rng() * 0.35, probability: 1 };
      out.push(lastNote);
    }
    return sortNotes(out);
  },
};

const PROGRESSIONS: Record<string, number[]> = {
  "I-V-vi-IV": [0, 4, 5, 3],
  "i-VI-III-VII": [0, 5, 2, 6],
  "ii-V-I-I": [1, 4, 0, 0],
  "I-vi-IV-V": [0, 5, 3, 4],
  "i-iv-v-i": [0, 3, 4, 0],
};

const chordGenerator: MidiTool = {
  id: "gen-chords",
  name: "Chords",
  kind: "generator",
  params: [
    { id: "progression", label: "Progression", type: "select", options: Object.keys(PROGRESSIONS).map((k) => ({ value: k, label: k })), default: "i-VI-III-VII" },
    { id: "voices", label: "Voices", type: "number", min: 3, max: 5, step: 1, default: 3 },
    { id: "octave", label: "Octave", type: "number", min: 2, max: 6, step: 1, default: 4 },
    { id: "spread", label: "Spread", type: "number", min: 0, max: 1, step: 1, default: 0 },
  ],
  run(notes, p, ctx) {
    const prog = PROGRESSIONS[str(p, "progression")] ?? PROGRESSIONS["I-V-vi-IV"];
    const chordLen = ctx.length / prog.length;
    const base = (num(p, "octave") + 1) * 12 + ctx.key.root;
    const out = clone(notes);
    prog.forEach((root, i) => {
      for (let v = 0; v < num(p, "voices"); v++) {
        let pitch = degreeToPitch(root + v * 2, ctx.key, base);
        if (num(p, "spread") && v % 2 === 1) pitch += 12; // open voicing
        out.push({ pitch, start: i * chordLen, length: chordLen * 0.95, velocity: 0.6, probability: 1 });
      }
    });
    return sortNotes(out);
  },
};

// ---------------------------------------------------------------- transforms

const arpeggiate: MidiTool = {
  id: "tr-arpeggiate",
  name: "Arpeggiate",
  kind: "transform",
  params: [
    { id: "style", label: "Style", type: "select", options: ["up", "down", "updown", "random"].map((v) => ({ value: v, label: v })), default: "up" },
    { id: "rate", label: "Rate", type: "select", options: [{ value: "0.25", label: "1/16" }, { value: "0.5", label: "1/8" }, { value: "0.1667", label: "1/16T" }], default: "0.25" },
    { id: "gate", label: "Gate", type: "number", min: 0.1, max: 1, step: 0.05, default: 0.8 },
  ],
  run(notes, p, ctx) {
    const rate = Number(str(p, "rate"));
    const out: Note[] = [];
    for (const chord of groupChords(notes)) {
      const pitches = chord.map((n) => n.pitch).sort((a, b) => a - b);
      let order = pitches;
      if (str(p, "style") === "down") order = [...pitches].reverse();
      if (str(p, "style") === "updown") order = pitches.concat(pitches.slice(1, -1).reverse());
      const start = chord[0].start;
      const end = start + Math.max(...chord.map((n) => n.length));
      let i = 0;
      for (let t = start; t < end - 1e-9; t += rate, i++) {
        const pitch = str(p, "style") === "random" ? pitches[Math.floor(ctx.rng() * pitches.length)] : order[i % order.length];
        out.push({ ...chord[0], pitch, start: t, length: rate * num(p, "gate") });
      }
    }
    return sortNotes(out);
  },
};

const strum: MidiTool = {
  id: "tr-strum",
  name: "Strum",
  kind: "transform",
  params: [
    { id: "time", label: "Time (beats)", type: "number", min: 0, max: 0.5, step: 0.01, default: 0.08 },
    { id: "direction", label: "Direction", type: "select", options: ["down", "up", "alternate"].map((v) => ({ value: v, label: v })), default: "down" },
    { id: "tension", label: "Curve", type: "number", min: -1, max: 1, step: 0.1, default: 0 },
  ],
  run(notes, p) {
    const out: Note[] = [];
    groupChords(notes).forEach((chord, ci) => {
      let sorted = [...chord].sort((a, b) => a.pitch - b.pitch);
      const dir = str(p, "direction");
      if (dir === "up" || (dir === "alternate" && ci % 2 === 1)) sorted = sorted.reverse();
      const exp = Math.pow(2, num(p, "tension") * 2);
      sorted.forEach((n, i) => {
        const frac = sorted.length > 1 ? Math.pow(i / (sorted.length - 1), exp) : 0;
        const offset = frac * num(p, "time");
        out.push({ ...n, start: n.start + offset, length: Math.max(STEP / 4, n.length - offset) });
      });
    });
    return sortNotes(out);
  },
};

const ornament: MidiTool = {
  id: "tr-ornament",
  name: "Ornament",
  kind: "transform",
  params: [
    { id: "type", label: "Type", type: "select", options: ["grace", "flam", "trill"].map((v) => ({ value: v, label: v })), default: "grace" },
    { id: "amount", label: "Chance", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
  ],
  run(notes, p, ctx) {
    const out = clone(notes);
    const type = str(p, "type");
    for (const n of notes) {
      if (ctx.rng() >= num(p, "amount")) continue;
      if (type === "flam") {
        out.push({ ...n, start: Math.max(0, n.start - 1 / 32), length: 1 / 32, velocity: n.velocity * 0.6 });
      } else if (type === "grace") {
        const upper = snapToScale(n.pitch + 2, ctx.key);
        out.push({ ...n, pitch: upper === n.pitch ? n.pitch + 1 : upper, start: Math.max(0, n.start - 1 / 16), length: 1 / 16, velocity: n.velocity * 0.7 });
      } else if (type === "trill" && n.length >= 0.5) {
        const upper = snapToScale(n.pitch + 2, ctx.key);
        const idx = out.findIndex((o) => o.start === n.start && o.pitch === n.pitch);
        out.splice(idx, 1);
        for (let t = 0, i = 0; t < n.length - 1e-9; t += 1 / 8, i++) {
          out.push({ ...n, pitch: i % 2 ? upper : n.pitch, start: n.start + t, length: 1 / 8 });
        }
      }
    }
    return sortNotes(out);
  },
};

const rhythmVariation: MidiTool = {
  id: "tr-variation",
  name: "Rhythm Variation",
  kind: "transform",
  params: [
    { id: "amount", label: "Amount", type: "number", min: 0, max: 1, step: 0.05, default: 0.3 },
    { id: "mode", label: "Mode", type: "select", options: ["mixed", "split", "drop", "shift"].map((v) => ({ value: v, label: v })), default: "mixed" },
  ],
  run(notes, p, ctx) {
    const out: Note[] = [];
    const modes = ["split", "drop", "shift"];
    for (const n of notes) {
      if (ctx.rng() >= num(p, "amount")) {
        out.push({ ...n });
        continue;
      }
      const mode = str(p, "mode") === "mixed" ? modes[Math.floor(ctx.rng() * modes.length)] : str(p, "mode");
      if (mode === "drop") continue;
      if (mode === "split" && n.length >= 2 * STEP) {
        const half = n.length / 2;
        out.push({ ...n, length: half }, { ...n, start: n.start + half, length: half, velocity: n.velocity * 0.85 });
      } else if (mode === "shift") {
        const start = Math.min(ctx.length - STEP, Math.max(0, n.start + (ctx.rng() < 0.5 ? -STEP : STEP)));
        out.push({ ...n, start });
      } else out.push({ ...n });
    }
    return sortNotes(out);
  },
};

const timeWarp: MidiTool = {
  id: "tr-timewarp",
  name: "Accelerando / Ritardando",
  kind: "transform",
  params: [{ id: "curve", label: "Curve (- faster / + slower)", type: "number", min: -1, max: 1, step: 0.05, default: 0.5 }],
  run(notes, p, ctx) {
    // Maps clip time t -> L * (t/L)^e: e > 1 bunches notes at the start
    // (they get further apart = slowing down), e < 1 the opposite.
    const e = Math.pow(3, num(p, "curve"));
    const L = ctx.length;
    const warp = (t: number) => L * Math.pow(Math.min(1, Math.max(0, t / L)), e);
    return sortNotes(
      notes.map((n) => {
        const start = warp(n.start);
        return { ...n, start, length: Math.max(1 / 64, warp(n.start + n.length) - start) };
      }),
    );
  },
};

const quantizeTool: MidiTool = {
  id: "tr-quantize",
  name: "Quantize",
  kind: "transform",
  params: [
    { id: "grid", label: "Grid", type: "select", options: [{ value: "0.25", label: "1/16" }, { value: "0.5", label: "1/8" }, { value: "1", label: "1/4" }], default: "0.25" },
    { id: "strength", label: "Strength", type: "number", min: 0, max: 1, step: 0.05, default: 1 },
  ],
  run(notes, p) {
    const g = Number(str(p, "grid"));
    return sortNotes(notes.map((n) => ({ ...n, start: n.start + (Math.round(n.start / g) * g - n.start) * num(p, "strength") })));
  },
};

const humanize: MidiTool = {
  id: "tr-humanize",
  name: "Humanize",
  kind: "transform",
  params: [
    { id: "timing", label: "Timing (beats)", type: "number", min: 0, max: 0.1, step: 0.005, default: 0.02 },
    { id: "velocity", label: "Velocity", type: "number", min: 0, max: 0.5, step: 0.05, default: 0.15 },
  ],
  run(notes, p, ctx) {
    return sortNotes(
      notes.map((n) => ({
        ...n,
        start: Math.max(0, n.start + (ctx.rng() * 2 - 1) * num(p, "timing")),
        velocity: Math.min(1, Math.max(0.05, n.velocity + (ctx.rng() * 2 - 1) * num(p, "velocity"))),
      })),
    );
  },
};

const transposeInScale: MidiTool = {
  id: "tr-transpose",
  name: "Transpose in Scale",
  kind: "transform",
  params: [{ id: "degrees", label: "Degrees", type: "number", min: -14, max: 14, step: 1, default: 2 }],
  run(notes, p, ctx) {
    return notes.map((n) => ({ ...n, pitch: Math.min(127, Math.max(0, degreeToPitch(pitchToDegree(n.pitch, ctx.key) + num(p, "degrees"), ctx.key))) }));
  },
};

const probability: MidiTool = {
  id: "tr-probability",
  name: "Probability",
  kind: "transform",
  params: [
    { id: "mode", label: "Mode", type: "select", options: ["set", "random", "offbeats"].map((v) => ({ value: v, label: v })), default: "random" },
    { id: "value", label: "Value", type: "number", min: 0, max: 1, step: 0.05, default: 0.6 },
  ],
  run(notes, p, ctx) {
    const v = num(p, "value");
    return notes.map((n) => {
      switch (str(p, "mode")) {
        case "set":
          return { ...n, probability: v };
        case "offbeats":
          return { ...n, probability: Math.abs(n.start % 1) < 1e-6 ? 1 : v };
        default:
          return { ...n, probability: v + (1 - v) * ctx.rng() };
      }
    });
  },
};

const legato: MidiTool = {
  id: "tr-legato",
  name: "Legato",
  kind: "transform",
  params: [],
  run(notes, _p, ctx) {
    const sorted = sortNotes(clone(notes));
    const starts = [...new Set(sorted.map((n) => n.start))];
    return sorted.map((n) => {
      const next = starts.find((s) => s > n.start + 1e-9) ?? ctx.length;
      return { ...n, length: next - n.start };
    });
  },
};

const registry: MidiTool[] = [
  rhythmGenerator,
  melodyGenerator,
  chordGenerator,
  arpeggiate,
  strum,
  ornament,
  rhythmVariation,
  timeWarp,
  quantizeTool,
  humanize,
  transposeInScale,
  probability,
  legato,
];

export function midiTools(): readonly MidiTool[] {
  return registry;
}

/** Extension point: add a custom generator or transform at runtime. */
export function registerMidiTool(tool: MidiTool) {
  const i = registry.findIndex((t) => t.id === tool.id);
  if (i >= 0) registry[i] = tool;
  else registry.push(tool);
}

export function defaultParams(tool: MidiTool): ParamValues {
  return Object.fromEntries(tool.params.map((p) => [p.id, p.default]));
}

/** Runs a tool and clamps the result into the clip. */
export function applyMidiTool(tool: MidiTool, notes: Note[], params: ParamValues, ctx: MidiToolContext): Note[] {
  return tool
    .run(clone(notes), { ...defaultParams(tool), ...params }, ctx)
    .filter((n) => n.start >= 0 && n.start < ctx.length && n.pitch >= 0 && n.pitch <= 127)
    .map((n) => ({ ...n, length: Math.min(n.length, ctx.length - n.start) }));
}

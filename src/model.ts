// Core project data model. Everything here is plain JSON so it can be saved,
// loaded and diffed easily. Time is measured in beats (quarter notes).

export const PROJECT_VERSION = 1;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BEAT = 4; // 16th-note grid

export interface Note {
  /** MIDI pitch, 0..127 */
  pitch: number;
  /** Start in beats, relative to the clip start */
  start: number;
  /** Length in beats */
  length: number;
  /** Velocity 0..1 */
  velocity: number;
  /** Chance 0..1 that the note plays on each loop pass (default 1) */
  probability?: number;
  /** Internal: set on the trigger "note" of an audio clip */
  audio?: AudioRegion;
  /** Internal: where playback of an audio trigger starts inside the clip, in beats */
  sampleOffset?: number;
}

/** Audio content of a clip on an audio track. */
export interface AudioRegion {
  /** Id of the sample in the sample library */
  sampleId: string;
  /** Linear gain 0..2 */
  gain: number;
  /**
   * Original tempo of the sample. When set, the sample is re-pitched to follow
   * the project tempo (playback rate = project BPM / sample BPM). Null plays at
   * original speed.
   */
  sampleBpm: number | null;
}

export interface Clip {
  name: string;
  /** Loop length in beats */
  length: number;
  notes: Note[];
  /** Present on audio clips */
  audio?: AudioRegion;
}

export type InstrumentKind = "synth" | "drums" | "audio";

export type Waveform = "sine" | "triangle" | "sawtooth" | "square";

export interface SynthParams {
  waveform: Waveform;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
}

export type DriveShape = "soft" | "hard" | "fold";

/** Multiband saturation insert ("Drive"). Bands split at ~250 Hz and ~2.5 kHz. */
export interface DriveParams {
  enabled: boolean;
  shape: DriveShape;
  low: number;
  mid: number;
  high: number;
  /** Dry/wet 0..1 */
  mix: number;
}

export interface TrackFx {
  /** Delay send amount 0..1 */
  delay: number;
  drive: DriveParams;
}

export interface KeySignature {
  /** Pitch class of the root, 0 = C */
  root: number;
  /** Id from SCALES in music/scales.ts */
  scale: string;
}

export interface TuningSettings {
  /** Id from TUNINGS in music/tuning.ts */
  system: string;
}

export interface Track {
  name: string;
  color: string;
  instrument: InstrumentKind;
  synth: SynthParams;
  /** Linear gain 0..1.25 */
  volume: number;
  /** -1 (left) .. 1 (right) */
  pan: number;
  mute: boolean;
  solo: boolean;
  fx: TrackFx;
  /** One slot per scene; null = empty slot */
  clips: (Clip | null)[];
  /** Clips placed on the arrangement timeline, sorted by start */
  arrangement: ArrangementClip[];
  /** Automation envelopes on the arrangement timeline, keyed by parameter id */
  automation: Partial<Record<AutomationParam, AutomationPoint[]>>;
}

export type AutomationParam = "volume" | "pan" | "delay" | "cutoff" | "driveMix";

export interface AutomationPoint {
  /** Timeline position in beats */
  beat: number;
  /** Normalised value 0..1 (see AUTOMATION_PARAMS for the mapping) */
  value: number;
}

/** A clip placed on the arrangement timeline. The clip loops to fill `length`. */
export interface ArrangementClip {
  /** Timeline position in beats */
  start: number;
  /** Length on the timeline in beats */
  length: number;
  /** Where in the clip's loop playback begins, in beats (set when the left part is cut off) */
  offset?: number;
  clip: Clip;
}

export interface LoopRegion {
  enabled: boolean;
  /** Beats, on the bar grid */
  start: number;
  end: number;
}

export interface Project {
  version: number;
  name: string;
  bpm: number;
  sceneCount: number;
  masterVolume: number;
  key: KeySignature;
  tuning: TuningSettings;
  loop: LoopRegion;
  tracks: Track[];
}

export const DEFAULT_SYNTH: SynthParams = {
  waveform: "sawtooth",
  attack: 0.005,
  decay: 0.15,
  sustain: 0.6,
  release: 0.2,
  cutoff: 2400,
  resonance: 4,
};

export const DEFAULT_DRIVE: DriveParams = { enabled: false, shape: "soft", low: 0.3, mid: 0.5, high: 0.2, mix: 1 };

export const TRACK_COLORS = ["#ff7a59", "#ffc145", "#5ad1a0", "#4fb3ff", "#b48cff", "#ff6fb5", "#9fd356", "#7ce0e6"];

/** Pitches used by the built-in drum kit, top to bottom in the editor. */
export const DRUM_MAP: { pitch: number; name: string }[] = [
  { pitch: 46, name: "Open Hat" },
  { pitch: 42, name: "Closed Hat" },
  { pitch: 39, name: "Clap" },
  { pitch: 38, name: "Snare" },
  { pitch: 36, name: "Kick" },
];

export function createTrack(index: number, instrument: InstrumentKind, sceneCount: number): Track {
  return {
    name: instrument === "drums" ? `Drums ${index + 1}` : instrument === "audio" ? `Audio ${index + 1}` : `Synth ${index + 1}`,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    instrument,
    synth: { ...DEFAULT_SYNTH },
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    fx: { delay: 0, drive: { ...DEFAULT_DRIVE } },
    clips: Array.from({ length: sceneCount }, () => null),
    arrangement: [],
    automation: {},
  };
}

export function createClip(name: string, bars = 1): Clip {
  return { name, length: bars * BEATS_PER_BAR, notes: [] };
}

function steps(pitch: number, stepList: number[], length = 0.25, velocity = 0.9): Note[] {
  return stepList.map((s) => ({ pitch, start: s / STEPS_PER_BEAT, length, velocity }));
}

/** A small demo project so the app makes sound right away. */
export function createDemoProject(): Project {
  const sceneCount = 8;
  const drums = createTrack(0, "drums", sceneCount);
  const bass = createTrack(1, "synth", sceneCount);
  bass.name = "Bass";
  bass.synth = { ...DEFAULT_SYNTH, waveform: "square", cutoff: 900, resonance: 6, release: 0.08 };
  const lead = createTrack(2, "synth", sceneCount);
  lead.name = "Keys";
  lead.synth = { ...DEFAULT_SYNTH, waveform: "triangle", attack: 0.01, release: 0.4, cutoff: 4000 };
  lead.fx.delay = 0.3;
  const extra = createTrack(3, "synth", sceneCount);

  const beat = createClip("Beat");
  beat.notes = [
    ...steps(36, [0, 4, 8, 12]),
    ...steps(39, [4, 12], 0.25, 0.7),
    ...steps(42, [2, 6, 10, 14], 0.25, 0.6),
  ];
  drums.clips[0] = beat;

  const beat2 = createClip("Beat + Snare");
  beat2.notes = [
    ...steps(36, [0, 3, 8, 10]),
    ...steps(38, [4, 12]),
    ...steps(42, [0, 2, 4, 6, 8, 10, 12, 14], 0.25, 0.5),
  ];
  drums.clips[1] = beat2;

  const bassClip = createClip("Bassline");
  bassClip.notes = steps(36, [0, 3, 6], 0.5).concat(steps(39, [10], 0.5), steps(41, [12], 0.75));
  bass.clips[0] = bassClip;
  bass.clips[1] = { ...bassClip, name: "Bassline 2", notes: bassClip.notes.map((n) => ({ ...n, pitch: n.pitch - 2 })) };

  const chords = createClip("Chords", 2);
  for (const [i, chord] of [
    [60, 63, 67],
    [58, 62, 65],
  ].entries()) {
    for (const p of chord) chords.notes.push({ pitch: p, start: i * 4, length: 3.5, velocity: 0.55 });
  }
  lead.clips[1] = chords;

  return {
    version: PROJECT_VERSION,
    name: "Untitled",
    bpm: 120,
    sceneCount,
    masterVolume: 0.8,
    key: { root: 0, scale: "minor" },
    tuning: { system: "12-tet" },
    loop: { enabled: false, start: 0, end: 4 * BEATS_PER_BAR },
    tracks: [drums, bass, lead, extra],
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** Parses and validates a project file. Throws on malformed input. */
export function parseProject(json: string): Project {
  const data = JSON.parse(json) as Partial<Project>;
  if (!data || typeof data !== "object") throw new Error("Project file is not an object");
  if (data.version !== PROJECT_VERSION) throw new Error(`Unsupported project version: ${String(data.version)}`);
  if (typeof data.bpm !== "number" || data.bpm < 20 || data.bpm > 999) throw new Error("Invalid tempo");
  if (!Array.isArray(data.tracks)) throw new Error("Project has no tracks");
  const sceneCount = typeof data.sceneCount === "number" ? data.sceneCount : 8;
  const tracks = data.tracks.map((t, i) => {
    const kind: InstrumentKind = t.instrument === "drums" || t.instrument === "audio" ? t.instrument : "synth";
    const base = createTrack(i, kind, sceneCount);
    const clips = Array.from({ length: sceneCount }, (_, s) => (t.clips?.[s] ? parseClip(t.clips[s]) : null));
    const arrangement = (Array.isArray(t.arrangement) ? t.arrangement : [])
      .filter((a) => a && a.clip)
      .map((a) => ({
        start: Math.max(0, Number(a.start) || 0),
        length: Math.max(0.25, Number(a.length) || BEATS_PER_BAR),
        offset: Math.max(0, Number(a.offset) || 0),
        clip: parseClip(a.clip),
      }))
      .sort((a, b) => a.start - b.start);
    return {
      ...base,
      ...t,
      synth: { ...base.synth, ...t.synth },
      fx: { ...base.fx, ...t.fx, drive: { ...base.fx.drive, ...t.fx?.drive } },
      clips,
      arrangement,
      automation: parseAutomation(t.automation),
    };
  });
  return {
    version: PROJECT_VERSION,
    name: String(data.name ?? "Untitled"),
    bpm: data.bpm,
    sceneCount,
    masterVolume: typeof data.masterVolume === "number" ? data.masterVolume : 0.8,
    key: {
      root: clampInt(data.key?.root ?? 0, 0, 11),
      scale: typeof data.key?.scale === "string" ? data.key.scale : "major",
    },
    tuning: { system: typeof data.tuning?.system === "string" ? data.tuning.system : "12-tet" },
    loop: parseLoop(data.loop),
    tracks,
  };
}

const AUTOMATION_IDS: AutomationParam[] = ["volume", "pan", "delay", "cutoff", "driveMix"];

function parseAutomation(a: unknown): Track["automation"] {
  const out: Track["automation"] = {};
  if (!a || typeof a !== "object") return out;
  for (const id of AUTOMATION_IDS) {
    const pts = (a as Record<string, unknown>)[id];
    if (!Array.isArray(pts)) continue;
    out[id] = pts
      .map((p: Partial<AutomationPoint>) => ({ beat: Math.max(0, Number(p?.beat) || 0), value: clamp01(p?.value ?? 0) }))
      .sort((x, y) => x.beat - y.beat);
  }
  return out;
}

function parseLoop(l: Partial<LoopRegion> | undefined): LoopRegion {
  const start = Math.max(0, Math.round((Number(l?.start) || 0) / BEATS_PER_BAR) * BEATS_PER_BAR);
  const end = Math.round((Number(l?.end) || start + 4 * BEATS_PER_BAR) / BEATS_PER_BAR) * BEATS_PER_BAR;
  return { enabled: !!l?.enabled, start, end: Math.max(start + BEATS_PER_BAR, end) };
}

function parseClip(c: Partial<Clip>): Clip {
  const audio = c.audio && typeof c.audio.sampleId === "string" ? parseAudio(c.audio) : undefined;
  return {
    ...(audio ? { audio } : {}),
    name: String(c.name ?? "Clip"),
    length: Math.max(0.25, Number(c.length) || BEATS_PER_BAR),
    notes: (c.notes ?? []).map((n) => ({
      pitch: clampInt(n.pitch, 0, 127),
      start: Math.max(0, Number(n.start) || 0),
      length: Math.max(1 / 64, Number(n.length) || 0.25),
      velocity: clamp01(n.velocity ?? 0.8),
      probability: clamp01(n.probability ?? 1),
    })),
  };
}

function parseAudio(a: Partial<AudioRegion>): AudioRegion {
  const bpm = Number(a.sampleBpm);
  return {
    sampleId: String(a.sampleId),
    gain: Math.min(2, Math.max(0, Number(a.gain ?? 1))),
    sampleBpm: bpm >= 20 && bpm <= 999 ? bpm : null,
  };
}

export function cloneClip(c: Clip): Clip {
  const copy: Clip = { name: c.name, length: c.length, notes: c.notes.map((n) => ({ ...n })) };
  if (c.audio) copy.audio = { ...c.audio };
  return copy;
}

/** Creates an audio clip for a sample of `durationSec` seconds at the given tempo. */
export function createAudioClip(name: string, sampleId: string, durationSec: number, bpm: number): Clip {
  const beats = (durationSec * bpm) / 60;
  return {
    name,
    length: Math.max(0.25, Math.round(beats * 4) / 4),
    notes: [],
    audio: { sampleId, gain: 1, sampleBpm: null },
  };
}

/** End of the last arrangement clip in beats (0 when the arrangement is empty). */
export function arrangementEnd(project: Project): number {
  let end = 0;
  for (const t of project.tracks) for (const a of t.arrangement) end = Math.max(end, a.start + a.length);
  return end;
}

function clamp01(v: unknown): number {
  const n = Number(v);
  return Number.isNaN(n) ? 1 : Math.min(1, Math.max(0, n));
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export function pitchName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 2}`;
}

/**
 * Makes room for `placed`: other clips it covers are removed, clips it
 * partly overlaps are shortened (the clip that starts later wins).
 */
export function trimOverlaps(list: ArrangementClip[], placed: ArrangementClip) {
  const pEnd = placed.start + placed.length;
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    if (o === placed) continue;
    const oEnd = o.start + o.length;
    if (oEnd <= placed.start || o.start >= pEnd) continue;
    if (o.start >= placed.start && oEnd <= pEnd) {
      list.splice(i, 1);
    } else if (o.start < placed.start) {
      // Starts before: cut its tail. If it also extends past the end, keep the remainder as a new piece.
      if (oEnd > pEnd) list.push({ start: pEnd, length: oEnd - pEnd, clip: cloneClip(o.clip), offset: (o.offset ?? 0) + (pEnd - o.start) });
      o.length = placed.start - o.start;
    } else {
      // Starts inside, ends after: move its start behind the placed clip.
      o.offset = (o.offset ?? 0) + (pEnd - o.start);
      o.length = oEnd - pEnd;
      o.start = pEnd;
    }
  }
}

// Automation envelopes: breakpoints with linear interpolation, stored
// normalised (0..1) and mapped to real parameter values per parameter.

import type { AutomationParam, AutomationPoint, Track } from "../model";

export interface AutomationParamDef {
  id: AutomationParam;
  label: string;
  /** Normalised 0..1 -> real value */
  fromNorm(v: number): number;
  /** Real value -> normalised 0..1 */
  toNorm(v: number): number;
  /** Current (non-automated) value of the track, real units */
  current(track: Track): number;
  format(real: number): string;
}

const LOG_MIN = 40;
const LOG_MAX = 18000;

export const AUTOMATION_PARAMS: AutomationParamDef[] = [
  {
    id: "volume",
    label: "Lautstärke",
    fromNorm: (v) => v * 1.25,
    toNorm: (v) => v / 1.25,
    current: (t) => t.volume,
    format: (v) => (v <= 0.0001 ? "-∞ dB" : `${(20 * Math.log10(v)).toFixed(1)} dB`),
  },
  {
    id: "pan",
    label: "Panorama",
    fromNorm: (v) => v * 2 - 1,
    toNorm: (v) => (v + 1) / 2,
    current: (t) => t.pan,
    format: (v) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `${Math.round(-v * 50)}L` : `${Math.round(v * 50)}R`),
  },
  {
    id: "delay",
    label: "Delay-Send",
    fromNorm: (v) => v,
    toNorm: (v) => v,
    current: (t) => t.fx.delay,
    format: (v) => `${Math.round(v * 100)}%`,
  },
  {
    id: "cutoff",
    label: "Filter-Cutoff",
    fromNorm: (v) => LOG_MIN * Math.pow(LOG_MAX / LOG_MIN, v),
    toNorm: (v) => Math.log(Math.max(LOG_MIN, v) / LOG_MIN) / Math.log(LOG_MAX / LOG_MIN),
    current: (t) => t.synth.cutoff,
    format: (v) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`),
  },
  {
    id: "driveMix",
    label: "Drive-Mix",
    fromNorm: (v) => v,
    toNorm: (v) => v,
    current: (t) => t.fx.drive.mix,
    format: (v) => `${Math.round(v * 100)}%`,
  },
];

export function automationParam(id: AutomationParam): AutomationParamDef {
  return AUTOMATION_PARAMS.find((p) => p.id === id) ?? AUTOMATION_PARAMS[0];
}

/** Normalised envelope value at `beat` (points must be sorted). Null when there are no points. */
export function valueAt(points: AutomationPoint[] | undefined, beat: number): number | null {
  if (!points || points.length === 0) return null;
  if (beat <= points[0].beat) return points[0].value;
  const last = points[points.length - 1];
  if (beat >= last.beat) return last.value;
  // Binary search for the segment containing `beat`.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].beat <= beat) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (b.beat === a.beat) return b.value;
  return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
}

/** Inserts or replaces a point (same beat = replace) and keeps the list sorted. Returns the point. */
export function setPoint(points: AutomationPoint[], beat: number, value: number): AutomationPoint {
  const v = Math.min(1, Math.max(0, value));
  const existing = points.find((p) => Math.abs(p.beat - beat) < 1e-6);
  if (existing) {
    existing.value = v;
    return existing;
  }
  const point = { beat: Math.max(0, beat), value: v };
  points.push(point);
  points.sort((a, b) => a.beat - b.beat);
  return point;
}

/** Breakpoints strictly inside (from, to), used to schedule exact ramps. */
export function pointsBetween(points: AutomationPoint[] | undefined, from: number, to: number): AutomationPoint[] {
  if (!points) return [];
  return points.filter((p) => p.beat > from && p.beat < to);
}

export function hasAutomation(track: Track, id: AutomationParam): boolean {
  return (track.automation[id]?.length ?? 0) > 0;
}

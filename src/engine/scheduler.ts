// Pure clip-launching and note-scheduling logic. No Web Audio in here so it
// can be unit-tested in Node.

import { BEATS_PER_BAR, type Clip, type Note } from "../model";

export interface PlayingClip {
  scene: number;
  /** Beat on the transport timeline where the clip's loop started */
  startBeat: number;
}

export interface QueuedLaunch {
  /** Scene index to launch, or null to stop the track */
  scene: number | null;
  atBeat: number;
}

export interface TrackPlayState {
  playing: PlayingClip | null;
  queued: QueuedLaunch | null;
}

export interface ScheduledNote {
  track: number;
  note: Note;
  /** Absolute transport beat of the note-on */
  beat: number;
  /** Length in beats, truncated so it never rings past a clip stop/switch */
  length: number;
}

export function emptyPlayState(): TrackPlayState {
  return { playing: null, queued: null };
}

/** Next launch point at or after `beat`, quantized to `quantum` beats. */
export function quantize(beat: number, quantum = BEATS_PER_BAR): number {
  if (quantum <= 0) return beat;
  const q = Math.ceil(beat / quantum - 1e-9) * quantum;
  return q < beat ? q + quantum : q;
}

/**
 * Notes of a looping clip whose note-on falls in [from, to).
 * `clipStart` is the transport beat where the clip loop started.
 */
export function clipNotesInWindow(clip: Clip, clipStart: number, from: number, to: number): { note: Note; beat: number }[] {
  const out: { note: Note; beat: number }[] = [];
  if (clip.length <= 0 || to <= from) return out;
  const lo = Math.max(from, clipStart);
  if (to <= lo) return out;
  const firstLoop = Math.floor((lo - clipStart) / clip.length);
  const lastLoop = Math.floor((to - clipStart) / clip.length);
  for (let k = firstLoop; k <= lastLoop; k++) {
    const loopStart = clipStart + k * clip.length;
    for (const note of clip.notes) {
      if (note.start >= clip.length) continue;
      const beat = loopStart + note.start;
      if (beat >= lo && beat < to) out.push({ note, beat });
    }
  }
  out.sort((a, b) => a.beat - b.beat || a.note.pitch - b.note.pitch);
  return out;
}

/**
 * Advances one track over the window [from, to): emits the notes to play and
 * applies any queued launch/stop whose boundary falls inside the window.
 * Mutates and returns `state`.
 */
export function advanceTrack(
  trackIndex: number,
  clips: (Clip | null)[],
  state: TrackPlayState,
  from: number,
  to: number,
  out: ScheduledNote[],
): TrackPlayState {
  let cursor = from;
  while (cursor < to) {
    const switchAt = state.queued && state.queued.atBeat < to ? Math.max(state.queued.atBeat, cursor) : null;
    const segEnd = switchAt ?? to;
    if (state.playing) {
      const clip = clips[state.playing.scene];
      if (clip) {
        for (const ev of clipNotesInWindow(clip, state.playing.startBeat, cursor, segEnd)) {
          let length = ev.note.length;
          if (state.queued) length = Math.min(length, Math.max(0, state.queued.atBeat - ev.beat));
          if (length > 0) out.push({ track: trackIndex, note: ev.note, beat: ev.beat, length });
        }
      } else {
        // The clip was deleted while playing.
        state.playing = null;
      }
    }
    if (switchAt === null || !state.queued) break;
    const { scene } = state.queued;
    state.queued = null;
    state.playing = scene !== null && clips[scene] ? { scene, startBeat: switchAt } : null;
    cursor = switchAt;
  }
  return state;
}

/** Playback position (in beats, 0..length) of a playing clip, for UI display. */
export function clipPosition(clip: Clip, playing: PlayingClip, beat: number): number {
  if (beat < playing.startBeat || clip.length <= 0) return 0;
  return (beat - playing.startBeat) % clip.length;
}

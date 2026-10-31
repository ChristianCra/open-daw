// Offline rendering of the arrangement (WAV export, bounce to new track).
// Builds a second engine on an OfflineAudioContext that shares the sample
// library, schedules the whole range at once and renders faster than realtime.

import type { SampleLibrary } from "../audio/samples";
import { trailingSilence } from "../audio/wav";
import { parseProject, serializeProject, type Project } from "../model";
import { AudioEngine } from "./engine";

export interface RenderOptions {
  /** Timeline range in beats */
  from: number;
  to: number;
  /** Only these tracks are rendered (default: all, respecting mute/solo) */
  tracks?: number[];
  sampleRate?: number;
  /** Extra seconds after `to` for release and delay tails (trimmed when silent) */
  tailSeconds?: number;
  /** Ignore the master volume (bounce renders at unity gain) */
  unityMaster?: boolean;
}

export interface RenderResult {
  channels: Float32Array[];
  sampleRate: number;
  /** Seconds of the rendered range without the tail */
  rangeSeconds: number;
}

/** Copy of the project prepared for rendering (loop off, track selection applied). */
export function prepareRenderProject(project: Project, opts: Pick<RenderOptions, "tracks" | "unityMaster">): Project {
  const p = parseProject(serializeProject(project));
  p.loop = { ...p.loop, enabled: false };
  if (opts.tracks) {
    const keep = new Set(opts.tracks);
    p.tracks.forEach((tr, i) => {
      tr.mute = !keep.has(i);
      tr.solo = false;
    });
  }
  if (opts.unityMaster) p.masterVolume = 1;
  return p;
}

/** Sample ids used by the arrangement of the given tracks. */
export function samplesUsed(project: Project, tracks?: number[]): string[] {
  const ids = new Set<string>();
  project.tracks.forEach((tr, i) => {
    if (tracks && !tracks.includes(i)) return;
    for (const ac of tr.arrangement) if (ac.clip.audio) ids.add(ac.clip.audio.sampleId);
  });
  return [...ids];
}

export async function renderArrangement(project: Project, samples: SampleLibrary, opts: RenderOptions): Promise<RenderResult> {
  const sampleRate = opts.sampleRate ?? 44100;
  const p = prepareRenderProject(project, opts);
  await Promise.all(samplesUsed(p, opts.tracks).map((id) => samples.load(id)));
  const rangeSeconds = ((opts.to - opts.from) * 60) / p.bpm;
  const tail = opts.tailSeconds ?? 2;
  const frames = Math.max(1, Math.ceil((rangeSeconds + tail) * sampleRate));
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  const engine = new AudioEngine(p, { ctx, samples });
  engine.scheduleRange(opts.from, opts.to);
  const buffer = await ctx.startRendering();
  let channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  // Keep the range, plus as much of the tail as is actually audible.
  const silent = trailingSilence(channels, 1e-4, Math.ceil(rangeSeconds * sampleRate));
  if (silent > 0) channels = channels.map((ch) => ch.slice(0, ch.length - silent));
  return { channels, sampleRate, rangeSeconds };
}

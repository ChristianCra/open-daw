import { describe, expect, it } from "vitest";
import { computePeaks, filterSamples, tagCounts, tagsFromName, type SampleMeta } from "../src/audio/samples";
import { arrangementNotesInWindow, chaseAudio, clipEvents, clipNotesInWindow } from "../src/engine/scheduler";
import { cloneClip, createAudioClip, createDemoProject, createTrack, parseProject, serializeProject, type ArrangementClip } from "../src/model";

const meta = (name: string, tags: string[], favorite = false): SampleMeta => ({
  id: name,
  name,
  tags,
  favorite,
  duration: 1,
  sampleRate: 44100,
  channels: 1,
  createdAt: 0,
  peaks: [],
});

describe("sample library helpers", () => {
  it("computes a peak envelope over all channels", () => {
    const a = new Float32Array([0, 0.5, -0.25, 0, 0, 0, 0.1, -0.9]);
    const b = new Float32Array([0.7, 0, 0, 0, 0, 0, 0, 0]);
    const peaks = computePeaks([a, b], 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.7);
    expect(peaks[1]).toBeCloseTo(0.25);
    expect(peaks[2]).toBe(0);
    expect(peaks[3]).toBeCloseTo(0.9);
  });

  it("returns silence for an empty buffer", () => {
    expect(computePeaks([new Float32Array(0)], 8)).toEqual(new Array(8).fill(0));
  });

  it("suggests tags from file names", () => {
    expect(tagsFromName("Kick_808_hard.wav")).toEqual(["kick", "808", "hard"]);
    expect(tagsFromName("BD 01.wav")).toEqual(["kick"]);
    expect(tagsFromName("vox-chop_Am.mp3")).toEqual(["vocal", "chop", "am"]);
  });

  it("filters by text, tags and favourites, favourites first", () => {
    const all = [meta("Snare A", ["snare", "acoustic"]), meta("Kick B", ["kick"], true), meta("Kick A", ["kick", "808"])];
    expect(filterSamples(all, { text: "", tags: [], favoritesOnly: false }).map((s) => s.name)).toEqual(["Kick B", "Kick A", "Snare A"]);
    expect(filterSamples(all, { text: "kick", tags: [], favoritesOnly: false }).map((s) => s.name)).toEqual(["Kick B", "Kick A"]);
    expect(filterSamples(all, { text: "", tags: ["kick", "808"], favoritesOnly: false }).map((s) => s.name)).toEqual(["Kick A"]);
    expect(filterSamples(all, { text: "acou", tags: [], favoritesOnly: false }).map((s) => s.name)).toEqual(["Snare A"]);
    expect(filterSamples(all, { text: "", tags: [], favoritesOnly: true }).map((s) => s.name)).toEqual(["Kick B"]);
  });

  it("counts tags, most used first", () => {
    const all = [meta("a", ["kick", "808"]), meta("b", ["kick"]), meta("c", ["snare"])];
    expect(tagCounts(all)).toEqual([
      { tag: "kick", count: 2 },
      { tag: "808", count: 1 },
      { tag: "snare", count: 1 },
    ]);
  });
});

describe("audio clips", () => {
  it("creates a clip whose length matches the sample at the project tempo", () => {
    const clip = createAudioClip("loop", "s1", 2, 120); // 2 s at 120 BPM = 4 beats
    expect(clip.length).toBe(4);
    expect(clip.audio).toEqual({ sampleId: "s1", gain: 1, sampleBpm: null });
    expect(createAudioClip("hit", "s2", 0.01, 120).length).toBe(0.25);
  });

  it("triggers the sample once per loop", () => {
    const clip = createAudioClip("loop", "s1", 2, 120);
    expect(clipEvents(clip)).toHaveLength(1);
    const evs = clipNotesInWindow(clip, 0, 0, 12);
    expect(evs.map((e) => e.beat)).toEqual([0, 4, 8]);
    expect(evs[0].note.audio?.sampleId).toBe("s1");
  });

  it("cuts the sample at the end of an arrangement clip", () => {
    const clip = createAudioClip("loop", "s1", 2, 120);
    const arr: ArrangementClip[] = [{ start: 2, length: 6, clip }];
    const notes = arrangementNotesInWindow(0, arr, 0, 16);
    expect(notes.map((n) => [n.beat, n.length])).toEqual([
      [2, 4],
      [6, 2],
    ]);
  });

  it("chases audio when playback starts inside a clip", () => {
    const clip = createAudioClip("loop", "s1", 2, 120);
    const arr: ArrangementClip[] = [{ start: 4, length: 8, offset: 1, clip }];
    const hit = chaseAudio(3, arr, 6);
    expect(hit).not.toBeNull();
    expect(hit!.track).toBe(3);
    expect(hit!.beat).toBe(6);
    expect(hit!.note.sampleOffset).toBe(3); // offset 1 + 2 beats into the clip
    expect(hit!.length).toBe(1); // until the loop restarts
    // On a loop boundary the regular scheduler handles it.
    expect(chaseAudio(0, arr, 7)).toBeNull();
    // Outside the clip, or for MIDI clips, nothing happens.
    expect(chaseAudio(0, arr, 12)).toBeNull();
    expect(chaseAudio(0, [{ start: 0, length: 4, clip: { name: "m", length: 4, notes: [] } }], 1)).toBeNull();
  });

  it("clones and round-trips audio clips", () => {
    const clip = createAudioClip("loop", "s1", 2, 120);
    clip.audio!.gain = 0.5;
    clip.audio!.sampleBpm = 98;
    const copy = cloneClip(clip);
    copy.audio!.gain = 1;
    expect(clip.audio!.gain).toBe(0.5);

    const p = createDemoProject();
    const t = createTrack(p.tracks.length, "audio", p.sceneCount);
    t.clips[0] = clip;
    t.arrangement.push({ start: 0, length: 4, clip: cloneClip(clip) });
    p.tracks.push(t);
    const back = parseProject(serializeProject(p));
    const bt = back.tracks[back.tracks.length - 1];
    expect(bt.instrument).toBe("audio");
    expect(bt.clips[0]?.audio).toEqual({ sampleId: "s1", gain: 0.5, sampleBpm: 98 });
    expect(bt.arrangement[0].clip.audio?.sampleId).toBe("s1");
  });
});

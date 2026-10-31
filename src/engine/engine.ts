// Audio engine: owns the AudioContext, the mixer graph and the transport.
// Uses the classic "lookahead" pattern: a timer wakes up every few ms and
// schedules all notes that fall into the next ~100 ms on the audio clock.

import { BEATS_PER_BAR, type Project } from "../model";
import { automationParam, hasAutomation, pointsBetween, valueAt } from "../automation/automation";
import type { AutomationParam } from "../model";
import { getTuning } from "../music/tuning";
import { DriveUnit } from "./drive";
import { DrumKit, PolySynth, type Instrument, type Voice } from "./instruments";
import {
  advanceTrack,
  arrangementNotesInWindow,
  emptyPlayState,
  linearToTimeline,
  quantize,
  timelineSegments,
  type ScheduledNote,
  type TrackPlayState,
} from "./scheduler";

const LOOKAHEAD_SECONDS = 0.12;
const TICK_MS = 25;

interface Channel {
  input: GainNode;
  drive: DriveUnit;
  volume: GainNode;
  pan: StereoPannerNode;
  delaySend: GainNode;
  meter: AnalyserNode;
  instrument: Instrument;
  kind: string;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private masterMeter: AnalyserNode;
  private delayIn: GainNode;
  private channels: Channel[] = [];
  private timer: number | null = null;

  playing = false;
  /** AudioContext time that corresponds to transport beat `anchorBeat` */
  private anchorTime = 0;
  private anchorBeat = 0;
  /** Transport beat up to which notes have been scheduled */
  private scheduledUntil = 0;
  playStates: TrackPlayState[] = [];
  /** Per track: true = plays the arrangement, false = overridden by the session grid */
  followArrangement: boolean[] = [];
  /** Timeline beat (on the bar grid) where playback starts */
  playStart = 0;
  /** Automated cutoff for the note currently being started (null = use the track value) */
  private cutoffOverride: (number | null)[] = [];

  /** Called when a track switches session clip (scene) or stops; `linearBeat` is when it happens. */
  onSessionSwitch: ((track: number, scene: number | null, linearBeat: number) => void) | null = null;

  constructor(public project: Project) {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = this.ctx.createGain();
    this.masterMeter = this.ctx.createAnalyser();
    this.masterMeter.fftSize = 512;
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.ratio.value = 12;
    this.master.connect(limiter).connect(this.masterMeter).connect(this.ctx.destination);

    // Shared tempo-synced ping-pong-ish delay return.
    this.delayIn = this.ctx.createGain();
    const delay = this.ctx.createDelay(2);
    const feedback = this.ctx.createGain();
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3500;
    feedback.gain.value = 0.38;
    this.delayIn.connect(delay);
    delay.connect(tone).connect(feedback).connect(delay);
    tone.connect(this.master);
    this.delayNode = delay;

    this.setProject(project);
  }

  private delayNode: DelayNode;

  /** Rebuilds the mixer for a (new) project. Stops playback. */
  setProject(project: Project) {
    this.stop();
    for (const ch of this.channels) ch.input.disconnect();
    this.project = project;
    this.channels = project.tracks.map((_, i) => this.createChannel(i));
    this.playStates = project.tracks.map(() => emptyPlayState());
    this.followArrangement = project.tracks.map(() => true);
    this.syncMixer();
  }

  /** Call after adding a track to the project. */
  addChannel() {
    const i = this.channels.length;
    this.channels.push(this.createChannel(i));
    this.playStates.push(emptyPlayState());
    this.followArrangement.push(true);
    this.syncMixer();
  }

  /** Recreates the instrument of a track after its kind changed. */
  refreshInstrument(i: number) {
    const ch = this.channels[i];
    const kind = this.project.tracks[i].instrument;
    if (ch.kind !== kind) {
      ch.instrument = this.makeInstrument(i, ch.input);
      ch.kind = kind;
    }
  }

  private makeInstrument(i: number, out: AudioNode): Instrument {
    return this.project.tracks[i].instrument === "drums"
      ? new DrumKit(this.ctx, out)
      : new PolySynth(
          this.ctx,
          out,
          () => {
            const synth = this.project.tracks[i].synth;
            const cutoff = this.cutoffOverride[i];
            return cutoff == null ? synth : { ...synth, cutoff };
          },
          (pitch) => getTuning(this.project.tuning.system).toFreq(pitch, this.project.key),
        );
  }

  private createChannel(i: number): Channel {
    const input = this.ctx.createGain();
    const volume = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();
    const delaySend = this.ctx.createGain();
    const meter = this.ctx.createAnalyser();
    meter.fftSize = 256;
    const drive = new DriveUnit(this.ctx);
    input.connect(drive.input);
    drive.output.connect(volume).connect(pan);
    pan.connect(this.master);
    pan.connect(meter);
    pan.connect(delaySend).connect(this.delayIn);
    return { input, drive, volume, pan, delaySend, meter, instrument: this.makeInstrument(i, input), kind: this.project.tracks[i].instrument };
  }

  /** Pushes volume/pan/mute/solo/send values from the project into the graph. */
  syncMixer() {
    const t = this.ctx.currentTime;
    this.project.tracks.forEach((tr, i) => {
      const ch = this.channels[i];
      if (!ch) return;
      const auto = (id: AutomationParam) => this.automationActive(i) && hasAutomation(tr, id);
      if (!auto("volume")) ch.volume.gain.setTargetAtTime(this.audible(i) ? tr.volume : 0, t, 0.01);
      if (!auto("pan")) ch.pan.pan.setTargetAtTime(tr.pan, t, 0.01);
      if (!auto("delay")) ch.delaySend.gain.setTargetAtTime(tr.fx.delay, t, 0.01);
      ch.drive.update(tr.fx.drive, t, auto("driveMix"));
    });
    this.master.gain.setTargetAtTime(this.project.masterVolume, t, 0.01);
    this.delayNode.delayTime.setTargetAtTime((60 / this.project.bpm) * 0.75, t, 0.05);
  }

  private audible(i: number): boolean {
    const tracks = this.project.tracks;
    const anySolo = tracks.some((tr) => tr.solo);
    return !tracks[i].mute && (!anySolo || tracks[i].solo);
  }

  /** Automation runs while the transport plays the arrangement on that track. */
  private automationActive(i: number): boolean {
    return this.playing && this.followArrangement[i] !== false && !this.playStates[i]?.playing;
  }

  /** Writes automation ramps for one timeline segment into the audio graph. */
  private scheduleAutomation(i: number, tlFrom: number, tlTo: number, t0: number, t1: number) {
    const tr = this.project.tracks[i];
    const ch = this.channels[i];
    if (!ch) return;
    const beatToSec = (tl: number) => t0 + ((tl - tlFrom) / (tlTo - tlFrom || 1)) * (t1 - t0);
    for (const id of ["volume", "pan", "delay", "driveMix"] as const) {
      const points = tr.automation[id];
      if (!points?.length) continue;
      const def = automationParam(id);
      const real = (tl: number) => {
        const v = def.fromNorm(valueAt(points, tl) ?? 0);
        return id === "volume" && !this.audible(i) ? 0 : v;
      };
      if (id === "driveMix") {
        if (!tr.fx.drive.enabled) continue;
        ch.drive.rampMix(real(tlFrom), real(tlTo), t0, t1);
        continue;
      }
      const param = id === "volume" ? ch.volume.gain : id === "pan" ? ch.pan.pan : ch.delaySend.gain;
      param.cancelScheduledValues(t0);
      param.setValueAtTime(real(tlFrom), t0);
      for (const p of pointsBetween(points, tlFrom, tlTo)) param.linearRampToValueAtTime(real(p.beat), beatToSec(p.beat));
      param.linearRampToValueAtTime(real(tlTo), t1);
    }
  }

  get secondsPerBeat() {
    return 60 / this.project.bpm;
  }

  /** Current transport position in beats (what the listener hears). */
  get currentBeat(): number {
    if (!this.playing) return this.anchorBeat;
    return this.anchorBeat + (this.ctx.currentTime - this.anchorTime) / this.secondsPerBeat;
  }

  /** Current position on the arrangement timeline (loop applied). */
  get timelineBeat(): number {
    if (!this.playing) return this.playStart;
    return linearToTimeline(Math.max(0, this.currentBeat), this.playStart, this.project.loop);
  }

  /** Converts a linear transport beat to a timeline beat. */
  toTimeline(linearBeat: number): number {
    return linearToTimeline(linearBeat, this.playStart, this.project.loop);
  }

  /** Moves the start position (snapped to bars). Restarts playback there if running. */
  setPlayStart(beat: number) {
    this.playStart = Math.max(0, Math.round(beat / BEATS_PER_BAR) * BEATS_PER_BAR);
    if (this.playing) {
      this.stop();
      void this.play();
    }
  }

  /** True when at least one track is overridden by a session clip. */
  get sessionOverride(): boolean {
    return this.followArrangement.some((f) => !f);
  }

  /** Stops session clips and lets every track play the arrangement again. */
  backToArrangement() {
    this.playStates.forEach((st, i) => {
      if (st.playing || st.queued) this.onSessionSwitch?.(i, null, Math.max(this.scheduledUntil, 0));
      st.playing = null;
      st.queued = null;
    });
    this.followArrangement = this.followArrangement.map(() => true);
  }

  private beatToTime(beat: number) {
    return this.anchorTime + (beat - this.anchorBeat) * this.secondsPerBeat;
  }

  setTempo(bpm: number) {
    // Re-anchor so the beat position stays continuous across the change.
    const beat = this.currentBeat;
    this.anchorTime = this.ctx.currentTime;
    this.anchorBeat = beat;
    this.project.bpm = bpm;
    this.syncMixer();
  }

  async play() {
    if (this.playing) return;
    await this.ctx.resume();
    this.playing = true;
    this.anchorBeat = 0;
    this.anchorTime = this.ctx.currentTime + 0.05;
    this.scheduledUntil = 0;
    this.playStart = Math.max(0, Math.round(this.playStart / BEATS_PER_BAR) * BEATS_PER_BAR);
    // Anything queued while stopped starts right at the downbeat.
    for (const st of this.playStates) if (st.queued) st.queued.atBeat = 0;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.playing = false;
    this.anchorBeat = 0;
    for (const st of this.playStates) {
      st.playing = null;
      st.queued = null;
    }
    // Return automated parameters to their fader values.
    for (const ch of this.channels) {
      for (const param of [ch.volume.gain, ch.pan.pan, ch.delaySend.gain]) param.cancelScheduledValues(this.ctx.currentTime);
    }
    this.syncMixer();
  }

  /** Launch point for a new clip: next bar after what's already scheduled. */
  private nextLaunchBeat(): number {
    return this.playing ? quantize(Math.max(this.scheduledUntil, this.currentBeat), BEATS_PER_BAR) : 0;
  }

  launchClip(track: number, scene: number) {
    this.followArrangement[track] = false;
    this.playStates[track].queued = { scene, atBeat: this.nextLaunchBeat() };
    if (!this.playing) void this.play();
  }

  stopTrack(track: number) {
    const st = this.playStates[track];
    this.followArrangement[track] = false;
    if (!this.playing) {
      st.playing = null;
      st.queued = null;
      return;
    }
    st.queued = { scene: null, atBeat: this.nextLaunchBeat() };
  }

  launchScene(scene: number) {
    const at = this.nextLaunchBeat();
    this.project.tracks.forEach((tr, i) => {
      this.followArrangement[i] = false;
      this.playStates[i].queued = { scene: tr.clips[scene] ? scene : null, atBeat: at };
    });
    if (!this.playing) void this.play();
  }

  stopAllClips() {
    this.project.tracks.forEach((_, i) => this.stopTrack(i));
  }

  private liveVoices = new Map<string, { voice: Voice; channel: number }>();
  /** Pitch-bend range in semitones (48 is the usual MPE per-note range) */
  bendRange = 2;

  /** Live note-on from a MIDI keyboard. */
  liveNoteOn(track: number, pitch: number, velocity: number, channel = 0) {
    void this.ctx.resume();
    const key = `${channel}:${pitch}`;
    this.liveVoices.get(key)?.voice.release(this.ctx.currentTime);
    const ch = this.channels[track];
    if (!ch) return;
    this.liveVoices.set(key, { voice: ch.instrument.noteOn(pitch, velocity, this.ctx.currentTime), channel });
  }

  liveNoteOff(pitch: number, channel = 0) {
    const key = `${channel}:${pitch}`;
    this.liveVoices.get(key)?.voice.release(this.ctx.currentTime);
    this.liveVoices.delete(key);
  }

  /** Pitch bend for all held notes on a MIDI channel (per-note in MPE mode). `value` is -1..1. */
  pitchBend(channel: number, value: number) {
    for (const v of this.liveVoices.values()) if (v.channel === channel) v.voice.bend(value * this.bendRange, this.ctx.currentTime);
  }

  allNotesOff() {
    for (const v of this.liveVoices.values()) v.voice.release(this.ctx.currentTime);
    this.liveVoices.clear();
  }

  /** Auditions a single note right now (used by the clip editor). */
  preview(track: number, pitch: number) {
    void this.ctx.resume();
    this.channels[track]?.instrument.play(pitch, 0.8, this.ctx.currentTime + 0.01, 0.2);
  }

  private tick() {
    if (!this.playing) return;
    const horizon = this.currentBeat + LOOKAHEAD_SECONDS / this.secondsPerBeat;
    if (horizon <= this.scheduledUntil) return;
    const from = this.scheduledUntil;
    const notes: (ScheduledNote & { tlBeat?: number })[] = [];
    this.project.tracks.forEach((tr, i) => {
      const st = this.playStates[i];
      if (this.followArrangement[i] && !st.playing && !st.queued) return;
      const queued = st.queued;
      const before = st.playing?.scene ?? null;
      advanceTrack(i, tr.clips, st, from, horizon, notes);
      if (queued && queued.atBeat < horizon) {
        const after = st.playing?.scene ?? null;
        if (after !== before || after !== null) this.onSessionSwitch?.(i, after, Math.max(queued.atBeat, from));
      }
    });
    // Arrangement playback, split where the loop region wraps around.
    for (const seg of timelineSegments(from, horizon, this.playStart, this.project.loop)) {
      const tlTo = seg.tlFrom + (seg.linTo - seg.linFrom);
      this.project.tracks.forEach((tr, i) => {
        if (!this.followArrangement[i] || this.playStates[i].playing) return;
        const t0 = Math.max(this.ctx.currentTime, this.beatToTime(seg.linFrom));
        const t1 = Math.max(t0 + 0.001, this.beatToTime(seg.linTo));
        this.scheduleAutomation(i, seg.tlFrom, tlTo, t0, t1);
        for (const n of arrangementNotesInWindow(i, tr.arrangement, seg.tlFrom, tlTo)) {
          const linBeat = seg.linFrom + (n.beat - seg.tlFrom);
          const length = seg.wraps ? Math.min(n.length, seg.linTo - linBeat) : n.length;
          notes.push({ ...n, beat: linBeat, length, tlBeat: n.beat });
        }
      });
    }
    for (const n of notes) {
      // Per-note probability is rolled each time the note comes around.
      if (Math.random() >= (n.note.probability ?? 1)) continue;
      const time = Math.max(this.ctx.currentTime, this.beatToTime(n.beat));
      const cutoff = n.tlBeat !== undefined ? valueAt(this.project.tracks[n.track]?.automation.cutoff, n.tlBeat) : null;
      this.cutoffOverride[n.track] = cutoff === null ? null : automationParam("cutoff").fromNorm(cutoff);
      this.channels[n.track]?.instrument.play(n.note.pitch, n.note.velocity, time, n.length * this.secondsPerBeat);
      this.cutoffOverride[n.track] = null;
    }
    this.scheduledUntil = horizon;
  }

  /** Peak level 0..1 of a track (or master when track is -1). */
  level(track: number): number {
    const an = track < 0 ? this.masterMeter : this.channels[track]?.meter;
    if (!an) return 0;
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const s of buf) peak = Math.max(peak, Math.abs(s));
    return Math.min(1, peak);
  }
}

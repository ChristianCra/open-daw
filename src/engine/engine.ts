// Audio engine: owns the AudioContext, the mixer graph and the transport.
// Uses the classic "lookahead" pattern: a timer wakes up every few ms and
// schedules all notes that fall into the next ~100 ms on the audio clock.

import { BEATS_PER_BAR, type Project } from "../model";
import { getTuning } from "../music/tuning";
import { DriveUnit } from "./drive";
import { DrumKit, PolySynth, type Instrument, type Voice } from "./instruments";
import { advanceTrack, emptyPlayState, quantize, type ScheduledNote, type TrackPlayState } from "./scheduler";

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
    this.syncMixer();
  }

  /** Call after adding a track to the project. */
  addChannel() {
    const i = this.channels.length;
    this.channels.push(this.createChannel(i));
    this.playStates.push(emptyPlayState());
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
          () => this.project.tracks[i].synth,
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
    const anySolo = this.project.tracks.some((tr) => tr.solo);
    this.project.tracks.forEach((tr, i) => {
      const ch = this.channels[i];
      if (!ch) return;
      const audible = !tr.mute && (!anySolo || tr.solo);
      ch.volume.gain.setTargetAtTime(audible ? tr.volume : 0, t, 0.01);
      ch.pan.pan.setTargetAtTime(tr.pan, t, 0.01);
      ch.delaySend.gain.setTargetAtTime(tr.fx.delay, t, 0.01);
      ch.drive.update(tr.fx.drive, t);
    });
    this.master.gain.setTargetAtTime(this.project.masterVolume, t, 0.01);
    this.delayNode.delayTime.setTargetAtTime((60 / this.project.bpm) * 0.75, t, 0.05);
  }

  get secondsPerBeat() {
    return 60 / this.project.bpm;
  }

  /** Current transport position in beats (what the listener hears). */
  get currentBeat(): number {
    if (!this.playing) return this.anchorBeat;
    return this.anchorBeat + (this.ctx.currentTime - this.anchorTime) / this.secondsPerBeat;
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
  }

  /** Launch point for a new clip: next bar after what's already scheduled. */
  private nextLaunchBeat(): number {
    return this.playing ? quantize(Math.max(this.scheduledUntil, this.currentBeat), BEATS_PER_BAR) : 0;
  }

  launchClip(track: number, scene: number) {
    this.playStates[track].queued = { scene, atBeat: this.nextLaunchBeat() };
    if (!this.playing) void this.play();
  }

  stopTrack(track: number) {
    const st = this.playStates[track];
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
    const notes: ScheduledNote[] = [];
    this.project.tracks.forEach((tr, i) => advanceTrack(i, tr.clips, this.playStates[i], from, horizon, notes));
    for (const n of notes) {
      // Per-note probability is rolled each time the note comes around.
      if (Math.random() >= (n.note.probability ?? 1)) continue;
      const time = Math.max(this.ctx.currentTime, this.beatToTime(n.beat));
      this.channels[n.track]?.instrument.play(n.note.pitch, n.note.velocity, time, n.length * this.secondsPerBeat);
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

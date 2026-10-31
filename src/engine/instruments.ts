// Built-in instruments. All sounds are synthesized at runtime; there are no
// sample files in this project.

import type { SynthParams } from "../model";

export interface Voice {
  /** Starts the release phase at `time`. */
  release(time: number): void;
  /** Pitch bend in semitones relative to the note's pitch. */
  bend(semitones: number, time: number): void;
}

export interface Instrument {
  /** Plays one note starting at `time` (AudioContext seconds) for `duration` seconds. */
  play(pitch: number, velocity: number, time: number, duration: number): void;
  /** Starts a held note (live input). Call `release()` on the returned voice for note-off. */
  noteOn(pitch: number, velocity: number, time: number): Voice;
}

const NO_VOICE: Voice = { release() {}, bend() {} };

/** Simple subtractive polysynth: oscillator -> resonant low-pass -> ADSR amp. */
export class PolySynth implements Instrument {
  constructor(
    private ctx: BaseAudioContext,
    private output: AudioNode,
    private params: () => SynthParams,
    private toFreq: (pitch: number) => number,
  ) {}

  play(pitch: number, velocity: number, time: number, duration: number): void {
    this.noteOn(pitch, velocity, time).release(time + duration);
  }

  noteOn(pitch: number, velocity: number, time: number): Voice {
    const p = this.params();
    const osc = this.ctx.createOscillator();
    osc.type = p.waveform;
    osc.frequency.setValueAtTime(this.toFreq(pitch), time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = p.resonance;
    // A little filter envelope makes it sound less static.
    filter.frequency.setValueAtTime(Math.min(18000, p.cutoff * 2), time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, p.cutoff), time + p.attack + p.decay);

    const amp = this.ctx.createGain();
    const peak = 0.3 * velocity;
    const attackEnd = time + Math.max(0.001, p.attack);
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, attackEnd);
    amp.gain.setTargetAtTime(peak * p.sustain, attackEnd, Math.max(0.001, p.decay) / 3);

    osc.connect(filter).connect(amp).connect(this.output);
    osc.start(time);
    osc.onended = () => amp.disconnect();

    let released = false;
    return {
      release: (when: number) => {
        if (released) return;
        released = true;
        const releaseStart = Math.max(when, attackEnd);
        amp.gain.cancelScheduledValues(releaseStart);
        amp.gain.setTargetAtTime(0, releaseStart, Math.max(0.001, p.release) / 3);
        osc.stop(releaseStart + Math.max(0.01, p.release) * 2 + 0.05);
      },
      bend: (semitones: number, when: number) => {
        osc.detune.setTargetAtTime(semitones * 100, when, 0.005);
      },
    };
  }
}

/** Synthesized drum kit mapped to General MIDI-style pitches. */
export class DrumKit implements Instrument {
  private noise: AudioBuffer;

  constructor(
    private ctx: BaseAudioContext,
    private output: AudioNode,
  ) {
    const len = Math.floor(ctx.sampleRate * 1);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  noteOn(pitch: number, velocity: number, time: number): Voice {
    this.play(pitch, velocity, time);
    return NO_VOICE;
  }

  play(pitch: number, velocity: number, time: number): void {
    switch (pitch) {
      case 36:
        return this.kick(velocity, time);
      case 38:
        return this.snare(velocity, time);
      case 39:
        return this.clap(velocity, time);
      case 42:
        return this.hat(velocity, time, 0.05);
      case 46:
        return this.hat(velocity, time, 0.3);
      default:
        return this.hat(velocity, time, 0.05);
    }
  }

  private env(time: number, peak: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    g.connect(this.output);
    return g;
  }

  private noiseSource(time: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(time, Math.random() * 0.5);
    src.stop(time + duration);
    return src;
  }

  private kick(v: number, t: number) {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    osc.connect(this.env(t, 0.9 * v, 0.45));
    osc.start(t);
    osc.stop(t + 0.5);
  }

  private snare(v: number, t: number) {
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    this.noiseSource(t, 0.25).connect(hp).connect(this.env(t, 0.5 * v, 0.2));
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    osc.connect(this.env(t, 0.4 * v, 0.12));
    osc.start(t);
    osc.stop(t + 0.15);
  }

  private clap(v: number, t: number) {
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    // Three quick bursts followed by a short tail.
    g.gain.setValueAtTime(0, t);
    for (const [i, off] of [0, 0.012, 0.024].entries()) {
      g.gain.setValueAtTime(0.6 * v * (1 - i * 0.15), t + off);
      g.gain.exponentialRampToValueAtTime(0.05, t + off + 0.01);
    }
    g.gain.setValueAtTime(0.4 * v, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    this.noiseSource(t, 0.25).connect(bp).connect(g).connect(this.output);
  }

  private hat(v: number, t: number, decay: number) {
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    this.noiseSource(t, decay + 0.05).connect(hp).connect(this.env(t, 0.3 * v, decay));
  }
}

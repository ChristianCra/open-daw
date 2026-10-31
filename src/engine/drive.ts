// "Drive": a three-band saturation insert. The signal is split into
// low / mid / high bands, each band goes through its own waveshaper, and the
// result is blended with the dry signal.

import type { DriveParams, DriveShape } from "../model";

const CURVE_SIZE = 2048;

/** Transfer curve for a WaveShaperNode. `amount` 0..1. Output is normalised to ±1. */
export function makeDriveCurve(amount: number, shape: DriveShape, size = CURVE_SIZE): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  const gain = 1 + amount * 30;
  const norm = shape === "soft" ? Math.tanh(gain) : 1;
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    let y: number;
    switch (shape) {
      case "hard":
        y = Math.max(-1, Math.min(1, x * gain));
        break;
      case "fold":
        // Wavefolder: reflect back whenever the signal exceeds ±1.
        y = Math.asin(Math.sin((x * gain * Math.PI) / 2)) / (Math.PI / 2);
        break;
      default:
        y = Math.tanh(x * gain) / norm;
    }
    curve[i] = y;
  }
  return curve;
}

export class DriveUnit {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private shapers: WaveShaperNode[];
  private bandGains: GainNode[];
  private last = "";

  constructor(ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);

    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 250;
    const mid = ctx.createBiquadFilter();
    mid.type = "bandpass";
    mid.frequency.value = 790; // geometric centre of 250..2500
    mid.Q.value = 0.5;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 2500;

    this.shapers = [];
    this.bandGains = [];
    for (const band of [low, mid, high]) {
      const shaper = ctx.createWaveShaper();
      shaper.oversample = "2x";
      const g = ctx.createGain();
      this.input.connect(band).connect(shaper).connect(g).connect(this.wet);
      this.shapers.push(shaper);
      this.bandGains.push(g);
    }
  }

  /** Automation: ramp the dry/wet mix from `from` at t0 to `to` at t1. */
  rampMix(from: number, to: number, t0: number, t1: number) {
    for (const [param, a, b] of [
      [this.dry.gain, 1 - from, 1 - to],
      [this.wet.gain, from, to],
    ] as const) {
      param.cancelScheduledValues(t0);
      param.setValueAtTime(a, t0);
      param.linearRampToValueAtTime(b, t1);
    }
  }

  /** `instant` sets values without smoothing (offline rendering). */
  update(p: DriveParams, time: number, skipMix = false, instant = false) {
    const mix = p.enabled ? p.mix : 0;
    const set = (param: AudioParam, v: number) => (instant ? param.setValueAtTime(v, time) : param.setTargetAtTime(v, time, 0.01));
    if (!skipMix) {
      set(this.dry.gain, 1 - mix);
      set(this.wet.gain, mix);
    }
    const key = JSON.stringify([p.shape, p.low, p.mid, p.high]);
    if (key === this.last) return;
    this.last = key;
    [p.low, p.mid, p.high].forEach((amount, i) => {
      this.shapers[i].curve = makeDriveCurve(amount, p.shape);
      // Compensate the loudness increase of heavy saturation a little.
      set(this.bandGains[i].gain, 1 / (1 + amount * 1.5));
    });
  }
}

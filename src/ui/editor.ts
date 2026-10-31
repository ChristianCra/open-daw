// Piano-roll clip editor with scale highlighting, fold-to-scale, note
// velocity/probability and drag-to-draw.

import { BEATS_PER_BAR, DRUM_MAP, STEPS_PER_BEAT, pitchName, type Clip, type Note } from "../model";
import { getScale, inScale, isRoot } from "../music/scales";
import type { App } from "./app";
import { drawPeaks } from "./browser";
import { h, select, slider } from "./dom";

const ROW_H = 16;
const STEP_W = 22;
const SYNTH_TOP = 96;
const SYNTH_BOTTOM = 24;
const PROB_CYCLE = [1, 0.75, 0.5, 0.25];

interface Row {
  pitch: number;
  label: string;
  inScale: boolean;
  root: boolean;
}

export class ClipEditor {
  fold = false;
  newVelocity = 0.8;
  newProbability = 1;
  private notesLayer: HTMLElement | null = null;
  private playhead: HTMLElement | null = null;
  private rows: Row[] = [];
  private scrollTop: number | null = null;
  /** True until the initial "centre on the notes" scroll has actually happened */
  private focusPending = false;
  private lastClipKey = "";
  /** Width of the audio waveform in beats (0 when the piano roll is shown) */
  private audioBeats = 0;

  constructor(private app: App) {}

  private computeRows(): Row[] {
    const app = this.app;
    const key = app.project.key;
    if (app.selectedTrack.instrument === "drums") {
      return DRUM_MAP.map((d) => ({ pitch: d.pitch, label: d.name, inScale: true, root: false }));
    }
    const rows: Row[] = [];
    for (let p = SYNTH_TOP; p >= SYNTH_BOTTOM; p--) {
      const inS = inScale(p, key);
      if (this.fold && !inS) continue;
      rows.push({ pitch: p, label: pitchName(p), inScale: inS, root: isRoot(p, key) });
    }
    return rows;
  }

  render(host: HTMLElement) {
    const app = this.app;
    const clip = app.selectedClip;
    const track = app.selectedTrack;
    const oldScroller = host.querySelector<HTMLElement>(".roll-scroll");
    const clipKey = `${app.selection.track}:${app.selection.scene}:${app.selection.arr}:${track?.instrument}:${this.fold}`;
    if (oldScroller && clipKey === this.lastClipKey && !this.focusPending) this.scrollTop = oldScroller.scrollTop;
    else this.scrollTop = null;
    this.lastClipKey = clipKey;

    if (!track) {
      host.replaceChildren();
      return;
    }
    if (!clip && app.view === "arrangement") {
      host.replaceChildren(
        h("div", { class: "panel-title" }, track.name),
        h("div", { class: "empty-editor" }, h("p", {}, "Wähle einen Clip in der Zeitleiste aus, um ihn hier zu bearbeiten.")),
      );
      this.notesLayer = null;
      this.playhead = null;
      return;
    }
    if (!clip) {
      host.replaceChildren(
        h("div", { class: "panel-title" }, `${track.name} · Szene ${app.selection.scene + 1}`),
        h(
          "div",
          { class: "empty-editor" },
          h("p", {}, "Leerer Slot."),
          h("button", { class: "btn", onclick: () => app.createClipAt(app.selection.track, app.selection.scene) }, "Clip anlegen"),
        ),
      );
      this.notesLayer = null;
      this.playhead = null;
      return;
    }

    if (clip.audio) {
      this.renderAudio(host, clip);
      return;
    }
    this.audioBeats = 0;

    this.rows = this.computeRows();
    const steps = Math.round(clip.length * STEPS_PER_BEAT);
    const width = steps * STEP_W;
    const height = this.rows.length * ROW_H;

    const name = h("input", {
      class: "clip-name-input",
      value: clip.name,
      onchange: () => {
        app.checkpoint();
        clip.name = name.value;
        app.changed();
      },
    });
    const scale = getScale(app.project.key.scale);
    const header = h(
      "div",
      { class: "panel-title editor-head" },
      h("span", { class: "swatch", style: { background: track.color } }),
      name,
      select(String(clip.length / BEATS_PER_BAR), ["1", "2", "4", "8"].map((v) => ({ value: v, label: `${v} Takt${v === "1" ? "" : "e"}` })), (v) => {
        app.checkpoint();
        clip.length = Number(v) * BEATS_PER_BAR;
        clip.notes = clip.notes.filter((n) => n.start < clip.length);
        app.changed();
      }, "Clip-Länge"),
      track.instrument === "synth"
        ? h(
            "label",
            { class: "check", title: `Nur Töne aus ${scale.name} anzeigen` },
            h("input", { type: "checkbox", checked: this.fold, onchange: () => ((this.fold = !this.fold), this.render(host)) }),
            "Fold",
          )
        : null,
      slider({ label: "Vel", min: 0.05, max: 1, step: 0.05, value: this.newVelocity, format: (v) => String(Math.round(v * 127)), onInput: (v) => (this.newVelocity = v) }),
      slider({ label: "Chance", min: 0.05, max: 1, step: 0.05, value: this.newProbability, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (this.newProbability = v) }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn small", title: "Als MIDI-Datei exportieren", onclick: () => app.exportSelectedClipMidi() }, "MIDI ↓"),
      h("button", { class: "btn small danger", title: "Clip löschen", onclick: () => app.deleteSelectedClip() }, "Löschen"),
    );

    const keys = h(
      "div",
      { class: "roll-keys", style: { height: `${height}px` } },
      this.rows.map((r) =>
        h(
          "div",
          {
            class: `key ${r.inScale ? "in-scale" : "out-scale"} ${r.root ? "root" : ""} ${track.instrument === "drums" ? "drum" : ""}`,
            style: { height: `${ROW_H}px` },
            onpointerdown: () => app.engine.preview(app.selection.track, r.pitch),
          },
          r.label,
        ),
      ),
    );

    const background = h(
      "div",
      { class: "roll-bg", style: { width: `${width}px`, height: `${height}px` } },
      this.rows.map((r) => h("div", { class: `lane ${r.inScale ? "in-scale" : "out-scale"} ${r.root ? "root" : ""}`, style: { height: `${ROW_H}px` } })),
    );
    background.style.setProperty("--step-w", `${STEP_W}px`);

    this.notesLayer = h("div", { class: "roll-notes", style: { width: `${width}px`, height: `${height}px` } });
    this.playhead = h("div", { class: "playhead", style: { height: `${height}px` } });
    const canvas = h("div", { class: "roll-canvas", style: { width: `${width}px`, height: `${height}px` } }, background, this.notesLayer, this.playhead);
    this.attachPointer(canvas);

    const scroller = h("div", { class: "roll-scroll" }, h("div", { class: "roll-inner" }, keys, canvas));
    host.replaceChildren(header, scroller);
    this.renderNotes();

    if (this.scrollTop !== null) scroller.scrollTop = this.scrollTop;
    else {
      // Centre the view around middle C (or the first note of the clip).
      const focus = clip.notes[0]?.pitch ?? 60;
      const idx = this.rows.findIndex((r) => r.pitch <= focus);
      this.focusPending = true;
      requestAnimationFrame(() => {
        if (!scroller.isConnected) return;
        scroller.scrollTop = Math.max(0, idx * ROW_H - scroller.clientHeight / 2);
        this.focusPending = false;
      });
    }
  }

  renderNotes() {
    const clip = this.app.selectedClip;
    if (!clip || !this.notesLayer) return;
    const color = this.app.selectedTrack.color;
    const children: HTMLElement[] = [];
    clip.notes.forEach((n, i) => {
      const row = this.rows.findIndex((r) => r.pitch === n.pitch);
      if (row < 0) return; // hidden by fold or outside the drum map
      const prob = n.probability ?? 1;
      children.push(
        h(
          "div",
          {
            class: `note ${prob < 1 ? "chance" : ""}`,
            "data-index": i,
            title: `${pitchName(n.pitch)} · Vel ${Math.round(n.velocity * 127)} · ${Math.round(prob * 100)}%`,
            style: {
              left: `${n.start * STEPS_PER_BEAT * STEP_W}px`,
              top: `${row * ROW_H}px`,
              width: `${Math.max(4, n.length * STEPS_PER_BEAT * STEP_W - 1)}px`,
              height: `${ROW_H - 1}px`,
              background: color,
              opacity: String(0.35 + 0.65 * n.velocity),
            },
          },
          prob < 1 ? `${Math.round(prob * 100)}%` : "",
        ),
      );
    });
    this.notesLayer.replaceChildren(...children);
  }

  updatePlayhead() {
    if (!this.playhead || !this.app.selectedClip) return;
    const at = this.app.selectedClipPosition();
    if (!at) {
      this.playhead.style.display = "none";
      return;
    }
    this.playhead.style.display = "block";
    if (this.audioBeats > 0) this.playhead.style.left = `${(at.pos / this.audioBeats) * 100}%`;
    else this.playhead.style.transform = `translateX(${at.pos * STEPS_PER_BEAT * STEP_W}px)`;
  }

  /** Editor for audio clips: waveform, gain, tempo following and length. */
  private renderAudio(host: HTMLElement, clip: Clip) {
    const app = this.app;
    const audio = clip.audio!;
    const track = app.selectedTrack;
    const meta = app.engine.samples.meta(audio.sampleId);
    const bpm = app.project.bpm;
    // Beats the sample lasts at the current tempo (re-pitched when sampleBpm is set).
    const sampleBeats = meta ? (meta.duration * (audio.sampleBpm ?? bpm)) / 60 : 0;
    this.audioBeats = clip.length;
    this.notesLayer = null;

    const name = h("input", {
      class: "clip-name-input",
      value: clip.name,
      onchange: () => {
        app.checkpoint();
        clip.name = name.value;
        app.changed();
      },
    });
    const lengths = ["1", "2", "4", "8", "16"];
    const bars = String(clip.length / BEATS_PER_BAR);
    const lengthSel = select(
      lengths.includes(bars) ? bars : "custom",
      [...lengths.map((v) => ({ value: v, label: `${v} Takt${v === "1" ? "" : "e"}` })), ...(lengths.includes(bars) ? [] : [{ value: "custom", label: `${+(clip.length / BEATS_PER_BAR).toFixed(2)} Takte` }])],
      (v) => {
        if (v === "custom") return;
        app.checkpoint();
        clip.length = Number(v) * BEATS_PER_BAR;
        app.changed();
      },
      "Clip-Länge",
    );
    const bpmInput = h("input", {
      class: "num-input",
      type: "number",
      min: 20,
      max: 400,
      step: 0.01,
      placeholder: "aus",
      value: audio.sampleBpm ?? "",
      title: "Original-Tempo des Samples. Gesetzt: das Sample folgt dem Projekttempo (Repitch). Leer: Originalgeschwindigkeit.",
      onchange: () => {
        const v = Number(bpmInput.value);
        app.checkpoint();
        audio.sampleBpm = bpmInput.value && v >= 20 && v <= 400 ? v : null;
        app.changed();
      },
    });

    const header = h(
      "div",
      { class: "panel-title editor-head" },
      h("span", { class: "swatch", style: { background: track.color } }),
      name,
      lengthSel,
      h(
        "button",
        {
          class: "btn small",
          title: "Clip-Länge auf die Sample-Länge setzen (auf 1/16 gerundet)",
          disabled: !meta,
          onclick: () => {
            app.checkpoint();
            clip.length = Math.max(0.25, Math.round(sampleBeats * 4) / 4);
            app.changed();
          },
        },
        "Sample-Länge",
      ),
      slider({
        label: "Gain",
        min: 0,
        max: 2,
        step: 0.01,
        value: audio.gain,
        format: (v) => (v <= 0 ? "-∞ dB" : `${(20 * Math.log10(v)).toFixed(1)} dB`),
        onInput: (v) => {
          audio.gain = v;
          app.changed(false);
        },
      }),
      h("label", { class: "check" }, "Sample-BPM ", bpmInput),
      h(
        "button",
        {
          class: "btn small",
          title: "Sample-BPM so setzen, dass das Sample genau die Clip-Länge füllt",
          disabled: !meta,
          onclick: () => {
            if (!meta) return;
            app.checkpoint();
            audio.sampleBpm = Math.round(((clip.length * 60) / meta.duration) * 100) / 100;
            app.changed();
          },
        },
        "An Clip anpassen",
      ),
      h("span", { class: "spacer" }),
      h("button", { class: "btn small danger", title: "Clip löschen", onclick: () => app.deleteSelectedClip() }, "Löschen"),
    );

    const canvas = h("canvas", { width: 1200, height: 140 });
    if (meta) drawPeaks(canvas, meta.peaks, track.color, 0, clip.length / Math.max(1e-6, sampleBeats));
    this.playhead = h("div", { class: "playhead" });
    const grid = h("div", { class: "audio-grid" });
    for (let b = 1; b < clip.length; b++) {
      grid.append(h("div", { class: `audio-beat ${b % BEATS_PER_BAR === 0 ? "bar" : ""}`, style: { left: `${(b / clip.length) * 100}%` } }));
    }
    const info = meta
      ? `${meta.name} · ${meta.duration.toFixed(2)} s · ${meta.sampleRate} Hz · ${meta.channels === 1 ? "Mono" : "Stereo"} · ${
          audio.sampleBpm ? `folgt dem Tempo (Rate ${(bpm / audio.sampleBpm).toFixed(3)}×)` : "Originalgeschwindigkeit"
        } · Sample ${sampleBeats.toFixed(2)} Schläge, Clip ${clip.length} Schläge`
      : "Das Sample fehlt in der Bibliothek. Importiere die Datei erneut, um den Clip abzuspielen.";
    host.replaceChildren(
      header,
      h("div", { class: "audio-editor" }, h("div", { class: "audio-wave-wrap" }, canvas, grid, this.playhead), h("p", { class: "audio-info" }, info)),
    );
    this.updatePlayhead();
  }

  private attachPointer(canvas: HTMLElement) {
    const app = this.app;
    canvas.addEventListener("pointerdown", (e) => {
      const clip = app.selectedClip;
      if (!clip || e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const step = Math.floor((e.clientX - rect.left) / STEP_W);
      const rowIdx = Math.floor((e.clientY - rect.top) / ROW_H);
      const row = this.rows[rowIdx];
      if (!row) return;

      const noteEl = (e.target as HTMLElement).closest<HTMLElement>(".note");
      if (noteEl) {
        const idx = Number(noteEl.dataset.index);
        app.checkpoint();
        if (e.shiftKey) {
          const n = clip.notes[idx];
          const cur = PROB_CYCLE.findIndex((p) => Math.abs(p - (n.probability ?? 1)) < 0.01);
          n.probability = PROB_CYCLE[(cur + 1) % PROB_CYCLE.length];
        } else {
          clip.notes.splice(idx, 1);
        }
        this.renderNotes();
        app.changed(false);
        return;
      }

      app.checkpoint();
      const note: Note = {
        pitch: row.pitch,
        start: step / STEPS_PER_BEAT,
        length: 1 / STEPS_PER_BEAT,
        velocity: this.newVelocity,
        probability: this.newProbability,
      };
      clip.notes.push(note);
      app.engine.preview(app.selection.track, row.pitch);
      this.renderNotes();
      canvas.setPointerCapture(e.pointerId);

      const move = (ev: PointerEvent) => {
        const endStep = Math.floor((ev.clientX - rect.left) / STEP_W) + 1;
        const maxSteps = clip.length * STEPS_PER_BEAT;
        note.length = Math.max(1, Math.min(maxSteps, endStep) - step) / STEPS_PER_BEAT;
        this.renderNotes();
      };
      const up = () => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        clip.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
        app.changed(false);
        this.renderNotes();
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
    });
  }
}

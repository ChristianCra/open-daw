// Application shell: top bar, session grid with mixer strips, and the lower
// panel (clip editor, device view, MIDI tools) all visible at the same time.

import { AudioEngine } from "../engine/engine";
import { MidiInput, type MidiEvent } from "../engine/midi-input";
import { clipPosition } from "../engine/scheduler";
import { clipToMidiFile } from "../midi/smf";
import {
  createClip,
  createDemoProject,
  createTrack,
  NOTE_NAMES,
  parseProject,
  serializeProject,
  STEPS_PER_BEAT,
  type InstrumentKind,
  type Note,
  type Project,
} from "../model";
import { SCALES } from "../music/scales";
import { TUNINGS } from "../music/tuning";
import { download, h, select, slider } from "./dom";
import { ClipEditor } from "./editor";
import { renderDevicePanel, renderToolsPanel, type ToolState } from "./panels";

const STORAGE_KEY = "open-daw.project.v1";
const MAX_UNDO = 100;

export interface Selection {
  track: number;
  scene: number;
}

export class App {
  project: Project;
  engine: AudioEngine;
  selection: Selection = { track: 0, scene: 0 };
  tools: ToolState = { toolId: "gen-melody", params: {}, seed: 1 };
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private editor: ClipEditor;
  private saveTimer: number | null = null;
  midi = new MidiInput();
  recording = false;
  recordQuantize = true;
  mpe = false;
  /** Held notes while recording: key -> note already inserted in the clip */
  private recordingNotes = new Map<string, { note: Note; onBeat: number }>();

  private topbar = h("header", { class: "topbar" });
  private session = h("section", { class: "session" });
  private editorHost = h("section", { class: "panel editor-panel" });
  private deviceHost = h("section", { class: "panel device-panel" });
  private toolsHost = h("section", { class: "panel tools-panel" });

  constructor(private root: HTMLElement) {
    this.project = loadStoredProject() ?? createDemoProject();
    this.engine = new AudioEngine(this.project);
    this.editor = new ClipEditor(this);
    root.append(
      this.topbar,
      this.session,
      h("div", { class: "lower" }, this.editorHost, h("div", { class: "side" }, this.deviceHost, this.toolsHost)),
      h("footer", { class: "statusbar" }, "Space: Play/Stop · Doppelklick auf leeren Slot: Clip anlegen · Shift+Klick auf Note: Wahrscheinlichkeit · Strg+Z: Rückgängig"),
    );
    this.midi.onEvent = (ev) => this.onMidi(ev);
    this.midi.onDevicesChanged = () => this.renderTopbar();
    this.renderAll();
    window.addEventListener("keydown", (e) => this.onKey(e));
    requestAnimationFrame(() => this.animate());
  }

  // ------------------------------------------------------------ state helpers

  /** Call before every structural edit so it can be undone. */
  checkpoint() {
    this.undoStack.push(serializeProject(this.project));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Call after any model change. */
  changed(structural = true) {
    this.engine.syncMixer();
    if (structural) this.renderAll();
    this.scheduleSave();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(serializeProject(this.project));
    this.restore(prev);
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(serializeProject(this.project));
    this.restore(next);
  }

  private restore(json: string) {
    const restored = parseProject(json);
    // Keep playback running: copy into the live project object when the track layout matches.
    if (restored.tracks.length === this.project.tracks.length) {
      Object.assign(this.project, restored);
    } else {
      this.project = restored;
      this.engine.setProject(this.project);
    }
    this.project.tracks.forEach((_, i) => this.engine.refreshInstrument(i));
    this.changed();
  }

  private scheduleSave() {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeProject(this.project));
      } catch {
        /* storage may be unavailable (private mode); the project still works */
      }
    }, 400);
  }

  loadProject(p: Project) {
    this.checkpoint();
    this.project = p;
    this.engine.setProject(p);
    this.selection = { track: 0, scene: 0 };
    this.changed();
  }

  get selectedTrack() {
    return this.project.tracks[this.selection.track];
  }

  get selectedClip() {
    return this.selectedTrack?.clips[this.selection.scene] ?? null;
  }

  select(track: number, scene: number) {
    this.selection = { track, scene };
    this.renderAll();
  }

  // ------------------------------------------------------------------ render

  renderAll() {
    this.renderTopbar();
    this.renderSession();
    this.editor.render(this.editorHost);
    renderDevicePanel(this, this.deviceHost);
    renderToolsPanel(this, this.toolsHost);
  }

  renderTopbar() {
    const p = this.project;
    const playBtn = h("button", { class: "btn play", title: "Play (Space)", onclick: () => this.togglePlay() }, "▶");
    const stopBtn = h("button", { class: "btn", title: "Stop", onclick: () => this.engine.stop() }, "■");
    const bpm = h("input", {
      type: "number",
      class: "bpm",
      min: 20,
      max: 999,
      value: p.bpm,
      title: "Tempo (BPM)",
      onchange: () => {
        const v = Math.min(999, Math.max(20, Number(bpm.value) || 120));
        this.engine.setTempo(v);
        this.changed(false);
      },
    });
    const position = h("span", { class: "position", id: "position" }, "1.1.1");
    const fileInput = h("input", {
      type: "file",
      accept: ".json,application/json",
      style: { display: "none" },
      onchange: async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        try {
          this.loadProject(parseProject(await file.text()));
        } catch (err) {
          this.toast(`Projekt konnte nicht geladen werden: ${(err as Error).message}`);
        }
      },
    });
    this.topbar.replaceChildren(
      h("div", { class: "brand" }, "open-daw"),
      h("div", { class: "group" }, playBtn, stopBtn, position),
      h("div", { class: "group" }, h("span", { class: "lbl" }, "BPM"), bpm),
      h(
        "div",
        { class: "group" },
        h("span", { class: "lbl" }, "Tonart"),
        select(String(p.key.root), NOTE_NAMES.map((n, i) => ({ value: String(i), label: n })), (v) => {
          this.checkpoint();
          p.key.root = Number(v);
          this.changed();
        }, "Grundton"),
        select(p.key.scale, SCALES.map((s) => ({ value: s.id, label: s.name })), (v) => {
          this.checkpoint();
          p.key.scale = v;
          this.changed();
        }, "Skala"),
      ),
      h(
        "div",
        { class: "group" },
        h("span", { class: "lbl" }, "Stimmung"),
        select(p.tuning.system, TUNINGS.map((t) => ({ value: t.id, label: t.name })), (v) => {
          this.checkpoint();
          p.tuning.system = v;
          this.changed();
        }, "Tuning-System"),
      ),
      this.renderMidiGroup(),
      h(
        "div",
        { class: "group" },
        slider({ label: "Master", min: 0, max: 1.2, step: 0.01, value: p.masterVolume, onInput: (v) => ((p.masterVolume = v), this.changed(false)) }),
        h("div", { class: "meter horizontal" }, h("div", { class: "meter-fill", id: "meter-master" })),
      ),
      h(
        "div",
        { class: "group right" },
        h("button", { class: "btn", title: "Rückgängig (Strg+Z)", onclick: () => this.undo() }, "↶"),
        h("button", { class: "btn", title: "Wiederholen (Strg+Shift+Z)", onclick: () => this.redo() }, "↷"),
        h("button", { class: "btn", onclick: () => confirmNew(this) }, "Neu"),
        h("button", { class: "btn", onclick: () => fileInput.click() }, "Öffnen"),
        h("button", { class: "btn", onclick: () => download(`${p.name || "project"}.opendaw.json`, serializeProject(p), "application/json") }, "Speichern"),
        fileInput,
      ),
    );
  }

  private renderMidiGroup(): HTMLElement {
    const rec = h(
      "button",
      { class: `btn rec ${this.recording ? "on" : ""}`, title: "MIDI-Aufnahme in den gewählten Clip", onclick: () => this.toggleRecord() },
      "●",
    );
    if (!this.midi.enabled) {
      return h(
        "div",
        { class: "group" },
        rec,
        h(
          "button",
          {
            class: "btn",
            title: this.midi.error ?? "MIDI-Keyboard verbinden",
            onclick: async () => {
              if (!(await this.midi.enable())) this.toast(this.midi.error ?? "MIDI nicht verfügbar");
              this.renderTopbar();
            },
          },
          "🎹 MIDI verbinden",
        ),
      );
    }
    const devices = this.midi.devices();
    return h(
      "div",
      { class: "group" },
      rec,
      h("span", { class: "lbl" }, "MIDI"),
      select(
        this.midi.selected,
        [{ value: "all", label: devices.length ? "Alle Eingänge" : "Kein Gerät gefunden" }, ...devices.map((d) => ({ value: d.id, label: d.name }))],
        (v) => this.midi.select(v),
        "MIDI-Eingang",
      ),
      h(
        "label",
        { class: "check", title: "MPE: Pitchbend pro Note (±48 Halbtöne)" },
        h("input", { type: "checkbox", checked: this.mpe, onchange: () => ((this.mpe = !this.mpe), (this.engine.bendRange = this.mpe ? 48 : 2)) }),
        "MPE",
      ),
      h(
        "label",
        { class: "check", title: "Aufgenommene Noten auf 1/16 quantisieren" },
        h("input", { type: "checkbox", checked: this.recordQuantize, onchange: () => (this.recordQuantize = !this.recordQuantize) }),
        "Quant.",
      ),
    );
  }

  toggleRecord() {
    this.recording = !this.recording;
    if (this.recording) {
      const { track, scene } = this.selection;
      if (!this.selectedClip) this.createClipAt(track, scene);
      // Make sure the clip being recorded into is actually playing.
      const st = this.engine.playStates[track];
      if (!this.engine.playing || st?.playing?.scene !== scene) this.engine.launchClip(track, scene);
    } else {
      this.recordingNotes.clear();
    }
    this.renderTopbar();
  }

  private onMidi(ev: MidiEvent) {
    const track = this.selection.track;
    switch (ev.type) {
      case "noteon":
        this.engine.liveNoteOn(track, ev.pitch, ev.velocity, ev.channel);
        if (this.recording) this.recordNoteOn(ev.pitch, ev.velocity, ev.channel);
        break;
      case "noteoff":
        this.engine.liveNoteOff(ev.pitch, ev.channel);
        if (this.recording) this.recordNoteOff(ev.pitch, ev.channel);
        break;
      case "bend":
        this.engine.pitchBend(ev.channel, ev.value);
        break;
      case "cc":
        if (ev.controller === 123 || ev.controller === 120) this.engine.allNotesOff();
        break;
    }
  }

  /** Clip-relative position of the transport for the selected clip, or null if it isn't playing. */
  private recordPosition(): { pos: number; beat: number } | null {
    const clip = this.selectedClip;
    const st = this.engine.playStates[this.selection.track];
    const beat = this.engine.currentBeat;
    if (!clip || !this.engine.playing || st?.playing?.scene !== this.selection.scene || beat < st.playing.startBeat) return null;
    return { pos: (beat - st.playing.startBeat) % clip.length, beat };
  }

  private recordNoteOn(pitch: number, velocity: number, channel: number) {
    const clip = this.selectedClip;
    const at = this.recordPosition();
    if (!clip || !at) return;
    let start = at.pos;
    if (this.recordQuantize) start = (Math.round(start * STEPS_PER_BEAT) / STEPS_PER_BEAT) % clip.length;
    this.checkpoint();
    const note: Note = { pitch, start, length: 1 / STEPS_PER_BEAT, velocity, probability: 1 };
    clip.notes.push(note);
    this.recordingNotes.set(`${channel}:${pitch}`, { note, onBeat: at.beat });
    this.editor.renderNotes();
  }

  private recordNoteOff(pitch: number, channel: number) {
    const key = `${channel}:${pitch}`;
    const held = this.recordingNotes.get(key);
    const clip = this.selectedClip;
    this.recordingNotes.delete(key);
    if (!held || !clip) return;
    let length = this.engine.currentBeat - held.onBeat;
    if (this.recordQuantize) length = Math.round(length * STEPS_PER_BEAT) / STEPS_PER_BEAT;
    held.note.length = Math.max(1 / STEPS_PER_BEAT, Math.min(length, clip.length - held.note.start));
    clip.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    this.editor.renderNotes();
    this.changed(false);
  }

  private renderSession() {
    const p = this.project;
    const cols = `repeat(${p.tracks.length}, minmax(130px, 1fr)) 110px`;
    const grid = h("div", { class: "grid", style: { gridTemplateColumns: cols } });

    // Track headers
    p.tracks.forEach((tr, ti) => {
      const name = h("input", {
        class: "track-name",
        value: tr.name,
        onchange: () => {
          this.checkpoint();
          tr.name = name.value;
          this.changed(false);
        },
      });
      const mute = h("button", { class: `btn small toggle ${tr.mute ? "on" : ""}`, title: "Stumm", onclick: () => ((tr.mute = !tr.mute), mute.classList.toggle("on", tr.mute), this.changed(false)) }, "M");
      const solo = h("button", { class: `btn small toggle solo ${tr.solo ? "on" : ""}`, title: "Solo", onclick: () => ((tr.solo = !tr.solo), solo.classList.toggle("on", tr.solo), this.changed(false)) }, "S");
      grid.append(
        h(
          "div",
          { class: `track-head ${ti === this.selection.track ? "selected" : ""}`, style: { borderTopColor: tr.color }, onclick: (e: Event) => e.target === e.currentTarget && this.select(ti, this.selection.scene) },
          name,
          select<InstrumentKind>(tr.instrument, [{ value: "synth", label: "Synth" }, { value: "drums", label: "Drums" }], (v) => {
            this.checkpoint();
            tr.instrument = v;
            this.engine.refreshInstrument(ti);
            this.changed();
          }, "Instrument"),
          h("div", { class: "row" }, mute, solo),
        ),
      );
    });
    grid.append(h("div", { class: "track-head scene-head" }, h("button", { class: "btn small", title: "Spur hinzufügen", onclick: () => this.addTrack() }, "+ Spur")));

    // Clip slots, row by row
    for (let s = 0; s < p.sceneCount; s++) {
      p.tracks.forEach((tr, ti) => {
        const clip = tr.clips[s];
        const selected = this.selection.track === ti && this.selection.scene === s;
        const cls = `slot ${clip ? "has-clip" : ""} ${selected ? "selected" : ""}`;
        const slot = h(
          "div",
          {
            class: cls,
            "data-track": ti,
            "data-scene": s,
            style: clip ? { "--clip-color": tr.color } : {},
            onclick: () => this.select(ti, s),
            ondblclick: () => {
              if (!clip) this.createClipAt(ti, s);
            },
          },
          clip
            ? [
                h("button", { class: "launch", title: "Clip starten", onclick: (e: Event) => (e.stopPropagation(), this.engine.launchClip(ti, s)) }, "▶"),
                h("span", { class: "clip-name" }, clip.name),
                h("div", { class: "clip-progress" }),
              ]
            : h("span", { class: "empty-hint" }, ""),
        );
        grid.append(slot);
      });
      grid.append(h("button", { class: "scene-launch", title: `Szene ${s + 1} starten`, onclick: () => this.engine.launchScene(s) }, `▶ Szene ${s + 1}`));
    }

    // Track stop buttons
    p.tracks.forEach((_, ti) => grid.append(h("button", { class: "track-stop", title: "Spur stoppen", onclick: () => this.engine.stopTrack(ti) }, "■")));
    grid.append(h("button", { class: "scene-launch stop-all", onclick: () => this.engine.stopAllClips() }, "■ Alle stoppen"));

    // Mixer strips
    p.tracks.forEach((tr, ti) => {
      grid.append(
        h(
          "div",
          { class: "strip" },
          h("div", { class: "meter" }, h("div", { class: "meter-fill", id: `meter-${ti}` })),
          h(
            "div",
            { class: "strip-controls" },
            slider({ label: "Vol", min: 0, max: 1.25, step: 0.01, value: tr.volume, format: dbFormat, onInput: (v) => ((tr.volume = v), this.changed(false)) }),
            slider({ label: "Pan", min: -1, max: 1, step: 0.01, value: tr.pan, format: panFormat, onInput: (v) => ((tr.pan = v), this.changed(false)) }),
            slider({ label: "Delay", min: 0, max: 1, step: 0.01, value: tr.fx.delay, format: pct, onInput: (v) => ((tr.fx.delay = v), this.changed(false)) }),
          ),
        ),
      );
    });
    grid.append(h("div", { class: "strip master-label" }, "Mixer"));
    this.session.replaceChildren(grid);
  }

  // ----------------------------------------------------------------- actions

  togglePlay() {
    if (this.engine.playing) {
      this.engine.stop();
      if (this.recording) this.toggleRecord();
    } else void this.engine.play();
  }

  createClipAt(track: number, scene: number) {
    this.checkpoint();
    this.project.tracks[track].clips[scene] = createClip(`Clip ${scene + 1}`);
    this.selection = { track, scene };
    this.changed();
  }

  deleteSelectedClip() {
    const { track, scene } = this.selection;
    if (!this.project.tracks[track]?.clips[scene]) return;
    this.checkpoint();
    this.project.tracks[track].clips[scene] = null;
    this.changed();
  }

  exportSelectedClipMidi() {
    const clip = this.selectedClip;
    if (!clip) return;
    download(`${clip.name || "clip"}.mid`, clipToMidiFile(clip, this.project.bpm, this.selectedTrack.instrument === "drums" ? 9 : 0) as Uint8Array<ArrayBuffer>, "audio/midi");
  }

  addTrack() {
    this.checkpoint();
    const i = this.project.tracks.length;
    this.project.tracks.push(createTrack(i, "synth", this.project.sceneCount));
    this.engine.addChannel();
    this.changed();
  }

  toast(msg: string) {
    const t = h("div", { class: "toast" }, msg);
    this.root.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  private onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range";
    if (typing || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      this.togglePlay();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
    }
  }

  // --------------------------------------------------------------- animation

  private animate() {
    const beat = this.engine.currentBeat;
    const pos = document.getElementById("position");
    if (pos) {
      const b = Math.max(0, beat);
      const bar = Math.floor(b / 4) + 1;
      const beatInBar = Math.floor(b % 4) + 1;
      const six = Math.floor((b % 1) * 4) + 1;
      pos.textContent = `${bar}.${beatInBar}.${six}`;
    }
    const play = this.topbar.querySelector(".play");
    play?.classList.toggle("active", this.engine.playing);

    this.session.querySelectorAll<HTMLElement>(".slot").forEach((slot) => {
      const ti = Number(slot.dataset.track);
      const s = Number(slot.dataset.scene);
      const st = this.engine.playStates[ti];
      const clip = this.project.tracks[ti]?.clips[s];
      const isPlaying = !!st?.playing && st.playing.scene === s && this.engine.playing && beat >= st.playing.startBeat;
      const isQueued = !!st?.queued && st.queued.scene === s;
      slot.classList.toggle("playing", isPlaying);
      slot.classList.toggle("queued", isQueued && !isPlaying);
      const prog = slot.querySelector<HTMLElement>(".clip-progress");
      if (prog && clip && st?.playing) prog.style.width = isPlaying ? `${(clipPosition(clip, st.playing, beat) / clip.length) * 100}%` : "0";
    });

    this.project.tracks.forEach((_, i) => setMeter(`meter-${i}`, this.engine.level(i)));
    setMeter("meter-master", this.engine.level(-1));
    this.editor.updatePlayhead(beat);
    requestAnimationFrame(() => this.animate());
  }
}

function setMeter(id: string, level: number) {
  const el = document.getElementById(id);
  if (!el) return;
  // Map peak to a roughly dB-like visual scale.
  const db = 20 * Math.log10(Math.max(1e-4, level));
  const pctVal = Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  el.style.setProperty("--level", `${pctVal}%`);
  el.classList.toggle("clip", level >= 0.99);
}

function confirmNew(app: App) {
  const p = createDemoProject();
  p.tracks.forEach((t) => (t.clips = t.clips.map(() => null)));
  app.loadProject(p);
  app.toast("Neues Projekt angelegt. Strg+Z holt das alte zurück.");
}

function loadStoredProject(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseProject(raw) : null;
  } catch {
    return null;
  }
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const dbFormat = (v: number) => (v <= 0.0001 ? "-∞" : `${(20 * Math.log10(v)).toFixed(1)} dB`);
const panFormat = (v: number) => (Math.abs(v) < 0.01 ? "C" : v < 0 ? `${Math.round(-v * 50)}L` : `${Math.round(v * 50)}R`);

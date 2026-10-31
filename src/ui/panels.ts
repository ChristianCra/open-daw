// Device panel (instrument + Drive insert of the selected track) and the
// MIDI Tools panel (generators / transforms for the selected clip).

import { applyMidiTool, defaultParams, midiTools, seededRandom, type ParamValues } from "../midi/tools";
import type { DriveShape, Waveform } from "../model";
import type { App } from "./app";
import { h, select, slider } from "./dom";

export interface ToolState {
  toolId: string;
  params: ParamValues;
  seed: number;
}

export function renderDevicePanel(app: App, host: HTMLElement) {
  const track = app.selectedTrack;
  if (!track) return host.replaceChildren();
  const live = () => app.changed(false);
  const s = track.synth;
  const d = track.fx.drive;

  const instrument =
    track.instrument === "synth"
      ? h(
          "div",
          { class: "device" },
          h("div", { class: "device-title" }, "Synth"),
          h(
            "label",
            { class: "slider" },
            h("span", {}, "Welle"),
            select<Waveform>(s.waveform, ["sine", "triangle", "sawtooth", "square"].map((w) => ({ value: w as Waveform, label: w })), (v) => ((s.waveform = v), live())),
          ),
          slider({ label: "Attack", min: 0.001, max: 2, step: 0.001, value: s.attack, format: sec, onInput: (v) => ((s.attack = v), live()) }),
          slider({ label: "Decay", min: 0.01, max: 2, step: 0.01, value: s.decay, format: sec, onInput: (v) => ((s.decay = v), live()) }),
          slider({ label: "Sustain", min: 0, max: 1, step: 0.01, value: s.sustain, format: pct, onInput: (v) => ((s.sustain = v), live()) }),
          slider({ label: "Release", min: 0.01, max: 4, step: 0.01, value: s.release, format: sec, onInput: (v) => ((s.release = v), live()) }),
          slider({
            label: "Cutoff",
            min: 0,
            max: 1,
            step: 0.001,
            value: Math.log(s.cutoff / 40) / Math.log(18000 / 40),
            format: (v) => hz(40 * Math.pow(18000 / 40, v)),
            onInput: (v) => ((s.cutoff = 40 * Math.pow(18000 / 40, v)), live()),
          }),
          slider({ label: "Reso", min: 0.1, max: 20, step: 0.1, value: s.resonance, onInput: (v) => ((s.resonance = v), live()) }),
        )
      : track.instrument === "audio"
        ? h(
            "div",
            { class: "device" },
            h("div", { class: "device-title" }, "Audiospur"),
            h("p", { class: "hint" }, "Spielt Samples aus der Bibliothek. Zieh Samples aus dem Browser in einen Slot oder in die Zeitleiste. Gain und Tempo stellst du im Clip-Editor ein."),
          )
        : h("div", { class: "device" }, h("div", { class: "device-title" }, "Drum Kit"), h("p", { class: "hint" }, "Synthetisierte Kick, Snare, Clap und Hi-Hats. Keine Samples nötig."));

  const drive = h(
    "div",
    { class: `device ${d.enabled ? "" : "bypassed"}` },
    h(
      "div",
      { class: "device-title" },
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: d.enabled, onchange: () => ((d.enabled = !d.enabled), app.changed()) }), "Drive"),
      h("span", { class: "hint" }, "3-Band-Sättigung"),
    ),
    h(
      "label",
      { class: "slider" },
      h("span", {}, "Form"),
      select<DriveShape>(d.shape, [
        { value: "soft", label: "Soft (tanh)" },
        { value: "hard", label: "Hard Clip" },
        { value: "fold", label: "Wavefold" },
      ], (v) => ((d.shape = v), live())),
    ),
    slider({ label: "Low", min: 0, max: 1, step: 0.01, value: d.low, format: pct, onInput: (v) => ((d.low = v), live()) }),
    slider({ label: "Mid", min: 0, max: 1, step: 0.01, value: d.mid, format: pct, onInput: (v) => ((d.mid = v), live()) }),
    slider({ label: "High", min: 0, max: 1, step: 0.01, value: d.high, format: pct, onInput: (v) => ((d.high = v), live()) }),
    slider({ label: "Mix", min: 0, max: 1, step: 0.01, value: d.mix, format: pct, onInput: (v) => ((d.mix = v), live()) }),
  );

  host.replaceChildren(h("div", { class: "panel-title" }, h("span", { class: "swatch", style: { background: track.color } }), `Geräte · ${track.name}`), h("div", { class: "devices" }, instrument, drive));
}

export function renderToolsPanel(app: App, host: HTMLElement) {
  const state = app.tools;
  const tools = midiTools();
  const tool = tools.find((t) => t.id === state.toolId) ?? tools[0];
  const params: ParamValues = { ...defaultParams(tool), ...state.params };
  const selected = app.selectedClip;
  // MIDI tools only work on MIDI clips.
  const clip = selected && !selected.audio ? selected : null;

  const controls = tool.params.map((p) =>
    p.type === "number"
      ? slider({ label: p.label, min: p.min, max: p.max, step: p.step, value: Number(params[p.id]), onInput: (v) => (state.params[p.id] = v) })
      : h("label", { class: "slider" }, h("span", {}, p.label), select(String(params[p.id]), p.options, (v) => (state.params[p.id] = v))),
  );

  const run = (replace: boolean) => {
    if (!clip) return;
    app.checkpoint();
    const basePitch = app.selectedTrack.instrument === "drums" ? 36 : 60;
    const input = tool.kind === "generator" && replace ? [] : clip.notes;
    clip.notes = applyMidiTool(tool, input, state.params, {
      key: app.project.key,
      length: clip.length,
      rng: seededRandom(state.seed),
      basePitch,
    });
    app.changed();
  };

  const seedInput = h("input", { type: "number", class: "seed", value: state.seed, min: 1, onchange: () => (state.seed = Math.max(1, Number(seedInput.value) || 1)) });

  host.replaceChildren(
    h("div", { class: "panel-title" }, "MIDI Tools"),
    h(
      "div",
      { class: "tools" },
      select(
        tool.id,
        [
          ...tools.filter((t) => t.kind === "generator").map((t) => ({ value: t.id, label: `✦ ${t.name}` })),
          ...tools.filter((t) => t.kind === "transform").map((t) => ({ value: t.id, label: `⇄ ${t.name}` })),
        ],
        (v) => {
          state.toolId = v;
          state.params = {};
          renderToolsPanel(app, host);
        },
        "Werkzeug",
      ),
      h("div", { class: "tool-params" }, controls.length ? controls : h("p", { class: "hint" }, "Keine Parameter.")),
      h(
        "div",
        { class: "row" },
        h("span", { class: "lbl" }, "Seed"),
        seedInput,
        h("button", { class: "btn small", title: "Neuer Zufallswert", onclick: () => ((state.seed = 1 + Math.floor(Math.random() * 99999)), (seedInput.value = String(state.seed))) }, "🎲"),
      ),
      h(
        "div",
        { class: "row" },
        tool.kind === "generator"
          ? [
              h("button", { class: "btn primary", disabled: !clip, onclick: () => run(true) }, "Erzeugen (ersetzen)"),
              h("button", { class: "btn", disabled: !clip, onclick: () => run(false) }, "Hinzufügen"),
            ]
          : h("button", { class: "btn primary", disabled: !clip, onclick: () => run(false) }, "Anwenden"),
      ),
      clip ? null : h("p", { class: "hint" }, selected?.audio ? "MIDI Tools gelten nur für MIDI-Clips." : "Wähle einen Clip aus, um ihn zu bearbeiten."),
    ),
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const hz = (v: number) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`);

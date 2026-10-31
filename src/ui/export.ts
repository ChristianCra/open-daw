// WAV export dialog and "bounce to new track".

import { encodeWav, normalize, type WavFormat } from "../audio/wav";
import { renderArrangement } from "../engine/render";
import { arrangementEnd, BEATS_PER_BAR } from "../model";
import type { App } from "./app";
import { download, h, select } from "./dom";

export type ExportRange = "arrangement" | "loop";

export interface ExportSettings {
  range: ExportRange;
  format: WavFormat;
  sampleRate: number;
  normalize: boolean;
}

const settings: ExportSettings = { range: "arrangement", format: "pcm24", sampleRate: 44100, normalize: false };

/** Timeline range (beats) to export, or null when there is nothing to render. */
export function exportRange(app: App, range: ExportRange): { from: number; to: number } | null {
  const p = app.project;
  if (range === "loop") return p.loop.end > p.loop.start ? { from: p.loop.start, to: p.loop.end } : null;
  const end = arrangementEnd(p);
  return end > 0 ? { from: 0, to: end } : null;
}

const fmtBars = (beats: number) => `${+(beats / BEATS_PER_BAR).toFixed(2)} Takte`;

/** Renders the arrangement and downloads it as a WAV file. Returns the file size in bytes. */
export async function exportWav(app: App, s: ExportSettings = settings): Promise<number> {
  const r = exportRange(app, s.range);
  if (!r) throw new Error(s.range === "loop" ? "Der Loop-Bereich ist leer." : "Die Zeitleiste ist leer. Zieh zuerst Clips ins Arrangement.");
  const res = await renderArrangement(app.project, app.engine.samples, { ...r, sampleRate: s.sampleRate });
  if (s.normalize) normalize(res.channels);
  const wav = encodeWav(res.channels, res.sampleRate, s.format);
  const name = (app.project.name || "open-daw").replace(/[\\/:*?"<>|]+/g, "_");
  download(`${name}.wav`, wav, "audio/wav");
  return wav.byteLength;
}

export function openExportDialog(app: App) {
  const close = () => overlay.remove();
  const status = h("p", { class: "hint" });
  const loopOk = !!exportRange(app, "loop");
  const arrOk = !!exportRange(app, "arrangement");
  const rangeLabel = (r: ExportRange) => {
    const x = exportRange(app, r);
    return x ? fmtBars(x.to - x.from) : "leer";
  };
  const go = h("button", { class: "btn primary", disabled: !arrOk && !loopOk }, "Exportieren");
  go.onclick = async () => {
    go.disabled = true;
    status.textContent = "Rendere …";
    try {
      const bytes = await exportWav(app, settings);
      status.textContent = `Fertig: ${(bytes / 1024 / 1024).toFixed(1)} MB`;
      setTimeout(close, 800);
    } catch (err) {
      status.textContent = (err as Error).message;
      go.disabled = false;
    }
  };
  if (!arrOk && loopOk) settings.range = "loop";
  const overlay = h(
    "div",
    { class: "modal-backdrop", onclick: (e: Event) => e.target === overlay && close() },
    h(
      "div",
      { class: "modal", role: "dialog", "aria-label": "Audio exportieren" },
      h("div", { class: "panel-title" }, "Audio exportieren", h("span", { class: "spacer" }), h("button", { class: "icon", title: "Schließen", onclick: close }, "×")),
      h(
        "div",
        { class: "modal-body" },
        h(
          "label",
          { class: "slider" },
          h("span", {}, "Bereich"),
          select<ExportRange>(
            settings.range,
            [
              { value: "arrangement", label: `Ganzes Arrangement (${rangeLabel("arrangement")})` },
              { value: "loop", label: `Loop-Bereich (${rangeLabel("loop")})` },
            ],
            (v) => (settings.range = v),
          ),
        ),
        h(
          "label",
          { class: "slider" },
          h("span", {}, "Format"),
          select<WavFormat>(
            settings.format,
            [
              { value: "pcm16", label: "WAV 16 Bit" },
              { value: "pcm24", label: "WAV 24 Bit" },
              { value: "float32", label: "WAV 32 Bit Float" },
            ],
            (v) => (settings.format = v),
          ),
        ),
        h(
          "label",
          { class: "slider" },
          h("span", {}, "Sample-Rate"),
          select(String(settings.sampleRate), [
            { value: "44100", label: "44,1 kHz" },
            { value: "48000", label: "48 kHz" },
            { value: "96000", label: "96 kHz" },
          ], (v) => (settings.sampleRate = Number(v))),
        ),
        h(
          "label",
          { class: "check" },
          h("input", { type: "checkbox", checked: settings.normalize, onchange: (e: Event) => (settings.normalize = (e.target as HTMLInputElement).checked) }),
          "Normalisieren",
        ),
        h("p", { class: "hint" }, "Gerendert wird die Zeitleiste mit Mixer, Effekten und Automation, schneller als in Echtzeit. Session-Clips, die nicht im Arrangement liegen, sind nicht enthalten."),
        status,
      ),
      h("div", { class: "modal-actions" }, h("button", { class: "btn", onclick: close }, "Abbrechen"), go),
    ),
  );
  document.body.append(overlay);
  go.focus();
}

/**
 * Renders a track's arrangement (with its instrument, effects and automation)
 * into a sample and puts it on a new audio track right below. The original
 * track is muted so the result sounds the same.
 */
export async function bounceTrack(app: App, ti: number): Promise<boolean> {
  const tr = app.project.tracks[ti];
  if (!tr) return false;
  if (!tr.arrangement.length) {
    app.toast("Die Spur hat keine Clips in der Zeitleiste.");
    return false;
  }
  const from = Math.min(...tr.arrangement.map((a) => a.start));
  const to = Math.max(...tr.arrangement.map((a) => a.start + a.length));
  app.stopTransport();
  app.toast(`Bounce „${tr.name}“ …`);
  const res = await renderArrangement(app.project, app.engine.samples, {
    from,
    to,
    tracks: [ti],
    unityMaster: true,
    sampleRate: app.engine.ctx.sampleRate,
  });
  const meta = await app.engine.samples.addRendered(`${tr.name} Bounce`, res.channels, res.sampleRate, ["bounce", tr.instrument]);
  app.insertBouncedTrack(ti, meta, from);
  return true;
}

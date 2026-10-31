// Stem separation dialog: splits a sample (or an audio clip) into drums,
// bass, other and vocals with a local AI model.

import { modelCached, SeparationError, StemSeparator, type SeparationProgress } from "../audio/stem-separator";
import { STEM_LABELS, STEM_SAMPLE_RATE } from "../audio/stems";
import type { SampleMeta } from "../audio/samples";
import type { App } from "./app";
import { h } from "./dom";

let separator: StemSeparator | null = null;

export interface StemTarget {
  sampleId: string;
  /** When set, the stems are put on new tracks next to this clip */
  clip?: { track: number; scene: number | null; arr: number | null };
}

export async function openStemDialog(app: App, target: StemTarget) {
  const lib = app.engine.samples;
  const meta = lib.meta(target.sampleId);
  if (!meta) {
    app.toast("Das Sample fehlt in der Bibliothek.");
    return;
  }
  separator ??= new StemSeparator();
  const sep = separator;
  const cached = await modelCached();
  let controller: AbortController | null = null;

  const bar = h("div", { class: "progress-bar" });
  const progress = h("div", { class: "progress", hidden: true }, bar);
  const status = h("p", { class: "hint" });
  const errorText = h("pre", { class: "error-details" });
  const copyError = h("button", { class: "btn small", onclick: () => void navigator.clipboard?.writeText(errorText.textContent ?? "").then(() => app.toast("Fehlermeldung kopiert"), () => {}) }, "Kopieren");
  const errorBox = h(
    "div",
    { class: "error-box", hidden: true, role: "alert" },
    h("div", { class: "error-head" }, h("b", {}, "Die Trennung hat nicht geklappt"), h("span", { class: "spacer" }), copyError),
    errorText,
    h("p", { class: "hint" }, "Häufigste Ursache ist zu wenig freier Arbeitsspeicher (das Modell braucht etwa 1,5 GB). Schließ andere Programme und versuch es noch einmal, oder probier ein kürzeres Sample."),
  );
  const go = h("button", { class: "btn primary" }, "Trennen");
  const pickModel = h("button", { class: "btn", hidden: true, title: "Eine heruntergeladene .onnx-Datei des Modells verwenden" }, "Modell-Datei wählen …");
  const cancel = h("button", { class: "btn" }, "Abbrechen");

  const close = () => {
    controller?.abort();
    overlay.remove();
  };
  const show = (p: SeparationProgress) => {
    progress.hidden = false;
    bar.classList.toggle("indeterminate", p.fraction < 0);
    bar.style.width = p.fraction < 0 ? "100%" : `${Math.round(p.fraction * 100)}%`;
    status.textContent = p.detail + (sep.backend ? ` · ${sep.backend}` : "");
  };

  const run = async () => {
    go.disabled = true;
    pickModel.hidden = true;
    errorBox.hidden = true;
    controller = new AbortController();
    try {
      const buf = await lib.load(meta.id);
      if (!buf) throw new Error("Sample konnte nicht geladen werden.");
      const t0 = performance.now();
      const stems = await sep.separate(buf, show, controller.signal);
      status.textContent = "Speichern …";
      const created: { label: string; meta: SampleMeta }[] = [];
      for (const stem of stems) {
        const label = STEM_LABELS[stem.name];
        const m = await lib.addRendered(`${meta.name} ${label}`, stem.channels, STEM_SAMPLE_RATE, ["stem", stem.name, ...meta.tags.filter((t) => t !== "stem")]);
        created.push({ label, meta: m });
      }
      const secs = Math.round((performance.now() - t0) / 1000);
      if (target.clip) app.insertStemTracks(target.clip.track, created, target.clip);
      else {
        app.browser.filter.text = meta.name;
        app.browser.refresh();
        app.toast(`4 Stems in der Bibliothek (${secs} s)`);
      }
      overlay.remove();
    } catch (err) {
      if ((err as Error).name === "AbortError" && controller?.signal.aborted) return;
      console.error("[stems]", err);
      const e = err as Error;
      const lines = [e.message || String(err), ...(err instanceof SeparationError ? err.details : [])];
      lines.push(`Sample: ${meta.name} (${meta.duration.toFixed(1)} s), ${navigator.userAgent}`);
      errorText.textContent = lines.join("\n");
      errorBox.hidden = false;
      status.textContent = "";
      progress.hidden = true;
      go.disabled = false;
      pickModel.hidden = false;
    }
  };
  go.onclick = () => void run();
  cancel.onclick = close;
  pickModel.onclick = () => {
    const input = h("input", { type: "file", accept: ".onnx", style: { display: "none" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      sep.dispose();
      sep.modelSource = file;
      void run();
    });
    document.body.append(input);
    input.click();
  };

  const overlay = h(
    "div",
    { class: "modal-backdrop" },
    h(
      "div",
      { class: "modal", role: "dialog", "aria-label": "Stems trennen" },
      h("div", { class: "panel-title" }, "In Stems trennen", h("span", { class: "spacer" }), h("button", { class: "icon", title: "Schließen", onclick: close }, "×")),
      h(
        "div",
        { class: "modal-body" },
        h("p", {}, h("b", {}, meta.name), ` · ${meta.duration.toFixed(1)} s`),
        h("p", { class: "hint" }, "Trennt in Drums, Bass, Gesang und Rest. Das läuft komplett auf deinem Rechner mit dem offenen Modell HT-Demucs (MIT-Lizenz), es wird nichts hochgeladen."),
        h(
          "p",
          { class: "hint" },
          cached
            ? "Das Modell ist schon geladen."
            : "Beim ersten Mal wird das Modell einmalig heruntergeladen (etwa 166 MB) und danach im Browser gespeichert.",
          " Ohne Grafikkarte dauert die Trennung etwa drei- bis fünfmal so lange wie das Audio selbst (ein 5-Minuten-Song also 15 bis 25 Minuten). Mit Grafikkarte (WebGPU) geht es deutlich schneller. Zum Ausprobieren eignet sich ein kurzes Sample.",
        ),
        target.clip ? h("p", { class: "hint" }, "Die Stems landen auf vier neuen Spuren unter der aktuellen, die Originalspur wird stummgeschaltet.") : null,
        progress,
        status,
        errorBox,
      ),
      h("div", { class: "modal-actions" }, pickModel, cancel, go),
    ),
  );
  document.body.append(overlay);
  go.focus();
}

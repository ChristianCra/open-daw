// Sample browser: import audio files, search, filter by tags and favourites,
// preview, edit tags and drag samples onto audio tracks.

import { rankSimilar } from "../audio/features";
import { filterSamples, tagCounts, type SampleFilter, type SampleMeta } from "../audio/samples";
import type { App } from "./app";
import { h } from "./dom";

export const SAMPLE_DRAG_TYPE = "application/x-opendaw-sample";

export class SampleBrowser {
  filter: SampleFilter = { text: "", tags: [], favoritesOnly: false };
  private host: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private editing: string | null = null;
  private previewing: string | null = null;
  /** Sample whose similar sounds are listed (null = normal list) */
  similarTo: string | null = null;

  constructor(private app: App) {}

  /** Opens a file picker and imports the chosen audio files. Resolves with the imported samples. */
  pickFiles(multiple = true): Promise<SampleMeta[]> {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept: "audio/*,.wav,.mp3,.ogg,.flac,.aif,.aiff,.m4a", multiple, style: { display: "none" } });
      input.addEventListener("change", async () => {
        const files = input.files ? [...input.files] : [];
        input.remove();
        resolve(files.length ? await this.importFiles(files) : []);
      });
      document.body.append(input);
      input.click();
    });
  }

  async importFiles(files: File[]): Promise<SampleMeta[]> {
    const { imported, failed } = await this.app.engine.samples.importFiles(files);
    if (failed.length) this.app.toast(`Nicht lesbar: ${failed.join(", ")}`);
    else if (imported.length) this.app.toast(`${imported.length} Sample${imported.length === 1 ? "" : "s"} importiert`);
    return imported;
  }

  render(host: HTMLElement) {
    this.host = host;
    const lib = this.app.engine.samples;
    const all = lib.list();
    const search = h("input", {
      class: "browser-search",
      placeholder: "Suchen …",
      value: this.filter.text,
      oninput: () => {
        this.filter.text = search.value;
        this.renderList();
      },
    });
    const tags = tagCounts(all).slice(0, 24);
    host.replaceChildren(
      h(
        "div",
        { class: "panel-title" },
        "Samples",
        h("span", { class: "spacer" }),
        h("button", { class: "btn small", title: "Audiodateien importieren (WAV, MP3, OGG, FLAC …)", onclick: () => void this.pickFiles() }, "+ Import"),
      ),
      h(
        "div",
        { class: "browser-filters" },
        search,
        h(
          "div",
          { class: "chips" },
          h(
            "button",
            {
              class: `chip ${this.filter.favoritesOnly ? "on" : ""}`,
              title: "Nur Favoriten",
              onclick: () => {
                this.filter.favoritesOnly = !this.filter.favoritesOnly;
                this.render(host);
              },
            },
            "★",
          ),
          tags.map(({ tag, count }) =>
            h(
              "button",
              {
                class: `chip ${this.filter.tags.includes(tag) ? "on" : ""}`,
                onclick: () => {
                  this.filter.tags = this.filter.tags.includes(tag) ? this.filter.tags.filter((t) => t !== tag) : [...this.filter.tags, tag];
                  this.render(host);
                },
              },
              `${tag} `,
              h("small", {}, String(count)),
            ),
          ),
        ),
      ),
      (this.listEl = h("div", { class: "browser-list" })),
    );
    if (!lib.persistent) host.append(h("p", { class: "hint pad" }, "Hinweis: Der Browser erlaubt keinen dauerhaften Speicher. Samples gehen beim Neuladen verloren."));
    // Dropping files anywhere on the browser imports them.
    host.ondragover = (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        host.classList.add("drop");
      }
    };
    host.ondragleave = () => host.classList.remove("drop");
    host.ondrop = (e) => {
      host.classList.remove("drop");
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      e.preventDefault();
      void this.importFiles([...files]);
    };
    this.renderList();
  }

  private renderList() {
    const list = this.listEl;
    if (!list) return;
    const lib = this.app.engine.samples;
    let items = filterSamples(lib.list(), this.filter);
    let scores: Map<string, number> | null = null;
    const target = this.similarTo ? lib.meta(this.similarTo) : undefined;
    if (this.similarTo && !target) this.similarTo = null;
    if (target) {
      if (!target.features || lib.list().some((s) => !s.features)) {
        list.replaceChildren(h("p", { class: "hint pad" }, "Analysiere Samples …"));
        void lib.analyzeMissing().then(() => this.renderList());
        return;
      }
      const ranked = rankSimilar(target.features, items.filter((s) => s.id !== target.id), lib.list().flatMap((s) => (s.features ? [s.features] : [])));
      scores = new Map(ranked.map((r) => [r.item.id, r.score]));
      items = ranked.map((r) => r.item);
    }
    const head = target
      ? h(
          "div",
          { class: "similar-head" },
          h("span", {}, "Ähnlich wie ", h("b", {}, target.name)),
          h("span", { class: "spacer" }),
          h("button", { class: "icon", title: "Zurück zur Liste", onclick: () => ((this.similarTo = null), this.renderList()) }, "×"),
        )
      : null;
    if (!items.length) {
      list.replaceChildren(
        h(
          "p",
          { class: "hint pad" },
          lib.list().length ? "Keine Treffer." : "Noch keine Samples. Importiere Audiodateien mit „+ Import“ oder zieh sie hierher.",
        ),
      );
      if (head) list.prepend(head);
      return;
    }
    list.replaceChildren(...(head ? [head] : []), ...items.map((s) => this.renderItem(s, scores?.get(s.id))));
  }

  private renderItem(s: SampleMeta, score?: number): HTMLElement {
    const lib = this.app.engine.samples;
    const wave = h("canvas", { class: "mini-wave", width: 120, height: 22 });
    drawPeaks(wave, s.peaks, "#8b93a5");
    const tagEditor =
      this.editing === s.id
        ? h("input", {
            class: "tag-input",
            value: s.tags.join(", "),
            placeholder: "Tags, durch Komma getrennt",
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                this.editing = null;
                this.renderList();
              }
            },
            onblur: (e: FocusEvent) => {
              this.editing = null;
              void lib.update(s.id, { tags: (e.target as HTMLInputElement).value.split(",") });
            },
          })
        : null;
    const el = h(
      "div",
      {
        class: `sample ${this.previewing === s.id ? "playing" : ""}`,
        draggable: true,
        title: `${s.name} · ${s.duration.toFixed(2)} s · ${s.sampleRate} Hz · ${s.channels === 1 ? "Mono" : "Stereo"}\nIn eine Audiospur ziehen`,
        ondragstart: (e: DragEvent) => {
          e.dataTransfer?.setData(SAMPLE_DRAG_TYPE, s.id);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
        },
      },
      h(
        "div",
        { class: "sample-row" },
        h(
          "button",
          {
            class: "icon",
            title: "Vorhören",
            onclick: () => {
              const on = this.previewing !== s.id;
              this.previewing = on ? s.id : null;
              this.app.engine.previewSample(on ? s.id : null);
              if (on) setTimeout(() => this.previewing === s.id && ((this.previewing = null), this.renderList()), s.duration * 1000 + 100);
              this.renderList();
            },
          },
          this.previewing === s.id ? "■" : "▶",
        ),
        h("span", { class: "sample-name" }, s.name),
        score !== undefined ? h("span", { class: "score", title: "Ähnlichkeit" }, `${Math.round(score * 100)}%`) : null,
        h(
          "button",
          {
            class: `icon ${this.similarTo === s.id ? "on" : ""}`,
            title: "Ähnliche Samples finden",
            onclick: () => {
              this.similarTo = s.id;
              this.renderList();
              this.listEl?.scrollTo({ top: 0 });
            },
          },
          "≈",
        ),
        h("button", { class: `icon fav ${s.favorite ? "on" : ""}`, title: "Favorit", onclick: () => void lib.update(s.id, { favorite: !s.favorite }) }, "★"),
        h(
          "button",
          {
            class: "icon",
            title: "Tags bearbeiten",
            onclick: () => {
              this.editing = s.id;
              this.renderList();
              this.listEl?.querySelector<HTMLInputElement>(".tag-input")?.focus();
            },
          },
          "#",
        ),
        h(
          "button",
          {
            class: "icon danger",
            title: "Aus der Bibliothek löschen",
            onclick: () => {
              if (this.app.sampleInUse(s.id)) {
                this.app.toast("Das Sample wird noch in einem Clip verwendet.");
                return;
              }
              void lib.remove(s.id);
            },
          },
          "×",
        ),
      ),
      h("div", { class: "sample-row" }, wave, tagEditor ?? h("span", { class: "sample-tags" }, s.tags.map((t) => h("span", { class: "tag" }, t)))),
    );
    return el;
  }

  refresh() {
    if (this.host) this.render(this.host);
  }
}

/** Draws a peak envelope into a canvas (used by browser, editor and arrangement). */
export function drawPeaks(canvas: HTMLCanvasElement, peaks: number[], color: string, from = 0, to = 1) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !peaks.length) return;
  const w = canvas.width;
  const hgt = canvas.height;
  ctx.clearRect(0, 0, w, hgt);
  ctx.fillStyle = color;
  const mid = hgt / 2;
  for (let x = 0; x < w; x++) {
    const pos = from + ((to - from) * x) / w;
    const i = Math.floor(pos * peaks.length);
    if (i < 0 || i >= peaks.length) continue;
    const p = peaks[i] * mid;
    ctx.fillRect(x, mid - p, 1, Math.max(1, p * 2));
  }
}

// Arrangement view: a timeline with one lane per track. Clips can be
// dragged in from the session grid, moved, resized, duplicated and deleted.
// The ruler sets the start position (click) and the loop region (drag).

import { BEATS_PER_BAR, trimOverlaps, type ArrangementClip, type Clip } from "../model";
import type { App } from "./app";
import { h, select } from "./dom";

export const CLIP_DRAG_TYPE = "application/x-opendaw-clip";

const LANE_H = 56;
const HEADER_W = 150;
const ZOOMS = [6, 10, 16, 24, 36];

export class ArrangementView {
  /** Pixels per beat */
  ppb = 16;
  private scroller: HTMLElement | null = null;
  private playhead: HTMLElement | null = null;
  private clipEls = new Map<ArrangementClip, HTMLElement>();
  private backBtn: HTMLButtonElement | null = null;
  private lastWidth = 0;

  constructor(private app: App) {}

  render(host: HTMLElement) {
    const app = this.app;
    const p = app.project;
    const prevScroll = this.scroller ? { left: this.scroller.scrollLeft, top: this.scroller.scrollTop } : null;
    const totalBeats = app.arrangementLength;
    const width = totalBeats * this.ppb;
    this.lastWidth = width;
    this.clipEls.clear();

    // ---------------------------------------------------------- toolbar
    const loop = p.loop;
    const barInput = (value: number, onChange: (bar: number) => void, title: string) => {
      const el = h("input", { type: "number", class: "bar-input", min: 1, value, title, onchange: () => onChange(Math.max(1, Math.round(Number(el.value) || 1))) });
      return el;
    };
    this.backBtn = h(
      "button",
      {
        class: `btn ${app.engine.sessionOverride ? "attention" : ""}`,
        title: "Session-Clips stoppen und wieder das Arrangement abspielen",
        onclick: () => {
          app.engine.backToArrangement();
          this.update();
        },
      },
      "↩ Zurück zum Arrangement",
    );
    const toolbar = h(
      "div",
      { class: "arr-toolbar" },
      h(
        "button",
        { class: `btn rec ${app.arrRecording ? "on" : ""}`, title: "Session-Clips beim Starten in die Zeitleiste aufnehmen", onclick: () => app.toggleArrangementRecord() },
        "● Arrangement-Aufnahme",
      ),
      this.backBtn,
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "checkbox",
          checked: loop.enabled,
          onchange: () => {
            app.checkpoint();
            loop.enabled = !loop.enabled;
            app.changed();
          },
        }),
        "Loop",
      ),
      h("span", { class: "lbl" }, "Takt"),
      barInput(loop.start / BEATS_PER_BAR + 1, (bar) => this.setLoop((bar - 1) * BEATS_PER_BAR, Math.max(loop.end, bar * BEATS_PER_BAR)), "Loop-Start (Takt)"),
      h("span", { class: "lbl" }, "bis"),
      barInput(loop.end / BEATS_PER_BAR, (bar) => this.setLoop(Math.min(loop.start, (bar - 1) * BEATS_PER_BAR), bar * BEATS_PER_BAR), "Loop-Ende (Takt, einschließlich)"),
      h("span", { class: "spacer" }),
      h("span", { class: "lbl" }, "Zoom"),
      select(String(this.ppb), ZOOMS.map((z) => ({ value: String(z), label: `${Math.round((z / 16) * 100)}%` })), (v) => {
        this.ppb = Number(v);
        this.render(host);
      }),
    );

    // ---------------------------------------------------------- ruler
    const ruler = h("div", { class: "arr-ruler", style: { width: `${width}px` } });
    for (let bar = 0; bar * BEATS_PER_BAR < totalBeats; bar++) {
      const every = this.ppb * BEATS_PER_BAR < 40 ? 4 : 1;
      if (bar % every === 0) ruler.append(h("span", { class: "bar-num", style: { left: `${bar * BEATS_PER_BAR * this.ppb}px` } }, String(bar + 1)));
    }
    const loopEl = h("div", {
      class: `loop-region ${loop.enabled ? "on" : ""}`,
      style: { left: `${loop.start * this.ppb}px`, width: `${(loop.end - loop.start) * this.ppb}px` },
    });
    const startMarker = h("div", { class: "start-marker", style: { left: `${app.engine.playStart * this.ppb}px` } });
    ruler.append(loopEl, startMarker);
    this.attachRuler(ruler, loopEl, startMarker);

    // ---------------------------------------------------------- lanes
    const headers = h("div", { class: "arr-headers", style: { width: `${HEADER_W}px` } }, h("div", { class: "arr-corner" }));
    const lanes = h("div", { class: "arr-lanes", style: { width: `${width}px` } }, ruler);
    lanes.style.setProperty("--bar-w", `${BEATS_PER_BAR * this.ppb}px`);
    lanes.style.setProperty("--beat-w", `${this.ppb}px`);

    p.tracks.forEach((tr, ti) => {
      const following = app.engine.followArrangement[ti] !== false;
      headers.append(
        h(
          "div",
          {
            class: `arr-track-head ${ti === app.selection.track ? "selected" : ""} ${following ? "" : "overridden"}`,
            style: { height: `${LANE_H}px`, borderLeftColor: tr.color },
            title: following ? "" : "Spielt gerade einen Session-Clip",
            onclick: () => app.selectArrangementClip(ti, null),
          },
          h("span", { class: "name" }, tr.name),
          h("span", { class: "hint" }, tr.instrument === "drums" ? "Drums" : "Synth"),
        ),
      );

      const lane = h("div", { class: "arr-lane", style: { height: `${LANE_H}px` }, "data-track": ti });
      lane.addEventListener("dblclick", (e) => {
        if (e.target !== lane) return;
        app.createArrangementClip(ti, this.snap(this.beatAt(e, lane), BEATS_PER_BAR, "floor"));
      });
      lane.addEventListener("pointerdown", (e) => {
        if (e.target === lane) app.selectArrangementClip(ti, null);
      });
      lane.addEventListener("dragover", (e) => {
        if (e.dataTransfer?.types.includes(CLIP_DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          lane.classList.add("drop");
        }
      });
      lane.addEventListener("dragleave", () => lane.classList.remove("drop"));
      lane.addEventListener("drop", (e) => {
        lane.classList.remove("drop");
        const raw = e.dataTransfer?.getData(CLIP_DRAG_TYPE);
        if (!raw) return;
        e.preventDefault();
        const src = JSON.parse(raw) as { track: number; scene: number };
        app.placeOnArrangement(ti, src, this.snap(this.beatAt(e, lane), BEATS_PER_BAR, "floor"));
      });

      tr.arrangement.forEach((ac, ai) => lane.append(this.renderClip(ti, ai, ac, tr.color)));
      lanes.append(lane);
    });

    this.playhead = h("div", { class: "arr-playhead" });
    lanes.append(this.playhead);

    const empty = p.tracks.every((t) => t.arrangement.length === 0)
      ? h("div", { class: "arr-empty" }, "Zieh Clips aus der Session-Ansicht hierher, doppelklicke in eine Spur oder nimm einen Session-Jam mit ● Arrangement-Aufnahme auf.")
      : null;

    this.scroller = h("div", { class: "arr-scroll" }, h("div", { class: "arr-inner" }, headers, lanes));
    host.replaceChildren(toolbar, this.scroller, empty ?? "");
    if (prevScroll) {
      this.scroller.scrollLeft = prevScroll.left;
      this.scroller.scrollTop = prevScroll.top;
    }
    this.update();
  }

  private renderClip(ti: number, ai: number, ac: ArrangementClip, color: string): HTMLElement {
    const app = this.app;
    const selected = app.selection.track === ti && app.selection.arr === ai;
    const canvas = h("canvas", { class: "arr-notes" });
    const el = h(
      "div",
      {
        class: `arr-clip ${selected ? "selected" : ""}`,
        style: { left: `${ac.start * this.ppb}px`, width: `${Math.max(4, ac.length * this.ppb)}px`, "--clip-color": color },
        title: `${ac.clip.name} · ${fmtLen(ac.length)}`,
      },
      h("span", { class: "arr-clip-name" }, ac.clip.name),
      canvas,
      h("div", { class: "resize", title: "Länge ändern" }),
    );
    this.clipEls.set(ac, el);
    requestAnimationFrame(() => drawNotes(canvas, ac, this.ppb, color));
    this.attachClipDrag(el, ti, ac);
    return el;
  }

  /** Per-frame update: playhead, start marker, growing recorded clips. */
  update() {
    const app = this.app;
    if (this.playhead) {
      const beat = app.engine.timelineBeat;
      this.playhead.style.transform = `translateX(${beat * this.ppb}px)`;
      this.playhead.classList.toggle("running", app.engine.playing);
      // Keep the playhead in view while playing.
      if (app.engine.playing && this.scroller) {
        const x = beat * this.ppb;
        const view = this.scroller.clientWidth - HEADER_W;
        const left = this.scroller.scrollLeft;
        if (x > left + view - 40 || x < left) this.scroller.scrollLeft = Math.max(0, x - 40);
      }
    }
    this.backBtn?.classList.toggle("attention", app.engine.sessionOverride);
    if (app.arrRecording) {
      for (const tr of app.project.tracks) {
        for (const ac of tr.arrangement) {
          const el = this.clipEls.get(ac);
          if (el) el.style.width = `${Math.max(4, ac.length * this.ppb)}px`;
        }
      }
      // Recording can add clips: re-render when the set changed.
      const count = app.project.tracks.reduce((n, t) => n + t.arrangement.length, 0);
      if (count !== this.clipEls.size && this.scroller?.parentElement) this.render(this.scroller.parentElement);
    }
    if (app.engine.timelineBeat * this.ppb > this.lastWidth - 200 && this.scroller?.parentElement) {
      this.render(this.scroller.parentElement);
    }
  }

  private setLoop(start: number, end: number) {
    const loop = this.app.project.loop;
    this.app.checkpoint();
    loop.start = Math.max(0, start);
    loop.end = Math.max(loop.start + BEATS_PER_BAR, end);
    loop.enabled = true;
    this.app.changed();
  }

  private beatAt(e: MouseEvent, el: HTMLElement): number {
    return Math.max(0, (e.clientX - el.getBoundingClientRect().left) / this.ppb);
  }

  private snap(beat: number, grid = 1, mode: "round" | "floor" = "round"): number {
    const f = mode === "floor" ? Math.floor : Math.round;
    return Math.max(0, f(beat / grid) * grid);
  }

  private attachRuler(ruler: HTMLElement, loopEl: HTMLElement, startMarker: HTMLElement) {
    ruler.addEventListener("pointerdown", (e) => {
      const app = this.app;
      const startBeat = this.snap(this.beatAt(e, ruler), BEATS_PER_BAR, "floor");
      let dragged = false;
      let endBeat = startBeat + BEATS_PER_BAR;
      ruler.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        const b = this.snap(this.beatAt(ev, ruler), BEATS_PER_BAR, "round");
        if (Math.abs(b - startBeat) < BEATS_PER_BAR && !dragged) return;
        dragged = true;
        endBeat = b;
        const lo = Math.min(startBeat, endBeat);
        const hi = Math.max(startBeat + BEATS_PER_BAR, endBeat);
        loopEl.classList.add("on");
        loopEl.style.left = `${lo * this.ppb}px`;
        loopEl.style.width = `${(hi - lo) * this.ppb}px`;
      };
      const up = () => {
        ruler.removeEventListener("pointermove", move);
        ruler.removeEventListener("pointerup", up);
        if (dragged) {
          this.setLoop(Math.min(startBeat, endBeat), Math.max(startBeat + BEATS_PER_BAR, endBeat));
        } else {
          app.engine.setPlayStart(startBeat);
          startMarker.style.left = `${app.engine.playStart * this.ppb}px`;
          this.update();
        }
      };
      ruler.addEventListener("pointermove", move);
      ruler.addEventListener("pointerup", up);
    });
  }

  private attachClipDrag(el: HTMLElement, trackIndex: number, ac: ArrangementClip) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const app = this.app;
      const resizing = (e.target as HTMLElement).classList.contains("resize");
      const originX = e.clientX;
      const originY = e.clientY;
      const orig = { start: ac.start, length: ac.length };
      let targetTrack = trackIndex;
      let changed = false;
      el.setPointerCapture(e.pointerId);
      // Select right away so the editor shows the clip.
      const idx = app.project.tracks[trackIndex].arrangement.indexOf(ac);
      if (app.selection.track !== trackIndex || app.selection.arr !== idx) {
        app.selection = { ...app.selection, track: trackIndex, arr: idx };
        app.refreshPanels();
        this.clipEls.forEach((c) => c.classList.toggle("selected", c === el));
      }

      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - originX) / this.ppb;
        const dy = ev.clientY - originY;
        if (!changed && Math.abs(ev.clientX - originX) < 4 && Math.abs(dy) < 4) return;
        if (!changed) app.checkpoint();
        changed = true;
        const grid = ev.altKey ? 0.25 : 1;
        if (resizing) {
          ac.length = Math.max(grid, this.snap(orig.length + dx, grid));
          el.style.width = `${ac.length * this.ppb}px`;
        } else {
          ac.start = this.snap(orig.start + dx, grid);
          el.style.left = `${ac.start * this.ppb}px`;
          targetTrack = Math.min(app.project.tracks.length - 1, Math.max(0, trackIndex + Math.round(dy / LANE_H)));
          el.style.transform = `translateY(${(targetTrack - trackIndex) * LANE_H}px)`;
        }
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        if (!changed) return;
        const tracks = app.project.tracks;
        if (targetTrack !== trackIndex) {
          tracks[trackIndex].arrangement = tracks[trackIndex].arrangement.filter((a) => a !== ac);
          tracks[targetTrack].arrangement.push(ac);
        }
        const list = tracks[targetTrack].arrangement;
        trimOverlaps(list, ac);
        list.sort((a, b) => a.start - b.start);
        app.selection = { ...app.selection, track: targetTrack, arr: list.indexOf(ac) };
        app.changed();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }
}

/** Mini piano-roll preview inside an arrangement clip. */
function drawNotes(canvas: HTMLCanvasElement, ac: ArrangementClip, ppb: number, color: string) {
  const w = Math.max(1, Math.round(ac.length * ppb));
  const hgt = LANE_H - 22;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  const clip: Clip = ac.clip;
  if (!clip.notes.length || clip.length <= 0) return;
  const pitches = clip.notes.map((n) => n.pitch);
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  const rows = Math.max(1, hi - lo + 1);
  const rowH = Math.max(1.5, Math.min(4, hgt / rows));
  ctx.fillStyle = color;
  const offset = ac.offset ?? 0;
  for (let loopStart = -offset; loopStart < ac.length; loopStart += clip.length) {
    for (const n of clip.notes) {
      const x0 = loopStart + n.start;
      if (x0 + n.length <= 0 || x0 >= ac.length) continue;
      const x = Math.max(0, x0) * ppb;
      const ww = Math.max(1, (Math.min(ac.length, x0 + n.length) - Math.max(0, x0)) * ppb - 1);
      const y = hgt - ((n.pitch - lo + 1) / rows) * (hgt - rowH) - rowH / 2;
      ctx.globalAlpha = 0.4 + 0.6 * n.velocity * (n.probability ?? 1);
      ctx.fillRect(x, y, ww, rowH);
    }
  }
}

function fmtLen(beats: number): string {
  const bars = Math.floor(beats / BEATS_PER_BAR + 1e-9);
  const rest = Math.round((beats - bars * BEATS_PER_BAR) * 100) / 100;
  const barText = `${bars} Takt${bars === 1 ? "" : "e"}`;
  if (!rest) return barText;
  const restText = `${rest} Schl${rest === 1 ? "ag" : "äge"}`;
  return bars ? `${barText} + ${restText}` : restText;
}

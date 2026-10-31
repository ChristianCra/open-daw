// Main-thread side of stem separation: downloads and caches the model,
// resamples audio to 44.1 kHz stereo and talks to the worker.

import type { WorkerRequest, WorkerResponse } from "./stems.worker";
import { STEM_NAMES, STEM_SAMPLE_RATE, type StemName } from "./stems";

/** HT-Demucs v4 (Meta, MIT license), exported to ONNX with fp16 weights (~166 MB). */
export const MODEL_URL = "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx";
const CACHE_NAME = "open-daw-models";

export interface SeparationProgress {
  stage: "download" | "init" | "separate";
  /** 0..1, or -1 when unknown */
  fraction: number;
  detail: string;
}

export interface Stem {
  name: StemName;
  channels: Float32Array[];
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

/** True when the model is already in the browser's cache. */
export async function modelCached(url = MODEL_URL): Promise<boolean> {
  try {
    return !!(await (await caches.open(CACHE_NAME)).match(url));
  } catch {
    return false;
  }
}

/** Downloads the model once and keeps it in the Cache API. */
export async function loadModel(onProgress: (p: SeparationProgress) => void, signal?: AbortSignal, url = MODEL_URL): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) {
      onProgress({ stage: "download", fraction: 1, detail: "Modell aus dem Cache" });
      return await hit.arrayBuffer();
    }
  } catch {
    cache = null; // Cache API unavailable (e.g. private mode): download every time
  }
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Modell-Download fehlgeschlagen (HTTP ${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.length;
    onProgress({ stage: "download", fraction: total ? received / total : -1, detail: `Modell laden: ${mb(received)}${total ? ` von ${mb(total)}` : ""}` });
  }
  const data = new Uint8Array(received);
  let o = 0;
  for (const p of parts) {
    data.set(p, o);
    o += p.length;
  }
  if (cache) await cache.put(url, new Response(data, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return data.buffer;
}

/** Removes the cached model (frees ~166 MB). */
export async function clearModelCache(): Promise<void> {
  await caches.delete(CACHE_NAME).catch(() => false);
}

/** Converts any AudioBuffer to 44.1 kHz stereo (the model's format). */
export async function toModelFormat(buf: AudioBuffer): Promise<[Float32Array, Float32Array]> {
  const frames = Math.ceil(buf.duration * STEM_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, Math.max(1, frames), STEM_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Mono is spread to both channels by the up-mix rules of the destination.
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

/** Owns the worker; the loaded model stays in it for further separations. */
export class StemSeparator {
  private worker: Worker | null = null;
  private ready: Promise<string> | null = null;
  backend = "";

  /** Source of the model: the default URL, or a file the user picked. */
  modelSource: string | File = MODEL_URL;

  private spawn(): Worker {
    return new Worker(new URL("./stems.worker.ts", import.meta.url), { type: "module" });
  }

  private request(msg: WorkerRequest, transfer: Transferable[], onProgress?: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<WorkerResponse> {
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.dispose();
        reject(new DOMException("Abgebrochen", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === "progress") {
          onProgress?.({ stage: "separate", fraction: m.done / m.total, detail: `Trennen: Abschnitt ${Math.min(m.done + 1, m.total)} von ${m.total}` });
          return;
        }
        signal?.removeEventListener("abort", abort);
        if (m.type === "error") reject(new Error(m.message));
        else resolve(m);
      };
      worker.onerror = (e) => {
        signal?.removeEventListener("abort", abort);
        reject(new Error(e.message || "Fehler im Worker"));
      };
      worker.postMessage(msg, transfer);
    });
  }

  private async init(onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<string> {
    const model = typeof this.modelSource === "string" ? await loadModel(onProgress, signal, this.modelSource) : await this.modelSource.arrayBuffer();
    onProgress({ stage: "init", fraction: -1, detail: "Modell starten …" });
    this.worker = this.spawn();
    const res = await this.request({ type: "init", model, useGpu: true }, [model], undefined, signal);
    if (res.type !== "ready") throw new Error("Unerwartete Antwort");
    this.backend = res.backend;
    return res.backend;
  }

  /** Separates a buffer into drums, bass, other and vocals (44.1 kHz stereo). */
  async separate(buf: AudioBuffer, onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<Stem[]> {
    if (!this.ready) {
      this.ready = this.init(onProgress, signal);
      this.ready.catch(() => this.dispose());
    }
    await this.ready;
    const [left, right] = await toModelFormat(buf);
    onProgress({ stage: "separate", fraction: 0, detail: "Trennen …" });
    const res = await this.request({ type: "run", left, right }, [left.buffer, right.buffer], onProgress, signal);
    if (res.type !== "result") throw new Error("Unerwartete Antwort");
    return res.stems.map((channels, i) => ({ name: STEM_NAMES[i], channels }));
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}

// Main-thread side of stem separation: downloads and caches the model,
// resamples audio to 44.1 kHz stereo and talks to the worker.

import type { Backend, WorkerRequest, WorkerResponse } from "./stems.worker";
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

/** "45 s", "3 min", "1 h 5 min" */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
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
  if (total && received !== total) throw new Error(`Modell-Download unvollständig (${mb(received)} von ${mb(total)})`);
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

const BACKEND_LABEL: Record<Backend, string> = { webgpu: "WebGPU", wasm: "WebAssembly" };
const GPU_BROKEN_KEY = "open-daw.stems.webgpu-broken.v2";

function gpuBroken(): boolean {
  try {
    return localStorage.getItem(GPU_BROKEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markGpuBroken() {
  try {
    localStorage.setItem(GPU_BROKEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Error with the details of every backend that was tried. */
export class SeparationError extends Error {
  constructor(
    message: string,
    readonly details: string[],
  ) {
    super(message);
    this.name = "SeparationError";
  }
}

/**
 * Owns the worker; the loaded model stays in it for further separations.
 * WebGPU is tried first. If it fails while starting or while separating, a
 * fresh worker retries with WebAssembly, and WebGPU is skipped from then on.
 */
export class StemSeparator {
  private worker: Worker | null = null;
  private ready: Promise<string> | null = null;
  backend = "";
  private current: Backend | null = null;

  /** Source of the model: the default URL, or a file the user picked. */
  modelSource: string | File = MODEL_URL;

  private spawn(): Worker {
    return new Worker(new URL("./stems.worker.ts", import.meta.url), { type: "module" });
  }

  private request(msg: WorkerRequest, transfer: Transferable[], onProgress?: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<WorkerResponse> {
    const worker = this.worker!;
    let started = performance.now();
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.dispose();
        reject(new DOMException("Abgebrochen", "AbortError"));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === "progress") {
          if (m.done === 0) started = performance.now();
          const left = m.done > 0 && m.done < m.total ? ((performance.now() - started) / m.done) * (m.total - m.done) : 0;
          const eta = left ? `, noch etwa ${formatDuration(left / 1000)}` : "";
          onProgress?.({ stage: "separate", fraction: m.done / m.total, detail: `Trennen: Abschnitt ${Math.min(m.done + 1, m.total)} von ${m.total}${eta}` });
          return;
        }
        signal?.removeEventListener("abort", abort);
        if (m.type === "error") reject(new Error(m.message));
        else resolve(m);
      };
      worker.onerror = (e) => {
        e.preventDefault();
        signal?.removeEventListener("abort", abort);
        reject(new Error(e.message || "Der Worker ist abgestürzt (evtl. zu wenig Arbeitsspeicher)"));
      };
      worker.postMessage(msg, transfer);
    });
  }

  private async loadBytes(onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<ArrayBuffer> {
    return typeof this.modelSource === "string" ? await loadModel(onProgress, signal, this.modelSource) : await this.modelSource.arrayBuffer();
  }

  private async init(onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<string> {
    const backends: Backend[] = gpuBroken() ? ["wasm"] : ["webgpu", "wasm"];
    const errors: string[] = [];
    for (const backend of backends) {
      // The model buffer is handed over to the worker, so load it per attempt (a cache hit after the first).
      const model = await this.loadBytes(onProgress, signal);
      onProgress({ stage: "init", fraction: -1, detail: `Modell starten (${BACKEND_LABEL[backend]}) …` });
      this.worker = this.spawn();
      try {
        const res = await this.request({ type: "init", model, backend }, [model], undefined, signal);
        if (res.type !== "ready") throw new Error("Unerwartete Antwort");
        this.backend = res.backend;
        this.current = backend;
        return res.backend;
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        console.warn(`[stems] ${BACKEND_LABEL[backend]} konnte nicht starten:`, err);
        const message = (err as Error).message;
        errors.push(`${BACKEND_LABEL[backend]} (Start): ${message}`);
        if (backend === "webgpu" && !message.startsWith("Keine WebGPU")) markGpuBroken();
        this.worker?.terminate();
        this.worker = null;
      }
    }
    // A broken download would fail again forever, so fetch it fresh next time.
    if (typeof this.modelSource === "string") await clearModelCache();
    throw new SeparationError("Das Modell konnte nicht gestartet werden.", errors);
  }

  /** Separates a buffer into drums, bass, other and vocals (44.1 kHz stereo). */
  async separate(buf: AudioBuffer, onProgress: (p: SeparationProgress) => void, signal?: AbortSignal): Promise<Stem[]> {
    const [left, right] = await toModelFormat(buf);
    const errors: string[] = [];
    for (;;) {
      if (!this.ready) {
        this.ready = this.init(onProgress, signal);
        this.ready.catch(() => this.dispose());
      }
      try {
        await this.ready;
      } catch (err) {
        if (err instanceof SeparationError) throw new SeparationError(err.message, [...errors, ...err.details]);
        throw err;
      }
      onProgress({ stage: "separate", fraction: 0, detail: "Trennen …" });
      try {
        // Copies (no transfer), so a retry on another backend still has the audio.
        const res = await this.request({ type: "run", left, right }, [], onProgress, signal);
        if (res.type !== "result") throw new Error("Unerwartete Antwort");
        return res.stems.map((channels, i) => ({ name: STEM_NAMES[i], channels }));
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        const backend = this.current;
        console.warn(`[stems] Trennen mit ${backend} fehlgeschlagen:`, err);
        errors.push(`${backend ? BACKEND_LABEL[backend] : "?"} (Trennen): ${(err as Error).message}`);
        this.dispose();
        if (backend !== "webgpu") throw new SeparationError("Die Trennung ist fehlgeschlagen.", errors);
        markGpuBroken(); // retry once with WebAssembly
      }
    }
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.current = null;
    this.backend = "";
  }
}

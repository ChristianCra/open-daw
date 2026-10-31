// Runs the stem separation model off the main thread with ONNX Runtime Web.
// Each worker runs one backend (WebGPU or WebAssembly). When ONNX Runtime
// hits a fatal error ("Aborted()") its WebAssembly module is dead for good, so
// the main thread falls back by starting a fresh worker. WebAssembly runs
// single-threaded: ORT's thread pool would spawn workers from this bundled
// worker script, which doesn't work, and static hosting can't enable the
// cross-origin isolation threads need anyway.

import * as ort from "onnxruntime-web/webgpu";
import { chunkInput, OverlapAdd, planChunks, SEGMENT, STEM_NAMES } from "./stems";

export type WorkerRequest =
  | { type: "init"; model: ArrayBuffer; backend: Backend }
  | { type: "run"; left: Float32Array; right: Float32Array };

export type Backend = "webgpu" | "wasm";

export type WorkerResponse =
  | { type: "ready"; backend: string }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; stems: Float32Array[][] }
  | { type: "error"; message: string };

let session: ort.InferenceSession | null = null;

// Graph optimizations must stay off: on HT-Demucs, ORT's constant folding
// runs out of WebAssembly memory (4 GB) and dies with "Aborted()" or
// std::bad_alloc. Without them the session starts and runs normally.
const SESSION_OPTIONS = { graphOptimizationLevel: "disabled" } as const;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

async function createSession(model: ArrayBuffer, backend: Backend): Promise<string> {
  ort.env.wasm.numThreads = 1;
  if (backend === "webgpu") {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
    if (!adapter) throw new Error("Keine WebGPU-Grafikkarte verfügbar");
    session = await ort.InferenceSession.create(new Uint8Array(model), { ...SESSION_OPTIONS, executionProviders: ["webgpu"] });
    return "WebGPU";
  }
  session = await ort.InferenceSession.create(new Uint8Array(model), { ...SESSION_OPTIONS, executionProviders: ["wasm"] });
  return "WebAssembly";
}

async function separate(left: Float32Array, right: Float32Array) {
  if (!session) throw new Error("Modell nicht geladen");
  const input = session.inputNames[0] ?? "mix";
  const output = session.outputNames[0] ?? "stems";
  const starts = planChunks(left.length);
  const acc = new OverlapAdd(left.length, STEM_NAMES.length);
  for (let i = 0; i < starts.length; i++) {
    post({ type: "progress", done: i, total: starts.length });
    const feeds = { [input]: new ort.Tensor("float32", chunkInput(left, right, starts[i]), [1, 2, SEGMENT]) };
    const res = await session.run(feeds);
    const data = (await res[output].getData()) as Float32Array;
    acc.add(data, starts[i]);
    res[output].dispose();
  }
  post({ type: "progress", done: starts.length, total: starts.length });
  return acc.finish();
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const msg = e.data;
    if (msg.type === "init") {
      const backend = await createSession(msg.model, msg.backend);
      post({ type: "ready", backend });
    } else if (msg.type === "run") {
      const stems = await separate(msg.left, msg.right);
      post({ type: "result", stems }, stems.flat().map((c) => c.buffer));
    }
  } catch (err) {
    console.error("[stems worker]", err);
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

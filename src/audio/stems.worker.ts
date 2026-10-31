// Runs the stem separation model off the main thread with ONNX Runtime Web.
// WebGPU is used when available, otherwise WebAssembly. WebAssembly runs
// single-threaded: ORT's thread pool would spawn workers from this bundled
// worker script, which doesn't work, and static hosting can't enable the
// cross-origin isolation threads need anyway.

import * as ort from "onnxruntime-web/webgpu";
import { chunkInput, OverlapAdd, planChunks, SEGMENT, STEM_NAMES } from "./stems";

export type WorkerRequest =
  | { type: "init"; model: ArrayBuffer; useGpu: boolean }
  | { type: "run"; left: Float32Array; right: Float32Array };

export type WorkerResponse =
  | { type: "ready"; backend: string }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; stems: Float32Array[][] }
  | { type: "error"; message: string };

let session: ort.InferenceSession | null = null;
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

async function createSession(model: ArrayBuffer, useGpu: boolean): Promise<string> {
  ort.env.wasm.numThreads = 1;
  const gpu = useGpu && "gpu" in navigator && !!(await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  if (gpu) {
    try {
      session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["webgpu"] });
      return "WebGPU";
    } catch {
      /* fall back to WebAssembly */
    }
  }
  session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
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
      const backend = await createSession(msg.model, msg.useGpu);
      post({ type: "ready", backend });
    } else if (msg.type === "run") {
      const stems = await separate(msg.left, msg.right);
      post({ type: "result", stems }, stems.flat().map((c) => c.buffer));
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};

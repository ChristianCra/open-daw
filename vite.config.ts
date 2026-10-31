import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  // The stem separation worker imports ONNX Runtime Web as an ES module; its
  // WebAssembly runtime is emitted as an asset next to the worker.
  worker: { format: "es" },
  test: { environment: "node" },
});

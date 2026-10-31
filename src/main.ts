import "./styles.css";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
new App(root);

// Offline support / "Install app" in Chrome and Edge.
// The desktop build (Tauri) ships its files locally, so it needs no service worker.
const isDesktop = "__TAURI_INTERNALS__" in window;
if ("serviceWorker" in navigator && import.meta.env.PROD && !isDesktop) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker registration failed", err));
  });
}

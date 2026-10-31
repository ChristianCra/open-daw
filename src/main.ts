import "./styles.css";
import { App } from "./ui/app";

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
new App(root);

// Offline support / "Install app" in Chrome and Edge.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker registration failed", err));
  });
}

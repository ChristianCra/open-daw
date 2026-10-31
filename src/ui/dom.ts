// Tiny DOM helper: h("div", { class: "x", onclick: fn }, child1, "text").

type Attrs = Record<string, unknown>;
type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2), v as EventListener);
    } else if (k === "style" && typeof v === "object") {
      for (const [prop, val] of Object.entries(v as Record<string, string>)) {
        if (prop.startsWith("--")) el.style.setProperty(prop, val);
        else (el.style as unknown as Record<string, string>)[prop] = val;
      }
    } else if (k in el && k !== "list") {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

/** Labelled range input with a live value read-out. */
export function slider(o: SliderOpts): HTMLElement {
  const fmt = o.format ?? ((v: number) => String(Math.round(v * 100) / 100));
  const out = h("output", {}, fmt(o.value));
  const input = h("input", {
    type: "range",
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    oninput: () => {
      const v = Number(input.value);
      out.textContent = fmt(v);
      o.onInput(v);
    },
  });
  return h("label", { class: "slider" }, h("span", {}, o.label), input, out);
}

export function select<T extends string>(value: T, options: { value: T; label: string }[], onChange: (v: T) => void, title?: string): HTMLSelectElement {
  const el = h("select", { title, onchange: () => onChange(el.value as T) }, ...options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label)));
  return el;
}

export function download(filename: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = h("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

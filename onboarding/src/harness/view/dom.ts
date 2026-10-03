// Tiny DOM helpers for the harness: no framework, just elements.

export type Child = Node | string | number | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** Create an element. `on*` attributes that are functions become listeners; false/null attributes are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") {
      el.addEventListener(key.replace(/^on/, "").toLowerCase(), value);
    } else if (key === "class") {
      el.className = String(value);
    } else if (key === "value" && "value" in el) {
      (el as unknown as { value: string }).value = String(value);
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

/** Replace an element's children. */
export function mount(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

/** Inline SVG from markup (icons are static strings, never user text). */
export function svg(markup: string, cls = ""): SVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  const el = tpl.content.firstElementChild as SVGElement;
  if (cls) el.setAttribute("class", cls);
  el.setAttribute("aria-hidden", "true");
  return el;
}

const STROKE = `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;

export const ICONS = {
  visual: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  auditory: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
  kinesthetic: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/></svg>`,
  other: `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" ${STROKE} stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
} as const;

export type SenseKey = "visual" | "auditory" | "kinesthetic" | "other";

export const SENSE_LABEL: Record<SenseKey, string> = {
  visual: "Picture",
  auditory: "Sound",
  kinesthetic: "Feeling",
  other: "Other",
};

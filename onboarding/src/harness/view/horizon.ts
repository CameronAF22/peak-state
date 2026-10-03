// The horizon (D-onboarding-021, from the design prototype design/horizon/): a soft band of white light low on the
// screen that rises and brightens as the state builds. Each step is a labelled point of light on the horizon, left to
// right, with its sense glyph above and the person's words below; the anchor has a ring. During playback a light
// sweeps from point to point and the band swells on the anchor. The DOM lives in harness/index.html.

import type { StepView } from "../../types.ts";
import { h, ICONS, mount, SENSE_LABEL, svg } from "./dom.ts";

export type HorizonMood = "calm" | "playing" | "swell";

export interface HorizonModel {
  title: string;
  chain: string;
  steps: StepView[];
  fullyInAt: number | null;
  /** Step lit (playback, practice recall); null for none. */
  activeStep: number | null;
}

let mood: HorizonMood = "calm";
let last: { root: HTMLElement; model: HorizonModel } | null = null;

/** Horizontal position (percent of width) of point i of n: centred, spreading as the chain grows. */
export function pointX(i: number, n: number): number {
  if (n <= 1) return 50;
  const narrow = globalThis.innerWidth < 640;
  const span = narrow ? 72 : 56;
  const gap = Math.min(narrow ? 26 : 15, span / (n - 1));
  return 50 + (i - (n - 1) / 2) * gap;
}

/** 0..1: how far the state has built, from the steps and details captured so far. */
export function levelFor(steps: StepView[], fullyInAt: number | null): number {
  let filled = 0;
  for (const s of steps) {
    const total = s.checklist.length || 1;
    const done = s.checklist.filter((c) => c.value !== null && c.value !== "").length;
    filled += 0.6 + 0.4 * (done / total);
  }
  return Math.min(1, 0.2 + 0.68 * Math.min(1, filled / 4) + (fullyInAt !== null ? 0.12 : 0));
}

function setLevel(level: number, boost: number): void {
  const root = document.documentElement;
  root.style.setProperty("--rise", Math.max(0, Math.min(1, level)).toFixed(3));
  root.style.setProperty("--glow", Math.max(0, Math.min(1, level)).toFixed(3));
  root.style.setProperty("--boost", String(boost));
}

/** Playback and practice set the mood; elicitation and the saved screen are calm. */
export function setHorizonMood(next: HorizonMood): void {
  mood = next;
  document.body.dataset.mood = next;
  if (last) renderHorizon(last.root, last.model);
}

function detailsLine(s: StepView): string {
  return s.checklist
    .filter((c) => c.value !== null && c.value !== "")
    .map((c) => (c.words?.trim() ? c.words : typeof c.value === "number" ? `${c.value}/10` : String(c.value).replace(/-/g, " ")))
    .join(" · ");
}

interface Parts {
  title: HTMLElement;
  list: HTMLOListElement;
  chain: HTMLElement;
  items: Map<number, HTMLLIElement>;
}
const parts = new WeakMap<HTMLElement, Parts>();

function partsOf(root: HTMLElement): Parts {
  let p = parts.get(root);
  if (!p) {
    const title = h("h2", { class: "visually-hidden" }, "Your strategy");
    const list = h("ol", { class: "points", "data-testid": "step-chain" });
    const chain = h("p", { class: "chain", "data-testid": "chain", title: "Your steps in order" });
    root.replaceChildren(title, list, chain);
    p = { title, list, chain, items: new Map() };
    parts.set(root, p);
    addEventListener("resize", () => {
      if (last?.root === root) renderHorizon(root, last.model);
    });
  }
  return p;
}

/** Render the steps as points on the horizon. Keyed by step, so points glide rather than rebuild. */
export function renderHorizon(root: HTMLElement, m: HorizonModel): void {
  last = { root, model: m };
  const p = partsOf(root);
  p.title.textContent = m.title;
  p.chain.textContent = m.chain;
  const n = m.steps.length;
  root.dataset.count = String(n);

  for (const [i, li] of p.items) {
    if (i >= n) {
      li.remove();
      p.items.delete(i);
    }
  }
  m.steps.forEach((s, i) => {
    let li = p.items.get(i);
    if (!li) {
      li = h("li", { class: "pt born", "data-testid": "step", "data-index": i });
      li.style.left = `${pointX(Math.max(0, n - 1), n)}%`;
      p.list.append(li);
      p.items.set(i, li);
      const el = li;
      setTimeout(() => el.classList.remove("born"), 1700);
    }
    const sense = SENSE_LABEL[s.modality];
    const details = detailsLine(s);
    const key = `${s.modality}|${s.direction}|${s.content}|${s.isAnchor}|${m.fullyInAt === i}|${details}`;
    if (li.dataset.key !== key) {
      li.dataset.key = key;
      mount(
        li,
        h("span", { class: "visually-hidden" }, `Step ${i + 1}, ${sense.toLowerCase()}${s.isAnchor ? ", your anchor" : ""}${m.fullyInAt === i ? ", fully in" : ""}: `),
        h("span", { class: "pt-sense", title: sense }, svg(ICONS[s.modality])),
        h("span", { class: "pt-dot", "aria-hidden": "true" }),
        h("span", { class: "pt-words" }, s.content),
        details ? h("span", { class: "visually-hidden" }, ` (${details})`) : null,
      );
      li.title = `${i + 1} · ${sense}${s.isAnchor ? " · anchor" : ""}\n${s.content}${details ? `\n${details}` : ""}`;
    }
    li.dataset.modality = s.modality;
    li.dataset.anchor = s.isAnchor ? "true" : "false";
    li.dataset.full = m.fullyInAt === i ? "true" : "false";
    li.dataset.active = m.activeStep === i ? "true" : "false";
    if (m.activeStep === i) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });
  // New points appear where they land; the next frame lets the rest glide to make room.
  requestAnimationFrame(() => {
    for (const [i, li] of p.items) li.style.left = `${pointX(i, n)}%`;
  });

  const sweep = document.getElementById("sweep");
  if (sweep) {
    const on = m.activeStep !== null && m.activeStep < n && mood !== "calm";
    if (on) sweep.style.left = `${pointX(m.activeStep as number, n)}%`;
    sweep.dataset.on = on ? "true" : "false";
  }

  if (mood === "swell") setLevel(1, 1);
  else if (mood === "playing") setLevel(m.activeStep === null ? 0.3 : 0.35 + 0.55 * ((m.activeStep + 1) / Math.max(1, n)), 0);
  else setLevel(levelFor(m.steps, m.fullyInAt), 0);
}

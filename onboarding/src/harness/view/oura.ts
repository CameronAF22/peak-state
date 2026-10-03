// A small mocked Oura Ring widget for the demo (D-onboarding-029): heart rate and HRV play a scripted sequence on a
// loop (baseline, rising at rest, trigger, guided session, recovered) so the room can see how a ring signal would
// start the state change. The numbers are simulated, built on the synthetic lab's baseline (62 bpm, 52 ms HRV,
// test/synthetic_lab), and the widget says so. It reads no device and changes nothing in the session.
// It starts minimized as a small ring icon; tapping it opens the card and tapping the card's header minimizes it.
// The choice is remembered in this browser only.

import { h } from "./dom.ts";

type Stage = "baseline" | "rising" | "trigger" | "guiding" | "recovered";

interface Sample {
  hr: number;
  hrv: number;
  stage: Stage;
}

const STAGES: { id: Stage; label: string }[] = [
  { id: "baseline", label: "Baseline" },
  { id: "rising", label: "Rising" },
  { id: "trigger", label: "Trigger" },
  { id: "guiding", label: "Guiding" },
  { id: "recovered", label: "Recovered" },
];

const STATUS: Record<Stage, (s: Sample) => string> = {
  baseline: (s) => `Resting · ${s.hr} bpm, HRV ${s.hrv} ms`,
  rising: (s) => `Heart rate rising at rest · HRV ${s.hrv} ms`,
  trigger: (s) => `Trigger · ${s.hr} bpm at rest, HRV ${s.hrv} ms · Content strategy ready`,
  guiding: (s) => `Running your strategy · ${s.hr} bpm and settling`,
  recovered: (s) => `Back near baseline · ${s.hr} bpm, HRV ${s.hrv} ms`,
};

/** The scripted sequence: one sample per tick, about 30 seconds a loop. Deterministic, so every loop looks the same. */
export function ouraSequence(): Sample[] {
  const out: Sample[] = [];
  const wobble = (i: number) => Math.round(Math.sin(i * 1.7) * 1.4);
  for (let i = 0; i < 9; i++) out.push({ hr: 62 + wobble(i), hrv: 52 - (i % 3), stage: "baseline" });
  for (let i = 0; i < 8; i++) out.push({ hr: 65 + Math.round(i * 3.2) + wobble(i), hrv: 48 - i * 2, stage: "rising" });
  for (let i = 0; i < 4; i++) out.push({ hr: 89 + (i % 2), hrv: 31, stage: "trigger" });
  for (let i = 0; i < 11; i++) out.push({ hr: 87 - Math.round(i * 1.9) + wobble(i), hrv: 33 + i, stage: "guiding" });
  for (let i = 0; i < 8; i++) out.push({ hr: 65 + wobble(i), hrv: 48 + (i % 2), stage: "recovered" });
  return out;
}

const TICK_MS = 750;
const OPEN_KEY = "peak-state.harness.oura-open";

function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveOpen(open: boolean): void {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* storage blocked: open for this page only */
  }
}
const WINDOW = 24; // samples shown in the sparkline

function sparkPath(points: number[], w: number, ht: number, lo: number, hi: number): string {
  if (points.length === 0) return "";
  const step = w / (WINDOW - 1);
  const x0 = w - (points.length - 1) * step;
  return points
    .map((v, i) => {
      const y = ht - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ht;
      return `${i === 0 ? "M" : "L"}${(x0 + i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function createOuraWidget(): HTMLElement {
  const seq = ouraSequence();
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 120 32");
  svg.setAttribute("class", "oura-spark");
  svg.setAttribute("aria-hidden", "true");
  const threshold = document.createElementNS(svgNs, "line");
  threshold.setAttribute("class", "oura-threshold");
  const line = document.createElementNS(svgNs, "path");
  line.setAttribute("class", "oura-line");
  const dot = document.createElementNS(svgNs, "circle");
  dot.setAttribute("class", "oura-dot");
  dot.setAttribute("r", "2.2");
  svg.append(threshold, line, dot);

  const hr = h("span", { class: "oura-hr", "data-testid": "oura-hr" }, "62");
  const status = h("p", { class: "oura-status", "data-testid": "oura-status", role: "status", "aria-live": "off" }, "");
  const chips = STAGES.map((s) => h("li", { class: "oura-chip", "data-stage": s.id }, s.label));
  const icon = h(
    "button",
    { class: "oura-icon", type: "button", "data-testid": "oura-open", "aria-label": "Show the Oura Ring trigger (simulated)", title: "Oura Ring (simulated)" },
    h("span", { class: "oura-ring", "aria-hidden": "true" }),
  );
  const head = h(
    "button",
    { class: "oura-head", type: "button", "data-testid": "oura-close", "aria-label": "Minimize the Oura Ring card", title: "Minimize" },
    h("span", { class: "oura-ring", "aria-hidden": "true" }),
    h("span", { class: "oura-title" }, "Oura Ring"),
    h("span", { class: "oura-mock" }, "simulated"),
    h("span", { class: "oura-min", "aria-hidden": "true" }, "–"),
  );
  const card = h(
    "div",
    { class: "oura-card", id: "oura-card" },
    head,
    h("div", { class: "oura-body" }, h("div", { class: "oura-read" }, hr, h("span", { class: "oura-unit" }, "bpm")), svg),
    h("ol", { class: "oura-chips" }, ...chips),
    status,
  );
  const el = h(
    "aside",
    { class: "oura", "data-testid": "oura-widget", "data-stage": "baseline", "aria-label": "Oura Ring heart rate trigger, simulated" },
    icon,
    card,
  );
  const setOpen = (open: boolean): void => {
    el.dataset.open = open ? "true" : "false";
    icon.setAttribute("aria-expanded", open ? "true" : "false");
    icon.hidden = open;
    card.hidden = !open;
    saveOpen(open);
  };
  icon.addEventListener("click", () => {
    setOpen(true);
    head.focus();
  });
  head.addEventListener("click", () => {
    setOpen(false);
    icon.focus();
  });
  setOpen(loadOpen());

  const lo = 55;
  const hi = 95;
  const trigY = 32 - ((84 - lo) / (hi - lo)) * 32; // the trigger line: 84 bpm at rest
  threshold.setAttribute("x1", "0");
  threshold.setAttribute("x2", "120");
  threshold.setAttribute("y1", trigY.toFixed(1));
  threshold.setAttribute("y2", trigY.toFixed(1));

  let i = 0;
  const shown: number[] = [];
  const tick = (): void => {
    const s = seq[i % seq.length]!;
    if (i % seq.length === 0) shown.length = 0;
    shown.push(s.hr);
    if (shown.length > WINDOW) shown.shift();
    line.setAttribute("d", sparkPath(shown, 120, 32, lo, hi));
    const lastY = 32 - ((Math.min(hi, Math.max(lo, s.hr)) - lo) / (hi - lo)) * 32;
    dot.setAttribute("cx", "120");
    dot.setAttribute("cy", lastY.toFixed(1));
    hr.textContent = String(s.hr);
    status.textContent = STATUS[s.stage](s);
    el.dataset.stage = s.stage;
    const at = STAGES.findIndex((x) => x.id === s.stage);
    chips.forEach((c, k) => {
      c.classList.toggle("on", k === at);
      c.classList.toggle("done", k < at);
    });
    i++;
  };
  tick();
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Reduced motion: still steps through the sequence, just without the pulse animations (CSS), at a calmer pace.
  setInterval(tick, reduce ? TICK_MS * 2 : TICK_MS);
  return el;
}

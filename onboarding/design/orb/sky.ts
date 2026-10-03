// The orb and its satellites: one breathing light, and one small point of light per captured step,
// settled in a quiet arc over the orb. The orb brightens as the chain grows and pulses once per step in playback.

import { h, ICONS, mount, SENSE_LABEL, svg } from "../../src/harness/view/dom.ts";
import type { StepView } from "../../src/types.ts";

export type Mood = "listening" | "rest" | "saved" | "running";

export interface SkyModel {
  steps: StepView[];
  /** Step lit during playback, or the step a question is about. */
  active: number | null;
  /** Steps already played in this run. */
  done?: number;
  mood: Mood;
}

export interface Sky {
  render(m: SkyModel): void;
  /** One pulse of the orb; `full` for the anchor's fuller glow. */
  pulse(full?: boolean): void;
  onFocusStep(cb: (step: StepView | null) => void): void;
}

/** Arc angles in degrees (270 = straight up), centred over the orb, read left to right. */
export function arcAngles(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [270];
  const span = Math.min(40, 150 / (n - 1));
  const start = 270 - ((n - 1) * span) / 2;
  return Array.from({ length: n }, (_, i) => start + i * span);
}

export function stepTitle(s: StepView): string {
  return `${s.index + 1} · ${SENSE_LABEL[s.modality]}${s.isAnchor ? " · anchor" : ""}: ${s.content}`;
}

export function createSky(root: HTMLElement): Sky {
  const halo = h("div", { class: "halo" });
  const core = h("div", { class: "core" });
  const orb = h("div", { class: "orb", "data-testid": "orb" }, halo, core);
  const ring = h("div", { class: "satellites", role: "list", "aria-label": "Your steps" });
  const drift = h("div", { class: "drift" }, orb, ring);
  mount(root, drift);

  let focusCb: (s: StepView | null) => void = () => {};
  let last: StepView[] = [];

  return {
    render(m) {
      last = m.steps;
      const level = Math.min(1, m.steps.length / 4);
      root.style.setProperty("--level", level.toFixed(3));
      root.dataset.mood = m.mood;
      orb.dataset.steps = String(m.steps.length);
      if (m.mood !== "running") orb.classList.remove("pulse", "pulse-full");
      const angles = arcAngles(m.steps.length);
      const existing = new Map<string, HTMLElement>();
      for (const el of Array.from(ring.children) as HTMLElement[]) existing.set(el.dataset.index ?? "", el);
      const els = m.steps.map((s, i) => {
        let el = existing.get(String(s.index));
        if (!el) {
          el = h(
            "button",
            {
              class: "sat",
              type: "button",
              role: "listitem",
              "data-testid": "satellite",
              "data-index": s.index,
              style: `--a:${angles[i]}deg`,
              onpointerenter: () => focusCb(last[s.index] ?? null),
              onpointerleave: () => focusCb(null),
              onfocus: () => focusCb(last[s.index] ?? null),
              onblur: () => focusCb(null),
            },
            h("span", { class: "dot" }),
            h("span", { class: "glyph" }, svg(ICONS[s.modality])),
          );
          el.classList.add("arriving");
          const born = el;
          requestAnimationFrame(() => requestAnimationFrame(() => born.classList.remove("arriving")));
        }
        el.style.setProperty("--a", `${angles[i]}deg`);
        el.dataset.modality = s.modality;
        el.dataset.anchor = s.isAnchor ? "true" : "false";
        el.dataset.active = m.active === s.index ? "true" : "false";
        el.dataset.played = m.done !== undefined && i < m.done ? "true" : "false";
        el.setAttribute("aria-label", stepTitle(s));
        el.title = stepTitle(s);
        return el;
      });
      ring.replaceChildren(...els);
    },
    pulse(full = false) {
      orb.classList.remove("pulse", "pulse-full");
      void orb.offsetWidth; // restart the animation
      orb.classList.add(full ? "pulse-full" : "pulse");
    },
    onFocusStep(cb) {
      focusCb = cb;
    },
  };
}

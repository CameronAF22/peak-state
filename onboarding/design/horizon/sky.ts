// The horizon: a soft band of light low on the screen. It rises and brightens as the state builds,
// carries one point of light per captured step (left to right), and during playback a sweep of light
// travels from point to point. Purely presentational: it is told what to show by main.ts.

import type { StepView } from "../../src/types.ts";
import { h, ICONS, SENSE_LABEL, svg } from "../../src/harness/view/dom.ts";

export type SkyMood = "calm" | "playing" | "swell" | "stopped";

export interface PointsModel {
  steps: StepView[];
  fullyInAt: number | null;
  /** Step lit during playback (or hovered as a choice); null for none. */
  activeStep: number | null;
}

export interface Sky {
  /** 0..1: how far the state has built. Raises and brightens the band. */
  setLevel(level: number): void;
  setMood(mood: SkyMood): void;
  setPoints(m: PointsModel): void;
  /** Move the sweeping light to a step's point; null fades it out. */
  sweepTo(stepIndex: number | null): void;
}

/** Horizontal position (percent of width) of point i of n: centred, spreading out as the chain grows. */
export function pointX(i: number, n: number): number {
  if (n <= 1) return 50;
  const narrow = globalThis.innerWidth < 640;
  const span = narrow ? 70 : 56;
  const gap = Math.min(narrow ? 24 : 15, span / (n - 1));
  return 50 + (i - (n - 1) / 2) * gap;
}

export function createSky(): Sky {
  const root = document.documentElement;
  const pointsEl = document.getElementById("points") as HTMLOListElement;
  const sweep = document.getElementById("sweep") as HTMLElement;
  const items = new Map<number, HTMLLIElement>();
  let count = 0;
  let sweepIndex: number | null = null;

  const placeSweep = (): void => {
    if (sweepIndex === null || sweepIndex >= count) {
      sweep.dataset.on = "false";
      return;
    }
    sweep.style.left = `${pointX(sweepIndex, count)}%`;
    sweep.dataset.on = "true";
  };

  const layout = (): void => {
    for (const [i, li] of items) li.style.left = `${pointX(i, count)}%`;
    placeSweep();
  };
  addEventListener("resize", layout);

  return {
    setLevel(level) {
      const l = Math.max(0, Math.min(1, level));
      root.style.setProperty("--rise", l.toFixed(3));
      root.style.setProperty("--glow", l.toFixed(3));
    },
    setMood(mood) {
      document.body.dataset.mood = mood;
    },
    setPoints(m) {
      count = m.steps.length;
      for (const [i, li] of items) {
        if (i >= count) {
          li.remove();
          items.delete(i);
        }
      }
      m.steps.forEach((s, i) => {
        let li = items.get(i);
        const fresh = !li;
        if (!li) {
          li = h("li", { class: "pt born", "data-testid": "step", "data-index": i });
          li.style.left = `${pointX(Math.max(0, count - 1), count)}%`;
          pointsEl.append(li);
          items.set(i, li);
          const el = li;
          setTimeout(() => el.classList.remove("born"), 1600);
        }
        const sense = SENSE_LABEL[s.modality];
        const key = `${s.modality}|${s.content}|${s.isAnchor}|${m.fullyInAt === i}`;
        if (li.dataset.key !== key) {
          li.dataset.key = key;
          li.replaceChildren(
            h("span", { class: "sr-only" }, `Step ${i + 1}, ${sense.toLowerCase()}${s.isAnchor ? ", your anchor" : ""}: `),
            h("span", { class: "pt-sense", title: sense }, svg(ICONS[s.modality])),
            h("span", { class: "pt-dot", "aria-hidden": "true" }),
            h("span", { class: "pt-words" }, s.content),
          );
          li.title = `${i + 1} · ${sense}${s.isAnchor ? " · anchor" : ""}\n${s.content}`;
        }
        li.dataset.modality = s.modality;
        li.dataset.anchor = s.isAnchor ? "true" : "false";
        li.dataset.full = m.fullyInAt === i ? "true" : "false";
        li.dataset.active = m.activeStep === i ? "true" : "false";
        if (fresh) {
          // Let the new point appear where it lands, then let the others slide to make room.
          requestAnimationFrame(() => requestAnimationFrame(layout));
        }
      });
      layout();
    },
    sweepTo(stepIndex) {
      sweepIndex = stepIndex;
      placeSweep();
    },
  };
}

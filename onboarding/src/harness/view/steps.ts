// "Your strategy": the chain notation and one card per step, filling in as the person answers.

import { chain as chainOf, getState, SUBMODALITIES, type ProfileV2, type StateId } from "@peak-state/contracts";
import type { StepView } from "../../types.ts";
import { h, ICONS, mount, SENSE_LABEL, svg, type SenseKey } from "./dom.ts";

const ATTRIBUTE_LABEL: Record<string, Record<string, string>> = {
  visual: { location: "Where it is", size: "Size", distance: "How close", brightness: "Brightness", perspective: "Own eyes or watching" },
  auditory: { source: "Whose voice", volume: "How loud", location: "Where from" },
  kinesthetic: { bodyLocation: "Where in the body", intensity: "How strong", movement: "Moving or still" },
};

/** Step cards for a saved profile, shaped like the engine's live StepView. */
export function stepViewsFromProfile(profile: ProfileV2, stateId: StateId): StepView[] {
  const state = getState(profile, stateId);
  if (!state) return [];
  return state.strategy.steps.map((step, index) => {
    const checklist: StepView["checklist"] = [];
    if (step.modality !== "other") {
      const core = (step.submodalities.core ?? {}) as Record<string, string | number | undefined>;
      const words = step.submodalities.words ?? {};
      for (const attribute of Object.keys(SUBMODALITIES[step.modality].core)) {
        checklist.push({
          attribute,
          label: ATTRIBUTE_LABEL[step.modality]?.[attribute] ?? attribute,
          value: core[attribute] ?? null,
          words: words[attribute],
        });
      }
    }
    return { index, modality: step.modality, direction: step.direction, content: step.content, checklist, isAnchor: state.anchorStep === index };
  });
}

export function chainFromProfile(profile: ProfileV2, stateId: StateId): string {
  const state = getState(profile, stateId);
  return state ? chainOf(state) : "";
}

function humanize(v: string | number): string {
  return typeof v === "number" ? `${v}/10` : v.replace(/-/g, " ");
}

export function senseHead(modality: SenseKey, direction?: "external" | "internal"): HTMLElement {
  const where = direction ? (direction === "external" ? " · outside" : " · inside") : "";
  return h("span", { class: "sense" }, svg(ICONS[modality]), `${SENSE_LABEL[modality]}${where}`);
}

export interface StepsModel {
  title: string;
  chain: string;
  steps: StepView[];
  fullyInAt: number | null;
  /** Step index glowing during playback; null for none. */
  activeStep: number | null;
}

export function renderSteps(root: HTMLElement, m: StepsModel): void {
  const cards = m.steps.map((s) =>
    h(
      "li",
      {
        class: "step",
        "data-testid": "step",
        "data-index": s.index,
        "data-modality": s.modality,
        "data-anchor": s.isAnchor ? "true" : "false",
        "data-active": m.activeStep === s.index ? "true" : "false",
      },
      h(
        "div",
        { class: "step-head" },
        h("span", { class: "step-num" }, `${s.index + 1}`),
        senseHead(s.modality, s.direction),
        h(
          "span",
          { class: "badges" },
          m.fullyInAt === s.index ? h("span", { class: "badge full" }, "Fully in") : null,
          s.isAnchor ? h("span", { class: "badge anchor", "data-testid": "anchor-badge" }, "⚓ Anchor") : null,
        ),
      ),
      h("p", { class: "step-words" }, s.content),
      s.checklist.length
        ? h(
            "ul",
            { class: "checklist", "aria-label": "Core details" },
            s.checklist.map((c) => {
              const done = c.value !== null && c.value !== undefined && c.value !== "";
              const shown = c.words?.trim() ? c.words : done ? humanize(c.value as string | number) : "";
              return h(
                "li",
                { class: done ? "done" : "", "data-testid": "check", "data-attribute": c.attribute, "data-done": done ? "true" : "false" },
                h("span", { class: "tick", "aria-hidden": "true" }, done ? "✓" : "○"),
                h("span", { class: "lbl" }, c.label),
                h("span", { class: "val" }, shown),
              );
            }),
          )
        : null,
    ),
  );

  mount(
    root,
    h(
      "div",
      { class: "card", "data-testid": "step-chain" },
      h("h2", { class: "card-title" }, m.title),
      h("div", { class: "chain", "data-testid": "chain" }, m.chain),
      cards.length ? h("ol", { class: "steps" }, cards) : h("p", { class: "empty" }, "Your steps appear here as you answer: what you see, hear and feel, in your order."),
    ),
  );
}

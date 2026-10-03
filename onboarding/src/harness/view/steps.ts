// "Your strategy": the chain notation and one point of light per step on the horizon, filling in as the person answers.

import { chain as chainOf, getState, SUBMODALITIES, type ProfileV2, type StateId } from "@peak-state/contracts";
import type { StepView } from "../../types.ts";
import { h, ICONS, SENSE_LABEL, svg, type SenseKey } from "./dom.ts";
import { renderHorizon } from "./horizon.ts";

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

export function senseHead(modality: SenseKey, direction?: "external" | "internal"): HTMLElement {
  const where = direction ? (direction === "external" ? " · outside" : " · inside") : "";
  return h("span", { class: "sense" }, svg(ICONS[modality]), `${SENSE_LABEL[modality]}${where}`);
}

export interface StepsModel {
  title: string;
  chain: string;
  steps: StepView[];
  fullyInAt: number | null;
  /** Step glowing during playback (or recalled in practice); null for none. */
  activeStep: number | null;
}

/** The steps, as labelled points of light along the horizon (src/harness/view/horizon.ts). */
export function renderSteps(root: HTMLElement, m: StepsModel): void {
  renderHorizon(root, m);
}

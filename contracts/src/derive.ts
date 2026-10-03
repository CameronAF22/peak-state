// Views derived from a state. Never stored (D-coord-012, D-contracts-008).

import type { Difference, ProfileV2, SensoryModality, State, StateId, Step } from "./profile.ts";

export type TriadSlot = "physiology" | "focus" | "language";

/**
 * The physiology / focus / language view of a strategy, steps kept in the person's order.
 * Feeling steps are physiology, picture steps and external sounds are focus, internal sounds (self-talk) are language.
 * Steps of modality "other" are left out.
 */
export function triad(state: State): Record<TriadSlot, { stepIndex: number; step: Step }[]> {
  const out: Record<TriadSlot, { stepIndex: number; step: Step }[]> = { physiology: [], focus: [], language: [] };
  state.strategy.steps.forEach((step, stepIndex) => {
    const slot = triadSlot(step);
    if (slot) out[slot].push({ stepIndex, step });
  });
  return out;
}

export function triadSlot(step: Step): TriadSlot | null {
  switch (step.modality) {
    case "kinesthetic":
      return "physiology";
    case "visual":
      return "focus";
    case "auditory":
      return step.direction === "internal" ? "language" : "focus";
    default:
      return null;
  }
}

const LETTER: Record<Step["modality"], string> = { visual: "V", auditory: "A", kinesthetic: "K", other: "O" };

/** The playbook notation, for example "Ve → Ai → Ki". */
export function chain(state: State): string {
  return state.strategy.steps.map((s) => LETTER[s.modality] + (s.direction === "external" ? "e" : "i")).join(" → ");
}

export interface Driver {
  differenceIndex: number;
  stepIndex: number;
  modality: SensoryModality;
  attribute: string;
  peakValue: string | number;
  contrastValue: string | number;
  ratingDelta: number | null;
}

function toDriver(d: Difference, differenceIndex: number): Driver {
  return {
    differenceIndex,
    stepIndex: d.stepIndex,
    modality: d.modality,
    attribute: d.attribute,
    peakValue: d.peak,
    contrastValue: d.contrast,
    ratingDelta: d.ratingDelta,
  };
}

/** The state's drivers resolved from their difference indexes, in stored order (largest ratingDelta first). */
export function drivers(state: State): Driver[] {
  return state.drivers.flatMap((i) => (state.differences[i] ? [toDriver(state.differences[i], i)] : []));
}

/** The drivers that belong to one strategy step: what reps speak as instructions for that step (D-reps-005). */
export function driversForStep(state: State, stepIndex: number): Driver[] {
  return drivers(state).filter((d) => d.stepIndex === stepIndex);
}

/** The steps a full rep replays: from the first up to and including fullyInAt (all steps when it is null). */
export function repSteps(state: State): number[] {
  const last = state.strategy.fullyInAt ?? state.strategy.steps.length - 1;
  return state.strategy.steps.slice(0, last + 1).map((_, i) => i);
}

export function getState(profile: ProfileV2, stateId: StateId): State | undefined {
  return profile.states.find((s) => s.id === stateId);
}

export function isDraft(profile: ProfileV2): boolean {
  return profile.confirmedAt === null;
}

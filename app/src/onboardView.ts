// What the Onboard screen shows, rebuilt from contracts OnboardingEvents by a pure reducer.
// The same reducer renders the engine's live run and the recorded script.
import type { CalibrationPhase, Difference, OnboardingEvent, ProfileV2, Step } from "./contracts";

export interface Turn {
  who: "guide" | "user";
  text: string;
  section?: string;
  final: boolean;
}

export interface OnboardView {
  turns: Turn[];
  label: string | null;
  words: string | null;
  steps: Step[];
  activeIndex: number | null;
  anchorStep: number | null;
  contrastLabel: string | null;
  /** Sparse, by difference index. */
  differences: (Difference | undefined)[];
  drivers: number[];
  test: { before: number; after: number } | null;
  calibrated: CalibrationPhase[];
  confirmed: ProfileV2 | null;
  stopped: "safety" | "cancel" | "error" | null;
}

export const EMPTY_VIEW: OnboardView = {
  turns: [],
  label: null,
  words: null,
  steps: [],
  activeIndex: null,
  anchorStep: null,
  contrastLabel: null,
  differences: [],
  drivers: [],
  test: null,
  calibrated: [],
  confirmed: null,
  stopped: null,
};

export function reduce(v: OnboardView, e: OnboardingEvent): OnboardView {
  switch (e.type) {
    case "guideTurn":
      return { ...v, turns: [...v.turns, { who: "guide", text: e.text, section: e.section, final: true }] };
    case "userTurn": {
      const turns = [...v.turns];
      const last = turns[turns.length - 1];
      if (last && last.who === "user" && !last.final) turns[turns.length - 1] = { who: "user", text: e.text, final: e.final };
      else turns.push({ who: "user", text: e.text, final: e.final });
      return { ...v, turns };
    }
    case "stateNamed":
      return { ...v, label: e.label, words: e.words };
    case "stepCaptured": {
      const steps = [...v.steps];
      steps[e.stepIndex] = e.step;
      return { ...v, steps, activeIndex: e.stepIndex };
    }
    case "submodalityCaptured": {
      if (e.target !== "peak" || e.stepIndex === undefined) return v;
      const s = v.steps[e.stepIndex];
      if (!s) return v;
      const steps = [...v.steps];
      const sub = s.submodalities as { core?: Record<string, string | number> };
      steps[e.stepIndex] = { ...s, submodalities: { ...sub, core: { ...(sub.core ?? {}), [e.attribute]: e.value } } } as Step;
      return { ...v, steps, activeIndex: e.stepIndex };
    }
    case "anchorStepMarked":
      return { ...v, anchorStep: e.stepIndex };
    case "calibrationCaptured":
      return { ...v, calibrated: [...v.calibrated, e.summary.phase] };
    case "contrastCaptured":
      return { ...v, contrastLabel: e.label };
    case "driverFound": {
      const differences = [...v.differences];
      differences[e.differenceIndex] = e.difference;
      return { ...v, differences, drivers: [...v.drivers, e.differenceIndex] };
    }
    case "testRated":
      return { ...v, test: { before: e.before, after: e.after } };
    case "confirmed":
      return { ...v, confirmed: e.profile, activeIndex: null };
    case "stopped":
      return { ...v, stopped: e.reason };
  }
}

// Onboarding events and result. Mirrors schemas/onboarding-event.schema.json (D-contracts-007, D-experience-005).

import type { Difference, ProfileV2, Rating, SensoryModality, StateId, Step } from "./profile.ts";
import type { CalibrationSummary } from "./signals.ts";

interface At {
  /** Milliseconds since the Unix epoch. */
  t: number;
}

export type OnboardingEvent =
  | (At & { type: "guideTurn"; text: string; section?: string })
  | (At & { type: "userTurn"; text: string; final: boolean; via: "voice" | "typed" | "script" })
  | (At & { type: "stateNamed"; stateId: StateId; label: string; words: string })
  | (At & { type: "stepCaptured"; stateId: StateId; stepIndex: number; step: Step; fullyIn?: boolean })
  | (At & {
      type: "submodalityCaptured";
      stateId: StateId;
      target: "peak" | "contrast";
      stepIndex?: number;
      modality: SensoryModality;
      attribute: string;
      value: string | number;
      words?: string;
    })
  | (At & { type: "anchorStepMarked"; stateId: StateId; stepIndex: number })
  | (At & { type: "calibrationCaptured"; stateId: StateId; summary: CalibrationSummary })
  | (At & { type: "contrastCaptured"; stateId: StateId; label: string; prefilled: boolean })
  | (At & { type: "driverFound"; stateId: StateId; differenceIndex: number; difference: Difference })
  | (At & { type: "testRated"; stateId: StateId; before: Rating; after: Rating })
  | (At & { type: "confirmed"; profile: ProfileV2 })
  | (At & { type: "stopped"; reason: "safety" | "cancel" | "error"; draft: ProfileV2 | null });

export type OnboardingEventType = OnboardingEvent["type"];

export type OnboardingResult =
  | { status: "confirmed"; profile: ProfileV2 }
  | { status: "stopped"; reason: "safety" | "cancel" | "error"; draft: ProfileV2 | null };

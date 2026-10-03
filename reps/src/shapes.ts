// Every shape reps reads or writes comes from @peak-state/contracts (D-contracts-007, D-reps-009).
// This file only re-exports them, plus aliases for single fields of RepSession. It declares no shape.

export type {
  Difference,
  ProfileV2,
  ProgressByState,
  Rating,
  RepSession,
  RepStep,
  RepStepKind,
  RepTrigger,
  SensoryModality,
  State,
  StateId,
  StateProgress,
  Step,
  TriggerKind,
} from "@peak-state/contracts";

import type { RepSession } from "@peak-state/contracts";

export type RepKind = RepSession["kind"];
export type Arm = RepSession["arm"];
export type SignalSource = RepSession["signalSource"];
export type EndedBy = RepSession["endedBy"];
export type OnboardingPhase = NonNullable<RepSession["phase"]>;

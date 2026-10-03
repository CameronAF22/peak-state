// Rep sessions and progress. Mirrors schemas/rep-session.schema.json (D-contracts-007, D-reps-005/006).

import type { IsoDateTime, Rating, StateId } from "./profile.ts";

export type RepStepKind = "rate" | "strategy-step" | "leverage" | "anchor-peak" | "anchor";

export interface RepStep {
  kind: RepStepKind;
  /** Index into strategy.steps. Required for strategy-step, anchor-peak and anchor. */
  stepIndex?: number;
  /** Indexes into the state's differences spoken in this step. */
  driversSpoken?: number[];
  /** Null for untimed steps. */
  plannedMs: number | null;
  startedAt: IsoDateTime | null;
  endedAt: IsoDateTime | null;
  delivered: boolean;
}

export type TriggerKind = "detection" | "manual" | "practice" | "onboarding";

export interface RepTrigger {
  kind: TriggerKind;
  /** The DetectionEvent id. Required when kind is detection. */
  detectionId?: string;
}

export interface RepSession {
  schemaVersion: 1;
  id: string;
  profileId: string;
  stateId: StateId;
  repIndex: number;
  kind: "full" | "anchor-only";
  /** Set on reps logged from playbook section 4. */
  phase: "recode" | "test" | "future-pace" | null;
  trigger: RepTrigger;
  arm: "cue" | "sham";
  startedAt: IsoDateTime;
  endedAt: IsoDateTime | null;
  steps: RepStep[];
  intensityBefore: Rating | null;
  intensityAfter: Rating | null;
  recoverySeconds: number | null;
  recoveryCensored: boolean;
  anchorPaired: boolean;
  signalSource: "simulator" | "hr-strap" | "none";
  scriptHash: string;
  endedBy: "completed" | "skipped" | "user-stop" | "safety-stop" | "timeout";
}

/** What reps.progress() returns for one state. Computed from RepSessions, never stored. */
export interface StateProgress {
  stateId: StateId;
  reps: number;
  goodReps: number;
  /** Anchor-only passes in a row, counting back from the latest. */
  anchorOnlyStreak: number;
  /** D-reps-003: 5 good reps, then 2 anchor-only passes in a row. */
  installed: boolean;
  /** intensityAfter of each completed rep, oldest first. */
  intensityTrend: number[];
  recovery: {
    cue: { n: number; medianSeconds: number | null };
    sham: { n: number; medianSeconds: number | null };
  };
}

export type ProgressByState = Record<StateId, StateProgress>;

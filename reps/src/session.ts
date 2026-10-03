// RepSession logging. The recorder is driven by the runner (M2) or by tests:
// it turns a RepScript plus what actually happened into one RepSession.

import type { RepScript } from "./script.ts";
import { findState } from "./script.ts";
import type { Arm, EndedBy, ProfileV2, RepSession, RepStep, RepTrigger, SignalSource } from "./shapes.ts";

export type Clock = () => Date;
const systemClock: Clock = () => new Date();

export interface RecorderOptions {
  trigger: RepTrigger;
  /** From DetectionEvent.gate.sham (D-reps-004). Forced to "cue" unless the trigger is a detection. */
  arm?: Arm;
  repIndex: number;
  signalSource?: SignalSource;
  clock?: Clock;
  id?: string;
}

export class RecorderError extends Error {}

export interface RepRecorder {
  readonly arm: Arm;
  /** The steps this rep will play: every script step for a cue, only the ratings for a sham. */
  readonly plan: RepScript["steps"];
  stepStarted(planIndex: number): void;
  stepEnded(planIndex: number, delivered?: boolean): void;
  rateBefore(value: number | null): void;
  rateAfter(value: number | null): void;
  recovery(result: { recoverySeconds: number | null; censored: boolean; source?: SignalSource }): void;
  finish(endedBy: EndedBy): RepSession;
}

export function createRecorder(script: RepScript, options: RecorderOptions): RepRecorder {
  const clock = options.clock ?? systemClock;
  const arm: Arm = options.trigger.kind === "detection" ? (options.arm ?? "cue") : "cue";
  const plan = arm === "sham" ? script.steps.filter((s) => s.kind === "rate") : script.steps;
  const startedAt = clock().toISOString();
  const steps: RepStep[] = plan.map((s) => ({
    kind: s.kind,
    ...(s.strategyStepIndex !== undefined ? { strategyStepIndex: s.strategyStepIndex } : {}),
    ...(s.driverIndexes !== undefined ? { driverIndexes: [...s.driverIndexes] } : {}),
    plannedMs: s.plannedMs,
    startedAt: null,
    endedAt: null,
    delivered: false,
  }));
  let intensityBefore: number | null = null;
  let intensityAfter: number | null = null;
  let recoverySeconds: number | null = null;
  let recoveryCensored = false;
  let signalSource: SignalSource = options.signalSource ?? "none";
  let finished = false;

  const step = (i: number) => {
    if (finished) throw new RecorderError("rep already finished");
    const s = steps[i];
    if (!s) throw new RecorderError(`no step ${i} in this rep's plan`);
    return s;
  };

  return {
    arm,
    plan,
    stepStarted(i) {
      step(i).startedAt = clock().toISOString();
    },
    stepEnded(i, delivered = true) {
      const s = step(i);
      if (s.startedAt === null) s.startedAt = clock().toISOString();
      s.endedAt = clock().toISOString();
      s.delivered = delivered;
    },
    rateBefore(value) {
      intensityBefore = checkRating(value);
    },
    rateAfter(value) {
      intensityAfter = checkRating(value);
    },
    recovery(result) {
      recoverySeconds = result.recoverySeconds;
      recoveryCensored = result.censored;
      if (result.source) signalSource = result.source;
    },
    finish(endedBy) {
      if (finished) throw new RecorderError("rep already finished");
      finished = true;
      const peak = steps.find((s) => s.kind === "peak");
      return {
        schemaVersion: 1,
        id: options.id ?? newRepId(script.stateId, startedAt),
        profileId: script.profileId,
        stateId: script.stateId,
        repIndex: options.repIndex,
        kind: script.kind,
        trigger: { ...options.trigger },
        arm,
        startedAt,
        endedAt: clock().toISOString(),
        steps,
        intensityBefore,
        intensityAfter,
        recoverySeconds,
        recoveryCensored,
        anchorPaired: arm === "cue" && peak !== undefined && peak.delivered,
        signalSource,
        scriptHash: script.scriptHash,
        endedBy,
      };
    },
  };
}

function checkRating(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 10) throw new RecorderError(`rating must be an integer 0 to 10, got ${value}`);
  return value;
}

let counter = 0;
function newRepId(stateId: string, startedAt: string): string {
  counter = (counter + 1) % 1_000_000;
  return `rep_${stateId}_${startedAt.replace(/[^0-9]/g, "")}_${counter}`;
}

/** The next repIndex for a state: one more than the highest logged so far. */
export function nextRepIndex(sessions: readonly RepSession[], stateId: string): number {
  return sessions.filter((s) => s.stateId === stateId).reduce((max, s) => Math.max(max, s.repIndex), 0) + 1;
}

export type OnboardingPhase = "recode" | "test" | "future-pace";

/**
 * Onboarding's recode, test and future pace as the first reps (D-reps-006).
 * Each session id ends in its phase until contracts adds a phase field.
 * They carry no sensing, so they never enter the cue-vs-sham comparison.
 */
export function fromOnboarding(profile: ProfileV2, stateId: string): RepSession[] {
  const state = findState(profile, stateId);
  const at = profile.confirmedAt ?? profile.createdAt;
  const phases: { phase: OnboardingPhase; before: number | null; after: number | null; anchorPaired: boolean }[] = [];
  if (state.recode) phases.push({ phase: "recode", before: null, after: null, anchorPaired: false });
  if (state.test) phases.push({ phase: "test", before: state.test.before, after: state.test.after, anchorPaired: false });
  if (state.futurePace) phases.push({ phase: "future-pace", before: null, after: null, anchorPaired: state.anchorStep !== null });

  return phases.map((p, i) => ({
    schemaVersion: 1,
    id: `rep_${profile.profileId}_${state.id}_onboarding-${p.phase}`,
    profileId: profile.profileId,
    stateId: state.id,
    repIndex: i + 1,
    kind: "full",
    trigger: { kind: "onboarding" },
    arm: "cue",
    startedAt: at,
    endedAt: at,
    steps: [],
    intensityBefore: p.before,
    intensityAfter: p.after,
    recoverySeconds: null,
    recoveryCensored: false,
    anchorPaired: p.anchorPaired,
    signalSource: "none",
    scriptHash: `onboarding:${p.phase}`,
    endedBy: "completed",
  }));
}

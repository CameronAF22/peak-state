// RepSession logging. The recorder is driven by the runner (M2) or by tests:
// it turns a RepScript plus what actually happened into one contracts RepSession,
// which passes validateRepSession(session, profile).

import type { RepScript } from "./script.ts";
import { findState } from "./script.ts";
import type { Arm, EndedBy, OnboardingPhase, ProfileV2, RepSession, RepStep, RepTrigger, SignalSource, StateId } from "./shapes.ts";

/** A Date factory, or the app's ModuleHost clock ({ now(): epoch ms }). */
export type Clock = (() => Date) | { now(): number };

function readClock(clock: Clock | undefined): () => string {
  if (!clock) return () => new Date().toISOString();
  if (typeof clock === "function") return () => clock().toISOString();
  return () => new Date(clock.now()).toISOString();
}

export interface RecorderOptions {
  trigger: RepTrigger;
  /** From DetectionEvent.gate.sham (D-reps-004). Forced to "cue" unless the trigger is a detection. */
  arm?: Arm;
  /** 0-based count of reps for this state (nextRepIndex). */
  repIndex: number;
  /** Set only on reps logged from playbook section 4 (D-reps-006). */
  phase?: OnboardingPhase | null;
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
  if (options.trigger.kind === "detection" && !options.trigger.detectionId) {
    throw new RecorderError("a detection trigger needs its detectionId");
  }
  if (!Number.isInteger(options.repIndex) || options.repIndex < 0) throw new RecorderError(`repIndex must be an integer >= 0, got ${options.repIndex}`);
  const now = readClock(options.clock);
  const arm: Arm = options.trigger.kind === "detection" ? (options.arm ?? "cue") : "cue";
  const plan = arm === "sham" ? script.steps.filter((s) => s.kind === "rate") : script.steps;
  const startedAt = now();
  const steps: RepStep[] = plan.map((s) => ({
    kind: s.kind,
    ...(s.stepIndex !== undefined ? { stepIndex: s.stepIndex } : {}),
    ...(s.driversSpoken !== undefined ? { driversSpoken: [...s.driversSpoken] } : {}),
    plannedMs: s.timed ? s.plannedMs : null,
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
      step(i).startedAt = now();
    },
    stepEnded(i, delivered = true) {
      const s = step(i);
      if (s.startedAt === null) s.startedAt = now();
      s.endedAt = now();
      s.delivered = delivered;
    },
    rateBefore(value) {
      intensityBefore = checkRating(value);
    },
    rateAfter(value) {
      intensityAfter = checkRating(value);
    },
    recovery(result) {
      if (result.recoverySeconds !== null && !(result.recoverySeconds >= 0)) {
        throw new RecorderError(`recoverySeconds must be >= 0 or null, got ${result.recoverySeconds}`);
      }
      recoverySeconds = result.recoverySeconds;
      recoveryCensored = result.censored;
      if (result.source) signalSource = result.source;
    },
    finish(endedBy) {
      if (finished) throw new RecorderError("rep already finished");
      finished = true;
      const peak = steps.find((s) => s.kind === "anchor-peak");
      return {
        schemaVersion: 1,
        id: options.id ?? newRepId(script.stateId, startedAt),
        profileId: script.profileId,
        stateId: script.stateId,
        repIndex: options.repIndex,
        kind: script.kind,
        phase: options.phase ?? null,
        trigger: { ...options.trigger },
        arm,
        startedAt,
        endedAt: now(),
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

/** The next repIndex for a state (0-based, as in the schema): one more than the highest logged so far, 0 for none. */
export function nextRepIndex(sessions: readonly RepSession[], stateId: StateId): number {
  return sessions.filter((s) => s.stateId === stateId).reduce((max, s) => Math.max(max, s.repIndex), -1) + 1;
}

export type { OnboardingPhase };

/**
 * Onboarding's recode, test and future pace as the first reps (D-reps-006), repIndex 0, 1, 2.
 * They carry no sensing, so they never enter the cue-vs-sham comparison.
 */
export function fromOnboarding(profile: ProfileV2, stateId: StateId): RepSession[] {
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
    repIndex: i,
    kind: "full",
    phase: p.phase,
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

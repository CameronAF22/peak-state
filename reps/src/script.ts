// Rep script generator (D-reps-005, D-reps-010).
// A full rep replays the person's own step chain in order, speaks the drivers
// that belong to each step, and pairs the anchor step at the peak.

import type { ProfileV2, RepKind, RepStepKind, State } from "./shapes.ts";
import {
  allCoreDetails,
  coreDetail,
  driverPhrase,
  peakLead,
  rateAfter,
  rateBefore,
  stepLead,
} from "./wording.ts";

export const TIMING = {
  minTotalMs: 20_000,
  maxTotalMs: 40_000,
  defaultTotalMs: 32_000,
  wordsPerSecond: 2.6,
  pauseMs: 1_000,
  repeatSilenceMs: 2_000,
  anchorOnlySilenceMs: 10_000,
  topDriverOnlyFromSteps: 5,
  roundMs: 100,
} as const;

export interface ScriptStep {
  kind: RepStepKind;
  text: string;
  /** Planned duration. 0 for untimed steps (the ratings wait for a tap). */
  plannedMs: number;
  /** Untimed steps sit outside the 20 to 40 s budget. */
  timed: boolean;
  strategyStepIndex?: number;
  driverIndexes?: number[];
}

export interface RepScript {
  profileId: string;
  stateId: string;
  kind: RepKind;
  steps: ScriptStep[];
  /** Sum of plannedMs over timed steps. */
  totalMs: number;
  scriptHash: string;
}

export interface ScriptOptions {
  /** Target for the timed steps of a full rep, clamped to 20 to 40 s. */
  targetMs?: number;
}

export class ScriptError extends Error {}

export function findState(profile: ProfileV2, stateId: string): State {
  if (profile.confirmedAt === null) throw new ScriptError("profile is a draft (confirmedAt is null)");
  const state = profile.states.find((s) => s.id === stateId);
  if (!state) throw new ScriptError(`no state '${stateId}' in profile ${profile.profileId}`);
  const n = state.strategy.steps.length;
  if (n === 0) throw new ScriptError(`state '${stateId}' has no strategy steps`);
  if (!Number.isInteger(state.strategy.fullyInAt) || state.strategy.fullyInAt < 0 || state.strategy.fullyInAt >= n) {
    throw new ScriptError(`state '${stateId}': fullyInAt ${state.strategy.fullyInAt} is not a step index`);
  }
  if (state.anchorStep !== null && (state.anchorStep < 0 || state.anchorStep >= n)) {
    throw new ScriptError(`state '${stateId}': anchorStep ${state.anchorStep} is not a step index`);
  }
  return state;
}

/** Drivers (indexes into differences) whose modality matches the step, in drivers order. */
export function driversForStep(state: State, stepIndex: number): number[] {
  const step = state.strategy.steps[stepIndex];
  return state.drivers.filter((d) => state.differences[d]?.modality === step.modality);
}

export function speechMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil((words / TIMING.wordsPerSecond) * 1000);
}

interface Draft extends Omit<ScriptStep, "plannedMs"> {
  floorMs: number;
}

function strategyStepDraft(state: State, i: number, topDriverOnly: boolean): Draft {
  const step = state.strategy.steps[i];
  let drivers = driversForStep(state, i);
  if (topDriverOnly) drivers = drivers.slice(0, 1);
  const details = drivers.length > 0 ? drivers.map((d) => driverPhrase(state.differences[d])) : [coreDetail(step)].filter((x): x is string => x !== null);
  const text = [stepLead(step), ...details].join(" ");
  const repeat = step.modality === "auditory" && step.direction === "internal" ? TIMING.repeatSilenceMs : 0;
  return {
    kind: "strategy-step",
    text,
    timed: true,
    strategyStepIndex: i,
    ...(drivers.length > 0 ? { driverIndexes: drivers } : {}),
    floorMs: speechMs(text) + TIMING.pauseMs + repeat,
  };
}

function anchorText(state: State, anchor: number): { text: string; drivers: number[] } {
  const step = state.strategy.steps[anchor];
  const drivers = driversForStep(state, anchor);
  const details = drivers.length > 0 ? drivers.map((d) => driverPhrase(state.differences[d])) : allCoreDetails(step);
  return { text: [stepLead(step), ...details].join(" "), drivers };
}

function fullDrafts(state: State, topDriverOnly: boolean): Draft[] {
  const drafts: Draft[] = [];
  for (let i = 0; i <= state.strategy.fullyInAt; i++) drafts.push(strategyStepDraft(state, i, topDriverOnly));
  if (state.leverage && state.leverage.trim()) {
    const text = state.leverage.trim().replace(/([^.!?])$/, "$1.");
    drafts.push({ kind: "leverage", text, timed: true, floorMs: speechMs(text) + TIMING.pauseMs });
  }
  if (state.anchorStep !== null) {
    const { text: body, drivers } = anchorText(state, state.anchorStep);
    const text = `${peakLead} ${body}`;
    drafts.push({
      kind: "peak",
      text,
      timed: true,
      strategyStepIndex: state.anchorStep,
      ...(drivers.length > 0 ? { driverIndexes: drivers } : {}),
      floorMs: speechMs(text) + TIMING.pauseMs,
    });
  }
  return drafts;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Share `totalMs` across drafts in proportion to their floors, rounded, summing exactly to totalMs. */
function allocate(drafts: Draft[], totalMs: number): number[] {
  const floors = drafts.map((d) => roundUp(d.floorMs));
  const floorSum = sum(floors);
  const r = TIMING.roundMs;
  const out = floors.map((f) => Math.floor(((f / floorSum) * totalMs) / r) * r);
  out[out.length - 1] += totalMs - sum(out);
  return out;
}

function untimed(kind: RepStepKind, text: string): ScriptStep {
  return { kind, text, plannedMs: 0, timed: false };
}

function finish(profile: ProfileV2, state: State, kind: RepKind, steps: ScriptStep[]): RepScript {
  const totalMs = sum(steps.filter((s) => s.timed).map((s) => s.plannedMs));
  return {
    profileId: profile.profileId,
    stateId: state.id,
    kind,
    steps,
    totalMs,
    scriptHash: hashScript(kind, steps),
  };
}

export function buildScript(profile: ProfileV2, stateId: string, kind: RepKind = "full", options: ScriptOptions = {}): RepScript {
  const state = findState(profile, stateId);
  const before = untimed("rate", rateBefore(state.label));
  const after = untimed("rate", rateAfter(state.label));

  if (kind === "anchor-only") {
    if (state.anchorStep === null) throw new ScriptError(`state '${stateId}' has no anchor step, so it has no anchor-only test`);
    const { text, drivers } = anchorText(state, state.anchorStep);
    const anchor: ScriptStep = {
      kind: "anchor",
      text,
      timed: true,
      strategyStepIndex: state.anchorStep,
      ...(drivers.length > 0 ? { driverIndexes: drivers } : {}),
      plannedMs: roundUp(speechMs(text) + TIMING.pauseMs) + TIMING.anchorOnlySilenceMs,
    };
    return finish(profile, state, kind, [before, anchor, after]);
  }

  const target = clamp(options.targetMs ?? TIMING.defaultTotalMs, TIMING.minTotalMs, TIMING.maxTotalMs);
  const longChain = state.strategy.fullyInAt + 1 >= TIMING.topDriverOnlyFromSteps;
  let drafts = fullDrafts(state, longChain);
  if (!longChain && sum(drafts.map((d) => d.floorMs)) > TIMING.maxTotalMs) drafts = fullDrafts(state, true);

  const floorSum = sum(drafts.map((d) => roundUp(d.floorMs)));
  const total = floorSum <= target ? target : Math.min(floorSum, TIMING.maxTotalMs);
  const planned = allocate(drafts, total);

  const timed: ScriptStep[] = drafts.map(({ floorMs: _floor, ...d }, i) => ({ ...d, plannedMs: planned[i] }));
  return finish(profile, state, kind, [before, ...timed, after]);
}

/** FNV-1a 32-bit over step kinds and texts: identifies the exact wording that ran. */
export function hashScript(kind: RepKind, steps: Pick<ScriptStep, "kind" | "text">[]): string {
  const input = JSON.stringify([kind, steps.map((s) => [s.kind, s.text])]);
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, "0")}`;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function roundUp(ms: number): number {
  return Math.ceil(ms / TIMING.roundMs) * TIMING.roundMs;
}

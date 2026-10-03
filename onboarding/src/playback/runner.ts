// One-click run of a saved strategy: rate, speak the person's steps in order ending on the anchor, rate again.
// Logged as a contracts RepSession (kind "full", trigger "practice", arm "cue") that validateRepSession accepts.

import { getState, type ProfileV2, type RepSession, type RepStep, type StateId } from "@peak-state/contracts";
import type { PlaybackCallbacks } from "../types.ts";
import { buildPlaybackLines, ratingPrompt, scriptHash } from "./script.ts";

export interface RunOptions {
  /** Silence after each spoken line, in ms. Default 1500. */
  pauseMs?: number;
  /** Milliseconds since epoch. Injected for deterministic tests. */
  now?: () => number;
  /** 0-based count of earlier runs for this state. Default 0. */
  repIndex?: number;
  /** Checked between lines; true ends the run with endedBy "user-stop". */
  shouldStop?: () => boolean;
  /** Waits ms. Injected in tests; default setTimeout. */
  wait?: (ms: number) => Promise<void>;
  /** Session id. Default derived from the start time. */
  id?: string;
}

export const DEFAULT_PAUSE_MS = 1500;

const realWait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function clampRating(n: number): number {
  return Math.max(0, Math.min(10, Math.round(Number.isFinite(n) ? n : 0)));
}

/** Run the strategy for one state. Resolves with the logged RepSession. */
export async function runStrategy(profile: ProfileV2, stateId: StateId, cb: PlaybackCallbacks, opts: RunOptions = {}): Promise<RepSession> {
  const state = getState(profile, stateId);
  if (!state) throw new Error(`state ${stateId} is not in the profile`);
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? realWait;
  const pauseMs = Math.max(0, Math.round(opts.pauseMs ?? DEFAULT_PAUSE_MS));
  const iso = (): string => new Date(now()).toISOString();
  const lines = buildPlaybackLines(profile, stateId);

  const startedAt = iso();
  const steps: RepStep[] = [];
  let endedBy: RepSession["endedBy"] = "completed";
  let anchorPaired = false;
  const stopped = (): boolean => {
    if (opts.shouldStop?.()) endedBy = "user-stop";
    return endedBy === "user-stop";
  };

  // Rate before.
  let t0 = iso();
  const intensityBefore = clampRating(await cb.rate(ratingPrompt(state, "before")));
  steps.push({ kind: "rate", plannedMs: null, startedAt: t0, endedAt: iso(), delivered: true });

  for (const line of lines) {
    if (stopped()) break;
    t0 = iso();
    cb.onStep(line.kind === "intro" ? -1 : line.stepIndex, line.text);
    await cb.speak(line.text);
    await wait(pauseMs);
    if (line.kind === "intro") continue;
    steps.push({
      kind: line.kind === "anchor" ? "anchor-peak" : "strategy-step",
      stepIndex: line.stepIndex,
      plannedMs: pauseMs,
      startedAt: t0,
      endedAt: iso(),
      delivered: true,
    });
    if (line.kind === "anchor") anchorPaired = true;
  }

  let intensityAfter: number | null = null;
  if (!stopped()) {
    t0 = iso();
    intensityAfter = clampRating(await cb.rate(ratingPrompt(state, "after")));
    steps.push({ kind: "rate", plannedMs: null, startedAt: t0, endedAt: iso(), delivered: true });
  }

  return {
    schemaVersion: 1,
    id: opts.id ?? `rep_${stateId}_${Date.parse(startedAt).toString(36)}`,
    profileId: profile.profileId,
    stateId,
    repIndex: Math.max(0, Math.floor(opts.repIndex ?? 0)),
    kind: "full",
    phase: null,
    trigger: { kind: "practice" },
    arm: "cue",
    startedAt,
    endedAt: iso(),
    steps,
    intensityBefore,
    intensityAfter,
    recoverySeconds: null,
    recoveryCensored: false,
    anchorPaired,
    signalSource: "none",
    scriptHash: scriptHash(lines),
    endedBy,
  };
}

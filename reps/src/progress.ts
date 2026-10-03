// Conditioning status and progress, computed from the logged RepSessions and never stored (D-reps-003).
// Pure functions: the app passes the whole log in and renders what comes back.

import type { ProgressByState, RepSession, StateId, StateProgress } from "./shapes.ts";

/** D-reps-003, in numbers. */
export const INSTALL = {
  /** A good rep, and an anchor-only pass, reach at least this rating after. */
  minAfter: 7,
  /** An anchor-only pass rises at least this much from the rating before. */
  minRise: 2,
  /** Good reps before the first anchor-only test. */
  goodRepsToTest: 5,
  /** Good reps after a failed test before the next one counts. */
  goodRepsAfterFail: 3,
  /** Anchor-only passes in a row to install. */
  passesToInstall: 2,
  /** Failed tests in a row that drop an installed state back to conditioning. */
  failsToDrop: 2,
} as const;

/** The rating a good rep must reach (mirrors onboarding's progress view). */
export const GOOD_REP_MIN = INSTALL.minAfter;

export type NextStep = "reps" | "anchor-test" | "installed";

export interface Conditioning {
  stateId: StateId;
  goodReps: number;
  /** Good reps still needed before the next anchor-only test counts. 0 when ready or installed. */
  goodRepsNeeded: number;
  /** Anchor-only passes in a row, counting back from the latest test that counted. */
  anchorPasses: number;
  installed: boolean;
  nextStep: NextStep;
}

/** contracts' StateProgress, plus what the progress screen shows next to the trend. */
export interface RepProgress extends StateProgress {
  /** Latest and best intensityTrend values, null before the first rated rep. */
  latest: number | null;
  best: number | null;
  nextStep: NextStep;
}

const completed = (s: RepSession) => s.endedBy === "completed";

/** D-reps-003: full, cue, completed, anchor paired at the peak, intensityAfter >= 7. */
export function isGoodRep(s: RepSession): boolean {
  return s.kind === "full" && s.arm === "cue" && completed(s) && s.anchorPaired && s.intensityAfter !== null && s.intensityAfter >= INSTALL.minAfter;
}

/**
 * The outcome of an anchor-only test: pass (intensityAfter >= 7 and a rise of at least 2), fail, or null when
 * the session is not a completed test with both ratings, so it counts neither way.
 */
export function anchorTestResult(s: RepSession): "pass" | "fail" | null {
  if (s.kind !== "anchor-only" || s.arm !== "cue" || !completed(s)) return null;
  if (s.intensityBefore === null || s.intensityAfter === null) return null;
  return s.intensityAfter >= INSTALL.minAfter && s.intensityAfter - s.intensityBefore >= INSTALL.minRise ? "pass" : "fail";
}

export function isAnchorPass(s: RepSession): boolean {
  return anchorTestResult(s) === "pass";
}

/** One state's sessions in log order (repIndex, then startedAt). */
function sessionsFor(sessions: readonly RepSession[], stateId: StateId): RepSession[] {
  return sessions
    .filter((s) => s.stateId === stateId)
    .slice()
    .sort((a, b) => a.repIndex - b.repIndex || Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/**
 * D-reps-003: 5 good reps, then 2 anchor-only passes in a row. After a fail, 3 more good reps before the next
 * test counts. Two failed tests in a row drop an installed state back to conditioning. A test taken before the
 * state is ready does not count. A state with no anchor step never logs an anchor-only test, so it never installs.
 */
export function conditioning(sessions: readonly RepSession[], stateId: StateId): Conditioning {
  let goodReps = 0;
  let goodSinceFail = 0;
  let coolingDown = false;
  let passes = 0;
  let fails = 0;
  let installed = false;

  const ready = () => goodReps >= INSTALL.goodRepsToTest && (!coolingDown || goodSinceFail >= INSTALL.goodRepsAfterFail);

  for (const s of sessionsFor(sessions, stateId)) {
    if (isGoodRep(s)) {
      goodReps++;
      goodSinceFail++;
      continue;
    }
    const result = anchorTestResult(s);
    if (result === null || !(installed || ready())) continue;
    if (result === "pass") {
      passes++;
      fails = 0;
      coolingDown = false;
      if (passes >= INSTALL.passesToInstall) installed = true;
    } else {
      passes = 0;
      fails++;
      coolingDown = true;
      goodSinceFail = 0;
      if (installed && fails >= INSTALL.failsToDrop) installed = false;
    }
  }

  const goodRepsNeeded = installed
    ? 0
    : coolingDown
      ? Math.max(0, INSTALL.goodRepsAfterFail - goodSinceFail)
      : Math.max(0, INSTALL.goodRepsToTest - goodReps);
  const nextStep: NextStep = installed ? "installed" : ready() ? "anchor-test" : "reps";
  return { stateId, goodReps, goodRepsNeeded, anchorPasses: passes, installed, nextStep };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function recovery(mine: RepSession[], arm: RepSession["arm"]): { n: number; medianSeconds: number | null } {
  const seconds = mine
    .filter((s) => s.arm === arm && completed(s) && !s.recoveryCensored && s.recoverySeconds !== null)
    .map((s) => s.recoverySeconds as number);
  return { n: seconds.length, medianSeconds: median(seconds) };
}

/**
 * One state's progress. `reps` and `intensityTrend` cover completed cue sessions (full and anchor-only);
 * stopped reps and shams are left out. Recovery compares cue against sham over completed, uncensored sessions.
 */
export function progress(sessions: readonly RepSession[], stateId: StateId): RepProgress {
  const mine = sessionsFor(sessions, stateId);
  const done = mine.filter((s) => completed(s) && s.arm === "cue");
  const intensityTrend = done.flatMap((s) => (s.intensityAfter === null ? [] : [s.intensityAfter]));
  const c = conditioning(mine, stateId);
  return {
    stateId,
    reps: done.length,
    goodReps: c.goodReps,
    anchorOnlyStreak: c.anchorPasses,
    installed: c.installed,
    intensityTrend,
    recovery: { cue: recovery(mine, "cue"), sham: recovery(mine, "sham") },
    latest: intensityTrend.length ? intensityTrend[intensityTrend.length - 1] : null,
    best: intensityTrend.length ? Math.max(...intensityTrend) : null,
    nextStep: c.nextStep,
  };
}

/** Every state in the log: the RepsModule.progress signature in contracts/src/api.ts. */
export function progressByState(sessions: readonly RepSession[]): ProgressByState {
  const out: ProgressByState = {};
  for (const stateId of new Set(sessions.map((s) => s.stateId))) out[stateId] = progress(sessions, stateId);
  return out;
}

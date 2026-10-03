// Rep ownership and progress, computed from the logged RepSessions and never stored (D-onboarding-016).
// A harness view: the good-rep rule is D-reps-003's, and reps.progress() stays the source once the reps package lands.

import type { RepSession, StateId } from "@peak-state/contracts";

/** D-reps-003: the intensity a good rep must reach. */
export const GOOD_REP_MIN = 7;

export interface ProgressSummary {
  stateId: StateId;
  /** Completed runs of any kind: each one is a time they chose to feel this way. */
  timesChosen: number;
  /** D-reps-003: full, cue, completed, anchor paired, intensityAfter >= 7. */
  goodReps: number;
  /** intensityAfter of each completed run with a rating, oldest first. */
  trend: number[];
  latest: number | null;
  best: number | null;
  /** Consecutive calendar days (UTC) with at least one completed run, counting back from the latest one. */
  dayStreak: number;
  lastAt: string | null;
}

export function isGoodRep(r: RepSession): boolean {
  return r.kind === "full" && r.arm === "cue" && r.endedBy === "completed" && r.anchorPaired && typeof r.intensityAfter === "number" && r.intensityAfter >= GOOD_REP_MIN;
}

function day(iso: string): number {
  return Math.floor(Date.parse(iso) / 86_400_000);
}

export function summarize(runs: readonly RepSession[], stateId: StateId): ProgressSummary {
  const mine = runs.filter((r) => r.stateId === stateId).slice().sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const completed = mine.filter((r) => r.endedBy === "completed" && r.arm === "cue");
  const trend = completed.map((r) => r.intensityAfter).filter((n): n is number => typeof n === "number");
  const days = [...new Set(completed.map((r) => day(r.startedAt)).filter(Number.isFinite))].sort((a, b) => b - a);
  let dayStreak = days.length ? 1 : 0;
  for (let i = 1; i < days.length && days[i - 1] - days[i] === 1; i++) dayStreak++;
  return {
    stateId,
    timesChosen: completed.length,
    goodReps: completed.filter(isGoodRep).length,
    trend,
    latest: trend.length ? trend[trend.length - 1] : null,
    best: trend.length ? Math.max(...trend) : null,
    dayStreak,
    lastAt: completed.length ? completed[completed.length - 1].startedAt : null,
  };
}

/** The spoken and shown reminder: how many times they chose to feel this way. */
export function reminderLine(p: ProgressSummary, stateLabel: string): string {
  if (p.timesChosen === 0) return `Every run counts as a time you chose to feel ${stateLabel}. This is your first.`;
  const times = p.timesChosen === 1 ? "once" : `${p.timesChosen} times`;
  const parts = [`You've chosen to feel ${stateLabel} ${times}.`];
  if (p.goodReps > 0) parts.push(p.goodReps === p.timesChosen && p.timesChosen > 1 ? `Every one took you to ${GOOD_REP_MIN} or higher.` : `${p.goodReps === 1 ? "One" : p.goodReps} of those took you to ${GOOD_REP_MIN} or higher.`);
  if (p.dayStreak >= 2) parts.push(`That's ${p.dayStreak} days in a row.`);
  return parts.join(" ");
}

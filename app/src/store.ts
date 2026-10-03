// Browser persistence, shared with the onboarding harness at "/" (same origin, same keys):
// the saved strategy under "peak-state.harness.strategy" and the RepSession log under
// "peak-state.harness.runs". Reads and writes go through @peak-state/onboarding's storage helpers,
// which survive missing or blocked storage.
import { appendRun, loadRuns, loadStrategy, saveStrategy } from "@peak-state/onboarding";
import type { ProfileV2, RepSession } from "./contracts";

export interface Saved {
  profile: ProfileV2;
  savedAt: string;
}

/** The strategy the harness (or this app) saved last, when it has a confirmed state. */
export function savedStrategy(): Saved | null {
  const s = loadStrategy();
  if (!s || !s.profile.confirmedAt || s.profile.states.length === 0) return null;
  return { profile: s.profile, savedAt: s.savedAt };
}

/** Save a profile confirmed here as the current strategy (revision 1, as the harness does on confirm). */
export function saveConfirmed(profile: ProfileV2): void {
  saveStrategy(profile);
}

/** Logged runs for one profile, oldest first. */
export function runsForProfile(profileId: string): RepSession[] {
  return loadRuns().filter((r) => r.profileId === profileId);
}

export function logRun(session: RepSession): void {
  appendRun(session);
}

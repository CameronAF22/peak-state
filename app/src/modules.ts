// Module registry (D-experience-003). Each slot has a fixture stub with the same interface;
// ?onboarding=stub|real (and sensing, reps) picks one per module so the demo can fall back
// in seconds. Real modules are wired in here, by package name, as each lane ships.
import type { OnboardingModule, RepsModule, SensingModule } from "./contracts";
import { onboardingStub } from "./stubs/onboarding";
import { repsStub } from "./stubs/reps";
import { sensingStub } from "./stubs/sensing";

export type ModuleName = "onboarding" | "sensing" | "reps";

interface Slot<T> {
  stub: T;
  /** null until the lane's package lands (e.g. import { onboarding } from "@peak-state/onboarding"). */
  real: T | null;
}

const slots: { onboarding: Slot<OnboardingModule>; sensing: Slot<SensingModule>; reps: Slot<RepsModule> } = {
  onboarding: { stub: onboardingStub, real: null },
  sensing: { stub: sensingStub, real: null },
  reps: { stub: repsStub, real: null },
};

export interface Resolved {
  onboarding: OnboardingModule;
  sensing: SensingModule;
  reps: RepsModule;
  /** Which implementation each slot is running, for the status badge. */
  using: Record<ModuleName, "stub" | "real">;
}

export function resolveModules(search: string): Resolved {
  const q = new URLSearchParams(search);
  const pick = <T>(name: ModuleName, slot: Slot<T>): [T, "stub" | "real"] => {
    const want = q.get(name) ?? "real";
    return want === "real" && slot.real ? [slot.real, "real"] : [slot.stub, "stub"];
  };
  const [onboarding, ou] = pick("onboarding", slots.onboarding);
  const [sensing, su] = pick("sensing", slots.sensing);
  const [reps, ru] = pick("reps", slots.reps);
  return { onboarding, sensing, reps, using: { onboarding: ou, sensing: su, reps: ru } };
}

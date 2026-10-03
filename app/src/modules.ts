// Module registry (D-experience-003), typed by @peak-state/contracts' module API (src/slots.ts).
// /demo/ runs the real onboarding and reps modules and the sensing stub (D-onboarding-023):
// sensing is plan only for now. ?onboarding=stub replays the recorded playbook run instead of the engine.
import { engineOnboarding } from "./real/onboarding";
import { repsReal } from "./real/reps";
import type { AppOnboardingModule, AppRepsModule, AppSensingModule } from "./slots";
import { onboardingStub } from "./stubs/onboarding";
import { sensingStub } from "./stubs/sensing";

export type ModuleName = "onboarding" | "sensing" | "reps";

interface Slot<T> {
  stub: T | null;
  real: T | null;
}

const slots: { onboarding: Slot<AppOnboardingModule>; sensing: Slot<AppSensingModule>; reps: Slot<AppRepsModule> } = {
  onboarding: { stub: onboardingStub, real: engineOnboarding },
  sensing: { stub: sensingStub, real: null },
  reps: { stub: null, real: repsReal },
};

export interface Resolved {
  onboarding: AppOnboardingModule;
  /** The recorded playbook run, always available for the scripted demo. */
  scriptedOnboarding: AppOnboardingModule;
  sensing: AppSensingModule;
  reps: AppRepsModule;
  /** Which implementation each slot is running, for the status badge. */
  using: Record<ModuleName, "stub" | "real">;
}

export function resolveModules(search: string): Resolved {
  const q = new URLSearchParams(search);
  const pick = <T>(name: ModuleName, slot: Slot<T>): [T, "stub" | "real"] => {
    const want = q.get(name) ?? "real";
    if (slot.real && (want === "real" || !slot.stub)) return [slot.real, "real"];
    return [slot.stub!, "stub"];
  };
  const [onboarding, ou] = pick("onboarding", slots.onboarding);
  const [sensing, su] = pick("sensing", slots.sensing);
  const [reps, ru] = pick("reps", slots.reps);
  return { onboarding, scriptedOnboarding: onboardingStub, sensing, reps, using: { onboarding: ou, sensing: su, reps: ru } };
}

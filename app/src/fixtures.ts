// Fixtures for demo mode and the stubs, straight from @peak-state/contracts (contracts/fixtures/*.json).
import { onboardingEventsDemo, profileDemo, repLogDemo, type OnboardingEvent, type ProfileV2, type RepSession } from "./contracts";

export function demoProfile(): ProfileV2 {
  return structuredClone(profileDemo);
}

export function demoRepLog(): RepSession[] {
  return structuredClone(repLogDemo);
}

export function demoOnboardingEvents(): OnboardingEvent[] {
  return structuredClone(onboardingEventsDemo);
}

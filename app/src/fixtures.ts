// Fixture access for demo mode and stubs. Today these are copies under src/fixtures/
// (D-experience-006); when @peak-state/contracts lands they import from its fixtures/.
import profileJson from "./fixtures/profile.demo.json";
import repLogJson from "./fixtures/rep-log.demo.json";
import type { ProfileV2, RepSession } from "./contracts";

export function demoProfile(): ProfileV2 {
  return structuredClone(profileJson) as unknown as ProfileV2;
}

export function demoRepLog(): RepSession[] {
  return structuredClone(repLogJson) as unknown as RepSession[];
}

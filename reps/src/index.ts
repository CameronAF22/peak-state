// @peak-state/reps: rep scripts from the person's own strategy, and the RepSession log.
// M1: script generator and logging. The timed runner with speech (reps.run) lands in M2,
// conditioning status in M3 and progress aggregates in M4 (reps/PLAN.md).

export { buildScript as script, buildScript, driversForStep, hashScript, speechMs, ScriptError, TIMING } from "./script.ts";
export type { RepScript, ScriptOptions, ScriptStep } from "./script.ts";
export { createRecorder, fromOnboarding, nextRepIndex, RecorderError } from "./session.ts";
export type { Clock, OnboardingPhase, RecorderOptions, RepRecorder } from "./session.ts";
export { driverPhrase, stepLead, submodalityPhrase } from "./wording.ts";
export type * from "./shapes.ts";

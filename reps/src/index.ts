// @peak-state/reps: rep scripts from the person's own strategy, the RepSession log, and conditioning status.
// Every shape is a @peak-state/contracts type (D-reps-009). The timed runner with speech (reps.run) lands in M2
// (reps/PLAN.md).

export { buildScript as script, buildScript, driversForStep, hashScript, speechMs, ScriptError, TIMING } from "./script.ts";
export type { RepScript, ScriptOptions, ScriptStep } from "./script.ts";
export { createRecorder, fromOnboarding, nextRepIndex, RecorderError } from "./session.ts";
export type { Clock, RecorderOptions, RepRecorder } from "./session.ts";
export { anchorTestResult, conditioning, GOOD_REP_MIN, INSTALL, isAnchorPass, isGoodRep, progress, progressByState } from "./progress.ts";
export type { Conditioning, NextStep, RepProgress } from "./progress.ts";
export { driverPhrase, stepLead, submodalityPhrase } from "./wording.ts";
export type * from "./shapes.ts";

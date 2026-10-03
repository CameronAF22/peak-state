// Validators. JSON Schema first (Ajv, draft 2020-12), then the cross-references a schema cannot express.
// Every lane validates through these instead of its own checks (D-contracts-002, D-contracts-008).

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";

import calibrationSchema from "../../schemas/calibration.schema.json" with { type: "json" };
import detectionEventSchema from "../../schemas/detection-event.schema.json" with { type: "json" };
import onboardingEventSchema from "../../schemas/onboarding-event.schema.json" with { type: "json" };
import profileSchema from "../../schemas/profile.v2.schema.json" with { type: "json" };
import repSessionSchema from "../../schemas/rep-session.schema.json" with { type: "json" };
import signalFrameSchema from "../../schemas/signal-frame.schema.json" with { type: "json" };

import { SUBMODALITIES, type ProfileV2, type State } from "./profile.ts";
import type { RepSession } from "./reps.ts";

export interface Result {
  ok: boolean;
  errors: string[];
}

// ajv's CJS default export needs unwrapping under some bundlers.
const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
const withFormats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats) as typeof addFormats;

// strictRequired is off: `required` inside if/then is standard JSON Schema.
const ajv = new AjvCtor({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
withFormats(ajv);
for (const s of [calibrationSchema, profileSchema, signalFrameSchema, detectionEventSchema, repSessionSchema, onboardingEventSchema]) {
  ajv.addSchema(s);
}

export const SCHEMA_IDS = {
  profile: profileSchema.$id,
  calibration: calibrationSchema.$id,
  signalFrame: signalFrameSchema.$id,
  detectionEvent: detectionEventSchema.$id,
  repSession: repSessionSchema.$id,
  onboardingEvent: onboardingEventSchema.$id,
} as const;

export type SchemaName = keyof typeof SCHEMA_IDS;

// Compile every schema now, so a broken schema fails on import rather than on first use.
for (const id of Object.values(SCHEMA_IDS)) ajv.getSchema(id);

function compiled(name: SchemaName): ValidateFunction {
  const fn = ajv.getSchema(SCHEMA_IDS[name]);
  if (!fn) throw new Error(`schema not loaded: ${name}`);
  return fn;
}

function format(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}

/** Schema validation only. */
export function validateSchema(name: SchemaName, data: unknown): Result {
  const fn = compiled(name);
  const ok = fn(data) as boolean;
  return { ok, errors: ok ? [] : format(fn.errors) };
}

function stateRefs(state: State, at: string): string[] {
  const errs: string[] = [];
  const n = state.strategy.steps.length;
  const inSteps = (i: number | null) => i === null || (i >= 0 && i < n);

  if (!inSteps(state.strategy.fullyInAt)) errs.push(`${at}/strategy/fullyInAt points past the last step`);
  if (!inSteps(state.anchorStep)) errs.push(`${at}/anchorStep points past the last step`);

  state.differences.forEach((d, i) => {
    const step = state.strategy.steps[d.stepIndex];
    if (!step) {
      errs.push(`${at}/differences/${i}/stepIndex points past the last step`);
    } else if (step.modality !== d.modality) {
      errs.push(`${at}/differences/${i}/modality is ${d.modality} but step ${d.stepIndex} is ${step.modality}`);
    }
    const vocab = SUBMODALITIES[d.modality] as { core: Record<string, unknown>; extended: Record<string, unknown> };
    if (!(d.attribute in vocab.core) && !(d.attribute in vocab.extended)) {
      errs.push(`${at}/differences/${i}/attribute '${d.attribute}' is not a ${d.modality} submodality`);
    }
  });

  state.drivers.forEach((di, i) => {
    if (!state.differences[di]) errs.push(`${at}/drivers/${i} names no difference`);
  });
  state.recode?.appliedDrivers.forEach((di, i) => {
    if (!state.drivers.includes(di)) errs.push(`${at}/recode/appliedDrivers/${i} is not one of the drivers`);
  });
  return errs;
}

/** Schema plus cross-references. Use this for every profile. */
export function validateProfile(data: unknown): Result {
  const schema = validateSchema("profile", data);
  if (!schema.ok) return schema;
  const profile = data as ProfileV2;
  const errors: string[] = [];

  const ids = profile.states.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push("/states has duplicate ids");

  profile.states.forEach((s, i) => {
    const at = `/states/${i}`;
    errors.push(...stateRefs(s, at));
    for (const phase of ["peak", "contrast"] as const) {
      const c = s.calibration[phase];
      if (c && (c.stateId !== s.id || c.phase !== phase)) errors.push(`${at}/calibration/${phase} is for ${c.stateId}/${c.phase}`);
    }
    if (profile.confirmedAt !== null) {
      if (!s.strategy.confirmed) errors.push(`${at}/strategy is not confirmed but the profile is`);
      if (s.strategy.steps.length === 0) errors.push(`${at}/strategy has no steps but the profile is confirmed`);
    }
  });
  return { ok: errors.length === 0, errors };
}

/** Schema, plus step and difference indexes against the profile when given. */
export function validateRepSession(data: unknown, profile?: ProfileV2): Result {
  const schema = validateSchema("repSession", data);
  if (!schema.ok || !profile) return schema;
  const session = data as RepSession;
  const errors: string[] = [];
  if (session.profileId !== profile.profileId) errors.push(`/profileId is not ${profile.profileId}`);
  const state = profile.states.find((s) => s.id === session.stateId);
  if (!state) return { ok: false, errors: [...errors, `/stateId ${session.stateId} is not in the profile`] };
  session.steps.forEach((step, i) => {
    if (step.stepIndex !== undefined && !state.strategy.steps[step.stepIndex]) {
      errors.push(`/steps/${i}/stepIndex points past the last strategy step`);
    }
    step.driversSpoken?.forEach((d, j) => {
      if (!state.differences[d]) errors.push(`/steps/${i}/driversSpoken/${j} names no difference`);
    });
    if ((step.kind === "anchor" || step.kind === "anchor-peak") && step.stepIndex !== state.anchorStep) {
      errors.push(`/steps/${i} is an anchor step but stepIndex is not the state's anchorStep`);
    }
  });
  return { ok: errors.length === 0, errors };
}

export const validateCalibration = (data: unknown): Result => validateSchema("calibration", data);
export const validateSignalFrame = (data: unknown): Result => validateSchema("signalFrame", data);
export const validateDetectionEvent = (data: unknown): Result => validateSchema("detectionEvent", data);
export const validateOnboardingEvent = (data: unknown): Result => validateSchema("onboardingEvent", data);

/** Throws with every error when invalid. */
export function assertValid(result: Result, what: string): void {
  if (!result.ok) throw new Error(`${what} is invalid:\n  ${result.errors.join("\n  ")}`);
}

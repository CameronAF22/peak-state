// Contract tests: every fixture validates, every invalid fixture fails, types and schemas agree,
// derive helpers behave, and v1 stays valid. Run with `npm test` (node --test, type stripping).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  SUBMODALITIES,
  chain,
  drivers,
  driversForStep,
  fixtures,
  repSteps,
  triad,
  validateCalibration,
  validateDetectionEvent,
  validateOnboardingEvent,
  validateProfile,
  validateRepSession,
  validateSignalFrame,
  type ProfileV2,
  type Result,
} from "../src/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIX = join(ROOT, "contracts", "fixtures");
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const fixture = (name: string) => read(join(FIX, name));
const demo = fixture("profile.demo.json") as ProfileV2;

const each = <T>(data: unknown, fn: (item: T) => Result): Result => {
  const errors = (data as T[]).flatMap((item, i) => fn(item).errors.map((e) => `[${i}] ${e}`));
  return { ok: errors.length === 0, errors };
};

// Which validator each fixture file goes through, by name.
const VALIDATORS: Record<string, (data: unknown) => Result> = {
  "profile.": validateProfile,
  "calibration.": validateCalibration,
  "frames.": (d) => each(d, validateSignalFrame),
  "detection.": validateDetectionEvent,
  "rep-session.": (d) => validateRepSession(d, demo),
  "rep-log.": (d) => each(d, (s) => validateRepSession(s, demo)),
  "onboarding.events.": (d) => each(d, validateOnboardingEvent),
};

function validatorFor(file: string) {
  const prefix = Object.keys(VALIDATORS).find((p) => file.startsWith(p));
  assert.ok(prefix, `no validator for fixture ${file}; add it to VALIDATORS`);
  return VALIDATORS[prefix];
}

test("every fixture validates against its schema and cross-references", () => {
  const files = readdirSync(FIX).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 13);
  for (const file of files) {
    const result = validatorFor(file)(fixture(file));
    assert.deepEqual(result.errors, [], `${file} should be valid`);
  }
});

test("every invalid fixture is rejected", () => {
  const files = readdirSync(join(FIX, "invalid"));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const result = validatorFor(file)(fixture(join("invalid", file)));
    assert.equal(result.ok, false, `invalid/${file} should be rejected`);
  }
});

test("typed fixtures in src/fixtures.ts match the JSON files", () => {
  const pairs: [unknown, string][] = [
    [fixtures.profileDemo, "profile.demo.json"],
    [fixtures.profileThreeStates, "profile.three-states.json"],
    [fixtures.profileDraft, "profile.draft.json"],
    [fixtures.framesDrift, "frames.drift.json"],
    [fixtures.repLogDemo, "rep-log.demo.json"],
    [fixtures.onboardingEventsDemo, "onboarding.events.demo.json"],
  ];
  for (const [typed, file] of pairs) assert.deepEqual(typed, fixture(file), `${file}: rerun contracts/fixtures/_generate.py`);
});

test("the TS submodality vocabulary matches the schema enums", () => {
  const schema = fixtureSchema("profile.v2.schema.json") as { $defs: Record<string, { properties: Record<string, { properties: Record<string, { enum?: string[] }> }> }> };
  const defs = { visual: "visualSubmodalities", auditory: "auditorySubmodalities", kinesthetic: "kinestheticSubmodalities" } as const;
  for (const [modality, def] of Object.entries(defs)) {
    for (const tier of ["core", "extended"] as const) {
      const fromSchema = schema.$defs[def].properties[tier].properties;
      const fromTs = (SUBMODALITIES as Record<string, Record<string, Record<string, readonly string[] | null>>>)[modality][tier];
      assert.deepEqual(Object.keys(fromTs).sort(), Object.keys(fromSchema).sort(), `${modality}.${tier} keys`);
      for (const [attr, values] of Object.entries(fromTs)) {
        if (values) assert.deepEqual([...values], fromSchema[attr].enum, `${modality}.${tier}.${attr}`);
      }
    }
  }
});

function fixtureSchema(name: string) {
  return read(join(ROOT, "schemas", name));
}

test("derive: chain, triad, drivers and rep steps", () => {
  const state = demo.states[0];
  assert.equal(chain(state), "Ve → Ai → Ki");
  const t = triad(state);
  assert.deepEqual(t.focus.map((s) => s.stepIndex), [0]);
  assert.deepEqual(t.language.map((s) => s.stepIndex), [1]);
  assert.deepEqual(t.physiology.map((s) => s.stepIndex), [2]);
  assert.deepEqual(drivers(state).map((d) => d.attribute), ["distance", "brightness", "volume"]);
  assert.deepEqual(driversForStep(state, 0).map((d) => d.peakValue), ["close", "bright"]);
  assert.deepEqual(driversForStep(state, 2), []);
  assert.deepEqual(repSteps(state), [0, 1, 2]);

  const three = fixtures.profileThreeStates.states;
  assert.equal(chain(three[1]), "Ae → Ki");
  assert.deepEqual(triad(three[1]).focus.map((s) => s.stepIndex), [0], "an external sound is focus");
  assert.equal(chain(three[2]), "Ki → Vi → Oe");
});

test("onboarding demo stream is ordered, about 90 s, and ends with the demo profile", () => {
  const events = fixtures.onboardingEventsDemo;
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `event ${i} out of order`);
  const seconds = (events.at(-1)!.t - events[0].t) / 1000;
  assert.ok(seconds >= 60 && seconds <= 120, `stream is ${seconds} s`);
  const last = events.at(-1)!;
  assert.equal(last.type, "confirmed");
  assert.deepEqual(last.type === "confirmed" && last.profile, demo);
});

test("rep log: sequential, shams log only rate steps, and the demo state ends installed", () => {
  const log = fixtures.repLogDemo;
  log.forEach((s, i) => assert.equal(s.repIndex, i));
  for (const s of log.filter((s) => s.arm === "sham")) assert.ok(s.steps.every((st) => st.kind === "rate"));
  const tail = log.slice(-2);
  assert.ok(tail.every((s) => s.kind === "anchor-only" && s.endedBy === "completed"), "ends with two anchor-only passes");
});

test("manual detections are never sham", () => {
  const bad = { ...fixtures.detectionManual, gate: { ...fixtures.detectionManual.gate, sham: true } };
  assert.equal(validateDetectionEvent(bad).ok, false);
});

test("v1 schemas still validate their examples", () => {
  const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
  const formats = ((addFormats as unknown as { default?: typeof addFormats }).default ?? addFormats) as typeof addFormats;
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  formats(ajv);
  const pairs: [string, string][] = [
    ["user-state-profile.schema.json", "sample-profile.json"],
    ["peak-strategies.schema.json", "sample-strategies.json"],
  ];
  for (const [schema, example] of pairs) {
    const validate = ajv.compile(fixtureSchema(schema) as object);
    assert.ok(validate(read(join(ROOT, "examples", example))), `${example}: ${JSON.stringify(validate.errors)}`);
  }
});

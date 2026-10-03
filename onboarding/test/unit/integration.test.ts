// The harness and reps together (D-onboarding-023): "I'm off" runs and anchor-only tests are valid RepSessions, and
// reps.conditioning reads the harness's own log through to installed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import { conditioning } from "@peak-state/reps";
import { runStrategy } from "../../src/playback/index.ts";

const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;
const stateId = profile.states[0].id;

let clock = Date.parse("2026-10-03T10:00:00Z");
const now = () => (clock += 1000);

function rep(i: number, before: number, after: number, mode: { kind?: RepSession["kind"]; trigger?: RepSession["trigger"] } = {}) {
  const ratings = [before, after];
  return runStrategy(profile, stateId, { onStep() {}, speak: async () => {}, rate: async () => ratings.shift()! }, { pauseMs: 0, wait: async () => {}, now, repIndex: i, id: `rep_${i}`, ...mode });
}

test("I'm off logs a manual full rep; the anchor test logs only the anchor", async () => {
  const off = await rep(0, 3, 8, { trigger: { kind: "manual" } });
  assert.equal(off.trigger.kind, "manual");
  assert.equal(off.kind, "full");
  let v = validateRepSession(off, profile);
  assert.ok(v.ok, v.errors.join("\n"));

  const anchor = await rep(1, 4, 8, { kind: "anchor-only", trigger: { kind: "manual" } });
  assert.equal(anchor.kind, "anchor-only");
  assert.deepEqual(anchor.steps.filter((s) => s.kind !== "rate").map((s) => s.kind), ["anchor"]);
  v = validateRepSession(anchor, profile);
  assert.ok(v.ok, v.errors.join("\n"));
});

test("five good reps, then two anchor passes, installs the state", async () => {
  const runs: RepSession[] = [];
  for (let i = 0; i < 5; i++) runs.push(await rep(i, 4, 8, { trigger: { kind: "manual" } }));
  assert.equal(conditioning(runs, stateId).nextStep, "anchor-test");
  runs.push(await rep(5, 4, 8, { kind: "anchor-only", trigger: { kind: "manual" } }));
  runs.push(await rep(6, 5, 9, { kind: "anchor-only", trigger: { kind: "manual" } }));
  const c = conditioning(runs, stateId);
  assert.equal(c.installed, true);
  assert.equal(c.nextStep, "installed");
});

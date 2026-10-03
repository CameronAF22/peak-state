import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildScript, createRecorder, fromOnboarding, nextRepIndex, RecorderError } from "../src/index.ts";
import type { Clock, ProfileV2, RepRecorder, RepSession } from "../src/index.ts";

const fixture: ProfileV2 = JSON.parse(readFileSync(new URL("./fixtures/profile.demo.json", import.meta.url), "utf8"));
const STATE = "calm-before-pitch";

function fakeClock(startIso = "2026-10-03T10:00:00.000Z"): Clock & { advance(ms: number): void } {
  let t = Date.parse(startIso);
  const clock = (() => new Date(t)) as Clock & { advance(ms: number): void };
  clock.advance = (ms) => (t += ms);
  return clock;
}

function playAll(rec: RepRecorder, clock: ReturnType<typeof fakeClock>) {
  rec.plan.forEach((s, i) => {
    rec.stepStarted(i);
    clock.advance(s.plannedMs || 1_000);
    rec.stepEnded(i);
  });
}

describe("RepSession recorder", () => {
  it("logs a completed cue rep from a detection", () => {
    const clock = fakeClock();
    const script = buildScript(fixture, STATE);
    const rec = createRecorder(script, { trigger: { kind: "detection", detectionId: "det_1" }, arm: "cue", repIndex: 4, clock, id: "rep_1" });
    rec.rateBefore(4);
    playAll(rec, clock);
    rec.rateAfter(8);
    rec.recovery({ recoverySeconds: 41, censored: false, source: "simulator" });
    const s = rec.finish("completed");

    assert.equal(s.schemaVersion, 1);
    assert.deepEqual([s.id, s.profileId, s.stateId, s.repIndex, s.kind, s.arm], ["rep_1", "profile_demo_ada", STATE, 4, "full", "cue"]);
    assert.deepEqual(s.trigger, { kind: "detection", detectionId: "det_1" });
    assert.equal(s.startedAt, "2026-10-03T10:00:00.000Z");
    assert.ok(Date.parse(s.endedAt) - Date.parse(s.startedAt) >= script.totalMs);
    assert.deepEqual(s.steps.map((x) => x.kind), script.steps.map((x) => x.kind));
    assert.ok(s.steps.every((x) => x.delivered && x.startedAt && x.endedAt));
    assert.deepEqual(s.steps[1].driverIndexes, [0, 1]);
    assert.deepEqual([s.intensityBefore, s.intensityAfter], [4, 8]);
    assert.deepEqual([s.recoverySeconds, s.recoveryCensored, s.signalSource], [41, false, "simulator"]);
    assert.equal(s.anchorPaired, true);
    assert.equal(s.scriptHash, script.scriptHash);
    assert.equal(s.endedBy, "completed");
  });

  it("logs a sham with only the rating steps and no anchor pairing", () => {
    const clock = fakeClock();
    const rec = createRecorder(buildScript(fixture, STATE), { trigger: { kind: "detection", detectionId: "det_2" }, arm: "sham", repIndex: 5, clock });
    assert.deepEqual(rec.plan.map((s) => s.kind), ["rate", "rate"]);
    playAll(rec, clock);
    rec.rateAfter(5);
    rec.recovery({ recoverySeconds: null, censored: true, source: "simulator" });
    const s = rec.finish("completed");
    assert.equal(s.arm, "sham");
    assert.deepEqual(s.steps.map((x) => x.kind), ["rate", "rate"]);
    assert.equal(s.anchorPaired, false);
    assert.deepEqual([s.recoverySeconds, s.recoveryCensored], [null, true]);
  });

  it("never logs a sham for manual or practice triggers", () => {
    for (const kind of ["manual", "practice"] as const) {
      const rec = createRecorder(buildScript(fixture, STATE), { trigger: { kind }, arm: "sham", repIndex: 1 });
      assert.equal(rec.arm, "cue");
    }
  });

  it("keeps a stopped rep, marks undelivered steps, and does not pair the anchor", () => {
    const clock = fakeClock();
    const rec = createRecorder(buildScript(fixture, STATE), { trigger: { kind: "manual" }, repIndex: 2, clock });
    rec.rateBefore(null);
    rec.stepStarted(1);
    clock.advance(2_000);
    rec.stepEnded(1, false);
    const s = rec.finish("user-stop");
    assert.equal(s.endedBy, "user-stop");
    assert.equal(s.anchorPaired, false);
    assert.equal(s.steps.filter((x) => x.delivered).length, 0);
    assert.equal(s.steps[1].startedAt, "2026-10-03T10:00:00.000Z");
    assert.equal(s.steps[2].startedAt, null);
    assert.equal(s.intensityBefore, null);
  });

  it("logs the anchor-only test without anchor pairing", () => {
    const clock = fakeClock();
    const rec = createRecorder(buildScript(fixture, STATE, "anchor-only"), { trigger: { kind: "practice" }, repIndex: 9, clock });
    rec.rateBefore(3);
    playAll(rec, clock);
    rec.rateAfter(7);
    const s = rec.finish("completed");
    assert.equal(s.kind, "anchor-only");
    assert.deepEqual(s.steps.map((x) => [x.kind, x.strategyStepIndex]), [["rate", undefined], ["anchor", 0], ["rate", undefined]]);
    assert.equal(s.anchorPaired, false);
  });

  it("rejects bad ratings, unknown steps and a second finish", () => {
    const rec = createRecorder(buildScript(fixture, STATE), { trigger: { kind: "manual" }, repIndex: 1 });
    assert.throws(() => rec.rateBefore(11), RecorderError);
    assert.throws(() => rec.rateAfter(6.5), RecorderError);
    assert.throws(() => rec.stepStarted(99), RecorderError);
    rec.finish("completed");
    assert.throws(() => rec.finish("completed"), RecorderError);
    assert.throws(() => rec.stepStarted(0), RecorderError);
  });

  it("produces JSON-serialisable sessions", () => {
    const rec = createRecorder(buildScript(fixture, STATE), { trigger: { kind: "manual" }, repIndex: 1 });
    const s = rec.finish("completed");
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  });
});

describe("onboarding as the first reps (D-reps-006)", () => {
  const sessions = fromOnboarding(fixture, STATE);

  it("logs recode, test and future pace in order as reps 1 to 3", () => {
    assert.deepEqual(sessions.map((s) => [s.repIndex, s.id.split("onboarding-")[1]]), [[1, "recode"], [2, "test"], [3, "future-pace"]]);
    for (const s of sessions) {
      assert.deepEqual([s.trigger.kind, s.arm, s.kind, s.signalSource, s.recoverySeconds, s.endedBy], ["onboarding", "cue", "full", "none", null, "completed"]);
    }
  });

  it("carries the test ratings and pairs the anchor on future pace only", () => {
    const [recode, test, future] = sessions;
    assert.deepEqual([test.intensityBefore, test.intensityAfter], [3, 7]);
    assert.deepEqual([recode.anchorPaired, test.anchorPaired, future.anchorPaired], [false, false, true]);
  });

  it("skips sections onboarding did not reach", () => {
    const p = structuredClone(fixture);
    p.states[0].recode = null;
    p.states[0].futurePace = null;
    assert.deepEqual(fromOnboarding(p, STATE).map((s) => s.scriptHash), ["onboarding:test"]);
  });

  it("feeds nextRepIndex, which continues after them", () => {
    assert.equal(nextRepIndex(sessions, STATE), 4);
    assert.equal(nextRepIndex([], STATE), 1);
    const other: RepSession = { ...sessions[0], stateId: "other", repIndex: 12 };
    assert.equal(nextRepIndex([...sessions, other], STATE), 4);
  });
});

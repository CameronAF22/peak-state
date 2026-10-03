import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { profileDemo, repLogDemo, repSessionAnchorOnly, repSessionFull, repSessionSham, validateRepSession } from "@peak-state/contracts";

import {
  buildScript,
  conditioning,
  createRecorder,
  fromOnboarding,
  isAnchorPass,
  isGoodRep,
  nextRepIndex,
  progress,
  progressByState,
} from "../src/index.ts";
import type { RepSession } from "../src/index.ts";

const STATE = "calm-before-pitch";

/** A log built from contracts' fixtures: each entry overrides the full or anchor-only fixture. */
function log(...entries: ({ test?: boolean } & Partial<RepSession>)[]): RepSession[] {
  return entries.map(({ test, ...over }, repIndex) => ({ ...structuredClone(test ? repSessionAnchorOnly : repSessionFull), repIndex, ...over }));
}
const good = () => ({});
const pass = () => ({ test: true, intensityBefore: 4, intensityAfter: 8 });
const fail = () => ({ test: true, intensityBefore: 4, intensityAfter: 5 });
const goods = (n: number) => Array.from({ length: n }, good);

describe("good reps and anchor-only passes (D-reps-003)", () => {
  it("a good rep is full, cue, completed, anchor paired, and rated 7 or more after", () => {
    assert.equal(isGoodRep(repSessionFull), true);
    for (const over of [
      { kind: "anchor-only" },
      { arm: "sham" },
      { endedBy: "user-stop" },
      { anchorPaired: false },
      { intensityAfter: 6 },
      { intensityAfter: null },
    ] as Partial<RepSession>[]) {
      assert.equal(isGoodRep({ ...repSessionFull, ...over }), false, JSON.stringify(over));
    }
    assert.equal(isGoodRep(repSessionSham), false);
  });

  it("an anchor-only pass is completed, rated 7 or more after, and rises at least 2", () => {
    assert.equal(isAnchorPass(repSessionAnchorOnly), true);
    assert.equal(isAnchorPass({ ...repSessionAnchorOnly, intensityBefore: 6, intensityAfter: 7 }), false);
    assert.equal(isAnchorPass({ ...repSessionAnchorOnly, intensityBefore: 2, intensityAfter: 6 }), false);
    assert.equal(isAnchorPass({ ...repSessionAnchorOnly, endedBy: "user-stop" }), false);
    assert.equal(isAnchorPass({ ...repSessionAnchorOnly, intensityBefore: null }), false);
    assert.equal(isAnchorPass(repSessionFull), false);
  });
});

describe("conditioning", () => {
  it("installs the demo log: 5 good reps, then 2 passes in a row", () => {
    assert.deepEqual(conditioning(repLogDemo, STATE), {
      stateId: STATE,
      goodReps: 5,
      goodRepsNeeded: 0,
      anchorPasses: 2,
      installed: true,
      nextStep: "installed",
    });
  });

  it("walks the demo log: reps, then the anchor test, one pass short of installed", () => {
    assert.deepEqual(pick(conditioning(repLogDemo.slice(0, 6), STATE)), [3, 2, 0, false, "reps"]);
    assert.deepEqual(pick(conditioning(repLogDemo.slice(0, 9), STATE)), [5, 0, 0, false, "anchor-test"]);
    assert.deepEqual(pick(conditioning(repLogDemo.slice(0, 10), STATE)), [5, 0, 1, false, "anchor-test"]);
  });

  it("starts with reps for a state with no log, and ignores other states", () => {
    assert.deepEqual(pick(conditioning([], STATE)), [0, 5, 0, false, "reps"]);
    assert.deepEqual(pick(conditioning(repLogDemo, "other")), [0, 5, 0, false, "reps"]);
  });

  it("does not count a test taken before 5 good reps", () => {
    assert.deepEqual(pick(conditioning(log(...goods(4), pass(), good(), pass()), STATE)), [5, 0, 1, false, "anchor-test"]);
  });

  it("needs 3 more good reps after a fail before the next test counts", () => {
    const failed = log(...goods(5), fail());
    assert.deepEqual(pick(conditioning(failed, STATE)), [5, 3, 0, false, "reps"]);
    const tooSoon = log(...goods(5), fail(), good(), pass(), pass());
    assert.deepEqual(pick(conditioning(tooSoon, STATE)), [6, 2, 0, false, "reps"]);
    const after = log(...goods(5), fail(), ...goods(3));
    assert.deepEqual(pick(conditioning(after, STATE)), [8, 0, 0, false, "anchor-test"]);
    assert.deepEqual(pick(conditioning(log(...goods(5), fail(), ...goods(3), pass(), pass()), STATE)), [8, 0, 2, true, "installed"]);
  });

  it("a fail between passes restarts the streak", () => {
    assert.deepEqual(pick(conditioning(log(...goods(5), pass(), fail(), ...goods(3), pass()), STATE)), [8, 0, 1, false, "anchor-test"]);
  });

  it("stays installed after one later fail and drops back to conditioning after two in a row", () => {
    const installed = [...goods(5), pass(), pass()];
    assert.equal(conditioning(log(...installed, fail()), STATE).installed, true);
    assert.deepEqual(pick(conditioning(log(...installed, fail(), fail()), STATE)), [5, 3, 0, false, "reps"]);
    assert.equal(conditioning(log(...installed, fail(), pass(), fail()), STATE).installed, true);
  });

  it("leaves shams, stopped reps and unrated tests out", () => {
    const noise = [{ arm: "sham" as const, anchorPaired: false, steps: [] }, { endedBy: "user-stop" as const }, { test: true, intensityBefore: null }];
    assert.deepEqual(pick(conditioning(log(...goods(4), ...noise), STATE)), [4, 1, 0, false, "reps"]);
  });
});

describe("progress", () => {
  it("summarises the demo log in contracts' StateProgress, plus latest, best and the next step", () => {
    assert.deepEqual(progress(repLogDemo, STATE), {
      stateId: STATE,
      reps: 9,
      goodReps: 5,
      anchorOnlyStreak: 2,
      installed: true,
      intensityTrend: [6, 7, 8, 8, 7, 8, 8, 7, 8],
      recovery: { cue: { n: 3, medianSeconds: 38 }, sham: { n: 1, medianSeconds: 80 } },
      latest: 8,
      best: 8,
      nextStep: "installed",
    });
  });

  it("orders by repIndex, whatever order the log arrives in", () => {
    assert.deepEqual(progress([...repLogDemo].reverse(), STATE).intensityTrend, progress(repLogDemo, STATE).intensityTrend);
  });

  it("is empty for a state with no log", () => {
    const p = progress([], STATE);
    assert.deepEqual([p.reps, p.intensityTrend, p.latest, p.best, p.recovery.cue.medianSeconds, p.nextStep], [0, [], null, null, null, "reps"]);
  });

  it("keys every state in the log (RepsModule.progress)", () => {
    const other = { ...repLogDemo[3], stateId: "other", repIndex: 0 };
    const all = progressByState([...repLogDemo, other]);
    assert.deepEqual(Object.keys(all).sort(), [STATE, "other"]);
    assert.equal(all[STATE].installed, true);
    assert.equal(all.other.reps, 1);
  });
});

describe("end to end against the contract", () => {
  it("onboarding reps, 5 recorded good reps and 2 recorded passes install the state, and every session validates", () => {
    const sessions: RepSession[] = fromOnboarding(profileDemo, STATE);
    let t = Date.parse("2026-10-04T08:00:00Z");
    const clock = { now: () => (t += 1_000) };
    const record = (kind: "full" | "anchor-only", before: number, after: number) => {
      const rec = createRecorder(buildScript(profileDemo, STATE, kind), { trigger: { kind: "practice" }, repIndex: nextRepIndex(sessions, STATE), clock });
      rec.rateBefore(before);
      rec.plan.forEach((_, i) => {
        rec.stepStarted(i);
        rec.stepEnded(i);
      });
      rec.rateAfter(after);
      sessions.push(rec.finish("completed"));
    };
    for (let i = 0; i < 5; i++) record("full", 4, 8);
    assert.equal(conditioning(sessions, STATE).nextStep, "anchor-test");
    record("anchor-only", 4, 7);
    record("anchor-only", 3, 8);

    for (const s of sessions) {
      const r = validateRepSession(s, profileDemo);
      assert.ok(r.ok, `${s.id}: ${r.errors.join(", ")}`);
    }
    assert.deepEqual(sessions.map((s) => s.repIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(pick(conditioning(sessions, STATE)), [5, 0, 2, true, "installed"]);
  });

  it("contracts' rep log fixture validates, and nextRepIndex continues it", () => {
    for (const s of repLogDemo) assert.ok(validateRepSession(s, profileDemo).ok, s.id);
    assert.equal(nextRepIndex(repLogDemo, STATE), 11);
  });
});

function pick(c: ReturnType<typeof conditioning>) {
  return [c.goodReps, c.goodRepsNeeded, c.anchorPasses, c.installed, c.nextStep];
}

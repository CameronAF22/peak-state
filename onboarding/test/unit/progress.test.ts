import assert from "node:assert/strict";
import { test } from "node:test";

import type { RepSession } from "@peak-state/contracts";
import { isGoodRep, reminderLine, summarize } from "../../src/progress/index.ts";

function rep(over: Partial<RepSession>): RepSession {
  return {
    schemaVersion: 1,
    id: `r${Math.random()}`,
    profileId: "p",
    stateId: "content",
    repIndex: 0,
    kind: "full",
    phase: null,
    trigger: { kind: "practice" },
    arm: "cue",
    startedAt: "2026-10-03T10:00:00.000Z",
    endedAt: "2026-10-03T10:01:00.000Z",
    steps: [],
    intensityBefore: null,
    intensityAfter: 8,
    recoverySeconds: null,
    recoveryCensored: false,
    anchorPaired: true,
    signalSource: "none",
    scriptHash: "x",
    endedBy: "completed",
    ...over,
  };
}

test("summarize counts times chosen, good reps, trend and the day streak", () => {
  const runs = [
    rep({ startedAt: "2026-10-01T09:00:00.000Z", intensityAfter: 5 }),
    rep({ startedAt: "2026-10-02T09:00:00.000Z", intensityAfter: 7 }),
    rep({ startedAt: "2026-10-03T09:00:00.000Z", intensityAfter: 9 }),
    rep({ startedAt: "2026-10-03T10:00:00.000Z", intensityAfter: 8, anchorPaired: false }),
    rep({ startedAt: "2026-10-03T11:00:00.000Z", endedBy: "user-stop", intensityAfter: null }),
    rep({ startedAt: "2026-10-03T12:00:00.000Z", stateId: "other" }),
  ];
  const p = summarize(runs, "content");
  assert.equal(p.timesChosen, 4);
  assert.equal(p.goodReps, 2);
  assert.deepEqual(p.trend, [5, 7, 9, 8]);
  assert.equal(p.latest, 8);
  assert.equal(p.best, 9);
  assert.equal(p.dayStreak, 3);
  assert.equal(p.lastAt, "2026-10-03T10:00:00.000Z");
  assert.equal(isGoodRep(runs[3]), false);
  assert.equal(reminderLine(p, "content"), "You've chosen to feel content 4 times. 2 of those took you to 7 out of 10 or higher. That's 3 days in a row.");
});

test("reminder wording for none, one and all-good", () => {
  assert.match(reminderLine(summarize([], "content"), "content"), /This is your first\.$/);
  assert.equal(reminderLine(summarize([rep({ intensityAfter: 4 })], "content"), "content"), "You've chosen to feel content once.");
  const two = [rep({ startedAt: "2026-10-01T09:00:00.000Z" }), rep({ startedAt: "2026-10-01T10:00:00.000Z" })];
  assert.equal(reminderLine(summarize(two, "content"), "content"), "You've chosen to feel content twice. Every one took you to 7 out of 10 or higher.");
});

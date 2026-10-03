import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateProfile, validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import { createPracticeLoop, questionTargets, TRY_AGAIN_LINE } from "../../src/practice/loop.ts";
import { parseRating } from "../../src/practice/rating.ts";
import { newRecord, readField, type StrategyRecord } from "../../src/store/index.ts";

const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;
const state = profile.states[0];

function clock(start = Date.parse("2026-10-03T18:00:00Z")): () => number {
  let t = start;
  return () => (t += 1000);
}

function loop(opts: { record?: StrategyRecord; maxTries?: number; questionOffset?: number } = {}) {
  const runs: RepSession[] = [];
  const records: StrategyRecord[] = [];
  const l = createPracticeLoop({
    record: opts.record ?? newRecord(profile, clock()),
    now: clock(),
    priorRuns: 4,
    maxTries: opts.maxTries,
    questionOffset: opts.questionOffset,
    onRun: (r) => runs.push(r),
    onChange: (r) => records.push(r),
  });
  return { l, runs, records };
}

/** Walk the recall prompts with "next". */
function recall(l: ReturnType<typeof createPracticeLoop>) {
  let s = l.snapshot();
  while (s.phase === "recall") s = l.answer({ text: "Next", via: "choice", choiceValue: "next" });
  return s;
}

test("parseRating reads digits, words and phrases, and ignores the scale", () => {
  const cases: [string, number | null][] = [
    ["7", 7],
    ["seven", 7],
    ["about a seven I think", 7],
    ["7 out of 10", 7],
    ["out of ten I'd say six", 6],
    ["from 0 to 10, an 8", 8],
    ["6.5", 7],
    ["10", 10],
    ["ten, completely", 10],
    ["zero", 0],
    ["8/10", 8],
    ["pretty close", null],
    ["", null],
  ];
  for (const [text, want] of cases) assert.equal(parseRating(text), want, text);
});

test("recall walks the saved steps in order, ending on the anchor, with the person's own answers", () => {
  const { l } = loop();
  const s0 = l.snapshot();
  assert.equal(s0.phase, "recall");
  assert.deepEqual(s0.recallOrder, [0, 1, 2, state.anchorStep]);
  assert.match(s0.prompt!.text, /^Step back into that time\. What's the very first thing you see\?$/);
  assert.match(s0.prompt!.remembered!, /first face in the room looking up at you/);
  assert.match(s0.prompt!.spoken, /Last time: See the first face/);
  const s1 = l.answer({ text: "the faces, yes", via: "voice" });
  assert.match(s1.prompt!.text, /very next thing you hear\?$/);
  const s2 = l.answer({ text: "next", via: "typed" });
  assert.match(s2.prompt!.text, /very next thing you feel\?$/);
  const s3 = l.answer({ text: "warm", via: "typed" });
  assert.match(s3.prompt!.text, /brings it back fastest/);
  const s4 = l.answer({ text: "yes", via: "voice" });
  assert.equal(s4.phase, "rate");
  assert.equal(s4.prompt!.text, `How close did you get to feeling ${state.label}, from 0 to 10?`);
});

test("a rating by voice, then the same answer, ends the session with one valid logged try", () => {
  const { l, runs, records } = loop();
  recall(l);
  let s = l.answer({ text: "hmm, pretty close", via: "voice" });
  assert.equal(s.phase, "rate");
  assert.match(s.notice!, /didn't catch a number/);
  s = l.answer({ text: "about a seven", via: "voice" });
  assert.equal(s.phase, "question");
  assert.equal(s.rating, 7);
  assert.equal(s.prompt!.field, "core.location"); // anchor step first
  assert.match(s.prompt!.text, /in the center/);
  s = l.answer({ text: "it's still in the center", via: "voice" });
  assert.equal(s.phase, "done");
  assert.equal(records.length, 0);
  assert.equal(runs.length, 1);
  const r = runs[0];
  assert.equal(r.repIndex, 4);
  assert.equal(r.intensityAfter, 7);
  assert.equal(r.intensityBefore, null);
  assert.equal(r.trigger.kind, "practice");
  assert.equal(r.anchorPaired, true);
  assert.equal(r.endedBy, "completed");
  assert.deepEqual(
    r.steps.map((x) => x.kind),
    ["strategy-step", "strategy-step", "strategy-step", "anchor-peak", "rate"],
  );
  const v = validateRepSession(r, profile);
  assert.ok(v.ok, v.errors.join("\n"));
});

test("a changed answer updates the strategy, says let's try again, and asks about the next detail", () => {
  const { l, runs, records } = loop();
  recall(l);
  l.answer({ text: "5", via: "choice", choiceValue: "5" });
  let s = l.answer({ text: "it's further off now, across the room", via: "voice" });
  // location question: "across the room" is a distance word, not a location, so it is unclear
  assert.equal(s.phase, "question");
  assert.match(s.notice!, /didn't catch/);
  s = l.answer({ text: "Off to the left", via: "voice" });
  assert.equal(s.phase, "recall");
  assert.equal(s.attempt, 2);
  assert.equal(s.notice, TRY_AGAIN_LINE);
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.revision, 2);
  assert.equal(rec.changes.length, 1);
  assert.deepEqual(
    { field: rec.changes[0].field, from: rec.changes[0].from, to: rec.changes[0].to, rating: rec.changes[0].rating, words: rec.changes[0].words },
    { field: "core.location", from: "center", to: "left", rating: 5, words: "Off to the left" },
  );
  assert.equal(readField(rec.profile.states[0].strategy.steps[0], "core.location"), "left");
  assert.ok(validateProfile(rec.profile).ok, validateProfile(rec.profile).errors.join("\n"));
  assert.equal(readField(profile.states[0].strategy.steps[0], "core.location"), "center", "input profile untouched");
  assert.equal(runs.length, 1);

  // try 2 recalls the new version and asks about the next detail (size)
  recall(l);
  s = l.answer({ text: "eight", via: "voice" });
  assert.equal(s.prompt!.field, "core.size");
  s = l.answer({ text: "Still life-size", via: "choice", choiceValue: "same" });
  assert.equal(s.phase, "done");
  assert.equal(runs.length, 2);
  assert.equal(runs[1].repIndex, 5);
  for (const r of runs) assert.ok(validateRepSession(r, s.record.profile).ok);
});

test("tries stop at the maximum even while answers keep changing", () => {
  const { l, runs, records } = loop({ maxTries: 2 });
  for (const pick of ["left", "small"]) {
    recall(l);
    l.answer({ text: "6", via: "typed" });
    l.answer({ text: pick, via: "choice", choiceValue: pick });
  }
  const s = l.snapshot();
  assert.equal(s.phase, "done");
  assert.equal(runs.length, 2);
  assert.equal(records.length, 2);
  assert.equal(s.record.revision, 3);
  assert.match(s.notice!, /enough for one session/);
});

test("questionOffset starts a later session on a later detail, cycling through every step", () => {
  const targets = questionTargets(state);
  assert.equal(targets.length, 11);
  assert.deepEqual(targets[0], { stepIndex: 0, field: "core.location" });
  assert.deepEqual(targets[5], { stepIndex: 1, field: "core.source" });
  const { l } = loop({ questionOffset: 6 });
  recall(l);
  const s = l.answer({ text: "7", via: "typed" });
  assert.equal(s.prompt!.field, "core.volume");
  const after = l.answer({ text: "louder now", via: "voice" });
  assert.equal(after.changes[0].to, "loud");
});

test("free-value detail: whose voice it was", () => {
  const { l } = loop({ questionOffset: 5 });
  recall(l);
  let s = l.answer({ text: "7", via: "typed" });
  assert.equal(s.prompt!.field, "core.source");
  assert.match(s.prompt!.text, /your own voice/);
  s = l.answer({ text: "yes, still mine", via: "voice" });
  assert.equal(s.phase, "done");
  assert.equal(s.changes.length, 0);
});

test("stop logs the try in progress as a user stop; the safety screen ends with a safety stop", () => {
  const a = loop();
  a.l.answer({ text: "next", via: "typed" });
  const stopped = a.l.stop();
  assert.equal(stopped.phase, "stopped");
  assert.equal(a.runs.length, 1);
  assert.equal(a.runs[0].endedBy, "user-stop");
  assert.ok(validateRepSession(a.runs[0], profile).ok);

  const b = loop();
  const s = b.l.answer({ text: "I want to kill myself", via: "voice" });
  assert.equal(s.phase, "stopped");
  assert.ok(s.stopReason);
  assert.equal(b.runs.length, 0, "nothing was delivered, so nothing is logged");
  assert.equal(b.l.answer({ text: "next", via: "typed" }).phase, "stopped");
});

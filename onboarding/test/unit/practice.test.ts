import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateProfile, validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import { STOP_MESSAGE } from "../../src/engine/safety.ts";
import { createPracticeLoop, questionTargets, readQuestionAnswer, TRY_AGAIN_LINE } from "../../src/practice/loop.ts";
import { parseRating } from "../../src/practice/rating.ts";
import { applyChange, newRecord, readField, type StrategyRecord } from "../../src/store/index.ts";

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

test("review findings: scales, number words inside words, and hundreds are not ratings", () => {
  const cases: [string, number | null][] = [
    ["on a scale of 1 to 10, 7", 7],
    ["scale of one to ten I'd say eight", 8],
    ["one hundred", null],
    ["100%", null],
    ["none of it, maybe a six", 6],
    ["not one bit", null],
    ["I'm at 0", 0],
    ["10/10", 10],
  ];
  for (const [text, want] of cases) assert.equal(parseRating(text), want, text);
});

test("review findings: bare no, negations and 'but' are never read as the same answer", () => {
  const step = (i: number) => state.strategy.steps[i];
  const read = (i: number, field: string, text: string) => readQuestionAnswer(step(i), field, { text, via: "voice" });
  // whose voice (free text): a bare no is unclear, not the new value
  for (const t of ["no", "nope", "different", "Different.", "it's different now"]) assert.equal(read(1, "core.source", t).kind, "unclear", t);
  assert.equal(read(1, "core.source", "yes, still mine").kind, "same");
  assert.deepEqual(read(1, "core.source", "my coach's voice"), { kind: "change", to: "my coach's voice", words: "my coach's voice" });
  // step words: a bare no is unclear
  for (const t of ["no", "different"]) assert.equal(read(0, "content", t).kind, "unclear", t);
  // negations
  assert.equal(read(0, "core.location", "not the same").kind, "unclear");
  assert.equal(read(0, "core.location", "no it's not in the center anymore").kind, "unclear");
  assert.deepEqual(read(0, "core.location", "not in the center, it's on the left").kind, "change");
  assert.equal((read(0, "core.location", "not in the center, it's on the left") as { to: string }).to, "left");
  assert.equal(read(0, "core.distance", "not close anymore").kind, "unclear");
  assert.equal((read(0, "core.distance", "it's further away now") as { to: string }).to, "far");
  assert.equal(read(0, "core.brightness", "still bright but further").kind, "same");
  assert.equal(read(0, "core.brightness", "less bright now").kind, "unclear");
  assert.equal(read(0, "core.brightness", "still bright").kind, "same");
  // intensity takes the last number
  assert.equal((read(2, "core.intensity", "it went from 8 to 9") as { to: number }).to, 9);
  assert.equal((read(2, "core.intensity", "less than 8, more like 6") as { to: number }).to, 6);
  assert.equal(read(2, "core.intensity", "still 8").kind, "same");
});

test("second review: no-change phrases, negated other values, scales and free text", () => {
  const step = (i: number) => state.strategy.steps[i];
  const read = (i: number, field: string, text: string) => readQuestionAnswer(step(i), field, { text, via: "voice" });
  for (const t of ["it hasn't changed", "didn't change", "it's the same, nothing changed", "nothing's different", "still close, isn't it?", "it's not far, still close", "still close but brighter"]) {
    assert.equal(read(0, "core.distance", t).kind, "same", t);
  }
  assert.equal(read(0, "core.location", "it's still in the center, hasn't moved").kind, "same");
  assert.equal(read(0, "core.location", "not on the left, still in the center").kind, "same");
  assert.notEqual(read(0, "core.brightness", "it's not dim").kind, "change");
  assert.equal(read(0, "core.brightness", "it doesn't feel dim, still bright").kind, "same");
  assert.equal((read(0, "core.distance", "it was close, now it's far") as { to: string }).to, "far");
  // intensity: the scale is never the answer
  assert.equal(read(2, "core.intensity", "8/10").kind, "same");
  assert.equal(read(2, "core.intensity", "same as last time, 8 out of 10").kind, "same");
  assert.equal((read(2, "core.intensity", "about a nine out of ten") as { to: number }).to, 9);
  // whose voice: same-answers are never saved as the new source
  for (const t of ["yes it's still my own voice", "same voice as before, yes", "still my own voice, but louder", "it hasn't changed", "it's my own voice"]) {
    assert.equal(read(1, "core.source", t).kind, "same", t);
  }
  // step words: no-change answers keep the words
  for (const t of ["it hasn't changed", "nothing changed", "yes, still the face in the room"]) assert.equal(read(0, "content", t).kind, "same", t);
  assert.equal(read(0, "content", "a new face, my daughter's").kind, "change");
});

test("second review: a peak moved onto its contrast drops that difference and its driver", () => {
  const next = applyChange(newRecord(profile), { stateId: state.id, stepIndex: 0, field: "core.distance", to: "far", rating: 5 });
  const st = next.profile.states[0];
  assert.equal(st.differences.some((d) => d.attribute === "distance"), false);
  assert.deepEqual(st.drivers.map((i) => st.differences[i].attribute), ["brightness", "volume"]);
  const v = validateProfile(next.profile);
  assert.ok(v.ok, v.errors.join("\n"));
});

test("review findings: a changed detail moves its driver's peak; content changes carry no words", () => {
  const d = state.differences.findIndex((x) => x.modality === "visual" && x.attribute === "distance");
  assert.ok(d >= 0, "demo has a distance driver");
  const next = applyChange(newRecord(profile), { stateId: state.id, stepIndex: state.differences[d].stepIndex, field: "core.distance", to: "arm-length", rating: 5 });
  assert.equal(next.profile.states[0].differences[d].peak, "arm-length");
  assert.equal(next.profile.states[0].differences[d].ratingDelta, null);
  const v = validateProfile(next.profile);
  assert.ok(v.ok, v.errors.join("\n"));
  const c = applyChange(newRecord(profile), { stateId: state.id, stepIndex: 2, field: "content", to: "x", words: "hello", rating: null });
  assert.equal(c.changes[0].words, undefined);
});

test("review findings: the safety stop shows the stop message, never the screened category", () => {
  const { l } = loop();
  const s = l.answer({ text: "I want to kill myself", via: "voice" });
  assert.equal(s.safetyStopped, true);
  assert.equal(s.stopReason, STOP_MESSAGE);
  const u = loop();
  u.l.answer({ text: "next", via: "typed" });
  assert.equal(u.l.stop().safetyStopped, false);
});

test("labels in the person's words are spoken in the guide's voice", () => {
  const p = JSON.parse(JSON.stringify(profile)) as ProfileV2;
  p.states[0].label = "playful with my kids";
  const l = createPracticeLoop({ record: newRecord(p) });
  let s = l.snapshot();
  while (s.phase === "recall") s = l.answer({ text: "next", via: "choice", choiceValue: "next" });
  assert.equal(s.prompt!.text, "How close did you get to feeling playful with your kids, from 0 to 10?");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateOnboardingEvent, validateProfile, type OnboardingEvent, type Step } from "@peak-state/contracts";
import { createEngine, inferDirection, parseSubmodality, screenAnswer, startHintTimer } from "../../src/engine/index.ts";
import type { Answer, EngineSnapshot, Question, QuestionEngine } from "../../src/types.ts";

const coreOf = (s: Step): unknown => (s.submodalities as { core?: unknown }).core;

const T0 = Date.UTC(2026, 9, 3, 9, 0, 0);

function clock() {
  let t = T0;
  return () => (t += 1000);
}

function setup(maxSteps?: number) {
  const events: OnboardingEvent[] = [];
  const engine = createEngine({ now: clock(), onEvent: (e) => events.push(e), profileId: "test-profile", maxSteps });
  return { engine, events };
}

const suggestion = (q: Question, i: 0 | 1): Answer => ({ text: q.suggestions[i], via: "suggestion" });
const choice = (q: Question, value: string): Answer => {
  const c = q.choices.find((x) => x.value === value);
  assert.ok(c, `${q.id} has choice ${value}`);
  return { text: c.label, via: "choice", choiceValue: c.value };
};

/** Answer questions in order with a planner that only ever uses a suggestion or a choice button. */
function drive(engine: QuestionEngine, plan: (q: Question) => Answer, limit = 100): EngineSnapshot {
  let snap = engine.snapshot();
  for (let n = 0; snap.status === "asking" && n < limit; n++) {
    const q = snap.question;
    assert.ok(q);
    snap = engine.answer(plan(q));
  }
  return snap;
}

function assertEventsValid(events: OnboardingEvent[]) {
  for (const e of events) {
    const r = validateOnboardingEvent(e);
    assert.ok(r.ok, `${e.type}: ${r.errors.join("; ")}`);
  }
}

test("first question is choose-state with Content and Excited", () => {
  const { engine, events } = setup();
  const s = engine.snapshot();
  assert.equal(s.status, "asking");
  assert.equal(s.question?.kind, "choose-state");
  assert.equal(s.question?.text, "What state do you want to choose?");
  assert.deepEqual(s.question?.choices.map((c) => c.label), ["Content", "Excited"]);
  assert.equal(events[0].type, "guideTurn");
  assert.deepEqual(s.transcript, [{ who: "guide", text: "What state do you want to choose?" }]);
});

test("content: two steps, answered only with suggestions and choices, reaches a valid confirmed profile", () => {
  const { engine, events } = setup();
  const snap = drive(engine, (q) => {
    switch (q.kind) {
      case "choose-state":
        return choice(q, "content");
      case "memory":
      case "first-step":
      case "submodality":
        return suggestion(q, 0);
      case "next-step":
        return suggestion(q, 1);
      case "fully-in":
        return choice(q, q.id === "fully-in:0" ? "no" : "yes");
      case "anchor":
        return choice(q, "1");
      case "confirm":
        return choice(q, "yes");
      default:
        throw new Error(`unexpected ${q.id}`);
    }
  });

  assert.equal(snap.status, "confirmed");
  assert.equal(snap.question, null);
  assert.equal(snap.chain, "Ve → Ki");
  assert.equal(snap.fullyInAt, 1);
  assert.equal(snap.anchorStep, 1);
  assert.ok(snap.profile);
  const r = validateProfile(snap.profile);
  assert.ok(r.ok, r.errors.join("\n"));

  const p = snap.profile;
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.profileId, "test-profile");
  assert.ok(p.confirmedAt);
  const st = p.states[0];
  assert.equal(st.id, "content");
  assert.equal(st.label, "Content");
  assert.equal(st.memoryCue, "A slow Sunday morning, coffee on the porch, nowhere to be");
  assert.equal(st.strategy.confirmed, true);
  assert.equal(st.strategy.fullyInAt, 1);
  assert.equal(st.anchorStep, 1);
  assert.deepEqual(st.differences, []);
  assert.deepEqual(st.calibration, { peak: null, contrast: null });

  const [s0, s1] = st.strategy.steps;
  assert.equal(s0.modality, "visual");
  assert.equal(s0.direction, "external");
  assert.equal(s0.content, "I saw the evening light on the water");
  assert.deepEqual(s0.submodalities.core, { location: "center", size: "life-size", distance: "close", brightness: "bright", perspective: "associated" });
  assert.equal(s0.submodalities.words?.distance, "It's close, right in front of me");
  assert.equal(s1.modality, "kinesthetic");
  assert.equal(s1.direction, "internal");
  assert.equal(s1.content, "I felt my shoulders drop");
  assert.deepEqual(s1.submodalities.core, { bodyLocation: "chest", intensity: 7, movement: "moving" });

  // Snapshot step views carry the human-label checklist.
  assert.equal(snap.steps.length, 2);
  assert.equal(snap.steps[1].isAnchor, true);
  assert.deepEqual(snap.steps[1].checklist.map((c) => c.label), ["Where in the body", "Intensity", "Moving or still"]);

  // Events: valid against the contracts schema, in the expected kinds.
  assertEventsValid(events);
  const types = events.map((e) => e.type);
  assert.equal(types.filter((t) => t === "stateNamed").length, 1);
  assert.equal(types.filter((t) => t === "stepCaptured").length, 2);
  assert.equal(types.filter((t) => t === "submodalityCaptured").length, 8);
  assert.equal(types.filter((t) => t === "anchorStepMarked").length, 1);
  assert.equal(types.at(-1), "confirmed");
  const sub = events.find((e) => e.type === "submodalityCaptured");
  assert.equal(sub?.type === "submodalityCaptured" && sub.target, "peak");

  // Playback reflects their words.
  const confirmQ = snap.transcript.filter((l) => l.who === "guide").at(-1)?.text;
  assert.equal(confirmQ, "So first you saw the evening light on the water, and then you felt your shoulders drop. Is that the order?");
});

test("excited: three steps, answered only with suggestions and choices, reaches a valid confirmed profile", () => {
  const { engine, events } = setup();
  const snap = drive(engine, (q) => {
    switch (q.kind) {
      case "choose-state":
        return suggestion(q, 1); // "Excited, like something great is about to happen"
      case "memory":
        return suggestion(q, 1);
      case "first-step":
        return suggestion(q, 1); // heard the opening beat
      case "next-step":
        return suggestion(q, 0); // said to myself / felt a buzz
      case "submodality":
        return q.target?.attribute === "volume" ? suggestion(q, 0) : suggestion(q, 1);
      case "fully-in":
        if (q.id === "fully-in:0") return suggestion(q, 1); // "No, there was a next thing"
        if (q.id === "fully-in:1") return choice(q, "no");
        return suggestion(q, 0); // "Yes, fully excited right there"
      case "anchor":
        return suggestion(q, 1); // "The last one, ..."
      case "confirm":
        return suggestion(q, 0); // "Yes, that's right"
      default:
        throw new Error(`unexpected ${q.id}`);
    }
  });

  assert.equal(snap.status, "confirmed");
  assert.ok(snap.profile);
  const r = validateProfile(snap.profile);
  assert.ok(r.ok, r.errors.join("\n"));
  const st = snap.profile.states[0];
  assert.equal(st.id, "excited");
  assert.equal(st.label, "Excited");
  assert.equal(st.words, "Excited, like something great is about to happen");
  assert.equal(snap.chain, "Ae → Ai → Ki");
  assert.equal(st.strategy.steps.length, 3);
  assert.equal(st.strategy.fullyInAt, 2);
  assert.equal(st.anchorStep, 2);
  const [a0, a1, k2] = st.strategy.steps;
  assert.deepEqual(coreOf(a0), { source: "My own voice saying, let's go", volume: "loud", location: "front" });
  assert.deepEqual(coreOf(a1), { source: "My own voice saying, let's go", volume: "loud", location: "front" });
  assert.deepEqual(coreOf(k2), { bodyLocation: "arms", intensity: 7, movement: "still" });
  assertEventsValid(events);
  assert.equal(events.at(-1)?.type, "confirmed");
});

test("a custom state is accepted in the person's words", () => {
  const { engine } = setup();
  const s = engine.answer({ text: "Calm before a pitch", via: "typed" });
  assert.equal(s.stateId, "calm-before-a-pitch");
  assert.equal(s.stateLabel, "Calm before a pitch");
  assert.match(s.question?.text ?? "", /felt totally calm before a pitch\?/);
  assert.deepEqual(s.question?.suggestions.length, 2);
});

test("modality is asked only when the step's sense cannot be read, and unreadable submodalities move on", () => {
  const { engine, events } = setup();
  engine.answer({ text: "Content", via: "choice", choiceValue: "content" });
  engine.answer({ text: "I'm there", via: "choice", choiceValue: "there" });
  let s = engine.answer({ text: "The moment the meeting ended", via: "typed" });
  assert.equal(s.question?.kind, "modality");
  s = engine.answer({ text: "Something I felt", via: "choice", choiceValue: "kinesthetic" });
  assert.equal(s.question?.id, "sub:kinesthetic:bodyLocation:0");
  s = engine.answer({ text: "hard to say", via: "typed" });
  assert.equal(s.question?.id, "sub:kinesthetic:intensity:0");
  assert.equal(s.steps[0].checklist[0].value, null);
  assert.equal(s.steps[0].checklist[0].words, "hard to say");
  s = engine.answer({ text: "8", via: "choice", choiceValue: "8" });
  s = engine.answer({ text: "it washes through", via: "typed" });
  assert.equal(s.question?.kind, "fully-in");
  assert.deepEqual(
    s.steps[0].checklist.map((c) => c.value),
    [null, 8, "moving"],
  );
  assertEventsValid(events);
});

test("an unclear yes/no keeps the same question", () => {
  const { engine } = setup();
  engine.answer({ text: "Content", via: "choice", choiceValue: "content" });
  engine.answer({ text: "I'm there", via: "choice", choiceValue: "there" });
  engine.answer({ text: "I felt my shoulders drop", via: "typed" });
  engine.answer({ text: "shoulders", via: "typed" });
  engine.answer({ text: "6", via: "typed" });
  let s = engine.answer({ text: "still", via: "typed" });
  assert.equal(s.question?.id, "fully-in:0");
  s = engine.answer({ text: "hmm", via: "typed" });
  assert.equal(s.question?.id, "fully-in:0");
});

test("safety: a stop-line answer stops with a stopped event and a draft", () => {
  assert.equal(screenAnswer("I had a panic attack").ok, false);
  assert.equal(screenAnswer("I felt my shoulders drop").ok, true);
  const { engine, events } = setup();
  engine.answer({ text: "Content", via: "choice", choiceValue: "content" });
  const s = engine.answer({ text: "Honestly I keep thinking about hurting myself", via: "voice" });
  assert.equal(s.status, "stopped");
  assert.equal(s.question, null);
  assert.match(s.stopReason ?? "", /not the right support/);
  assert.match(s.stopReason ?? "", /person you trust/);
  assert.match(s.stopReason ?? "", /emergency services/);
  const stopped = events.at(-1);
  assert.equal(stopped?.type, "stopped");
  if (stopped?.type === "stopped") {
    assert.equal(stopped.reason, "safety");
    assert.ok(stopped.draft);
    assert.equal(stopped.draft.confirmedAt, null);
    assert.ok(validateProfile(stopped.draft).ok);
  }
  assertEventsValid(events);
  // Further answers are ignored.
  assert.equal(engine.answer({ text: "ok", via: "typed" }).status, "stopped");
  // back() undoes the stop.
  assert.equal(engine.back().status, "asking");
});

test("back() undoes the last answer and reset() starts over", () => {
  const { engine } = setup();
  engine.answer({ text: "Content", via: "choice", choiceValue: "content" });
  engine.answer({ text: "Sunday morning", via: "typed" });
  let s = engine.answer({ text: "I saw the evening light on the water", via: "typed" });
  assert.equal(s.question?.id, "sub:visual:location:0");
  assert.equal(s.steps.length, 1);
  s = engine.back();
  assert.equal(s.question?.id, "first-step");
  assert.equal(s.steps.length, 0);
  assert.equal(s.stateId, "content");
  s = engine.answer({ text: "I heard the kettle click off", via: "typed" });
  assert.equal(s.question?.id, "sub:auditory:source:0");
  assert.equal(s.chain, "Ae");
  s = engine.back();
  s = engine.back();
  s = engine.back();
  assert.equal(s.question?.kind, "choose-state");
  assert.equal(s.stateId, null);
  assert.equal(engine.back().question?.kind, "choose-state");
  engine.answer({ text: "Excited", via: "choice", choiceValue: "excited" });
  s = engine.reset();
  assert.equal(s.question?.kind, "choose-state");
  assert.equal(s.transcript.length, 1);
});

test("confirm 'no' goes through the steps again, keeping the state and memory", () => {
  const { engine } = setup();
  engine.answer({ text: "Content", via: "choice", choiceValue: "content" });
  engine.answer({ text: "Sunday morning", via: "typed" });
  engine.answer({ text: "I felt my shoulders drop", via: "typed" });
  engine.answer({ text: "shoulders", via: "typed" });
  engine.answer({ text: "6", via: "typed" });
  engine.answer({ text: "still", via: "typed" });
  engine.answer({ text: "Fully content", via: "choice", choiceValue: "yes" });
  engine.answer({ text: "1. I felt my shoulders drop", via: "choice", choiceValue: "0" });
  let s = engine.answer({ text: "No, let's go again", via: "choice", choiceValue: "no" });
  assert.equal(s.question?.id, "first-step");
  assert.equal(s.steps.length, 0);
  assert.equal(s.stateId, "content");
  assert.equal(s.anchorStep, null);
});

test("maxSteps caps the step loop and treats the last step as fully in", () => {
  const { engine } = setup(2);
  const snap = drive(engine, (q) => {
    switch (q.kind) {
      case "choose-state":
        return choice(q, "content");
      case "fully-in":
        return choice(q, "no");
      case "anchor":
        return choice(q, "0");
      case "confirm":
        return choice(q, "yes");
      default:
        return suggestion(q, 0);
    }
  });
  assert.equal(snap.status, "confirmed");
  assert.equal(snap.profile?.states[0].strategy.steps.length, 2);
  assert.equal(snap.fullyInAt, 1);
  assert.ok(validateProfile(snap.profile).ok);

  const def = setup();
  const s6 = drive(def.engine, (q) => (q.kind === "choose-state" ? choice(q, "excited") : q.kind === "fully-in" ? choice(q, "no") : q.kind === "anchor" ? choice(q, "3") : q.kind === "confirm" ? choice(q, "yes") : suggestion(q, 1)));
  assert.equal(s6.profile?.states[0].strategy.steps.length, 6);
  assert.equal(s6.fullyInAt, 5);
  assert.ok(validateProfile(s6.profile).ok);
});

test("direction and choice precedence", () => {
  assert.equal(inferDirection("I saw the evening light", 0), "external");
  assert.equal(inferDirection("I saw the evening light", 1), "internal");
  assert.equal(inferDirection("I said to myself, go", 0), "internal");
  assert.equal(inferDirection("someone said my name", 2), "external");
  assert.equal(parseSubmodality("visual", "distance", "It's close", "far"), "far");
  assert.equal(parseSubmodality("kinesthetic", "intensity", "about seven"), 7);
  assert.equal(parseSubmodality("kinesthetic", "intensity", "very strong"), 8);
});

test("hint timer shows the two suggestions after the delay and can be cancelled", () => {
  const { engine } = setup();
  const q = engine.snapshot().question!;
  let fire: (() => void) | null = null;
  let delay = 0;
  const shown: [string, string][] = [];
  const cancel = startHintTimer(q, (s) => shown.push(s), { setTimer: (fn, ms) => ((fire = fn), (delay = ms)), clearTimer: () => (fire = null) });
  assert.equal(delay, 5000);
  (fire as (() => void) | null)?.();
  assert.deepEqual(shown, [q.suggestions]);
  cancel();
  const cancel2 = startHintTimer(q, (s) => shown.push(s), { setTimer: (fn) => (fire = fn), clearTimer: () => (fire = null) });
  cancel2();
  assert.equal(fire, null);
});

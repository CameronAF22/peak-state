import { test } from "node:test";
import assert from "node:assert/strict";

import { SUBMODALITIES, type SensoryModality } from "@peak-state/contracts";
import {
  buildQuestion,
  coreAttributes,
  everyQuestion,
  playbackLine,
  stepSuggestions,
  SUGGESTIONS,
  type SuggestionSetKey,
} from "../../script/questions.ts";
import { inferModality, isCoreValue, parseAnchor, parseStateChoice, parseSubmodality, parseYesNo } from "../../src/engine/parse.ts";
import { screenAnswer } from "../../src/engine/safety.ts";

const KEYS: SuggestionSetKey[] = ["content", "destressed", "generic"];
const MODALITIES: SensoryModality[] = ["visual", "auditory", "kinesthetic"];

test("every question has exactly two non-empty, distinct suggestions", () => {
  const all = everyQuestion();
  assert.ok(all.length > 100);
  for (const q of all) {
    assert.equal(q.suggestions.length, 2, q.id);
    const [a, b] = q.suggestions;
    assert.ok(a.trim().length > 0 && b.trim().length > 0, q.id);
    assert.notEqual(a, b, q.id);
    assert.ok(!a.includes("{") && !b.includes("{") && !q.text.includes("{"), `${q.id} has an unfilled placeholder`);
  }
});

test("no suggestion trips the safety screen", () => {
  for (const q of everyQuestion()) for (const s of q.suggestions) assert.ok(screenAnswer(s).ok, s);
});

test("question ids are stable and kinds match the flow", () => {
  const state = { key: "content" as const, phrase: "content" };
  assert.equal(buildQuestion({ kind: "choose-state" }).text, "What state do you want to choose?");
  assert.deepEqual(
    buildQuestion({ kind: "choose-state" }).choices.map((c) => c.value),
    ["content", "destressed"],
  );
  assert.match(buildQuestion({ kind: "memory", state }).text, /felt totally content\?/);
  assert.equal(buildQuestion({ kind: "next-step", state, stepIndex: 2 }).id, "next-step:2");
  const sub = buildQuestion({ kind: "submodality", state, stepIndex: 0, modality: "visual", attribute: "distance" });
  assert.equal(sub.id, "sub:visual:distance:0");
  assert.deepEqual(sub.target, { stepIndex: 0, modality: "visual", attribute: "distance" });
  assert.ok(sub.choices.some((c) => c.value === "arm-length" && c.label === "Arm's length"));
  const fully = buildQuestion({ kind: "fully-in", state, stepIndex: 1 });
  assert.equal(fully.text, "Were you fully content at that point, or was there a next thing?");
  assert.deepEqual(fully.choices, [
    { value: "yes", label: "Fully content" },
    { value: "no", label: "There was a next thing" },
  ]);
  const anchor = buildQuestion({ kind: "anchor", state, steps: ["I saw it", "I felt it"] });
  assert.deepEqual(anchor.choices.map((c) => c.value), ["0", "1"]);
});

test("submodality choices are the contracts vocabulary", () => {
  const state = { key: "generic" as const, phrase: "calm" };
  for (const modality of MODALITIES) {
    for (const attribute of coreAttributes(modality)) {
      const q = buildQuestion({ kind: "submodality", state, stepIndex: 0, modality, attribute });
      for (const c of q.choices) {
        const v = attribute === "intensity" ? Number(c.value) : c.value;
        assert.ok(isCoreValue(modality, attribute, v), `${modality}.${attribute}=${c.value}`);
        assert.equal(parseSubmodality(modality, attribute, c.label, c.value), v);
      }
      const vocab = (SUBMODALITIES[modality].core as Record<string, readonly string[] | null>)[attribute];
      if (vocab) assert.equal(q.choices.length, vocab.length);
    }
  }
});

test("every submodality suggestion parses to a vocabulary value", () => {
  for (const key of KEYS) {
    for (const modality of MODALITIES) {
      for (const attribute of coreAttributes(modality)) {
        const pair = SUGGESTIONS[key].submodality[modality][attribute];
        assert.ok(pair, `${key} ${modality}.${attribute} has suggestions`);
        for (const s of pair) {
          const v = parseSubmodality(modality, attribute, s);
          assert.ok(v !== null && isCoreValue(modality, attribute, v), `${key} ${modality}.${attribute}: "${s}" → ${v}`);
        }
        // The two suggestions offer two different answers, except free-text source.
        if (attribute !== "source") {
          assert.notEqual(parseSubmodality(modality, attribute, pair[0]), parseSubmodality(modality, attribute, pair[1]), `${key} ${modality}.${attribute}`);
        }
      }
    }
  }
});

test("step suggestions parse to a modality and vary by step", () => {
  for (const key of KEYS) {
    for (let i = 0; i < 8; i++) {
      const pair = stepSuggestions(key, i);
      for (const s of pair) assert.ok(inferModality(s), `${key} step ${i}: "${s}"`);
      if (i > 0) assert.notDeepEqual(pair, stepSuggestions(key, i - 1), `${key} step ${i} repeats step ${i - 1}`);
    }
  }
  assert.equal(inferModality("I saw the evening light on the water"), "visual");
  assert.equal(inferModality("I said to myself, it's all handled"), "auditory");
  assert.equal(inferModality("I felt my shoulders drop"), "kinesthetic");
});

test("modality, yes/no, anchor and state suggestions parse", () => {
  for (const key of KEYS) {
    const s = SUGGESTIONS[key];
    for (const m of s.modality) assert.ok(inferModality(m), m);
    const fill = (t: string) => t.replaceAll("{state}", key);
    assert.equal(parseYesNo(fill(s.fullyIn[0])), "yes", s.fullyIn[0]);
    assert.equal(parseYesNo(fill(s.fullyIn[1])), "no", s.fullyIn[1]);
    assert.equal(parseYesNo(s.confirm[0]), "yes", s.confirm[0]);
    assert.equal(parseYesNo(s.confirm[1]), "no", s.confirm[1]);
    const steps = [
      { content: "I saw it", modality: "visual" as const },
      { content: "I said it", modality: "auditory" as const },
      { content: "I felt it", modality: "kinesthetic" as const },
    ];
    for (const a of s.anchor) assert.notEqual(parseAnchor(a, steps), null, a);
  }
  const chosen = buildQuestion({ kind: "choose-state" }).suggestions.map((t) => parseStateChoice(t)?.id);
  assert.deepEqual(chosen, ["content", "destressed"]);
});

test("playback reflects the person's own words in order", () => {
  assert.equal(
    playbackLine(["I saw the evening light on the water", "I said to myself, I am fine", "I felt my shoulders drop"]),
    "first you saw the evening light on the water, then you said to yourself, I am fine, and then you felt your shoulders drop",
  );
  assert.equal(playbackLine(["the crowd"]), "first “the crowd”");
});

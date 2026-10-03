import assert from "node:assert/strict";
import { test } from "node:test";

import { endsSentence, mapWordIndex, SENTENCE_PAUSE_MS, splitWords, wordAtTime, wordIndexAtChar, wordTimeline, WORDS_PER_SECOND } from "../../src/voice/words.ts";

test("splitWords: words with offsets, any whitespace", () => {
  const w = splitWords("  See the  light.\nThen breathe ");
  assert.deepEqual(
    w.map((x) => x.text),
    ["See", "the", "light.", "Then", "breathe"],
  );
  assert.deepEqual(w[2], { text: "light.", start: 11, end: 17 });
  assert.deepEqual(splitWords(""), []);
  assert.deepEqual(splitWords("   "), []);
});

test("wordIndexAtChar: the word at or after a boundary offset", () => {
  const w = splitWords("What was the first thing?");
  assert.equal(wordIndexAtChar(w, 0), 0);
  assert.equal(wordIndexAtChar(w, 5), 1);
  assert.equal(wordIndexAtChar(w, 4), 1); // the space before "was"
  assert.equal(wordIndexAtChar(w, 999), 4);
  assert.equal(wordIndexAtChar([], 3), -1);
});

test("endsSentence: . ! ? … and closing quotes", () => {
  for (const s of ["done.", "now!", "why?", "so…", 'it."', "it.”", "(yes.)"]) assert.equal(endsSentence(s), true, s);
  for (const s of ["comma,", "word", "e.g", "3.5x"]) assert.equal(endsSentence(s), false, s);
});

test("wordTimeline: 2.6 words a second and a 1 s pause after each sentence (D-reps-010)", () => {
  assert.equal(WORDS_PER_SECOND, 2.6);
  assert.equal(SENTENCE_PAUSE_MS, 1000);
  const per = 1000 / 2.6;
  const t = wordTimeline(splitWords("See it. Feel it now."));
  assert.deepEqual(t.starts, [0, Math.round(per), Math.round(2 * per + 1000), Math.round(3 * per + 1000), Math.round(4 * per + 1000)]);
  // No pause after the final word.
  assert.equal(t.total, Math.round(5 * per + 1000));
  assert.deepEqual(wordTimeline([]), { starts: [], total: 0 });
  // Custom pace.
  assert.deepEqual(wordTimeline(["a", "b"], { wordsPerSecond: 2, sentencePauseMs: 0 }), { starts: [0, 500], total: 1000 });
});

test("wordAtTime: before, during and after the line", () => {
  const t = wordTimeline(["One.", "Two", "three"], { wordsPerSecond: 2, sentencePauseMs: 1000 });
  assert.deepEqual(t.starts, [0, 1500, 2000]);
  assert.equal(wordAtTime(t, -1), -1);
  assert.equal(wordAtTime(t, 0), 0);
  assert.equal(wordAtTime(t, 1499), 0); // the pause belongs to the sentence's last word
  assert.equal(wordAtTime(t, 1500), 1);
  assert.equal(wordAtTime(t, 2400), 2);
  assert.equal(wordAtTime(t, t.total), 3);
});

test("mapWordIndex: same text, shown inside spoken, and a proportional fallback", () => {
  assert.equal(mapWordIndex("a b c", "a b c", 1), 1);
  assert.equal(mapWordIndex("a b c", "a b c", 9), 3);
  // A notice spoken before the question.
  const spoken = "Okay, let's try again. Where is the picture?";
  const shown = "Where is the picture?";
  assert.equal(mapWordIndex(spoken, shown, 0), -1);
  assert.equal(mapWordIndex(spoken, shown, 4), 0);
  assert.equal(mapWordIndex(spoken, shown, 7), 3);
  assert.equal(mapWordIndex(spoken, shown, 8), 4);
  // Said differently: proportional.
  assert.equal(mapWordIndex("one two three four", "alpha beta", 0), 0);
  assert.equal(mapWordIndex("one two three four", "alpha beta", 2), 1);
  assert.equal(mapWordIndex("one two three four", "alpha beta", 4), 2);
  assert.equal(mapWordIndex("", "x", 0), -1);
});

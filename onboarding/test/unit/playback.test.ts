import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateRepSession, type ProfileV2 } from "@peak-state/contracts";
import { buildPlaybackLines, runStrategy, scriptHash, toSecondPerson } from "../../src/playback/index.ts";
import { appendRun, clearStrategy, loadRuns, loadStrategy, saveStrategy, type KeyValueStore } from "../../src/playback/storage.ts";

const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;
const state = profile.states[0];

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

test("buildPlaybackLines follows the person's steps in order and ends on the anchor", () => {
  const lines = buildPlaybackLines(profile, state.id);
  assert.equal(lines[0].kind, "intro");
  const steps = lines.filter((l) => l.kind === "step");
  assert.deepEqual(
    steps.map((l) => l.stepIndex),
    state.strategy.steps.map((_, i) => i),
  );
  assert.match(steps[0].text, /^See the first face in the room looking up at you\./);
  assert.match(steps[0].text, /bright/);
  assert.match(steps[1].text, /^Hear your own voice say 'here we go, slow', quietly\.$/);
  assert.match(steps[2].text, /^Feel warmth spreading through your chest/);
  const last = lines[lines.length - 1];
  assert.equal(last.kind, "anchor");
  assert.equal(last.stepIndex, state.anchorStep);
  assert.match(last.text, /let it fill you\.$/);
  assert.equal(scriptHash(lines), scriptHash(buildPlaybackLines(profile, state.id)));
});

test("toSecondPerson leaves quoted self-talk alone", () => {
  assert.equal(toSecondPerson("I'm on my porch and 'I've got this' rings in me"), "you're on your porch and 'I've got this' rings in you");
});

test("runStrategy returns a RepSession the contracts validator accepts", async () => {
  let t = Date.parse("2026-10-03T16:00:00Z");
  const seen: number[] = [];
  const spoken: string[] = [];
  const ratings = [3, 8];
  const session = await runStrategy(
    profile,
    state.id,
    {
      onStep: (i) => void seen.push(i),
      rate: async () => ratings.shift() ?? 0,
      speak: async (text) => void spoken.push(text),
    },
    { pauseMs: 0, now: () => (t += 1000), repIndex: 2, wait: async () => {} },
  );
  const result = validateRepSession(session, profile);
  assert.ok(result.ok, result.errors.join("\n"));
  assert.deepEqual(seen, [-1, 0, 1, 2, state.anchorStep]);
  assert.equal(spoken.length, 5);
  assert.equal(session.intensityBefore, 3);
  assert.equal(session.intensityAfter, 8);
  assert.equal(session.repIndex, 2);
  assert.equal(session.anchorPaired, true);
  assert.equal(session.endedBy, "completed");
  assert.deepEqual(
    session.steps.map((s) => s.kind),
    ["rate", "strategy-step", "strategy-step", "strategy-step", "anchor-peak", "rate"],
  );
});

test("a stopped run is logged as user-stop and still validates", async () => {
  let calls = 0;
  const session = await runStrategy(
    profile,
    state.id,
    { onStep: () => {}, rate: async () => 5, speak: async () => {} },
    { pauseMs: 0, wait: async () => {}, shouldStop: () => ++calls > 2 },
  );
  assert.equal(session.endedBy, "user-stop");
  assert.equal(session.intensityAfter, null);
  assert.equal(session.anchorPaired, false);
  assert.ok(validateRepSession(session, profile).ok);
});

test("storage round-trips the strategy and the run log", async () => {
  const store = memoryStore();
  assert.equal(loadStrategy(store), null);
  saveStrategy(profile, store, () => 0);
  assert.equal(loadStrategy(store)?.profile.profileId, profile.profileId);
  assert.equal(loadStrategy(store)?.savedAt, "1970-01-01T00:00:00.000Z");
  const session = await runStrategy(profile, state.id, { onStep: () => {}, rate: async () => 4, speak: async () => {} }, { pauseMs: 0, wait: async () => {} });
  appendRun(session, store);
  assert.equal(loadRuns(store).length, 1);
  clearStrategy(store);
  assert.equal(loadStrategy(store), null);
  assert.equal(loadRuns(store).length, 1);
});

test("stepLine turns first-person answers into gentle instructions with lowercase details", async () => {
  const { stepLine } = await import("../../src/playback/script.ts");
  type Step = ProfileV2["states"][number]["strategy"]["steps"][number];
  const visual: Step = {
    modality: "visual",
    direction: "external",
    content: "I saw the to-do list fade out",
    submodalities: { core: { distance: "close", brightness: "dim", size: "small" }, words: { distance: "Close", brightness: "Dim", size: "Small" } },
  };
  assert.equal(stepLine(visual), "See the to-do list fade out. Bring it close, dim and small.");
  const looked: Step = { modality: "visual", direction: "external", content: "I looked at my garden", submodalities: {} };
  assert.equal(stepLine(looked), "See your garden.");
  const felt: Step = {
    modality: "kinesthetic",
    direction: "internal",
    content: "I felt my shoulders drop",
    submodalities: { core: { bodyLocation: "shoulders", movement: "still" }, words: { movement: "Still" } },
  };
  assert.equal(stepLine(felt), "Feel your shoulders drop, still and steady.");
  const said: Step = { modality: "auditory", direction: "internal", content: "I said to myself, this is enough", submodalities: { core: { volume: "quiet" } } };
  assert.equal(stepLine(said), "Hear your own voice say 'this is enough', quietly.");
  const heard: Step = { modality: "auditory", direction: "external", content: "I heard the kettle click off near me", submodalities: {} };
  assert.equal(stepLine(heard), "Hear the kettle click off near you.");
  const im: Step = { modality: "kinesthetic", direction: "internal", content: "I'm warm all over", submodalities: {} };
  assert.equal(stepLine(im), "Feel warm all over.");
});

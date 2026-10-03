import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { validateProfile, type ProfileV2 } from "@peak-state/contracts";
import { STRATEGY_KEY, type KeyValueStore } from "../../src/playback/storage.ts";
import { applyChange, loadRecord, newer, newRecord, readField, saveRecord, toRecord } from "../../src/store/index.ts";

const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;
const now = () => Date.parse("2026-10-03T18:00:00Z");

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

test("an older SavedStrategy in storage upgrades to revision 1", () => {
  const store = memoryStore();
  store.setItem(STRATEGY_KEY, JSON.stringify({ profile, savedAt: "2026-10-03T15:00:00.000Z" }));
  const rec = loadRecord(store)!;
  assert.equal(rec.revision, 1);
  assert.deepEqual(rec.changes, []);
  assert.equal(toRecord({ nope: true }), null);
  store.setItem(STRATEGY_KEY, "{broken");
  assert.equal(loadRecord(store), null);
  assert.equal(loadRecord(null), null);
});

test("applyChange writes a new revision, logs the change and drops the old phrasing", () => {
  const rec = newRecord(profile, now);
  const next = applyChange(rec, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.distance", to: "far", rating: 4 }, () => now() + 60_000);
  assert.equal(next.revision, 2);
  assert.equal(readField(next.profile.states[0].strategy.steps[0], "core.distance"), "far");
  assert.equal(next.profile.states[0].strategy.steps[0].submodalities.words?.distance, undefined, "old words described the old value");
  assert.equal(next.profile.updatedAt, "2026-10-03T18:01:00.000Z");
  assert.deepEqual(next.changes, [{ stateId: "calm-before-pitch", stepIndex: 0, field: "core.distance", from: "close", to: "far", rating: 4, revision: 2, at: "2026-10-03T18:01:00.000Z" }]);
  assert.ok(validateProfile(next.profile).ok);
  assert.equal(readField(rec.profile.states[0].strategy.steps[0], "core.distance"), "close", "input untouched");

  assert.equal(applyChange(next, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.distance", to: "far", rating: 4 }), next, "same value is no change");

  const worded = applyChange(next, { stateId: "calm-before-pitch", stepIndex: 2, field: "content", to: "warmth all through me", rating: null });
  assert.equal(worded.revision, 3);
  assert.equal(worded.profile.states[0].strategy.steps[2].content, "warmth all through me");
  assert.throws(() => applyChange(rec, { stateId: "nope", stepIndex: 0, field: "content", to: "x", rating: null }));
});

test("newer prefers the higher revision, then the later save", () => {
  const a = newRecord(profile, now);
  const b = applyChange(a, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "small", rating: 6 });
  assert.equal(newer(a, b), b);
  assert.equal(newer(b, a), b);
  assert.equal(newer(null, a), a);
  assert.equal(newer(a, null), a);
});

test("saveRecord round-trips", () => {
  const store = memoryStore();
  const rec = newRecord(profile, now);
  saveRecord(rec, store);
  assert.deepEqual(loadRecord(store), rec);
});

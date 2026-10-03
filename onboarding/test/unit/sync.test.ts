import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ProfileV2 } from "@peak-state/contracts";
import { appendRun, loadRuns, runStrategy, type KeyValueStore } from "../../src/playback/index.ts";
import { applyChange, loadRecord, newRecord, readField, saveRecord } from "../../src/store/index.ts";
import { createApi as createClient, loadAccount, syncAll, type FetchLike } from "../../src/sync/index.ts";
import { createApi as createServer } from "../../worker/api.ts";
import { fakeD1 } from "./d1.ts";

const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;
const CODE = "test-invite-code";

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** The page's fetch, wired straight into the Worker's handler. */
function wire(): FetchLike {
  const handle = createServer({ DB: fakeD1(), INVITE_CODE: CODE });
  return async (url, init) => {
    const res = await handle(new Request(`https://peak.test${url}`, { method: init?.method, headers: init?.headers, body: init?.body }));
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };
}

async function oneRun(id: string) {
  const r = await runStrategy(profile, "calm-before-pitch", { onStep() {}, rate: async () => 8, speak: async () => {} }, { pauseMs: 0, wait: async () => {}, id });
  return r;
}

test("two devices: create, sync up, sign in elsewhere, sync down, change, sync back", async () => {
  const fetch = wire();
  const laptopStore = memoryStore();
  const laptop = createClient({ fetch, store: laptopStore });
  assert.deepEqual(await laptop.health(), { ok: true, accounts: true, voice: false });

  // The laptop already has a strategy and a run from before signing in.
  saveRecord(newRecord(profile), laptopStore);
  appendRun(await oneRun("rep_a"), laptopStore);
  await assert.rejects(laptop.createAccount("cam@example.com", "wrong"), /not right/);
  await laptop.createAccount("cam@example.com", CODE);
  assert.equal(loadAccount(laptopStore)?.email, "cam@example.com");
  const up = await syncAll(laptop, laptopStore);
  assert.equal(up.pushedRuns, 1);
  assert.equal(up.record?.revision, 1);

  // The phone signs in and gets both.
  const phoneStore = memoryStore();
  const phone = createClient({ fetch, store: phoneStore });
  await assert.rejects(phone.createAccount("cam@example.com", CODE), /already an account/);
  await phone.signIn("cam@example.com", CODE);
  const down = await syncAll(phone, phoneStore);
  assert.equal(down.record?.profile.profileId, profile.profileId);
  assert.deepEqual(loadRuns(phoneStore).map((r) => r.id), ["rep_a"]);

  // The phone changes an answer and logs a run; the laptop picks both up.
  const changed = applyChange(loadRecord(phoneStore)!, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "small", rating: 6 });
  saveRecord(changed, phoneStore);
  appendRun(await oneRun("rep_b"), phoneStore);
  const phoneUp = await syncAll(phone, phoneStore);
  assert.equal(phoneUp.record?.revision, 2);
  const laptopDown = await syncAll(laptop, laptopStore);
  assert.equal(laptopDown.record?.revision, 2);
  assert.equal(readField(loadRecord(laptopStore)!.profile.states[0].strategy.steps[0], "core.size"), "small");
  assert.deepEqual(loadRuns(laptopStore).map((r) => r.id).sort(), ["rep_a", "rep_b"]);

  // A stale write from the laptop resolves to the server's copy.
  const stale = await laptop.putStrategy(newRecord(profile));
  assert.equal(stale.conflict, true);
  assert.equal(stale.record?.revision, 2);

  await laptop.signOut();
  assert.equal(laptop.account(), null);
  assert.equal(loadAccount(laptopStore), null);
  await assert.rejects(laptop.getStrategy(), /Sign in first/);
});

test("no server: health is null and nothing throws", async () => {
  const client = createClient({ fetch: async () => { throw new Error("offline"); }, store: memoryStore() });
  assert.equal(await client.health(), null);
});

test("a dead session signs the page out", async () => {
  const store = memoryStore();
  store.setItem("peak-state.account", JSON.stringify({ email: "a@b.co", token: "x".repeat(43) }));
  const client = createClient({ fetch: wire(), store });
  await assert.rejects(client.getStrategy(), /Sign in again|Sign in first/);
  assert.equal(client.account(), null);
});

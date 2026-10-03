import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ProfileV2 } from "@peak-state/contracts";
import { appendRun, loadRuns, runStrategy, type KeyValueStore } from "../../src/playback/index.ts";
import { applyChange, loadRecord, newRecord, readField, saveRecord } from "../../src/store/index.ts";
import { createApi as createClient, loadAccount, PREVIOUS_STRATEGY_KEY, pushRecord, syncAll, type FetchLike } from "../../src/sync/index.ts";
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

test("a newer different strategy made offline wins on sign-in; a losing local copy is backed up", async () => {
  const fetch = wire();
  const laptopStore = memoryStore();
  const laptop = createClient({ fetch, store: laptopStore });
  saveRecord(newRecord(profile, () => Date.parse("2026-10-03T10:00:00Z")), laptopStore);
  await laptop.createAccount("cam@example.com", CODE);
  await syncAll(laptop, laptopStore);

  // The phone built a brand-new strategy before signing in.
  const phoneStore = memoryStore();
  const phone = createClient({ fetch, store: phoneStore });
  const fresh = newRecord({ ...profile, profileId: "prof_phone" }, () => Date.parse("2026-10-03T12:00:00Z"));
  saveRecord(fresh, phoneStore);
  await phone.signIn("cam@example.com", CODE);
  const r = await syncAll(phone, phoneStore);
  assert.equal(r.record?.profile.profileId, "prof_phone");
  assert.equal((await phone.getStrategy())?.profile.profileId, "prof_phone", "pushed, replacing the old one");

  // The laptop changed the old strategy offline (rev 2); the account's newer different strategy wins, and the
  // laptop's change is kept under the backup key rather than lost.
  const offline = applyChange(loadRecord(laptopStore)!, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "small", rating: 6 }, () => Date.parse("2026-10-03T11:00:00Z"));
  saveRecord(offline, laptopStore);
  const l = await syncAll(laptop, laptopStore);
  assert.equal(l.record?.profile.profileId, "prof_phone");
  assert.equal(JSON.parse(laptopStore.getItem(PREVIOUS_STRATEGY_KEY)!).revision, 2);
});

test("two devices that both made revision 2 offline: the account's copy wins, the other is backed up", async () => {
  const fetch = wire();
  const aStore = memoryStore();
  const bStore = memoryStore();
  const a = createClient({ fetch, store: aStore });
  const b = createClient({ fetch, store: bStore });
  saveRecord(newRecord(profile), aStore);
  await a.createAccount("cam@example.com", CODE);
  await syncAll(a, aStore);
  await b.signIn("cam@example.com", CODE);
  await syncAll(b, bStore);
  const base = loadRecord(aStore)!;
  saveRecord(applyChange(base, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "small", rating: 6 }), aStore);
  saveRecord(applyChange(base, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "medium", rating: 6 }), bStore);
  await syncAll(a, aStore);
  const rb = await syncAll(b, bStore);
  assert.equal(readField(rb.record!.profile.states[0].strategy.steps[0], "core.size"), "small");
  assert.equal(readField(JSON.parse(bStore.getItem(PREVIOUS_STRATEGY_KEY)!).profile.states[0].strategy.steps[0], "core.size"), "medium");
});

test("a slow push of revision 2 never overwrites revision 3 saved while it was in flight", async () => {
  const inner = wire();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  let slowNext = false;
  const fetch: FetchLike = async (url, init) => {
    if (slowNext && init?.method === "PUT") {
      slowNext = false;
      await gate;
    }
    return inner(url, init);
  };
  const store = memoryStore();
  const api = createClient({ fetch, store });
  saveRecord(newRecord(profile), store);
  await api.createAccount("slow@example.com", CODE);
  await syncAll(api, store);
  const rev2 = saveRecord(applyChange(loadRecord(store)!, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "small", rating: 6 }), store);
  slowNext = true;
  const pending = pushRecord(api, rev2, store);
  const rev3 = saveRecord(applyChange(rev2, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.distance", to: "arm-length", rating: 6 }), store);
  release();
  await pending;
  assert.equal(loadRecord(store)!.revision, 3);
  assert.deepEqual(loadRecord(store), rev3);
});

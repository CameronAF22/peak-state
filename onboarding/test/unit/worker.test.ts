import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { ProfileV2, RepSession } from "@peak-state/contracts";
import { createApi, MAX_FAILED_CODES_PER_DAY, REALTIME_SECRETS_URL } from "../../worker/api.ts";
import { applyChange, newRecord } from "../../src/store/index.ts";
import { fakeD1 } from "./d1.ts";

const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;
const CODE = "test-invite-code";

function server(opts: { openai?: string; fetch?: typeof fetch } = {}) {
  let t = Date.parse("2026-10-03T18:00:00Z");
  const handle = createApi({ DB: fakeD1(), INVITE_CODE: CODE, OPENAI_API_KEY: opts.openai }, { now: () => (t += 1000), fetch: opts.fetch });
  async function call(method: string, path: string, body?: unknown, token?: string, ip = "1.2.3.4") {
    const headers: Record<string, string> = { "cf-connecting-ip": ip };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await handle(new Request(`https://peak.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }
  return { call, advance: (ms: number) => (t += ms) };
}

function rep(id: string, over: Partial<RepSession> = {}): RepSession {
  return {
    schemaVersion: 1, id, profileId: profile.profileId, stateId: "calm-before-pitch", repIndex: 0, kind: "full", phase: null,
    trigger: { kind: "practice" }, arm: "cue", startedAt: "2026-10-03T10:00:00.000Z", endedAt: "2026-10-03T10:01:00.000Z",
    steps: [], intensityBefore: null, intensityAfter: 8, recoverySeconds: null, recoveryCensored: false, anchorPaired: true,
    signalSource: "none", scriptHash: "x", endedBy: "completed", ...over,
  };
}

test("accounts need the invite code, are keyed by email, and sign in again on another device", async () => {
  const { call } = server();
  assert.deepEqual((await call("GET", "/api/health")).body, { ok: true, accounts: true, voice: false });
  assert.equal((await call("POST", "/api/accounts", { email: "cam@example.com", code: "wrong" })).status, 403);
  assert.equal((await call("POST", "/api/accounts", { email: "not-an-email", code: CODE })).status, 400);
  const made = await call("POST", "/api/accounts", { email: "  Cam@Example.com ", code: ` ${CODE} ` });
  assert.equal(made.status, 201);
  assert.equal(made.body.email, "cam@example.com");
  assert.match(made.body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await call("POST", "/api/accounts", { email: "cam@example.com", code: CODE })).status, 409);
  assert.equal((await call("POST", "/api/sessions", { email: "nobody@example.com", code: CODE })).status, 404);
  assert.equal((await call("POST", "/api/sessions", { email: "cam@example.com", code: "nope" })).status, 403);
  const again = await call("POST", "/api/sessions", { email: "cam@example.com", code: CODE });
  assert.equal(again.status, 200);
  assert.notEqual(again.body.token, made.body.token);
  assert.deepEqual((await call("GET", "/api/me", undefined, made.body.token)).body, { email: "cam@example.com" });
  assert.equal((await call("DELETE", "/api/sessions", undefined, made.body.token)).status, 200);
  assert.equal((await call("GET", "/api/me", undefined, made.body.token)).status, 401, "signed out");
  assert.equal((await call("GET", "/api/me", undefined, again.body.token)).status, 200, "the other device stays signed in");
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/me", undefined, "x".repeat(43))).status, 401);
});

test("wrong codes are limited per client per day", async () => {
  const { call } = server();
  for (let i = 0; i < MAX_FAILED_CODES_PER_DAY; i++) assert.equal((await call("POST", "/api/accounts", { email: "a@b.co", code: "x" })).status, 403);
  assert.equal((await call("POST", "/api/accounts", { email: "a@b.co", code: CODE })).status, 429);
  assert.equal((await call("POST", "/api/accounts", { email: "a@b.co", code: CODE }, undefined, "5.6.7.8")).status, 201, "another client is not blocked");
});

test("no invite code configured means no accounts", async () => {
  const handle = createApi({ DB: fakeD1() });
  const res = await handle(new Request("https://peak.test/api/accounts", { method: "POST", body: JSON.stringify({ email: "a@b.co", code: "" }) }));
  assert.equal(res.status, 503);
});

test("strategy revisions: newer saves, older is refused with the server's copy, accounts are separate", async () => {
  const { call } = server();
  const a = (await call("POST", "/api/accounts", { email: "a@example.com", code: CODE })).body.token;
  const b = (await call("POST", "/api/accounts", { email: "b@example.com", code: CODE })).body.token;
  assert.deepEqual((await call("GET", "/api/strategy", undefined, a)).body, { record: null });

  const r1 = newRecord(profile, () => Date.parse("2026-10-03T17:00:00Z"));
  assert.equal((await call("PUT", "/api/strategy", { record: r1 }, a)).status, 200);
  const r2 = applyChange(r1, { stateId: "calm-before-pitch", stepIndex: 0, field: "core.size", to: "small", rating: 5 }, () => Date.parse("2026-10-03T17:05:00Z"));
  const put2 = await call("PUT", "/api/strategy", { record: r2 }, a);
  assert.equal(put2.status, 200);
  assert.equal(put2.body.record.revision, 2);
  assert.equal(put2.body.record.changes.length, 1);

  const stale = await call("PUT", "/api/strategy", { record: r1 }, a);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.record.revision, 2);
  assert.deepEqual(stale.body.record, put2.body.record);

  const got = await call("GET", "/api/strategy", undefined, a);
  assert.deepEqual(got.body.record, JSON.parse(JSON.stringify(r2)));
  assert.deepEqual((await call("GET", "/api/strategy", undefined, b)).body, { record: null }, "b sees nothing of a");

  // A new strategy (different profileId) replaces the latest even at revision 1.
  const fresh = newRecord({ ...profile, profileId: "prof_new" }, () => Date.parse("2026-10-03T19:00:00Z"));
  assert.equal((await call("PUT", "/api/strategy", { record: fresh }, a)).status, 200);
  assert.equal((await call("GET", "/api/strategy", undefined, a)).body.record.profile.profileId, "prof_new");

  assert.equal((await call("PUT", "/api/strategy", { record: { ...r2, revision: 0 } }, a)).status, 400);
  assert.equal((await call("PUT", "/api/strategy", { record: { ...r2, profile: { ...profile, confirmedAt: null } } }, a)).status, 400);
  assert.equal((await call("PUT", "/api/strategy", { record: r2 })).status, 401);
});

test("reps: owned by the account, idempotent by id, with progress", async () => {
  const { call } = server();
  const a = (await call("POST", "/api/accounts", { email: "a@example.com", code: CODE })).body.token;
  const b = (await call("POST", "/api/accounts", { email: "b@example.com", code: CODE })).body.token;
  const reps = [rep("r1", { intensityAfter: 6 }), rep("r2", { startedAt: "2026-10-03T11:00:00.000Z" })];
  assert.equal((await call("POST", "/api/reps", { reps }, a)).status, 200);
  assert.equal((await call("POST", "/api/reps", { reps }, a)).status, 200, "the same runs again are ignored");
  assert.equal((await call("POST", "/api/reps", { reps: [rep("r1")] }, b)).status, 200, "ids are per account");
  const mine = (await call("GET", "/api/reps", undefined, a)).body.reps;
  assert.deepEqual(mine.map((r: RepSession) => r.id), ["r1", "r2"]);
  assert.equal((await call("GET", "/api/reps?state=calm-before-pitch", undefined, b)).body.reps.length, 1);
  const p = (await call("GET", "/api/progress?state=calm-before-pitch", undefined, a)).body.progress;
  assert.equal(p.timesChosen, 2);
  assert.equal(p.goodReps, 1);
  assert.equal((await call("GET", "/api/progress", undefined, a)).status, 400);
  assert.equal((await call("POST", "/api/reps", { reps: [{ ...rep("bad"), intensityAfter: 11 }] }, a)).status, 400);
  assert.equal((await call("POST", "/api/reps", { reps: "nope" }, a)).status, 400);
});

test("realtime token: needs an account and the server key, and returns only the short-lived key", async () => {
  const seen: { url: string; auth: string | null; body: any }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ value: "ek_short", expires_at: 1790000000 }), { status: 200 });
  }) as unknown as typeof fetch;
  const off = server();
  const tOff = (await off.call("POST", "/api/accounts", { email: "a@example.com", code: CODE })).body.token;
  assert.equal((await off.call("POST", "/api/realtime/token", {}, tOff)).status, 503);

  const { call } = server({ openai: "sk-real-secret", fetch: fakeFetch });
  assert.equal((await call("POST", "/api/realtime/token", {})).status, 401);
  const t = (await call("POST", "/api/accounts", { email: "a@example.com", code: CODE })).body.token;
  const res = await call("POST", "/api/realtime/token", { model: "gpt-live-1" }, t);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { value: "ek_short", expiresAt: 1790000000, model: "gpt-live-1" });
  assert.ok(!JSON.stringify(res.body).includes("sk-real-secret"));
  assert.equal(seen[0].url, REALTIME_SECRETS_URL);
  assert.equal(seen[0].auth, "Bearer sk-real-secret");
  assert.equal(seen[0].body.session.model, "gpt-live-1");
  assert.equal((await call("POST", "/api/realtime/token", { model: "../../evil" }, t)).body.model, "gpt-realtime");
});

test("unknown routes and bad bodies answer as JSON", async () => {
  const { call } = server();
  assert.equal((await call("GET", "/api/nope")).status, 404);
  const handle = createApi({ DB: fakeD1(), INVITE_CODE: CODE });
  const res = await handle(new Request("https://peak.test/api/accounts", { method: "POST", body: "{not json" }));
  assert.equal(res.status, 400);
  assert.match((await res.json() as { error: string }).error, /JSON/);
});

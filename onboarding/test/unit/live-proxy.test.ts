import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createLiveProxy, LIVE_PROXY_PATH, OPENAI_LIVE_SESSIONS_URL } from "../../harness/live-proxy.ts";

function req(opts: { url?: string; method?: string; headers?: Record<string, string>; body?: string }): IncomingMessage {
  const r = Readable.from(opts.body === undefined ? [] : [Buffer.from(opts.body)]) as unknown as IncomingMessage;
  r.url = opts.url ?? LIVE_PROXY_PATH;
  r.method = opts.method ?? "POST";
  r.headers = opts.headers ?? {};
  return r;
}

function res() {
  const out = { statusCode: 0, headers: {} as Record<string, string>, body: "" };
  const r = {
    set statusCode(v: number) {
      out.statusCode = v;
    },
    get statusCode() {
      return out.statusCode;
    },
    setHeader(k: string, v: string) {
      out.headers[k.toLowerCase()] = v;
    },
    end(b?: string) {
      out.body = b ?? "";
    },
  } as unknown as ServerResponse;
  return { r, out, json: () => JSON.parse(out.body) };
}

const offer = JSON.stringify({ session: { model: "gpt-live-1", instructions: "Say lines." }, sdp: "v=0 offer" });

function upstream(status = 201, body = JSON.stringify({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "v=0 answer" } })) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    return { status, text: async () => body, headers: { get: () => "application/json" } };
  };
  return { calls, fetch };
}

test("live proxy: other paths pass through to the next middleware", async () => {
  const { fetch, calls } = upstream();
  let nexted = false;
  await createLiveProxy({ env: {}, fetch })(req({ url: "/index.html", method: "GET" }), res().r, () => (nexted = true));
  assert.equal(nexted, true);
  assert.equal(calls.length, 0);
});

test("live proxy: forwards { session, transport } to OpenAI with the env key and passes the answer back", async () => {
  const { fetch, calls } = upstream();
  const out = res();
  await createLiveProxy({ env: { OPENAI_API_KEY: "sk-env" }, fetch })(
    req({ body: offer, headers: { origin: "http://127.0.0.1:5174", "x-openai-key": "sk-page" } }),
    out.r,
    () => assert.fail("next"),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, OPENAI_LIVE_SESSIONS_URL);
  assert.equal(calls[0]!.init.headers.Authorization, "Bearer sk-env", "the server's key wins over a pasted one");
  assert.deepEqual(JSON.parse(calls[0]!.init.body), {
    session: { model: "gpt-live-1", instructions: "Say lines." },
    transport: { type: "webrtc", sdp: "v=0 offer" },
  });
  assert.equal(out.out.statusCode, 201);
  assert.equal(out.json().transport.sdp, "v=0 answer");
  assert.equal(out.out.headers["cache-control"], "no-store");
});

test("live proxy: falls back to the x-openai-key header when OPENAI_API_KEY is unset", async () => {
  const { fetch, calls } = upstream();
  await createLiveProxy({ env: {}, fetch })(req({ body: offer, headers: { "x-openai-key": "sk-page" } }), res().r, () => {});
  assert.equal(calls[0]!.init.headers.Authorization, "Bearer sk-page");
});

test("live proxy: no key anywhere → 401 with setup advice, no upstream call", async () => {
  const { fetch, calls } = upstream();
  const out = res();
  await createLiveProxy({ env: {}, fetch })(req({ body: offer }), out.r, () => {});
  assert.equal(out.out.statusCode, 401);
  assert.match(out.json().error.message, /OPENAI_API_KEY/);
  assert.equal(calls.length, 0);
});

test("live proxy: rejects non-local origins, wrong methods and bad bodies", async () => {
  const { fetch, calls } = upstream();
  const proxy = createLiveProxy({ env: { OPENAI_API_KEY: "sk-env" }, fetch });
  const cases: [IncomingMessage, number][] = [
    [req({ body: offer, headers: { origin: "https://evil.example" } }), 403],
    [req({ method: "GET" }), 405],
    [req({ body: "not json" }), 400],
    [req({ body: JSON.stringify({ session: { model: "gpt-live-1" } }) }), 400],
  ];
  for (const [r, status] of cases) {
    const out = res();
    await proxy(r, out.r, () => {});
    assert.equal(out.out.statusCode, status);
  }
  assert.equal(calls.length, 0);
});

test("live proxy: OpenAI errors pass through with their status and body", async () => {
  const { fetch } = upstream(403, JSON.stringify({ error: { message: "Project does not have access to model gpt-live-1" } }));
  const out = res();
  await createLiveProxy({ env: { OPENAI_API_KEY: "sk-env" }, fetch })(req({ body: offer }), out.r, () => {});
  assert.equal(out.out.statusCode, 403);
  assert.match(out.json().error.message, /does not have access/);
});

test("live proxy: network failure → 502", async () => {
  const out = res();
  await createLiveProxy({
    env: { OPENAI_API_KEY: "sk-env" },
    fetch: async () => {
      throw new Error("ENOTFOUND api.openai.com");
    },
  })(req({ body: offer }), out.r, () => {});
  assert.equal(out.out.statusCode, 502);
  assert.match(out.json().error.message, /ENOTFOUND/);
});

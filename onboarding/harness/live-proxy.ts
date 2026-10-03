// Dev-server route that starts a GPT-Live WebRTC session for the harness (D-onboarding-025).
//
// OpenAI creates GPT-Live sessions server-side with the project key: POST /v1/live/sessions with
// { session, transport: { type: "webrtc", sdp } } returns { session, transport: { sdp: answer } }.
// The page posts { session, sdp } here; this route adds the key and forwards. The key comes from
// OPENAI_API_KEY in the terminal that runs the harness, or from an x-openai-key header the page sends
// to this local route when a key was pasted in the gear. The response is passed through unchanged.
// /api/answer/interpret cleans up a spoken answer with the same key, as the Worker does (D-onboarding-028).

import type { IncomingMessage, ServerResponse } from "node:http";
import { buildInterpretRequest, DEFAULT_INTERPRET_MODEL, OPENAI_RESPONSES_URL, parseInterpretResponse, readInterpretBody } from "../src/voice/interpret.ts";

export const LIVE_PROXY_PATH = "/api/live/session";
export const INTERPRET_PATH = "/api/answer/interpret";
export const OPENAI_LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
const MAX_BODY_BYTES = 1_000_000;

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;

export interface LiveProxyOptions {
  env?: Record<string, string | undefined>;
  fetch?: FetchLike;
  upstream?: string;
  responsesUrl?: string;
}

type Next = (err?: unknown) => void;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function errorBody(message: string): { error: { message: string } } {
  return { error: { message } };
}

/** Only pages served from this machine may use the route, so other sites cannot spend the key. */
function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin GETs and tools such as curl send no Origin
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Connect-style middleware for Vite's dev and preview servers. */
export function createLiveProxy(options: LiveProxyOptions = {}) {
  const env = options.env ?? process.env;
  const fetchFn = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const upstream = options.upstream ?? OPENAI_LIVE_SESSIONS_URL;

  function keyFor(req: IncomingMessage): string {
    const headerKey = req.headers["x-openai-key"];
    return env.OPENAI_API_KEY?.trim() || (typeof headerKey === "string" ? headerKey.trim() : "");
  }

  async function interpret(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let asked;
    try {
      asked = readInterpretBody(JSON.parse(await readBody(req)));
    } catch {
      asked = null;
    }
    if (!asked) return sendJson(res, 400, errorBody("Send the heard words and the question."));
    const key = keyFor(req);
    if (!key) return sendJson(res, 401, errorBody("No OpenAI API key for the answer clean-up."));
    try {
      const up = await fetchFn(options.responsesUrl ?? OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildInterpretRequest(env.INTERPRET_MODEL?.trim() || DEFAULT_INTERPRET_MODEL, asked.ctx, asked.heard)),
      });
      const text = await up.text();
      if (up.status < 200 || up.status >= 300) return sendJson(res, 502, errorBody(`OpenAI refused the clean-up (${up.status}).`));
      const v = parseInterpretResponse(JSON.parse(text));
      if (!v) return sendJson(res, 502, errorBody("OpenAI sent no usable clean-up."));
      return sendJson(res, 200, v);
    } catch (err) {
      return sendJson(res, 502, errorBody(`Could not reach OpenAI (${(err as Error)?.message ?? err}).`));
    }
  }

  return async function liveProxy(req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> {
    const path = (req.url ?? "").split("?")[0];
    if (path !== LIVE_PROXY_PATH && path !== INTERPRET_PATH) return next();
    if (req.method !== "POST") return sendJson(res, 405, errorBody("Use POST."));
    if (!isLocalOrigin(req.headers.origin)) return sendJson(res, 403, errorBody("This route only serves pages on localhost."));
    if (path === INTERPRET_PATH) return interpret(req, res);

    let parsed: { session?: unknown; sdp?: unknown };
    try {
      parsed = JSON.parse(await readBody(req)) as { session?: unknown; sdp?: unknown };
    } catch {
      return sendJson(res, 400, errorBody("Send JSON: { session, sdp }."));
    }
    if (!parsed || typeof parsed.sdp !== "string" || !parsed.sdp.trim() || typeof parsed.session !== "object" || !parsed.session) {
      return sendJson(res, 400, errorBody("Send JSON: { session, sdp } with the WebRTC offer SDP."));
    }

    const key = keyFor(req);
    if (!key) {
      return sendJson(
        res,
        401,
        errorBody("No OpenAI API key. Start the harness with OPENAI_API_KEY set in that terminal, or paste a key in the gear."),
      );
    }

    let upstreamRes;
    try {
      upstreamRes = await fetchFn(upstream, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ session: parsed.session, transport: { type: "webrtc", sdp: parsed.sdp } }),
      });
    } catch (err) {
      return sendJson(res, 502, errorBody(`Could not reach OpenAI (${(err as Error)?.message ?? err}).`));
    }
    const text = await upstreamRes.text();
    res.statusCode = upstreamRes.status;
    res.setHeader("Content-Type", upstreamRes.headers?.get("content-type") ?? "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  };
}

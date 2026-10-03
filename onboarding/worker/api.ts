// The Peak State API (D-onboarding-017): invite-code accounts, strategy revisions, the rep log, progress, and
// short-lived GPT live keys. Runs in a Cloudflare Worker; the storage is any D1-shaped database, so tests use SQLite.
// Ajv cannot compile schemas inside Workers, so shapes are checked here by hand; the page validates with contracts.

import type { RepSession } from "@peak-state/contracts";
import { summarize } from "../src/progress/index.ts";
import { buildInterpretRequest, DEFAULT_INTERPRET_MODEL, OPENAI_RESPONSES_URL, parseInterpretResponse, readInterpretBody } from "../src/voice/interpret.ts";

// ── the D1 subset this file uses ────────────────────────────────────────────

export interface Statement {
  bind(...values: unknown[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}

export interface Env {
  /** Optional: the model that cleans up spoken answers (D-onboarding-028). Default gpt-5.4-mini. */
  INTERPRET_MODEL?: string;
  DB: Database;
  /** Worker secret. Account creation and sign-in need it. */
  INVITE_CODE?: string;
  /** Worker secret. The real OpenAI key; it never leaves the Worker (GPT live sessions start here). */
  OPENAI_API_KEY?: string;
}

export interface ApiDeps {
  now?: () => number;
  /** Outbound fetch for OpenAI. Injected in tests. */
  fetch?: typeof fetch;
  randomBytes?: (n: number) => Uint8Array;
}

export const SESSION_DAYS = 90;
/** Sign-up and sign-in attempts per client per day (right or wrong code). */
export const MAX_CODE_ATTEMPTS_PER_DAY = 30;
/** Wrong codes across every client per day, so spreading guesses over many addresses does not help. */
export const MAX_WRONG_CODES_PER_DAY = 500;
/** Sign-ins per email per day. */
export const MAX_SIGN_INS_PER_EMAIL_PER_DAY = 10;
export const MAX_REVISIONS_PER_STRATEGY = 2000;
export const MAX_REPS_PER_ACCOUNT = 20000;
/** Spoken answers cleaned up per account per day (D-onboarding-028). */
export const MAX_INTERPRETS_PER_DAY = 3000;
/** GPT live sessions started per account per day. */
export const MAX_VOICE_SESSIONS_PER_DAY = 40;
export const MAX_BODY_BYTES = 512 * 1024;
export const LIVE_SESSIONS_URL = "https://api.openai.com/v1/live/sessions";
export const DEFAULT_LIVE_MODEL = "gpt-live-1";
const MAX_INSTRUCTIONS = 4000;
const MAX_SDP = 64 * 1024;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const STATE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MODEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;

class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request is too large.");
  try {
    const v = text ? JSON.parse(text) : {};
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be a JSON object.");
  }
}

// ── crypto helpers ──────────────────────────────────────────────────────────

function hex(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Compares two secrets by their digests, so the time taken does not depend on where they differ. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── the handler ─────────────────────────────────────────────────────────────

export function createApi(env: Env, deps: ApiDeps = {}): (req: Request) => Promise<Response> {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;
  const random = deps.randomBytes ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const db = env.DB;
  const iso = (ms = now()): string => new Date(ms).toISOString();
  const today = (): string => iso().slice(0, 10);

  /** Count one more for today and return the new count, in one statement, so parallel requests cannot slip past. */
  async function bump(key: string): Promise<number> {
    const row = await db
      .prepare("INSERT INTO counters (key, day, count) VALUES (?, ?, 1) ON CONFLICT(key, day) DO UPDATE SET count = count + 1 RETURNING count")
      .bind(key, today())
      .first<{ count: number }>();
    return row?.count ?? Number.MAX_SAFE_INTEGER;
  }

  /** The client's address, with IPv6 grouped by /64 (one home or phone network). */
  function clientKey(req: Request): string {
    const ip = req.headers.get("cf-connecting-ip") ?? "local";
    return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") : ip;
  }

  async function checkCode(req: Request, code: unknown): Promise<void> {
    const expected = env.INVITE_CODE ?? "";
    if (!expected) throw new HttpError(503, "Accounts are not set up on this server yet.");
    if ((await bump(`code:${clientKey(req)}`)) > MAX_CODE_ATTEMPTS_PER_DAY) throw new HttpError(429, "Too many tries today. Try again tomorrow.");
    if (typeof code !== "string" || !(await sameSecret(code.trim(), expected))) {
      if ((await bump("code:wrong:all")) > MAX_WRONG_CODES_PER_DAY) throw new HttpError(429, "Too many tries today. Try again tomorrow.");
      throw new HttpError(403, "That code is not right.");
    }
  }

  function readEmail(v: unknown): string {
    const email = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
    return email;
  }

  async function newSession(accountId: string): Promise<string> {
    const token = base64url(random(32));
    const created = now();
    await db
      .prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), accountId, iso(created), iso(created + SESSION_DAYS * 86_400_000))
      .run();
    return token;
  }

  async function account(req: Request): Promise<{ id: string; email: string; tokenHash: string }> {
    const auth = req.headers.get("authorization") ?? "";
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(auth);
    if (!m) throw new HttpError(401, "Sign in first.");
    const tokenHash = await sha256(m[1]);
    const row = await db
      .prepare("SELECT a.id AS id, a.email AS email, s.expires_at AS expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?")
      .bind(tokenHash)
      .first<{ id: string; email: string; expires_at: string }>();
    if (!row || Date.parse(row.expires_at) <= now()) throw new HttpError(401, "Your session has ended. Sign in again.");
    return { id: row.id, email: row.email, tokenHash };
  }

  // ── accounts ──

  async function createAccount(req: Request): Promise<Response> {
    const body = await readBody(req);
    await checkCode(req, body.code);
    const email = readEmail(body.email);
    const existing = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first<{ id: string }>();
    if (existing) throw new HttpError(409, "There is already an account for that email. Sign in instead.");
    const id = `acct_${base64url(random(12))}`;
    await db.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)").bind(id, email, iso()).run();
    return json({ email, token: await newSession(id) }, 201);
  }

  async function signIn(req: Request): Promise<Response> {
    const body = await readBody(req);
    await checkCode(req, body.code);
    const email = readEmail(body.email);
    if ((await bump(`signin:${email}`)) > MAX_SIGN_INS_PER_EMAIL_PER_DAY) throw new HttpError(429, "Too many sign-ins for this email today. Try again tomorrow.");
    const row = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first<{ id: string }>();
    if (!row) throw new HttpError(404, "No account for that email yet. Create one.");
    return json({ email, token: await newSession(row.id) });
  }

  async function signOut(req: Request): Promise<Response> {
    const me = await account(req);
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(me.tokenHash).run();
    return json({ ok: true });
  }

  // ── strategy ──

  interface Row {
    profile_id: string;
    revision: number;
    saved_at: string;
    profile_json: string;
  }

  async function latest(accountId: string): Promise<Row | null> {
    return db
      .prepare(
        "SELECT s.profile_id AS profile_id, s.revision AS revision, s.saved_at AS saved_at, s.profile_json AS profile_json FROM current_strategy c JOIN strategies s ON s.account_id = c.account_id AND s.profile_id = c.profile_id AND s.revision = c.revision WHERE c.account_id = ?",
      )
      .bind(accountId)
      .first<Row>();
  }

  async function recordFrom(accountId: string, row: Row): Promise<Record<string, unknown>> {
    const changes = await db
      .prepare("SELECT change_json FROM strategy_changes WHERE account_id = ? AND profile_id = ? AND revision <= ? ORDER BY revision")
      .bind(accountId, row.profile_id, row.revision)
      .all<{ change_json: string }>();
    return {
      profile: JSON.parse(row.profile_json),
      revision: row.revision,
      savedAt: row.saved_at,
      changes: changes.results.map((c) => JSON.parse(c.change_json)),
    };
  }

  async function getStrategy(req: Request): Promise<Response> {
    const me = await account(req);
    const row = await latest(me.id);
    return json({ record: row ? await recordFrom(me.id, row) : null });
  }

  function checkRecord(v: unknown): { profileId: string; revision: number; savedAt: string; profile: Record<string, unknown>; changes: Record<string, unknown>[] } {
    const r = v as Record<string, unknown> | null;
    const profile = r?.profile as Record<string, unknown> | undefined;
    if (!r || !profile || typeof profile !== "object") throw new HttpError(400, "record.profile is missing.");
    if (profile.schemaVersion !== 2 || typeof profile.profileId !== "string" || !ID.test(profile.profileId)) throw new HttpError(400, "record.profile is not a Profile v2.");
    const states = profile.states;
    if (!Array.isArray(states) || states.length < 1 || states.length > 3) throw new HttpError(400, "record.profile.states must hold 1 to 3 states.");
    for (const s of states as Record<string, unknown>[]) {
      if (!s || typeof s.id !== "string" || !STATE_ID.test(s.id) || !s.strategy || !Array.isArray((s.strategy as { steps?: unknown }).steps)) {
        throw new HttpError(400, "record.profile.states has a state without an id or strategy.");
      }
    }
    if (!profile.confirmedAt) throw new HttpError(400, "Only a confirmed strategy can be saved.");
    const revision = r.revision;
    if (!Number.isInteger(revision) || (revision as number) < 1) throw new HttpError(400, "record.revision must be a whole number from 1.");
    const savedAt = typeof r.savedAt === "string" && !Number.isNaN(Date.parse(r.savedAt)) ? r.savedAt : null;
    if (!savedAt) throw new HttpError(400, "record.savedAt must be a date-time.");
    const changes = Array.isArray(r.changes) ? (r.changes as Record<string, unknown>[]) : [];
    if (changes.length > 1000) throw new HttpError(400, "record.changes is too long.");
    for (const c of changes) {
      if (!c || !Number.isInteger(c.revision) || typeof c.field !== "string" || !Number.isInteger(c.stepIndex)) throw new HttpError(400, "record.changes has a malformed change.");
    }
    return { profileId: profile.profileId, revision: revision as number, savedAt, profile, changes };
  }

  /**
   * Save a new revision. The same strategy must move to a higher revision; a different strategy must name the
   * current one it replaces (`replaces: {profileId, revision}`). Anything else, or losing a race to another
   * device, is a 409 with the server's copy. Revisions are never overwritten.
   */
  async function putStrategy(req: Request): Promise<Response> {
    const me = await account(req);
    const body = await readBody(req);
    const rec = checkRecord(body.record);
    const replaces = body.replaces as { profileId?: unknown; revision?: unknown } | null | undefined;
    const conflict = async (why: string): Promise<Response> => {
      const row = await latest(me.id);
      return json({ error: why, record: row ? await recordFrom(me.id, row) : null }, 409);
    };
    const current = await db
      .prepare("SELECT profile_id, revision FROM current_strategy WHERE account_id = ?")
      .bind(me.id)
      .first<{ profile_id: string; revision: number }>();
    if (current) {
      if (current.profile_id === rec.profileId) {
        if (rec.revision <= current.revision) return conflict("The server has a newer or equal revision of this strategy.");
      } else if (!replaces || replaces.profileId !== current.profile_id || replaces.revision !== current.revision) {
        return conflict("The account's current strategy is a different one. Say which one this replaces.");
      }
    }
    const count = await db
      .prepare("SELECT COUNT(*) AS n FROM strategies WHERE account_id = ? AND profile_id = ?")
      .bind(me.id, rec.profileId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_REVISIONS_PER_STRATEGY) throw new HttpError(413, "This strategy has too many saved versions. Start a new one.");

    const stamp = iso();
    const move = current
      ? db
          .prepare("UPDATE current_strategy SET profile_id = ?, revision = ?, updated_at = ? WHERE account_id = ? AND profile_id = ? AND revision = ?")
          .bind(rec.profileId, rec.revision, stamp, me.id, current.profile_id, current.revision)
      : db.prepare("INSERT INTO current_strategy (account_id, profile_id, revision, updated_at) VALUES (?, ?, ?, ?)").bind(me.id, rec.profileId, rec.revision, stamp);
    // Rows are written only if the move above landed, so a device that lost the race leaves nothing behind.
    const moved = "EXISTS (SELECT 1 FROM current_strategy WHERE account_id = ? AND profile_id = ? AND revision = ?)";
    const stmts: Statement[] = [
      move,
      db
        .prepare(`INSERT INTO strategies (account_id, profile_id, revision, saved_at, profile_json) SELECT ?, ?, ?, ?, ? WHERE ${moved}`)
        .bind(me.id, rec.profileId, rec.revision, rec.savedAt, JSON.stringify(rec.profile), me.id, rec.profileId, rec.revision),
    ];
    for (const c of rec.changes) {
      stmts.push(
        db
          .prepare(`INSERT OR IGNORE INTO strategy_changes (account_id, profile_id, revision, change_json) SELECT ?, ?, ?, ? WHERE ${moved}`)
          .bind(me.id, rec.profileId, c.revision, JSON.stringify(c), me.id, rec.profileId, rec.revision),
      );
    }
    let results: { meta?: { changes?: number } }[];
    try {
      results = (await db.batch(stmts)) as { meta?: { changes?: number } }[];
    } catch {
      // A duplicate revision or a second first-save: another device got there first. The batch rolled back.
      return conflict("Another device saved this revision first.");
    }
    if ((results[0]?.meta?.changes ?? 0) !== 1) return conflict("Another device moved the strategy on first.");
    const row = await latest(me.id);
    return json({ record: row ? await recordFrom(me.id, row) : null });
  }

  // ── reps and progress ──

  function checkRep(v: unknown): RepSession {
    const r = v as Partial<RepSession> | null;
    if (!r || r.schemaVersion !== 1 || typeof r.id !== "string" || !ID.test(r.id)) throw new HttpError(400, "A rep is missing its id.");
    if (typeof r.profileId !== "string" || typeof r.stateId !== "string" || !STATE_ID.test(r.stateId)) throw new HttpError(400, `Rep ${r.id} has no profile or state.`);
    if (typeof r.startedAt !== "string" || Number.isNaN(Date.parse(r.startedAt))) throw new HttpError(400, `Rep ${r.id} has no start time.`);
    if (!Array.isArray(r.steps) || typeof r.endedBy !== "string") throw new HttpError(400, `Rep ${r.id} has no steps or end.`);
    if (r.intensityAfter !== null && r.intensityAfter !== undefined && !(Number.isInteger(r.intensityAfter) && r.intensityAfter >= 0 && r.intensityAfter <= 10)) {
      throw new HttpError(400, `Rep ${r.id} has a rating outside 0 to 10.`);
    }
    return r as RepSession;
  }

  async function postReps(req: Request): Promise<Response> {
    const me = await account(req);
    const body = await readBody(req);
    const reps = body.reps;
    if (!Array.isArray(reps) || reps.length > 500) throw new HttpError(400, "reps must be a list of at most 500 runs.");
    const checked = reps.map(checkRep);
    const have = await db.prepare("SELECT COUNT(*) AS n FROM reps WHERE account_id = ?").bind(me.id).first<{ n: number }>();
    if ((have?.n ?? 0) + checked.length > MAX_REPS_PER_ACCOUNT) throw new HttpError(413, "This account has reached its run log limit.");
    if (checked.length) {
      await db.batch(
        checked.map((r) =>
          db
            .prepare("INSERT OR IGNORE INTO reps (account_id, id, profile_id, state_id, started_at, ended_by, intensity_after, rep_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(me.id, r.id, r.profileId, r.stateId, r.startedAt, r.endedBy, r.intensityAfter ?? null, JSON.stringify(r)),
        ),
      );
    }
    return json({ stored: checked.length });
  }

  async function listReps(accountId: string, stateId: string | null): Promise<RepSession[]> {
    const q = stateId
      ? db.prepare("SELECT rep_json FROM reps WHERE account_id = ? AND state_id = ? ORDER BY started_at").bind(accountId, stateId)
      : db.prepare("SELECT rep_json FROM reps WHERE account_id = ? ORDER BY started_at").bind(accountId);
    const rows = await q.all<{ rep_json: string }>();
    return rows.results.map((r) => JSON.parse(r.rep_json) as RepSession);
  }

  async function getReps(req: Request, url: URL): Promise<Response> {
    const me = await account(req);
    const state = url.searchParams.get("state");
    if (state !== null && !STATE_ID.test(state)) throw new HttpError(400, "state is not a state id.");
    return json({ reps: await listReps(me.id, state) });
  }

  async function getProgress(req: Request, url: URL): Promise<Response> {
    const me = await account(req);
    const state = url.searchParams.get("state") ?? "";
    if (!STATE_ID.test(state)) throw new HttpError(400, "state is required.");
    return json({ progress: summarize(await listReps(me.id, state), state) });
  }

  // ── GPT live sessions (D-onboarding-025) ──

  // GPT-Live sessions are created server-side with the project key. The page sends its WebRTC offer and the
  // session settings; only the model, instructions and voice are taken from it, delegation stays client-side.
  async function liveSession(req: Request): Promise<Response> {
    const me = await account(req);
    if (!env.OPENAI_API_KEY) throw new HttpError(503, "GPT live is not set up on this server.");
    const body = await readBody(req);
    const sdp = typeof body.sdp === "string" ? body.sdp : "";
    if (!sdp.trim() || sdp.length > MAX_SDP) throw new HttpError(400, "Send the WebRTC offer as sdp.");
    const asked = (body.session ?? {}) as { model?: unknown; instructions?: unknown; audio?: { output?: { voice?: unknown } } };
    const model = typeof asked.model === "string" && MODEL.test(asked.model.trim()) ? asked.model.trim() : DEFAULT_LIVE_MODEL;
    const session: Record<string, unknown> = { model, delegation: { type: "client" } };
    if (typeof asked.instructions === "string" && asked.instructions.trim()) session.instructions = asked.instructions.slice(0, MAX_INSTRUCTIONS);
    const voice = asked.audio?.output?.voice;
    if (typeof voice === "string" && MODEL.test(voice)) session.audio = { output: { voice } };
    if ((await bump(`voice:${me.id}`)) > MAX_VOICE_SESSIONS_PER_DAY) throw new HttpError(429, "That's the voice limit for today. Use browser or typed voice.");
    let res: Response;
    try {
      res = await doFetch(LIVE_SESSIONS_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ session, transport: { type: "webrtc", sdp } }),
      });
    } catch {
      throw new HttpError(502, "Could not reach OpenAI.");
    }
    const text = await res.text();
    let parsed: { transport?: { sdp?: unknown }; session?: { id?: unknown }; error?: { message?: unknown } } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    if (!res.ok) {
      const why = typeof parsed.error?.message === "string" ? `: ${parsed.error.message}` : "";
      throw new HttpError(502, `OpenAI refused the GPT live session (${res.status})${why}`, { upstreamStatus: res.status });
    }
    const answer = parsed.transport?.sdp;
    if (typeof answer !== "string" || !answer) throw new HttpError(502, "OpenAI sent no SDP answer.");
    return json({ session: { id: typeof parsed.session?.id === "string" ? parsed.session.id : null, model }, transport: { type: "webrtc", sdp: answer } }, 201);
  }

  // ── spoken answer clean-up (D-onboarding-028) ──

  async function interpretAnswer(req: Request): Promise<Response> {
    const me = await account(req);
    if (!env.OPENAI_API_KEY) throw new HttpError(503, "GPT live is not set up on this server.");
    const asked = readInterpretBody(await readBody(req));
    if (!asked) throw new HttpError(400, "Send the heard words and the question.");
    if ((await bump(`interpret:${me.id}`)) > MAX_INTERPRETS_PER_DAY) throw new HttpError(429, "That's the limit for today.");
    const model = env.INTERPRET_MODEL && MODEL.test(env.INTERPRET_MODEL) ? env.INTERPRET_MODEL : DEFAULT_INTERPRET_MODEL;
    let res: Response;
    try {
      res = await doFetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify(buildInterpretRequest(model, asked.ctx, asked.heard)),
      });
    } catch {
      throw new HttpError(502, "Could not reach OpenAI.");
    }
    if (!res.ok) throw new HttpError(502, `OpenAI refused the clean-up (${res.status}).`);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await res.text());
    } catch {
      // not JSON
    }
    const v = parseInterpretResponse(parsed);
    if (!v) throw new HttpError(502, "OpenAI sent no usable clean-up.");
    return json(v);
  }

  // ── routing ──

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "")}`;
    try {
      switch (route) {
        case "GET /api/health":
          return json({ ok: true, accounts: Boolean(env.INVITE_CODE), voice: Boolean(env.OPENAI_API_KEY) });
        case "POST /api/accounts":
          return await createAccount(req);
        case "POST /api/sessions":
          return await signIn(req);
        case "DELETE /api/sessions":
          return await signOut(req);
        case "GET /api/me": {
          const me = await account(req);
          return json({ email: me.email });
        }
        case "GET /api/strategy":
          return await getStrategy(req);
        case "PUT /api/strategy":
          return await putStrategy(req);
        case "GET /api/reps":
          return await getReps(req, url);
        case "POST /api/reps":
          return await postReps(req);
        case "GET /api/progress":
          return await getProgress(req, url);
        case "POST /api/live/session":
          return await liveSession(req);
        case "POST /api/answer/interpret":
          return await interpretAnswer(req);
        default:
          return json({ error: "Not found." }, 404);
      }
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      console.error("api error", route, err);
      return json({ error: "Something went wrong on the server." }, 500);
    }
  };
}

// The page's side of the Peak State API (D-onboarding-017): the account, strategy and rep sync, and the
// short-lived GPT live key. Local storage stays the first copy; the server is the account's copy.

import { validateRepSession, type RepSession } from "@peak-state/contracts";
import type { KeyValueStore } from "../playback/storage.ts";
import { loadRuns, RUNS_KEY } from "../playback/storage.ts";
import { loadRecord, newer, saveRecord, toRecord, type StrategyRecord } from "../store/index.ts";

export const ACCOUNT_KEY = "peak-state.account";
/** Where a local strategy goes when the account's copy replaces it, so nothing is lost silently. */
export const PREVIOUS_STRATEGY_KEY = "peak-state.harness.strategy.previous";

export interface AccountSession {
  email: string;
  token: string;
}

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function defaultStore(): KeyValueStore | null {
  try {
    return (globalThis as unknown as { localStorage?: KeyValueStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadAccount(store: KeyValueStore | null = defaultStore()): AccountSession | null {
  try {
    const raw = store?.getItem(ACCOUNT_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<AccountSession>) : null;
    return v && typeof v.email === "string" && typeof v.token === "string" ? { email: v.email, token: v.token } : null;
  } catch {
    return null;
  }
}

function saveAccount(a: AccountSession | null, store: KeyValueStore | null): void {
  try {
    if (a) store?.setItem(ACCOUNT_KEY, JSON.stringify(a));
    else store?.removeItem(ACCOUNT_KEY);
  } catch {
    /* storage blocked: signed in for this page only */
  }
}

export interface ServerInfo {
  ok: boolean;
  accounts: boolean;
  voice: boolean;
}

export interface Api {
  account(): AccountSession | null;
  /** Null when no server answers (plain `npm run harness`). */
  health(): Promise<ServerInfo | null>;
  createAccount(email: string, code: string): Promise<AccountSession>;
  signIn(email: string, code: string): Promise<AccountSession>;
  signOut(): Promise<void>;
  getStrategy(): Promise<StrategyRecord | null>;
  /**
   * Returns the server's copy after the write; a 409 resolves with the server's copy instead of throwing.
   * A different strategy than the account's current one must name it in `replaces`.
   */
  putStrategy(record: StrategyRecord, replaces?: { profileId: string; revision: number } | null): Promise<{ record: StrategyRecord | null; conflict: boolean }>;
  getReps(): Promise<RepSession[]>;
  postReps(reps: RepSession[]): Promise<number>;
  /** Authorization for the signed-in account, for routes called outside this client (GPT live's /api/live/session). */
  authHeaders(): Record<string, string>;
}

export interface ApiOptions {
  baseUrl?: string;
  fetch?: FetchLike;
  store?: KeyValueStore | null;
}

export function createApi(opts: ApiOptions = {}): Api {
  const base = (opts.baseUrl ?? "").replace(/\/+$/, "");
  const store = opts.store === undefined ? defaultStore() : opts.store;
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));
  let session = loadAccount(store);

  async function call(method: string, path: string, body?: unknown, auth = true): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth) {
      if (!session) throw new ApiError(401, "Sign in first.");
      headers.authorization = `Bearer ${session.token}`;
    }
    let res;
    try {
      res = await doFetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new ApiError(0, "Could not reach the server.");
    }
    let data: Record<string, unknown> = {};
    try {
      data = ((await res.json()) as Record<string, unknown>) ?? {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      if (res.status === 401 && auth) {
        session = null;
        saveAccount(null, store);
      }
      throw new ApiError(res.status, typeof data.error === "string" ? data.error : `Server error ${res.status}.`, data);
    }
    return data;
  }

  async function startSession(path: string, email: string, code: string): Promise<AccountSession> {
    const data = await call("POST", path, { email, code }, false);
    session = { email: String(data.email), token: String(data.token) };
    saveAccount(session, store);
    return session;
  }

  return {
    account: () => session,
    async health() {
      try {
        const data = await call("GET", "/api/health", undefined, false);
        return data.ok === true ? { ok: true, accounts: data.accounts === true, voice: data.voice === true } : null;
      } catch {
        return null;
      }
    },
    createAccount: (email, code) => startSession("/api/accounts", email, code),
    signIn: (email, code) => startSession("/api/sessions", email, code),
    async signOut() {
      try {
        if (session) await call("DELETE", "/api/sessions");
      } finally {
        session = null;
        saveAccount(null, store);
      }
    },
    async getStrategy() {
      const data = await call("GET", "/api/strategy");
      return toRecord(data.record);
    },
    async putStrategy(record, replaces) {
      try {
        const data = await call("PUT", "/api/strategy", { record, ...(replaces ? { replaces } : {}) });
        return { record: toRecord(data.record), conflict: false };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) return { record: toRecord(err.body.record), conflict: true };
        throw err;
      }
    },
    async getReps() {
      const data = await call("GET", "/api/reps");
      return Array.isArray(data.reps) ? (data.reps as RepSession[]) : [];
    },
    async postReps(reps) {
      if (reps.length === 0) return 0;
      const data = await call("POST", "/api/reps", { reps });
      return Number(data.stored ?? 0);
    },
    authHeaders(): Record<string, string> {
      return session ? { authorization: `Bearer ${session.token}` } : {};
    },
  };
}

// ── sync ────────────────────────────────────────────────────────────────────

function backup(record: StrategyRecord, store: KeyValueStore | null): void {
  try {
    store?.setItem(PREVIOUS_STRATEGY_KEY, JSON.stringify(record));
  } catch {
    /* storage blocked */
  }
}

/**
 * Send this browser's record to the account and settle on one copy. The newer record wins: the same strategy at a
 * higher revision, or a different strategy saved later (it then names the account's current one as replaced). When
 * the account's copy wins, the local one is kept under PREVIOUS_STRATEGY_KEY. Saves the result locally and returns it.
 */
export async function pushRecord(api: Api, record: StrategyRecord, store: KeyValueStore | null = defaultStore(), remote?: StrategyRecord | null): Promise<StrategyRecord> {
  const sent = record;
  let server = remote;
  for (let attempt = 0; attempt < 3; attempt++) {
    let replaces: { profileId: string; revision: number } | null = null;
    if (server) {
      const sameStrategy = server.profile.profileId === record.profile.profileId;
      // Same strategy: the account's copy wins at an equal or higher revision. Different: the later save wins.
      const serverWins = sameStrategy ? server.revision >= record.revision : newer(record, server) === server;
      if (serverWins) {
        if (JSON.stringify(server) !== JSON.stringify(record)) backup(record, store);
        record = server;
        break;
      }
      if (!sameStrategy) replaces = { profileId: server.profile.profileId, revision: server.revision };
    }
    const put = await api.putStrategy(record, replaces);
    if (!put.conflict) break;
    server = put.record; // the account moved on: decide again against its copy
    if (!server) break;
  }
  // Write only over the record this push started from: a newer save made while it was in flight stays.
  const now = loadRecord(store);
  const untouched = !now || JSON.stringify(now) === JSON.stringify(sent) || (now.profile.profileId === record.profile.profileId && now.revision < record.revision);
  if (untouched) saveRecord(record, store);
  return record;
}

export interface SyncResult {
  record: StrategyRecord | null;
  runs: RepSession[];
  pushedRuns: number;
}

/**
 * Bring this browser and the account into line: the newer strategy record wins (see pushRecord), runs are merged
 * by id, and anything the server lacks is pushed. Saves the result locally.
 */
export async function syncAll(api: Api, store: KeyValueStore | null = defaultStore()): Promise<SyncResult> {
  const local = loadRecord(store);
  const remote = await api.getStrategy();
  let record: StrategyRecord | null = null;
  if (local) record = await pushRecord(api, local, store, remote);
  else if (remote) record = saveRecord(remote, store);

  const localRuns = loadRuns(store);
  const remoteRuns = await api.getReps();
  const seen = new Set(remoteRuns.map((r) => r.id));
  const missing = localRuns.filter((r) => !seen.has(r.id) && validateRepSession(r).ok);
  const pushedRuns = await api.postReps(missing);
  const byId = new Map<string, RepSession>();
  for (const r of [...remoteRuns, ...localRuns]) if (!byId.has(r.id)) byId.set(r.id, r);
  const runs = [...byId.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  try {
    store?.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    /* storage blocked */
  }
  return { record, runs, pushedRuns };
}

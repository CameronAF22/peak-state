// The page's side of the Peak State API (D-onboarding-017): the account, strategy and rep sync, and the
// short-lived GPT live key. Local storage stays the first copy; the server is the account's copy.

import { validateRepSession, type RepSession } from "@peak-state/contracts";
import type { KeyValueStore } from "../playback/storage.ts";
import { loadRuns, RUNS_KEY } from "../playback/storage.ts";
import { loadRecord, newer, saveRecord, toRecord, type StrategyRecord } from "../store/index.ts";

export const ACCOUNT_KEY = "peak-state.account";

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
  /** Returns the server's copy after the write; a 409 resolves with the server's newer copy instead of throwing. */
  putStrategy(record: StrategyRecord): Promise<{ record: StrategyRecord | null; conflict: boolean }>;
  getReps(): Promise<RepSession[]>;
  postReps(reps: RepSession[]): Promise<number>;
  realtimeKey(model: string): Promise<string>;
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
    async putStrategy(record) {
      try {
        const data = await call("PUT", "/api/strategy", { record });
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
    async realtimeKey(model) {
      const data = await call("POST", "/api/realtime/token", { model });
      if (typeof data.value !== "string") throw new ApiError(502, "The server sent no voice key.");
      return data.value;
    },
  };
}

// ── sync ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  record: StrategyRecord | null;
  runs: RepSession[];
  pushedRuns: number;
}

/**
 * Bring this browser and the account into line: the newer strategy record wins (the account's copy when the two
 * are different strategies), runs are merged by id, and anything the server lacks is pushed. Saves the result locally.
 */
export async function syncAll(api: Api, store: KeyValueStore | null = defaultStore()): Promise<SyncResult> {
  const local = loadRecord(store);
  const remote = await api.getStrategy();
  let record: StrategyRecord | null;
  if (local && remote && local.profile.profileId !== remote.profile.profileId) record = remote;
  else record = newer(local, remote);

  if (record && record !== remote && (!remote || record.revision > remote.revision || record.profile.profileId !== remote.profile.profileId)) {
    const put = await api.putStrategy(record);
    if (put.conflict && put.record) record = put.record;
  }
  if (record) saveRecord(record, store);

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

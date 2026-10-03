// Browser storage for the saved strategy and the run log (D-onboarding-012).
// Every access is wrapped: storage can be missing, full or blocked (private windows, previews).

import type { ProfileV2, RepSession } from "@peak-state/contracts";
import type { SavedStrategy } from "../types.ts";

export const STRATEGY_KEY = "peak-state.harness.strategy";
export const RUNS_KEY = "peak-state.harness.runs";

/** The subset of the Web Storage API these helpers use. Injected in tests. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    const g = globalThis as unknown as { localStorage?: KeyValueStore };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, store: KeyValueStore | null): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown, store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Save a confirmed profile as the current strategy. Returns what was stored. */
export function saveStrategy(profile: ProfileV2, store: KeyValueStore | null = defaultStore(), now: () => number = Date.now): SavedStrategy {
  const saved: SavedStrategy = { profile, savedAt: new Date(now()).toISOString() };
  writeJson(STRATEGY_KEY, saved, store);
  return saved;
}

/** The saved strategy, or null when there is none (or it cannot be read). */
export function loadStrategy(store: KeyValueStore | null = defaultStore()): SavedStrategy | null {
  const saved = readJson<SavedStrategy>(STRATEGY_KEY, store);
  if (!saved || typeof saved !== "object" || !saved.profile || !Array.isArray(saved.profile.states)) return null;
  return saved;
}

export function clearStrategy(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(STRATEGY_KEY);
  } catch {
    /* ignore */
  }
}

/** Every logged run, oldest first. */
export function loadRuns(store: KeyValueStore | null = defaultStore()): RepSession[] {
  const runs = readJson<RepSession[]>(RUNS_KEY, store);
  return Array.isArray(runs) ? runs : [];
}

/** Runs logged for one profile and state, oldest first. */
export function runsFor(profileId: string, stateId: string, store: KeyValueStore | null = defaultStore()): RepSession[] {
  return loadRuns(store).filter((r) => r.profileId === profileId && r.stateId === stateId);
}

/** Append a finished run to the log. Returns the whole log. */
export function appendRun(session: RepSession, store: KeyValueStore | null = defaultStore()): RepSession[] {
  const runs = [...loadRuns(store), session];
  writeJson(RUNS_KEY, runs, store);
  return runs;
}

export function clearRuns(store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(RUNS_KEY);
  } catch {
    /* ignore */
  }
}

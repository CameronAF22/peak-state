// The strategy record: the confirmed profile, a revision number and a log of every change (D-onboarding-014).
// Stored local first under the existing strategy key; an older SavedStrategy value upgrades to revision 1 on read.

import { getState, type ProfileV2, type Rating, type StateId, type Step } from "@peak-state/contracts";
import { STRATEGY_KEY, type KeyValueStore } from "../playback/storage.ts";

/** One answer that changed in a practice loop. */
export interface StrategyChange {
  stateId: StateId;
  stepIndex: number;
  /** "content" for the step's words, or "core.<attribute>" for a core submodality. */
  field: string;
  from: string | number | null;
  to: string | number | null;
  /** The person's own words for the new answer, when they gave some. */
  words?: string;
  /** The closeness rating that came just before the change. */
  rating: Rating | null;
  /** The revision this change produced. */
  revision: number;
  at: string;
}

export interface StrategyRecord {
  profile: ProfileV2;
  /** 1 for the first save; every change adds one. */
  revision: number;
  savedAt: string;
  changes: StrategyChange[];
}

function defaultStore(): KeyValueStore | null {
  try {
    return (globalThis as unknown as { localStorage?: KeyValueStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** True when the value looks like a strategy record (or the older SavedStrategy, which has no revision). */
function looksLikeRecord(v: unknown): v is Partial<StrategyRecord> & { profile: ProfileV2; savedAt: string } {
  if (!v || typeof v !== "object") return false;
  const p = (v as { profile?: unknown }).profile as ProfileV2 | undefined;
  return Boolean(p && typeof p === "object" && Array.isArray(p.states) && typeof (v as { savedAt?: unknown }).savedAt === "string");
}

/** Normalise anything read from storage or the server into a record, or null. */
export function toRecord(v: unknown): StrategyRecord | null {
  if (!looksLikeRecord(v)) return null;
  const revision = Number.isInteger(v.revision) && (v.revision as number) >= 1 ? (v.revision as number) : 1;
  const changes = Array.isArray(v.changes) ? (v.changes as StrategyChange[]) : [];
  return { profile: v.profile, revision, savedAt: v.savedAt, changes };
}

/** A new record for a freshly confirmed profile. */
export function newRecord(profile: ProfileV2, now: () => number = Date.now): StrategyRecord {
  return { profile, revision: 1, savedAt: new Date(now()).toISOString(), changes: [] };
}

export function loadRecord(store: KeyValueStore | null = defaultStore()): StrategyRecord | null {
  if (!store) return null;
  try {
    const raw = store.getItem(STRATEGY_KEY);
    return raw ? toRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveRecord(record: StrategyRecord, store: KeyValueStore | null = defaultStore()): StrategyRecord {
  try {
    store?.setItem(STRATEGY_KEY, JSON.stringify(record));
  } catch {
    // storage full or blocked: the record lives for this page only
  }
  return record;
}

// ── reading and changing one detail ─────────────────────────────────────────

/** The current value of a field on a step: its words, or one core submodality. */
export function readField(step: Step, field: string): string | number | null {
  if (field === "content") return step.content;
  const attr = field.startsWith("core.") ? field.slice(5) : null;
  if (!attr) return null;
  const core = (step.submodalities as { core?: Record<string, string | number> }).core ?? {};
  return core[attr] ?? null;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export interface ChangeInput {
  stateId: StateId;
  stepIndex: number;
  field: string;
  to: string | number;
  words?: string;
  rating: Rating | null;
}

/**
 * Apply one changed answer. Returns the next record (revision + 1, the change logged, updatedAt set), or the same
 * record when the value did not change. Never mutates the input.
 */
export function applyChange(record: StrategyRecord, input: ChangeInput, now: () => number = Date.now): StrategyRecord {
  const state = getState(record.profile, input.stateId);
  const step = state?.strategy.steps[input.stepIndex];
  if (!state || !step) throw new Error(`no step ${input.stepIndex} in state ${input.stateId}`);
  const from = readField(step, input.field);
  if (from === input.to) return record;

  const at = new Date(now()).toISOString();
  const profile = clone(record.profile);
  const s = getState(profile, input.stateId)!.strategy.steps[input.stepIndex];
  if (input.field === "content") {
    s.content = String(input.to);
  } else if (input.field.startsWith("core.")) {
    const attr = input.field.slice(5);
    const sub = s.submodalities as { core?: Record<string, string | number>; words?: Record<string, string> };
    sub.core = { ...(sub.core ?? {}), [attr]: input.to };
    const words = { ...(sub.words ?? {}) };
    if (input.words?.trim()) words[attr] = input.words.trim();
    else delete words[attr]; // the old phrasing described the old value
    sub.words = words;
    if (Object.keys(sub.words).length === 0) delete sub.words;
    // A driver measured against the old peak value now points at the new one; its effect is untested again.
    // When the new peak equals the contrast there is nothing left to change, so that difference and its driver go.
    const st = getState(profile, input.stateId)!;
    const kept: number[] = [];
    st.differences = st.differences.filter((d, i) => {
      if (d.stepIndex === input.stepIndex && d.modality === s.modality && d.attribute === attr) {
        if (d.contrast === input.to) return false;
        d.peak = input.to;
        d.ratingDelta = null;
      }
      kept.push(i);
      return true;
    });
    const remap = (ids: number[]) => ids.filter((i) => kept.includes(i)).map((i) => kept.indexOf(i));
    st.drivers = remap(st.drivers);
    if (st.recode) st.recode.appliedDrivers = remap(st.recode.appliedDrivers);
  } else {
    throw new Error(`unknown field ${input.field}`);
  }
  profile.updatedAt = at;
  const revision = record.revision + 1;
  const change: StrategyChange = {
    stateId: input.stateId,
    stepIndex: input.stepIndex,
    field: input.field,
    from,
    to: input.to,
    ...(input.words?.trim() && input.field !== "content" ? { words: input.words.trim() } : {}),
    rating: input.rating,
    revision,
    at,
  };
  return { profile, revision, savedAt: at, changes: [...record.changes, change] };
}

/** The newer of two records: higher revision wins; on a tie the later save. */
export function newer(a: StrategyRecord | null, b: StrategyRecord | null): StrategyRecord | null {
  if (!a) return b;
  if (!b) return a;
  if (a.profile.profileId !== b.profile.profileId) return Date.parse(a.savedAt) >= Date.parse(b.savedAt) ? a : b;
  if (a.revision !== b.revision) return a.revision > b.revision ? a : b;
  return Date.parse(a.savedAt) >= Date.parse(b.savedAt) ? a : b;
}

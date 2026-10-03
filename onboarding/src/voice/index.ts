// The voice layer: speaks the engine's question text and transcribes the person. Never decides what to ask.

import type { GptLiveConfig, VoiceAdapter, VoiceKind } from "../types.ts";
import { createBrowserVoice } from "./browser.ts";
import { createGptLiveVoice, DEFAULT_GPT_LIVE_MODEL } from "./gpt-live.ts";
import { createTypedVoice } from "./typed.ts";

export { createTypedVoice } from "./typed.ts";
export { createBrowserVoice, isBrowserVoiceSupported } from "./browser.ts";
export type { BrowserVoiceOptions } from "./browser.ts";
export {
  createGptLiveVoice,
  buildSessionUpdate,
  buildSpeakEvent,
  speakInstruction,
  DEFAULT_GPT_LIVE_MODEL,
  DEFAULT_REALTIME_ENDPOINT,
  DEFAULT_TRANSCRIBE_MODEL,
} from "./gpt-live.ts";
export type {
  AudioElementLike,
  DataChannelLike,
  GptLiveDeps,
  GptLiveVoiceConfig,
  MediaStreamLike,
  PeerConnectionLike,
} from "./gpt-live.ts";

/**
 * Build the adapter for a kind. "gpt-live" without a config (or without an API key) still returns the
 * GPT live adapter; its start() reports a clear error status so the UI can ask for a key.
 */
export function createVoice(kind: VoiceKind, config?: GptLiveConfig): VoiceAdapter {
  switch (kind) {
    case "browser":
      return createBrowserVoice();
    case "gpt-live":
      return createGptLiveVoice(config ?? { apiKey: "", model: DEFAULT_GPT_LIVE_MODEL });
    case "typed":
    default:
      return createTypedVoice();
  }
}

// ── settings ────────────────────────────────────────────────────────────────

export const VOICE_SETTINGS_KEY = "peak-state.harness.voice";

export interface VoiceSettings {
  kind: VoiceKind;
  /** GPT live model id. Default "gpt-live-1". */
  model: string;
  /** Only present when remember is true (or for the current page session, never persisted otherwise). */
  apiKey?: string;
  /** Persist the API key in this browser's localStorage. Off by default. */
  remember: boolean;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { kind: "typed", model: DEFAULT_GPT_LIVE_MODEL, remember: false };

/** Minimal storage shape so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return (globalThis as unknown as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

const KINDS: readonly VoiceKind[] = ["typed", "browser", "gpt-live"];

export function loadVoiceSettings(storage: StorageLike | null = defaultStorage()): VoiceSettings {
  if (!storage) return { ...DEFAULT_VOICE_SETTINGS };
  try {
    const raw = storage.getItem(VOICE_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const v = JSON.parse(raw) as Partial<VoiceSettings>;
    const out: VoiceSettings = {
      kind: KINDS.includes(v.kind as VoiceKind) ? (v.kind as VoiceKind) : DEFAULT_VOICE_SETTINGS.kind,
      model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_GPT_LIVE_MODEL,
      remember: v.remember === true,
    };
    if (out.remember && typeof v.apiKey === "string" && v.apiKey) out.apiKey = v.apiKey;
    return out;
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

/** Saves kind and model always; saves the API key only when remember is true. */
export function saveVoiceSettings(settings: VoiceSettings, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const stored: Record<string, unknown> = {
    kind: settings.kind,
    model: settings.model?.trim() || DEFAULT_GPT_LIVE_MODEL,
    remember: settings.remember === true,
  };
  if (settings.remember && settings.apiKey) stored.apiKey = settings.apiKey;
  try {
    storage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(stored));
  } catch {
    // storage full or blocked: settings live for this page only
  }
}

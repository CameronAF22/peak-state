// Shared shapes inside the onboarding question harness (D-onboarding-012).
// Cross-lane shapes (Profile v2, OnboardingEvent, RepSession) come from @peak-state/contracts and are never redeclared.

import type { OnboardingEvent, ProfileV2, SensoryModality, StateId } from "@peak-state/contracts";

// ── question bank (onboarding/script/) ──────────────────────────────────────

/** Built-in states offered on the first screen. Testing always answers one of these. */
export type PresetState = "content" | "destressed";

/** Where in the flow a question sits. */
export type QuestionKind =
  | "choose-state" // 1.1 What state do you want to choose?
  | "memory" // 1.2 Step into a specific time
  | "first-step" // 1.3 The very first thing
  | "modality" // asked only when the sense of a step could not be read from the answer
  | "submodality" // section 2 core attributes for the current step's sense
  | "fully-in" // 1.5 Fully in it, or a next thing?
  | "next-step" // 1.4 After that, the very next thing
  | "anchor" // Which one brings it back fastest?
  | "confirm"; // 1.6 Playback: is that the order?

export interface Choice {
  /** Stored value: a contracts vocabulary value, a modality, "yes"/"no", a step index as string, etc. */
  value: string;
  /** What the button says. */
  label: string;
}

/** One question as the person sees and hears it, already filled in for the current state and step. */
export interface Question {
  /** Stable id, e.g. "first-step", "sub:visual:distance:0", "next-step:2". */
  id: string;
  kind: QuestionKind;
  /** Spoken and shown. Placeholders already replaced. */
  text: string;
  /** Quick-pick buttons (vocabulary values, yes/no, step picks). Free text is always accepted too. */
  choices: Choice[];
  /** Exactly two phrasings shown after the hint delay, to help find descriptive language. */
  suggestions: [string, string];
  /** Present for submodality questions. */
  target?: { stepIndex: number; modality: SensoryModality; attribute: string };
  /** Section 1 or 2 of the playbook, for the screen header. */
  section: "strategy" | "submodalities" | "playback";
}

// ── engine (onboarding/src/engine/) ─────────────────────────────────────────

export type AnswerVia = "voice" | "typed" | "script" | "suggestion" | "choice";

export interface Answer {
  text: string;
  via: AnswerVia;
  /** Set when a choice button was pressed. */
  choiceValue?: string;
}

export type EngineStatus = "asking" | "confirmed" | "stopped";

/** A step as the harness shows it while it fills in. */
export interface StepView {
  index: number;
  modality: SensoryModality | "other";
  direction: "external" | "internal";
  content: string;
  /** Core attributes for this step's sense, with the captured value or null. */
  checklist: { attribute: string; label: string; value: string | number | null; words?: string }[];
  isAnchor: boolean;
}

export interface EngineSnapshot {
  status: EngineStatus;
  stateId: StateId | null;
  stateLabel: string | null;
  /** The question waiting for an answer; null when confirmed or stopped. */
  question: Question | null;
  steps: StepView[];
  /** e.g. "Ve → Ai → Ki". */
  chain: string;
  fullyInAt: number | null;
  anchorStep: number | null;
  /** The transcript so far, guide and person. */
  transcript: { who: "guide" | "person"; text: string }[];
  /** Set once confirmed. */
  profile: ProfileV2 | null;
  /** Set when stopped by the safety screen. */
  stopReason: string | null;
}

export interface EngineOptions {
  /** Milliseconds since epoch. Injected so tests are deterministic. */
  now?: () => number;
  onEvent?: (event: OnboardingEvent) => void;
  /** Max steps before the guide assumes the person is fully in. Default 6. */
  maxSteps?: number;
  /** For a test run: fixed profile id. */
  profileId?: string;
}

/** The deterministic question engine. Created by createEngine(options) in src/engine/index.ts. */
export interface QuestionEngine {
  snapshot(): EngineSnapshot;
  /** Answer the current question. Returns the new snapshot. */
  answer(answer: Answer): EngineSnapshot;
  /** Go back one question (undo the last answer). */
  back(): EngineSnapshot;
  /** Start over. */
  reset(): EngineSnapshot;
}

// ── voice (onboarding/src/voice/) ───────────────────────────────────────────

export type VoiceKind = "typed" | "browser" | "gpt-live";

export interface VoiceStatus {
  kind: VoiceKind;
  state: "idle" | "connecting" | "ready" | "speaking" | "listening" | "error";
  detail?: string;
}

/** Speaks the engine's questions and hears the person's answers. Never decides what to ask. */
export interface VoiceAdapter {
  readonly kind: VoiceKind;
  start(): Promise<void>;
  stop(): void;
  /** Resolves when the text has been spoken (immediately for typed). */
  speak(text: string): Promise<void>;
  /** Partial and final transcripts of what the person says. Returns an unsubscribe. */
  onTranscript(cb: (text: string, final: boolean) => void): () => void;
  onStatus(cb: (status: VoiceStatus) => void): () => void;
}

export interface GptLiveConfig {
  apiKey: string;
  /** Editable in settings. Default "gpt-live-1". */
  model: string;
  /** Default "https://api.openai.com/v1/realtime/calls". */
  endpoint?: string;
  voice?: string;
}

// ── hint timer (onboarding/src/engine/hints.ts) ─────────────────────────────

/** Default delay before the two suggestions show. */
export const HINT_DELAY_MS = 5000;

// ── storage and playback (onboarding/src/playback/) ─────────────────────────

export interface SavedStrategy {
  profile: ProfileV2;
  savedAt: string;
}

export interface PlaybackCallbacks {
  /** Called as each step starts, with the line being spoken. -1 for intro/outro lines. */
  onStep(stepIndex: number, line: string): void;
  /** Ask the person for a 0..10 rating; resolves with it. */
  rate(prompt: string): Promise<number>;
  speak(text: string): Promise<void>;
}

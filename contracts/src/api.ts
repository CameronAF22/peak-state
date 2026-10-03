// Module API. The app calls these; each lane implements its module and exports it from <lane>/src/index.ts
// (D-experience-003). Prose and event flow: contracts/API.md. D-contracts-007.

import type { OnboardingEvent, OnboardingResult } from "./onboarding.ts";
import type { ProfileV2, StateId } from "./profile.ts";
import type { ProgressByState, RepSession, RepTrigger } from "./reps.ts";
import type { CalibrationPhase, CalibrationSummary, DetectionEvent, SignalFrame } from "./signals.ts";

export type Unsubscribe = () => void;

/** What the app hands every module (D-experience-005). The app owns speech and the clock. */
export interface ModuleHost {
  /** Present when the module may render its own view. */
  el?: HTMLElement;
  speech: {
    speak(text: string): Promise<void>;
    listen(onText: (text: string, final: boolean) => void): Unsubscribe;
    readonly muted: boolean;
  };
  clock: {
    /** Milliseconds since the Unix epoch, possibly scaled for the demo. */
    now(): number;
    readonly speed: number;
  };
  onSafetyStop(reason: string): void;
}

/** A module with its own view (D-experience-003). */
export interface Mountable<P> {
  mount(el: HTMLElement, props: P): () => void;
}

// ── sensing ─────────────────────────────────────────────────────────────────

export interface CalibrationHandle {
  /** Tell sensing someone is speaking, so those seconds are excluded. */
  mark(kind: "speech-start" | "speech-end"): void;
  end(): Promise<CalibrationSummary>;
}

export interface SensingHandle {
  stop(): void;
  /** The "I'm off" button. Emits a manual DetectionEvent. */
  triggerManual(): void;
}

export interface SensingModule {
  start(
    profile: ProfileV2,
    stateId: StateId,
    onEvent: (event: DetectionEvent) => void,
    onFrame?: (frame: SignalFrame) => void,
  ): SensingHandle;
  calibration: {
    /** Open-ended window for one playbook phase (D-sensing-006). */
    begin(stateId: StateId, phase: CalibrationPhase): CalibrationHandle;
  };
  /** Fixed-length convenience. */
  record(stateId: StateId, seconds: number, phase: CalibrationPhase): Promise<CalibrationSummary>;
}

// ── onboarding ──────────────────────────────────────────────────────────────

export interface OnboardingOptions {
  onEvent?: (event: OnboardingEvent) => void;
  /** voice is the default; script replays a recorded event stream (the demo path). */
  mode?: "voice" | "typed" | "script";
  /** Calibration during playbook 1.2-1.5 and 3.1-3.2. Without it, onboarding completes with empty calibration. */
  calibration?: SensingModule["calibration"];
  /** Draft to resume from. */
  draft?: ProfileV2 | null;
}

export interface OnboardingModule {
  run(host: ModuleHost, options?: OnboardingOptions): Promise<OnboardingResult>;
}

// ── reps ────────────────────────────────────────────────────────────────────

export interface RepHandle {
  session: Promise<RepSession>;
  /** The stop button. The session resolves with endedBy user-stop. */
  stop(): void;
}

export interface RepsModule {
  /** Refuses a draft profile (confirmedAt null). */
  run(profile: ProfileV2, stateId: StateId, trigger: RepTrigger, host: ModuleHost, detection?: DetectionEvent): RepHandle;
  /** Playbook section 4 as the first reps (D-reps-006). */
  fromOnboarding(profile: ProfileV2, stateId: StateId): RepSession[];
  progress(sessions: RepSession[]): ProgressByState;
}

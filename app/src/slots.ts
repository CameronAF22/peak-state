// The module slots the app fills (D-experience-003), typed by @peak-state/contracts' module API.
// Each slot type extends the contracts interface only with optional trailing options the app's screens use
// (typed answers, ratings, step callbacks, cancel), so every implementation still satisfies contracts.
import type { Answer, Question, StepView } from "@peak-state/onboarding";
import type { ScriptStep } from "@peak-state/reps";
import type {
  DetectionEvent,
  ModuleHost,
  OnboardingModule,
  OnboardingOptions,
  OnboardingResult,
  ProfileV2,
  RepHandle,
  RepTrigger,
  RepsModule,
  SensingHandle,
  SensingModule,
  SignalFrame,
  StateId,
} from "./contracts";

// ── onboarding ──────────────────────────────────────────────────────────────

export type AnswerMessage = { kind: "answer"; answer: Answer } | { kind: "back" };

/** Typed and tapped answers from the screen into a running onboarding. */
export interface AnswerChannel {
  push(message: AnswerMessage): void;
  subscribe(cb: (message: AnswerMessage) => void): () => void;
}

export function createAnswerChannel(): AnswerChannel {
  const subs = new Set<(m: AnswerMessage) => void>();
  return {
    push(m) {
      for (const cb of [...subs]) cb(m);
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

export interface AppOnboardingOptions extends OnboardingOptions {
  /** Abort resolves the run as stopped (cancel). */
  signal?: AbortSignal;
  answers?: AnswerChannel;
  /** The question waiting for an answer, with its quick picks (null when the run ends), and the steps so far. */
  onQuestion?(question: Question | null, steps: StepView[]): void;
}

export interface AppOnboardingModule extends OnboardingModule {
  run(host: ModuleHost, options?: AppOnboardingOptions): Promise<OnboardingResult>;
}

// ── reps ────────────────────────────────────────────────────────────────────

export interface RepUi {
  kind?: "full" | "anchor-only";
  repIndex?: number;
  /** Ask the person for a 0 to 10 rating. Without it the module listens for a spoken number. */
  rate?(prompt: string): Promise<number>;
  /** Each planned step as it starts. */
  onStep?(step: ScriptStep, index: number): void;
}

export interface AppRepsModule extends RepsModule {
  run(profile: ProfileV2, stateId: StateId, trigger: RepTrigger, host: ModuleHost, detection?: DetectionEvent, ui?: RepUi): RepHandle;
}

// ── sensing ─────────────────────────────────────────────────────────────────

/** Sensing gate as the Live screen draws it. */
export interface GateView {
  consecutive: number;
  required: number;
  refractoryRemainingS: number;
}

export interface AppSensingModule extends SensingModule {
  start(
    profile: ProfileV2,
    stateId: StateId,
    onEvent: (event: DetectionEvent) => void,
    onFrame?: (frame: SignalFrame) => void,
    onGate?: (gate: GateView) => void,
  ): SensingHandle;
}

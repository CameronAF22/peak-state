// TEMPORARY MIRROR of @peak-state/contracts (D-experience-006).
// Field for field from contracts/PLAN.md (D-contracts-005, D-contracts-006) and the
// proposed onboarding events and ModuleHost (D-experience-005). When @peak-state/contracts
// merges, this file becomes `export * from "@peak-state/contracts"` and nothing else in the
// app changes. Do not add fields here: message the contracts lane instead.

// ---------- Profile v2 ----------

export type Modality = "visual" | "auditory" | "kinesthetic" | "olfactory" | "gustatory";
export type Direction = "external" | "internal";

export interface Submodalities {
  core: Record<string, string | number>;
  extended?: Record<string, string | number>;
  other?: Record<string, string | number>;
}

export type AnchorDetail =
  | { kind: "scene"; [k: string]: unknown }
  | { kind: "song"; title: string; artist?: string; moment?: string }
  | { kind: "body"; location: string; movement?: string }
  | null;

export interface StrategyStep {
  modality: Modality;
  direction: Direction;
  content: string;
  submodalities: Submodalities;
  anchorDetail?: AnchorDetail;
}

export interface Difference {
  modality: Modality;
  attribute: string;
  peak: string | number;
  contrast: string | number;
  ratingDelta: number | null;
}

export interface CalibrationStats {
  hr: { mean: number; sd: number };
  lnRmssd: { mean: number; sd: number };
  rmssd: number;
  windows: number;
}

export interface CalibrationSummary {
  phase: "peak" | "contrast" | "neutral";
  source: SignalSource;
  startedAt: string;
  durationSeconds: number;
  quality: number;
  stats: CalibrationStats;
  rating?: number;
}

export interface PeakState {
  id: string;
  label: string;
  words: string;
  memoryCue?: string;
  leverage?: string;
  strategy: { steps: StrategyStep[]; fullyInAt: number | null; confirmed: boolean };
  anchorStep: number | null;
  contrast: {
    label: string;
    submodalities: Partial<Record<Modality, Submodalities>>;
    prefilled: boolean;
  } | null;
  differences: Difference[] | null;
  drivers: number[] | null;
  recode: { appliedDrivers: number[] } | null;
  test: { before: number; after: number } | null;
  futurePace: { situation: string } | null;
  calibration: { peak: CalibrationSummary | null; contrast: CalibrationSummary | null } | null;
}

export interface ProfileV2 {
  schemaVersion: 2;
  profileId: string;
  displayName?: string;
  createdAt: string;
  confirmedAt: string | null;
  states: PeakState[];
  neutral?: CalibrationSummary | null;
}

// ---------- Signals and detection ----------

export type SignalSource = "simulator" | "hr-strap" | "manual";

export interface SignalFrame {
  t: number;
  source: SignalSource;
  hr: number | null;
  rr: number[];
  quality: number;
  scenarioStep?: string;
}

export interface DetectionEvent {
  id: string;
  t: number;
  kind: "drift" | "manual";
  targetStateId: string | null;
  confidence: number;
  window: { startT: number; endT: number; hr: number; rmssd: number; quality: number };
  gate: { consecutive: number; refractoryMs: number; sham: boolean };
  scores?: { toPeak: number; toContrast: number };
}

// ---------- Reps ----------

export type RepStepKind = "rate" | "anchor" | "strategy-step" | "leverage" | "peak";

export interface RepStep {
  kind: RepStepKind;
  strategyStepIndex?: number;
  driverIndexes?: number[];
  plannedMs: number;
  startedAt: string | null;
  endedAt: string | null;
  delivered: boolean;
}

export interface RepTrigger {
  kind: "detection" | "manual" | "practice" | "onboarding";
  detectionId?: string;
}

export interface RepSession {
  schemaVersion: 1;
  id: string;
  profileId: string;
  stateId: string;
  repIndex: number;
  kind: "full" | "anchor-only";
  trigger: RepTrigger;
  arm: "cue" | "sham";
  startedAt: string;
  endedAt: string;
  steps: RepStep[];
  intensityBefore: number | null;
  intensityAfter: number | null;
  recoverySeconds: number | null;
  recoveryCensored: boolean;
  anchorPaired: boolean;
  signalSource: SignalSource | "none";
  scriptHash: string;
  endedBy: "completed" | "skipped" | "user-stop" | "safety-stop" | "timeout";
}

// ---------- Module API (D-experience-003, D-experience-005, D-contracts-006) ----------

export interface ModuleHost {
  el?: HTMLElement;
  speech: {
    speak(text: string): Promise<void>;
    listen(onText: (text: string, final: boolean) => void): () => void;
    readonly muted: boolean;
  };
  clock: { now(): number; readonly speed: number; sleep(ms: number): Promise<void> };
  onSafetyStop(reason: string): void;
}

/** Proposed in D-experience-005; contracts will type the final union. */
export type OnboardingEvent =
  | { type: "guideTurn"; text: string; section: string }
  | { type: "userTurn"; text: string; final: boolean }
  | { type: "stateNamed"; stateId: string; label: string; words: string }
  | { type: "stepCaptured"; stateId: string; index: number; step: StrategyStep }
  | { type: "submodalityCaptured"; stateId: string; index: number; tier: "core" | "extended"; key: string; value: string | number }
  | { type: "contrastCaptured"; stateId: string; contrast: NonNullable<PeakState["contrast"]> }
  | { type: "driverFound"; stateId: string; differences: Difference[]; drivers: number[] }
  | { type: "anchorStepMarked"; stateId: string; index: number }
  | { type: "testRated"; stateId: string; before: number; after: number }
  | { type: "window"; phase: "peak" | "contrast"; open: boolean }
  | { type: "confirmed"; profile: ProfileV2 }
  | { type: "stopped"; reason: "safety" | "cancel" };

export type OnboardingResult =
  | { status: "confirmed"; profile: ProfileV2 }
  | { status: "stopped"; reason: "safety" | "cancel"; draft: ProfileV2 | null };

export interface OnboardingModule {
  run(props: { host: ModuleHost; mode: "voice" | "typed" | "scripted"; onEvent(e: OnboardingEvent): void; signal?: AbortSignal }): Promise<OnboardingResult>;
}

export interface GateState {
  consecutive: number;
  required: number;
  refractoryRemainingS: number;
  sham: boolean;
  confidence: number;
}

export interface SensingHandle {
  stop(): void;
  triggerManual(): void;
}

export interface SensingModule {
  start(
    profile: ProfileV2,
    onEvent: (e: DetectionEvent) => void,
    opts: { host: ModuleHost; stateId: string; onFrame?: (f: SignalFrame) => void; onGate?: (g: GateState) => void },
  ): SensingHandle;
}

export interface RepRunProps {
  host: ModuleHost;
  arm?: "cue" | "sham";
  /** The app asks the person for a 0 to 10 rating and resolves with it. */
  rate(prompt: string): Promise<number>;
  onStep?(step: RepStep, index: number, say: string): void;
}

export interface RepHandle {
  session: Promise<RepSession>;
  stop(reason: "user-stop" | "safety-stop"): void;
}

export type StateStatus = "conditioning" | "ready-to-test" | "installed" | "no-anchor";

export interface ProgressForState {
  stateId: string;
  reps: number;
  cueReps: number;
  shamReps: number;
  intensityTrend: { repIndex: number; before: number | null; after: number | null }[];
  meanRecoveryCue: number | null;
  meanRecoverySham: number | null;
}

export interface RepsModule {
  run(profile: ProfileV2, stateId: string, trigger: RepTrigger, props: RepRunProps): RepHandle;
  progress(sessions: RepSession[]): ProgressForState[];
  status(profile: ProfileV2, sessions: RepSession[]): Record<string, StateStatus>;
}

// ---------- Derived views (contracts/src/derive.ts) ----------

const LETTER: Record<Modality, string> = { visual: "V", auditory: "A", kinesthetic: "K", olfactory: "O", gustatory: "G" };

export function stepCode(step: Pick<StrategyStep, "modality" | "direction">): string {
  return LETTER[step.modality] + (step.direction === "external" ? "e" : "i");
}

/** The step-chain notation, for example "Ve → Ai → Ki". */
export function chain(state: Pick<PeakState, "strategy">): string {
  return state.strategy.steps.map(stepCode).join(" → ");
}

/** Core submodality keys per modality, from the playbook. */
export const CORE_KEYS: Record<Modality, string[]> = {
  visual: ["location", "size", "distance", "brightness", "perspective"],
  auditory: ["source", "volume", "location"],
  kinesthetic: ["bodyLocation", "intensity", "movement"],
  olfactory: [],
  gustatory: [],
};

/** Driver submodalities for one step, as plain instructions. */
export function driverInstructions(state: PeakState, stepIndex: number): string[] {
  const step = state.strategy.steps[stepIndex];
  if (!step || !state.differences || !state.drivers) return [];
  return state.drivers
    .map((i) => state.differences![i])
    .filter((d) => d && d.modality === step.modality)
    .map((d) => `${d.attribute}: ${d.peak}`);
}

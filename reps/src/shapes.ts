// Local mirror of the shapes proposed in D-contracts-005 (Profile v2) and
// D-contracts-006 (RepSession), field for field, using contracts' names.
// This is the only file in reps that declares them. Replace it with imports
// from @peak-state/contracts as soon as that package exists (D-reps-009).

export type Modality = "visual" | "auditory" | "kinesthetic" | "olfactory" | "gustatory";
export type Direction = "external" | "internal";

export type SubmodalityValues = Record<string, string | number>;

export interface Submodalities {
  core: SubmodalityValues;
  extended?: SubmodalityValues;
  other?: SubmodalityValues;
}

export interface StrategyStep {
  modality: Modality;
  direction: Direction;
  content: string;
  submodalities: Submodalities;
  anchorDetail?: Record<string, unknown> | null;
}

export interface Strategy {
  steps: StrategyStep[];
  fullyInAt: number;
  confirmed: boolean;
}

export interface Difference {
  modality: Modality;
  attribute: string;
  peak: string | number;
  contrast: string | number;
  ratingDelta: number;
}

export interface State {
  id: string;
  label: string;
  words: string;
  memoryCue?: string | null;
  leverage?: string | null;
  strategy: Strategy;
  anchorStep: number | null;
  contrast: {
    label: string;
    submodalities: Partial<Record<Modality, Submodalities>>;
    prefilled?: boolean;
  } | null;
  differences: Difference[];
  drivers: number[];
  recode: { appliedDrivers: number[] } | null;
  test: { before: number; after: number } | null;
  futurePace: { situation: string } | null;
  calibration?: Record<string, unknown> | null;
}

export interface ProfileV2 {
  schemaVersion: 2;
  profileId: string;
  displayName?: string;
  createdAt: string;
  confirmedAt: string | null;
  states: State[];
  neutral?: Record<string, unknown> | null;
}

export type RepKind = "full" | "anchor-only";
export type RepStepKind = "rate" | "anchor" | "strategy-step" | "leverage" | "peak";
export type TriggerKind = "detection" | "manual" | "practice" | "onboarding";
export type Arm = "cue" | "sham";
export type SignalSource = "simulator" | "hr-strap" | "none";
export type EndedBy = "completed" | "skipped" | "user-stop" | "safety-stop" | "timeout";

export interface RepTrigger {
  kind: TriggerKind;
  detectionId?: string;
}

export interface RepStep {
  kind: RepStepKind;
  strategyStepIndex?: number;
  driverIndexes?: number[];
  plannedMs: number;
  startedAt: string | null;
  endedAt: string | null;
  delivered: boolean;
}

export interface RepSession {
  schemaVersion: 1;
  id: string;
  profileId: string;
  stateId: string;
  repIndex: number;
  kind: RepKind;
  trigger: RepTrigger;
  arm: Arm;
  startedAt: string;
  endedAt: string;
  steps: RepStep[];
  intensityBefore: number | null;
  intensityAfter: number | null;
  recoverySeconds: number | null;
  recoveryCensored: boolean;
  anchorPaired: boolean;
  signalSource: SignalSource;
  scriptHash: string;
  endedBy: EndedBy;
}

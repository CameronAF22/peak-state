// Profile v2. Mirrors schemas/profile.v2.schema.json (D-contracts-008).
// The schema is the source of truth; test/types.test.ts keeps the two in step.

import type { CalibrationSummary } from "./signals.ts";

export type StateId = string; // ^[a-z][a-z0-9-]{0,31}$
export type Rating = number; // integer 0..10
export type IsoDateTime = string;

export const VISUAL = {
  core: {
    location: ["center", "left", "right", "above", "below", "upper-left", "upper-right", "lower-left", "lower-right", "all-around"],
    size: ["small", "medium", "life-size", "larger-than-life"],
    distance: ["close", "arm-length", "across-room", "far"],
    brightness: ["dim", "normal", "bright"],
    perspective: ["associated", "dissociated"],
  },
  extended: {
    motion: ["still", "movie"],
    colour: ["colour", "black-and-white"],
    focus: ["sharp", "soft"],
    frame: ["framed", "panoramic"],
  },
} as const;

export const AUDITORY = {
  core: {
    source: null, // free text: whose voice or what source
    volume: ["quiet", "normal", "loud"],
    location: ["inside-head", "front", "behind", "left", "right", "above", "all-around"],
  },
  extended: {
    pitch: ["low", "mid", "high"],
    tempo: ["slow", "medium", "fast"],
    tone: ["warm", "neutral", "sharp"],
  },
} as const;

export const KINESTHETIC = {
  core: {
    bodyLocation: ["head", "face", "throat", "chest", "stomach", "shoulders", "arms", "hands", "back", "legs", "feet", "whole-body"],
    intensity: null, // integer 0..10
    movement: ["still", "moving"],
  },
  extended: {
    temperature: ["cool", "neutral", "warm"],
    pressure: ["light", "medium", "heavy"],
    rhythm: ["steady", "pulsing"],
    direction: ["up", "down", "outward", "inward", "spreading", "circling"],
  },
} as const;

/** The controlled submodality vocabulary, per modality. null means free value (text, or 0..10 for intensity). */
export const SUBMODALITIES = { visual: VISUAL, auditory: AUDITORY, kinesthetic: KINESTHETIC } as const;

type Enum<T> = T extends readonly (infer U)[] ? U : never;
type Vocab<T extends Record<string, readonly string[] | null>> = { [K in keyof T]?: Enum<T[K]> };

/** The person's own phrasing for any attribute, keyed by attribute name. */
export type Words = Record<string, string>;

export interface VisualSubmodalities {
  core?: Vocab<typeof VISUAL.core>;
  extended?: Vocab<typeof VISUAL.extended>;
  words?: Words;
}

export interface AuditorySubmodalities {
  core?: { source?: string; volume?: Enum<typeof AUDITORY.core.volume>; location?: Enum<typeof AUDITORY.core.location> };
  extended?: Vocab<typeof AUDITORY.extended>;
  words?: Words;
}

export interface KinestheticSubmodalities {
  core?: { bodyLocation?: Enum<typeof KINESTHETIC.core.bodyLocation>; intensity?: Rating; movement?: Enum<typeof KINESTHETIC.core.movement> };
  extended?: Vocab<typeof KINESTHETIC.extended>;
  words?: Words;
}

export type SensoryModality = "visual" | "auditory" | "kinesthetic";
export type Modality = SensoryModality | "other";
export type Direction = "external" | "internal";

export type AnchorDetail =
  | { kind: "scene"; caption: string; details?: string[] }
  | { kind: "song"; title: string; artist?: string | null; moment?: string | null }
  | { kind: "body"; gesture: string };

interface StepBase {
  direction: Direction;
  /** The step in the person's words. */
  content: string;
  anchorDetail?: AnchorDetail | null;
}

export type Step =
  | (StepBase & { modality: "visual"; submodalities: VisualSubmodalities })
  | (StepBase & { modality: "auditory"; submodalities: AuditorySubmodalities })
  | (StepBase & { modality: "kinesthetic"; submodalities: KinestheticSubmodalities })
  | (StepBase & { modality: "other"; submodalities: { words?: Words } });

export interface Strategy {
  /** Playbook 1.3 to 1.5, in order. Array position is the step index. */
  steps: Step[];
  /** Playbook 1.5: step index where the person was fully in the state. */
  fullyInAt: number | null;
  /** Playbook 1.6: the person accepted the order on playback. */
  confirmed: boolean;
}

export interface Contrast {
  /** Short label only, never what it was about. */
  label: string;
  submodalities: {
    visual?: VisualSubmodalities;
    auditory?: AuditorySubmodalities;
    kinesthetic?: KinestheticSubmodalities;
  };
  /** Filled from a rehearsal, not live. */
  prefilled: boolean;
}

export interface Difference {
  stepIndex: number;
  modality: SensoryModality;
  attribute: string;
  peak: string | number;
  contrast: string | number;
  /** Rating change when this one attribute is switched. Null until tested. */
  ratingDelta: number | null;
}

export interface State {
  id: StateId;
  label: string;
  words: string;
  memoryCue?: string | null;
  leverage?: string | null;
  strategy: Strategy;
  anchorStep: number | null;
  contrast: Contrast | null;
  differences: Difference[];
  /** Indexes into differences, largest ratingDelta first. Hypotheses. */
  drivers: number[];
  recode: { appliedDrivers: number[] } | null;
  test: { before: Rating; after: Rating } | null;
  futurePace: { situation: string } | null;
  calibration: { peak: CalibrationSummary | null; contrast: CalibrationSummary | null };
}

export interface ProfileV2 {
  schemaVersion: 2;
  profileId: string;
  displayName?: string | null;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
  /** Null is a draft. Reps refuse a draft. */
  confirmedAt: IsoDateTime | null;
  /** 1 to 3 states. The MVP has one. */
  states: State[];
}

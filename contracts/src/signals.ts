// Signals: calibration, frames and detection events.
// Mirrors schemas/calibration, signal-frame and detection-event (D-contracts-007, D-sensing-005/006).

import type { IsoDateTime, StateId } from "./profile.ts";

export type SignalSource = "simulator" | "hr-strap" | "manual";
export type CalibrationPhase = "peak" | "contrast";

export interface MeanSd {
  mean: number;
  sd: number;
}

export interface CalibrationSummary {
  stateId: StateId;
  phase: CalibrationPhase;
  source: SignalSource;
  hr: MeanSd;
  lnRmssd: MeanSd;
  windows: number;
  seconds: number;
  /** low: fewer than 2 usable windows; use as a prior only. */
  quality: "ok" | "low";
  speechExcludedSeconds: number;
  recordedAt: IsoDateTime;
  /** On the second summary of a pair, in pooled SDs. */
  separability?: { separable: boolean; hr: number; lnRmssd: number };
  /** The person's own 0..10 rating, added by onboarding. */
  rating?: number;
}

export interface SignalFrame {
  /** Milliseconds since the Unix epoch. */
  t: number;
  source: SignalSource;
  hr: number | null;
  /** RR intervals in ms since the previous frame. */
  rr: number[];
  /** 0..1 */
  quality: number;
  /** Simulator scenario segment. */
  label?: string;
}

export interface DetectionWindow {
  seconds: number;
  hrMean: number | null;
  rmssd: number | null;
  hrDelta: number | null;
  rmssdDelta: number | null;
  z: number | null;
  /** 0 at peak, 1 at contrast. Null unless calibrationMode is contrast. */
  position: number | null;
}

export interface DetectionEvent {
  schemaVersion: 1;
  id: string;
  t: number;
  kind: "drift" | "manual";
  stateId: StateId;
  confidence: number;
  /** Null for manual events. */
  window: DetectionWindow | null;
  gate: { consecutiveWindows: number; required: number; refractorySeconds: number; sham: boolean };
  calibrationMode: "contrast" | "on-only" | "generic";
}

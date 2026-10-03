// Fixture stub of the sensing module: a deterministic simulator at 1 Hz with a
// 5 s window gate (3 consecutive windows, refractory, no sham on the first fire).
// It starts in the person's peak band, drifts toward their contrast band so the
// gate opens at about 20 s, and recovers after a detection. Sensing is plan only for now (D-onboarding-023),
// so this stub stays in its slot. It implements contracts' SensingModule plus an optional gate callback,
// and runs in real time (contracts' start() takes no host clock).
import { calibrationContrast, calibrationPeak, type CalibrationSummary, type DetectionEvent, type SignalFrame } from "../contracts";
import type { AppSensingModule, GateView } from "../slots";

export const WINDOW_S = 5;
export const REQUIRED_WINDOWS = 3;
export const REFRACTORY_S = 60;
export const DRIFT_AT_S = 3;
export const DRIFT_RAMP_S = 8;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the scenario sits at second s, as a 0..1 mix from peak (0) to contrast (1). */
export function scenarioMix(s: number, recoverFrom: number | null): number {
  if (recoverFrom !== null) return Math.max(0, 1 - (s - recoverFrom) / 25);
  if (s < DRIFT_AT_S) return 0;
  return Math.min(1, (s - DRIFT_AT_S) / DRIFT_RAMP_S);
}

export function rmssd(rr: number[]): number {
  if (rr.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rr.length; i++) sum += (rr[i] - rr[i - 1]) ** 2;
  return Math.sqrt(sum / (rr.length - 1));
}

/** Calibration bands for a state: its recorded ones, else contracts' fixture calibration. */
function bands(profile: { states: { id: string; calibration: { peak: CalibrationSummary | null; contrast: CalibrationSummary | null } }[] }, stateId: string) {
  const state = profile.states.find((s) => s.id === stateId) ?? profile.states[0];
  const peak = state?.calibration.peak ?? calibrationPeak;
  const contrast = state?.calibration.contrast ?? calibrationContrast;
  return {
    stateId: state?.id ?? stateId,
    peak: { hr: peak.hr, rmssd: Math.exp(peak.lnRmssd.mean) },
    contrast: { hr: contrast.hr, rmssd: Math.exp(contrast.lnRmssd.mean) },
  };
}

function fixtureSummary(stateId: string, phase: "peak" | "contrast", seconds: number): CalibrationSummary {
  const base = phase === "peak" ? calibrationPeak : calibrationContrast;
  return { ...structuredClone(base), stateId, seconds, recordedAt: new Date().toISOString() };
}

export const sensingStub: AppSensingModule = {
  start(profile, stateId, onEvent, onFrame, onGate) {
    const { stateId: sid, peak, contrast } = bands(profile, stateId);
    const rand = mulberry32(7);
    const t0 = Date.now();
    let s = 0;
    let recoverFrom: number | null = null;
    let consecutive = 0;
    let refractoryUntil = -Infinity;
    let fired = 0;
    let windowFrames: SignalFrame[] = [];
    let stopped = false;

    const gate = (): GateView => ({
      consecutive,
      required: REQUIRED_WINDOWS,
      refractoryRemainingS: Math.max(0, Math.ceil(refractoryUntil - s)),
    });

    const fire = (kind: "drift" | "manual", confidence: number, w: SignalFrame[]) => {
      fired++;
      const hrs = w.map((f) => f.hr ?? 0);
      const rr = w.flatMap((f) => f.rr);
      const hrMean = hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null;
      const e: DetectionEvent = {
        schemaVersion: 1,
        id: `det_${t0}_${fired}`,
        t: t0 + s * 1000,
        kind,
        stateId: sid,
        confidence,
        window:
          kind === "manual"
            ? null
            : {
                seconds: w.length,
                hrMean,
                rmssd: rmssd(rr),
                hrDelta: hrMean === null ? null : hrMean - peak.hr.mean,
                rmssdDelta: rmssd(rr) - peak.rmssd,
                z: hrMean === null ? null : (hrMean - peak.hr.mean) / peak.hr.sd,
                position: confidence,
              },
        gate: { consecutiveWindows: consecutive, required: REQUIRED_WINDOWS, refractorySeconds: REFRACTORY_S, sham: false },
        calibrationMode: "contrast",
      };
      refractoryUntil = s + REFRACTORY_S;
      consecutive = 0;
      recoverFrom = s;
      onEvent(e);
    };

    const tick = () => {
      if (stopped) return;
      s++;
      const mix = scenarioMix(s, recoverFrom);
      const hrTarget = peak.hr.mean + (contrast.hr.mean - peak.hr.mean) * mix;
      const hr = hrTarget + (rand() - 0.5) * 2 * peak.hr.sd;
      const amp = (peak.rmssd + (contrast.rmssd - peak.rmssd) * mix) / 2;
      const beats = Math.max(1, Math.round(hr / 60));
      const rr: number[] = [];
      for (let b = 0; b < beats; b++) {
        rr.push(Math.round(60000 / hr + (rr.length % 2 === 0 ? amp : -amp) * (0.8 + rand() * 0.4)));
      }
      const frame: SignalFrame = {
        t: t0 + s * 1000,
        source: "simulator",
        hr: Math.round(hr * 10) / 10,
        rr,
        quality: 1,
        label: recoverFrom !== null ? "recovery" : s < DRIFT_AT_S ? "baseline" : "drift",
      };
      onFrame?.(frame);
      windowFrames.push(frame);

      if (windowFrames.length >= WINDOW_S) {
        const meanHr = windowFrames.reduce((a, f) => a + (f.hr ?? 0), 0) / windowFrames.length;
        const confidence = Math.max(0, Math.min(1, (meanHr - peak.hr.mean) / (contrast.hr.mean - peak.hr.mean)));
        const out = meanHr > peak.hr.mean + 2 * peak.hr.sd;
        const inRefractory = s < refractoryUntil;
        consecutive = out && !inRefractory ? consecutive + 1 : 0;
        if (consecutive >= REQUIRED_WINDOWS) fire("drift", confidence, windowFrames);
        onGate?.(gate());
        windowFrames = [];
      }
      timer = setTimeout(tick, 1000);
    };
    let timer = setTimeout(tick, 1000);

    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
      },
      triggerManual() {
        fire("manual", 1, windowFrames);
      },
    };
  },

  calibration: {
    begin(stateId, phase) {
      const started = Date.now();
      return {
        mark() {},
        end: async () => fixtureSummary(stateId, phase, Math.round((Date.now() - started) / 1000)),
      };
    },
  },

  async record(stateId, seconds, phase) {
    return fixtureSummary(stateId, phase, seconds);
  },
};

// Fixture stub of the sensing module: a deterministic simulator at 1 Hz with a
// 5 s window gate (3 consecutive windows, refractory, no sham on the first fire).
// It starts in the person's peak band, drifts toward their contrast band so the
// gate opens at about 20 s, and recovers after a detection. Sensing's real module replaces this.
import type { DetectionEvent, GateState, SensingModule, SignalFrame } from "../contracts";

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

export const sensingStub: SensingModule = {
  start(profile, onEvent, { host, stateId, onFrame, onGate }) {
    const state = profile.states.find((s) => s.id === stateId) ?? profile.states[0];
    const peak = state.calibration?.peak?.stats ?? { hr: { mean: 68, sd: 2.5 }, rmssd: 49 };
    const contrast = state.calibration?.contrast?.stats ?? { hr: { mean: 82, sd: 3 }, rmssd: 25 };
    const rand = mulberry32(7);
    const t0 = host.clock.now();
    let s = 0;
    let recoverFrom: number | null = null;
    let consecutive = 0;
    let refractoryUntil = -Infinity;
    let fired = 0;
    let lastBeat = 60000 / peak.hr.mean;
    let windowFrames: SignalFrame[] = [];
    let stopped = false;

    const gate = (confidence: number): GateState => ({
      consecutive,
      required: REQUIRED_WINDOWS,
      refractoryRemainingS: Math.max(0, Math.ceil(refractoryUntil - s)),
      sham: false,
      confidence,
    });

    const fire = (kind: "drift" | "manual", confidence: number, w: SignalFrame[]) => {
      fired++;
      const hrs = w.map((f) => f.hr ?? 0);
      const rr = w.flatMap((f) => f.rr);
      const e: DetectionEvent = {
        id: `det_${t0}_${fired}`,
        t: t0 + s * 1000,
        kind,
        targetStateId: state.id,
        confidence,
        window: {
          startT: w[0]?.t ?? t0 + s * 1000,
          endT: w[w.length - 1]?.t ?? t0 + s * 1000,
          hr: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : 0,
          rmssd: rmssd(rr),
          quality: 1,
        },
        gate: { consecutive, refractoryMs: REFRACTORY_S * 1000, sham: false },
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
        lastBeat = 60000 / hr + (rr.length % 2 === 0 ? amp : -amp) * (0.8 + rand() * 0.4);
        rr.push(Math.round(lastBeat));
      }
      const frame: SignalFrame = {
        t: t0 + s * 1000,
        source: "simulator",
        hr: Math.round(hr * 10) / 10,
        rr,
        quality: 1,
        scenarioStep: recoverFrom !== null ? "recovery" : s < DRIFT_AT_S ? "baseline" : "drift",
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
        onGate?.(gate(confidence));
        windowFrames = [];
      }
      timer = setTimeout(tick, 1000 / host.clock.speed);
    };
    let timer = setTimeout(tick, 1000 / host.clock.speed);

    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
      },
      triggerManual() {
        fire("manual", 1, windowFrames.length ? windowFrames : []);
      },
    };
  },
};

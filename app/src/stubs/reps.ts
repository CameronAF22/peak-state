// Fixture stub of the reps module. A full rep is: rate, anchor, the person's own steps
// in their order (driver submodalities spoken), peak, rate (D-reps-005). A sham rep
// withholds the cue: rate, wait, rate. Installed follows D-reps-003 (proposed):
// 5 good cue reps, then 2 anchor-only passes in a row. The reps lane replaces this.
import {
  driverInstructions,
  type ProgressForState,
  type RepSession,
  type RepStep,
  type RepsModule,
  type StateStatus,
} from "../contracts";

const GOOD_GAIN = 2;
const GOOD_REPS = 5;
const ANCHOR_PASSES = 2;

class Stopped extends Error {
  constructor(readonly reason: "user-stop" | "safety-stop") {
    super(reason);
  }
}

export const repsStub: RepsModule = {
  run(profile, stateId, trigger, props) {
    const { host } = props;
    const state = profile.states.find((s) => s.id === stateId);
    if (!state) throw new Error(`No state ${stateId} in profile`);
    if (!profile.confirmedAt) throw new Error("Reps refuse a draft profile");
    const arm = props.arm ?? "cue";
    let stopReason: "user-stop" | "safety-stop" | null = null;
    const startedAt = new Date(host.clock.now()).toISOString();
    const steps: RepStep[] = [];
    const anchorIndex = state.anchorStep ?? 0;
    const anchor = state.strategy.steps[anchorIndex];

    const check = () => {
      if (stopReason) throw new Stopped(stopReason);
    };

    const deliver = async (step: Omit<RepStep, "startedAt" | "endedAt" | "delivered">, say: string) => {
      check();
      const s: RepStep = { ...step, startedAt: new Date(host.clock.now()).toISOString(), endedAt: null, delivered: false };
      steps.push(s);
      props.onStep?.(s, steps.length - 1, say);
      if (say) await host.speech.speak(say);
      await host.clock.sleep(Math.max(0, step.plannedMs - (say ? 2500 : 0)));
      check();
      s.endedAt = new Date(host.clock.now()).toISOString();
      s.delivered = true;
    };

    const rate = async (prompt: string) => {
      check();
      const s: RepStep = { kind: "rate", plannedMs: 3000, startedAt: new Date(host.clock.now()).toISOString(), endedAt: null, delivered: false };
      steps.push(s);
      props.onStep?.(s, steps.length - 1, prompt);
      const value = await props.rate(prompt);
      check();
      s.endedAt = new Date(host.clock.now()).toISOString();
      s.delivered = true;
      return value;
    };

    const session = (async (): Promise<RepSession> => {
      let before: number | null = null;
      let after: number | null = null;
      let endedBy: RepSession["endedBy"] = "completed";
      try {
        before = await rate(`Where are you right now, 0 to 10, on ${state.label}?`);
        if (arm === "cue") {
          await deliver({ kind: "anchor", strategyStepIndex: anchorIndex, plannedMs: 4000 }, `${cap(anchor.content)}.`);
          for (let i = 0; i < state.strategy.steps.length; i++) {
            const step = state.strategy.steps[i];
            const drivers = driverInstructions(state, i);
            const driverIdx = (state.drivers ?? []).filter((d) => state.differences?.[d]?.modality === step.modality);
            const say = drivers.length
              ? `${cap(step.content)}. Make it ${drivers.map((d) => d.split(": ")[1]).join(" and ")}.`
              : `${cap(step.content)}.`;
            await deliver(
              { kind: "strategy-step", strategyStepIndex: i, ...(driverIdx.length ? { driverIndexes: driverIdx } : {}), plannedMs: 6000 },
              say,
            );
          }
          await deliver({ kind: "peak", plannedMs: 4000 }, `${cap(anchor.content)}. Let it peak.`);
        } else {
          // Sham: the cue is withheld; the person just waits.
          await host.clock.sleep(8000);
          check();
        }
        after = await rate(`And now, 0 to 10?`);
      } catch (e) {
        if (!(e instanceof Stopped)) throw e;
        endedBy = e.reason;
      }
      return {
        schemaVersion: 1,
        id: `rep_${Date.now().toString(36)}`,
        profileId: profile.profileId,
        stateId,
        repIndex: 0,
        kind: "full",
        trigger,
        arm,
        startedAt,
        endedAt: new Date(host.clock.now()).toISOString(),
        steps,
        intensityBefore: before,
        intensityAfter: after,
        recoverySeconds: null,
        recoveryCensored: true,
        anchorPaired: arm === "cue" && endedBy === "completed",
        signalSource: "simulator",
        scriptHash: "stub-v1",
        endedBy,
      };
    })();

    return {
      session,
      stop(reason) {
        stopReason = reason;
      },
    };
  },

  progress(sessions) {
    const byState = new Map<string, RepSession[]>();
    for (const s of sessions) byState.set(s.stateId, [...(byState.get(s.stateId) ?? []), s]);
    return [...byState.entries()].map(([stateId, list]): ProgressForState => {
      const cue = list.filter((s) => s.arm === "cue" && s.recoverySeconds !== null && !s.recoveryCensored);
      const sham = list.filter((s) => s.arm === "sham" && s.recoverySeconds !== null && !s.recoveryCensored);
      return {
        stateId,
        reps: list.length,
        cueReps: list.filter((s) => s.arm === "cue").length,
        shamReps: list.filter((s) => s.arm === "sham").length,
        intensityTrend: list.map((s) => ({ repIndex: s.repIndex, before: s.intensityBefore, after: s.intensityAfter })),
        meanRecoveryCue: mean(cue.map((s) => s.recoverySeconds!)),
        meanRecoverySham: mean(sham.map((s) => s.recoverySeconds!)),
      };
    });
  },

  status(profile, sessions) {
    const out: Record<string, StateStatus> = {};
    for (const state of profile.states) {
      if (state.anchorStep === null) {
        out[state.id] = "no-anchor";
        continue;
      }
      const list = sessions.filter((s) => s.stateId === state.id && s.endedBy === "completed");
      const good = list.filter(
        (s) => s.kind === "full" && s.arm === "cue" && gain(s) >= GOOD_GAIN,
      ).length;
      if (good < GOOD_REPS) {
        out[state.id] = "conditioning";
        continue;
      }
      const anchorRuns = list.filter((s) => s.kind === "anchor-only");
      const tail = anchorRuns.slice(-ANCHOR_PASSES);
      out[state.id] = tail.length === ANCHOR_PASSES && tail.every((s) => gain(s) >= GOOD_GAIN) ? "installed" : "ready-to-test";
    }
    return out;
  },
};

function gain(s: RepSession): number {
  return (s.intensityAfter ?? 0) - (s.intensityBefore ?? 0);
}

function mean(xs: number[]): number | null {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

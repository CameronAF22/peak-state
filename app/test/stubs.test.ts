import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chain, type DetectionEvent, type OnboardingEvent, type SignalFrame } from "../src/contracts";
import { demoProfile, demoRepLog } from "../src/fixtures";
import { createHost } from "../src/host";
import { resolveModules } from "../src/modules";
import { reduce } from "../src/screens/Onboard";
import { onboardingStub } from "../src/stubs/onboarding";
import { repsStub } from "../src/stubs/reps";
import { sensingStub } from "../src/stubs/sensing";

const fastHost = () => createHost({ speed: 1000, muted: true, onSafetyStop: () => {} });

describe("fixtures and derived views", () => {
  it("demo profile has one confirmed state with the chain Ve → Ai → Ki", () => {
    const p = demoProfile();
    expect(p.states).toHaveLength(1);
    expect(p.confirmedAt).not.toBeNull();
    expect(chain(p.states[0])).toBe("Ve → Ai → Ki");
  });
});

describe("onboarding stub + Onboard reducer", () => {
  it("emits the playbook in order and the reducer rebuilds the step chain", async () => {
    const events: OnboardingEvent[] = [];
    const result = await onboardingStub.run({ host: fastHost(), mode: "scripted", onEvent: (e) => events.push(e) });
    expect(result.status).toBe("confirmed");

    const types = events.map((e) => e.type);
    expect(types.indexOf("stateNamed")).toBeLessThan(types.indexOf("stepCaptured"));
    expect(types.indexOf("stepCaptured")).toBeLessThan(types.indexOf("driverFound"));
    expect(types[types.length - 1]).toBe("confirmed");

    const view = events.reduce(reduce, {
      turns: [], label: null, words: null, steps: [], activeIndex: null, anchorStep: null,
      contrastLabel: null, differences: null, drivers: null, test: null, window: null, confirmed: null,
    });
    expect(chain({ strategy: { steps: view.steps, fullyInAt: null, confirmed: true } })).toBe("Ve → Ai → Ki");
    expect(view.steps[0].submodalities.core).toEqual(demoProfile().states[0].strategy.steps[0].submodalities.core);
    expect(view.anchorStep).toBe(0);
    expect(view.drivers).toEqual([0, 1]);
    expect(view.turns.every((t) => t.final)).toBe(true);
  });

  it("stops cleanly when aborted", async () => {
    const ctl = new AbortController();
    const events: OnboardingEvent[] = [];
    const run = onboardingStub.run({ host: fastHost(), mode: "scripted", signal: ctl.signal, onEvent: (e) => events.push(e) });
    ctl.abort();
    const result = await run;
    expect(result.status).toBe("stopped");
    expect(events[events.length - 1]).toEqual({ type: "stopped", reason: "cancel" });
  });
});

describe("sensing stub", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drifts and opens the gate at about 20 s, then goes quiet in refractory", () => {
    const host = createHost({ speed: 1, muted: true, onSafetyStop: () => {} });
    const events: DetectionEvent[] = [];
    const frames: SignalFrame[] = [];
    const h = sensingStub.start(demoProfile(), (e) => events.push(e), {
      host, stateId: "calm-before-pitch", onFrame: (f) => frames.push(f),
    });
    vi.advanceTimersByTime(19_000);
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(2_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "drift", targetStateId: "calm-before-pitch", gate: { sham: false } });
    vi.advanceTimersByTime(40_000);
    expect(events).toHaveLength(1);
    expect(frames.at(-1)!.scenarioStep).toBe("recovery");
    h.triggerManual();
    expect(events[1].kind).toBe("manual");
    h.stop();
  });
});

describe("reps stub", () => {
  it("runs a cue rep in the person's own step order", async () => {
    const h = repsStub.run(demoProfile(), "calm-before-pitch", { kind: "practice" }, {
      host: fastHost(),
      rate: async () => 5,
    });
    const s = await h.session;
    expect(s.endedBy).toBe("completed");
    expect(s.steps.map((x) => x.kind)).toEqual(["rate", "anchor", "strategy-step", "strategy-step", "strategy-step", "peak", "rate"]);
    expect(s.steps.filter((x) => x.kind === "strategy-step").map((x) => x.strategyStepIndex)).toEqual([0, 1, 2]);
    expect(s.steps[2].driverIndexes).toEqual([0, 1]);
  });

  it("a sham rep withholds the cue", async () => {
    const s = await repsStub.run(demoProfile(), "calm-before-pitch", { kind: "detection" }, {
      host: fastHost(), arm: "sham", rate: async () => 4,
    }).session;
    expect(s.arm).toBe("sham");
    expect(s.steps.map((x) => x.kind)).toEqual(["rate", "rate"]);
    expect(s.anchorPaired).toBe(false);
  });

  it("stop ends the rep as user-stop", async () => {
    let release: (n: number) => void = () => {};
    const h = repsStub.run(demoProfile(), "calm-before-pitch", { kind: "practice" }, {
      host: fastHost(), rate: () => new Promise((r) => (release = r)),
    });
    h.stop("user-stop");
    release(5);
    expect((await h.session).endedBy).toBe("user-stop");
  });

  it("the seeded demo log ends installed; progress separates cue and sham", () => {
    const log = demoRepLog();
    expect(repsStub.status(demoProfile(), log)["calm-before-pitch"]).toBe("installed");
    expect(repsStub.status(demoProfile(), log.slice(0, 6))["calm-before-pitch"]).toBe("ready-to-test");
    const [p] = repsStub.progress(log);
    expect(p.shamReps).toBe(1);
    expect(p.meanRecoverySham!).toBeGreaterThan(p.meanRecoveryCue!);
  });
});

describe("module registry", () => {
  it("falls back to stubs until real modules land", () => {
    expect(resolveModules("?sensing=real").using).toEqual({ onboarding: "stub", sensing: "stub", reps: "stub" });
  });
});

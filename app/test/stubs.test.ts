import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chain, validateDetectionEvent, type DetectionEvent, type OnboardingEvent, type SignalFrame } from "../src/contracts";
import { demoProfile } from "../src/fixtures";
import { createHost } from "../src/host";
import { EMPTY_VIEW, reduce } from "../src/onboardView";
import { onboardingStub } from "../src/stubs/onboarding";
import { sensingStub } from "../src/stubs/sensing";

const fastHost = () => createHost({ speed: 1000, muted: true, onSafetyStop: () => {} });

describe("fixtures and derived views", () => {
  it("the demo profile comes from contracts: one confirmed state with the chain Ve → Ai → Ki", () => {
    const p = demoProfile();
    expect(p.states).toHaveLength(1);
    expect(p.confirmedAt).not.toBeNull();
    expect(chain(p.states[0])).toBe("Ve → Ai → Ki");
  });
});

describe("onboarding stub (script replay) + Onboard reducer", () => {
  it("replays contracts' recorded playbook run and the reducer rebuilds the step chain", async () => {
    const events: OnboardingEvent[] = [];
    const result = await onboardingStub.run(fastHost(), { mode: "script", onEvent: (e) => events.push(e) });
    expect(result.status).toBe("confirmed");

    const types = events.map((e) => e.type);
    expect(types.indexOf("stateNamed")).toBeLessThan(types.indexOf("stepCaptured"));
    expect(types.indexOf("stepCaptured")).toBeLessThan(types.indexOf("driverFound"));
    expect(types[types.length - 1]).toBe("confirmed");

    const view = events.reduce(reduce, EMPTY_VIEW);
    const demo = demoProfile().states[0];
    expect(view.label).toBe(demo.label);
    expect(view.steps.map((s) => s.content)).toEqual(demo.strategy.steps.map((s) => s.content));
    expect((view.steps[0].submodalities as { core?: unknown }).core).toEqual((demo.strategy.steps[0].submodalities as { core?: unknown }).core);
    expect(view.anchorStep).toBe(demo.anchorStep);
    expect([...view.drivers].sort()).toEqual([...demo.drivers].sort());
    expect(view.calibrated).toEqual(["peak", "contrast"]);
    expect(view.confirmed?.profileId).toBe(demoProfile().profileId);
  });

  it("stops cleanly when aborted", async () => {
    const ctl = new AbortController();
    const events: OnboardingEvent[] = [];
    const run = onboardingStub.run(fastHost(), { mode: "script", signal: ctl.signal, onEvent: (e) => events.push(e) });
    ctl.abort();
    const result = await run;
    expect(result).toEqual({ status: "stopped", reason: "cancel", draft: null });
    expect(events[events.length - 1]).toMatchObject({ type: "stopped", reason: "cancel" });
  });
});

describe("sensing stub", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("drifts and opens the gate at about 20 s, then goes quiet in refractory; events match the contracts schema", () => {
    const events: DetectionEvent[] = [];
    const frames: SignalFrame[] = [];
    const h = sensingStub.start(demoProfile(), "calm-before-pitch", (e) => events.push(e), (f) => frames.push(f));
    vi.advanceTimersByTime(19_000);
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(2_000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "drift", stateId: "calm-before-pitch", gate: { sham: false } });
    vi.advanceTimersByTime(40_000);
    expect(events).toHaveLength(1);
    expect(frames.at(-1)!.label).toBe("recovery");
    h.triggerManual();
    expect(events[1]).toMatchObject({ kind: "manual", window: null });
    for (const e of events) expect(validateDetectionEvent(e).errors).toEqual([]);
    h.stop();
  });

  it("records a calibration summary for the asked state and phase", async () => {
    const c = await sensingStub.record("calm-before-pitch", 30, "contrast");
    expect(c).toMatchObject({ stateId: "calm-before-pitch", phase: "contrast", seconds: 30 });
  });
});

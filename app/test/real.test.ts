import { describe, expect, it } from "vitest";
import type { Question } from "@peak-state/onboarding";
import type { ScriptStep } from "@peak-state/reps";
import { validateProfile, validateRepSession, type DetectionEvent, type OnboardingEvent } from "../src/contracts";
import { demoProfile, demoRepLog } from "../src/fixtures";
import { createHost } from "../src/host";
import { EMPTY_VIEW, reduce } from "../src/onboardView";
import { engineOnboarding } from "../src/real/onboarding";
import { progressFor, repsReal } from "../src/real/reps";
import { createAnswerChannel } from "../src/slots";

const fastHost = () => createHost({ speed: 1000, muted: true, onSafetyStop: () => {} });

describe("real onboarding: @peak-state/onboarding's engine, driven headlessly", () => {
  it("reaches a valid confirmed profile from tapped choices and suggestions", async () => {
    const answers = createAnswerChannel();
    const events: OnboardingEvent[] = [];
    let asked = 0;
    const result = await engineOnboarding.run(fastHost(), {
      mode: "typed",
      answers,
      onEvent: (e) => events.push(e),
      onQuestion: (q: Question | null) => {
        if (!q || ++asked > 60) return;
        const c = q.choices[0];
        const answer = c ? { text: c.label, via: "choice" as const, choiceValue: c.value } : { text: q.suggestions[0], via: "suggestion" as const };
        queueMicrotask(() => answers.push({ kind: "answer", answer }));
      },
    });
    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(validateProfile(result.profile).errors).toEqual([]);
    expect(events[0].type).toBe("guideTurn");
    expect(events.at(-1)?.type).toBe("confirmed");
    const view = events.reduce(reduce, EMPTY_VIEW);
    expect(view.steps.length).toBe(result.profile.states[0].strategy.steps.length);
  });

  it("cancels on abort and stops on the safety line", async () => {
    const ctl = new AbortController();
    const run = engineOnboarding.run(fastHost(), { signal: ctl.signal });
    ctl.abort();
    expect((await run).status).toBe("stopped");

    let stopped = "";
    const host = createHost({ speed: 1000, muted: true, onSafetyStop: (r) => (stopped = r) });
    const answers = createAnswerChannel();
    const safety = engineOnboarding.run(host, { answers });
    answers.push({ kind: "answer", answer: { text: "Honestly I keep thinking about hurting myself", via: "typed" } });
    expect(await safety).toMatchObject({ status: "stopped", reason: "safety" });
    expect(stopped).toBe("safety");
  });
});

describe("real reps: @peak-state/reps script and recorder, played through the host", () => {
  const profile = demoProfile();
  const stateId = profile.states[0].id;

  it("the I'm off button runs a full rep in the person's own step order and logs a valid manual session", async () => {
    const steps: ScriptStep[] = [];
    const ratings = [4, 8];
    const h = repsReal.run(profile, stateId, { kind: "manual" }, fastHost(), undefined, {
      repIndex: 11,
      rate: async () => ratings.shift()!,
      onStep: (s) => steps.push(s),
    });
    const s = await h.session;
    expect(validateRepSession(s, profile).errors).toEqual([]);
    expect(s).toMatchObject({ endedBy: "completed", trigger: { kind: "manual" }, arm: "cue", repIndex: 11, intensityBefore: 4, intensityAfter: 8 });
    expect(steps[0].kind).toBe("rate");
    expect(steps.at(-1)!.kind).toBe("rate");
    expect(steps.filter((x) => x.kind === "strategy-step").map((x) => x.stepIndex)).toEqual([0, 1, 2]);
    expect(steps.some((x) => x.kind === "anchor-peak")).toBe(true);
    expect(s.steps.every((x) => x.delivered)).toBe(true);
  });

  it("an anchor-only test is rate, anchor, rate", async () => {
    const s = await repsReal.run(profile, stateId, { kind: "practice" }, fastHost(), undefined, { kind: "anchor-only", rate: async () => 5 }).session;
    expect(s.kind).toBe("anchor-only");
    expect(s.steps.map((x) => x.kind)).toEqual(["rate", "anchor", "rate"]);
  });

  it("a sham detection withholds the cue", async () => {
    const detection = { ...structuredClone(demoDetection), gate: { ...demoDetection.gate, sham: true } };
    const s = await repsReal.run(profile, stateId, { kind: "detection", detectionId: detection.id }, fastHost(), detection, { rate: async () => 4 }).session;
    expect(s.arm).toBe("sham");
    expect(s.steps.map((x) => x.kind)).toEqual(["rate", "rate"]);
    expect(s.anchorPaired).toBe(false);
  });

  it("stop ends the rep as user-stop while it waits for a rating", async () => {
    const h = repsReal.run(profile, stateId, { kind: "manual" }, fastHost(), undefined, { rate: () => new Promise<number>(() => {}) });
    h.stop();
    const s = await h.session;
    expect(s.endedBy).toBe("user-stop");
    expect(validateRepSession(s, profile).errors).toEqual([]);
  });

  it("refuses a draft profile", () => {
    const draft = { ...demoProfile(), confirmedAt: null };
    expect(() => repsReal.run(draft, stateId, { kind: "manual" }, fastHost())).toThrow();
  });

  it("progress: the seeded demo log ends installed; part of it is still conditioning", () => {
    const log = demoRepLog();
    expect(progressFor(log, stateId)).toMatchObject({ installed: true, nextStep: "installed" });
    expect(progressFor(log.slice(0, 4), stateId).nextStep).toBe("reps");
    expect(repsReal.progress(log)[stateId].installed).toBe(true);
  });
});

const demoDetection: DetectionEvent = {
  schemaVersion: 1,
  id: "det_test_1",
  t: Date.UTC(2026, 9, 3, 15, 10),
  kind: "drift",
  stateId: "calm-before-pitch",
  confidence: 0.8,
  window: { seconds: 5, hrMean: 80, rmssd: 25, hrDelta: 12, rmssdDelta: -20, z: 3, position: 0.8 },
  gate: { consecutiveWindows: 3, required: 3, refractorySeconds: 60, sham: false },
  calibrationMode: "contrast",
};

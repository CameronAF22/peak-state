import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { profileDemo, type Difference } from "@peak-state/contracts";

import { buildScript, ScriptError, TIMING } from "../src/index.ts";
import type { ProfileV2, Step } from "../src/index.ts";

const fixture: ProfileV2 = profileDemo;
const STATE = "calm-before-pitch";
const clone = (): ProfileV2 => structuredClone(fixture);

const timedKinds = (p: ProfileV2, kind: "full" | "anchor-only" = "full") =>
  buildScript(p, STATE, kind).steps.filter((s) => s.timed).map((s) => s.kind);

describe("full rep script", () => {
  const script = buildScript(fixture, STATE);

  it("rates, replays the person's steps in their order, leverage, peak, rates", () => {
    assert.deepEqual(
      script.steps.map((s) => [s.kind, s.stepIndex]),
      [["rate", undefined], ["strategy-step", 0], ["strategy-step", 1], ["strategy-step", 2], ["leverage", undefined], ["anchor-peak", 0], ["rate", undefined]],
    );
  });

  it("has no opening anchor step (D-reps-009)", () => {
    assert.ok(!script.steps.some((s) => s.kind === "anchor"));
  });

  it("speaks each step's content in the person's words", () => {
    const steps = script.steps.filter((s) => s.kind === "strategy-step");
    assert.equal(steps[0].text.startsWith("See the first face in the room looking up at me."), true);
    assert.equal(steps[1].text.startsWith("Say to yourself 'here we go, slow'."), true);
    assert.equal(steps[2].text.startsWith("Feel warmth spreading through my chest."), true);
  });

  it("speaks the drivers on the step they belong to (Difference.stepIndex), largest delta first", () => {
    const visual = script.steps[1];
    assert.deepEqual(visual.driversSpoken, [2, 3]);
    assert.match(visual.text, /Bring it close\. Make it bright\.$/);
    const auditory = script.steps[2];
    assert.deepEqual(auditory.driversSpoken, [5]);
    assert.match(auditory.text, /Make it quiet\.$/);
  });

  it("falls back to one core submodality on steps without a driver", () => {
    const kinesthetic = script.steps[3];
    assert.equal(kinesthetic.driversSpoken, undefined);
    assert.match(kinesthetic.text, /Feel it in your chest\.$/);
  });

  it("pairs the anchor step at the peak with its drivers", () => {
    const peak = script.steps.find((s) => s.kind === "anchor-peak")!;
    assert.equal(peak.stepIndex, fixture.states[0].anchorStep);
    assert.deepEqual(peak.driversSpoken, [2, 3]);
    assert.equal(peak.text, "Now, at full strength. See the first face in the room looking up at me. Bring it close. Make it bright.");
  });

  it("speaks the leverage line once", () => {
    const leverage = script.steps.filter((s) => s.kind === "leverage");
    assert.equal(leverage.length, 1);
    assert.equal(leverage[0].text, "So I stop rushing the part that matters.");
  });

  it("takes at least the default 32 s budget (here the speech floor, 33 s), with untimed ratings outside it", () => {
    assert.ok(script.totalMs >= TIMING.defaultTotalMs && script.totalMs <= TIMING.maxTotalMs, `total ${script.totalMs}`);
    for (const s of script.steps) {
      if (s.kind === "rate") assert.deepEqual([s.timed, s.plannedMs], [false, 0]);
      else assert.ok(s.timed && s.plannedMs > 0);
    }
  });

  it("gives an internal auditory step extra time for the person to repeat it", () => {
    const [visual, auditory] = script.steps.slice(1, 3);
    const perWord = (s: typeof visual) => s.plannedMs / s.text.split(" ").length;
    assert.ok(perWord(auditory) > perWord(visual));
  });

  it("includes no words that are not the person's or the fixed templates", () => {
    const allowed = new Set(
      [
        ...JSON.stringify(fixture.states[0]).toLowerCase().split(/[^a-z0-9']+/),
        ..."on a scale of 0 to 10 how strong is right now and see picture hear say to yourself feel notice it in the your put bring make let keep stay turn up down to watch through own eyes move hold still at full strength center around you head front of behind on above far away across room arm's length colour".split(" "),
      ].filter(Boolean),
    );
    for (const s of script.steps) {
      for (const word of s.text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean)) {
        assert.ok(allowed.has(word), `unexpected word '${word}' in: ${s.text}`);
      }
    }
  });

  it("is deterministic: same profile, same hash; different wording, different hash", () => {
    assert.equal(buildScript(clone(), STATE).scriptHash, script.scriptHash);
    assert.match(script.scriptHash, /^fnv1a:[0-9a-f]{8}$/);
    const p = clone();
    p.states[0].strategy.steps[2].content = "heat in my chest";
    assert.notEqual(buildScript(p, STATE).scriptHash, script.scriptHash);
  });
});

describe("timing bounds", () => {
  const content = (i: number) => `step ${i} of a long remembered sequence with quite a few words in it`;
  const step = (i: number): Step =>
    i % 3 === 0
      ? { modality: "visual", direction: "internal", content: content(i), submodalities: { core: { location: "center" } } }
      : i % 3 === 1
        ? { modality: "auditory", direction: "internal", content: content(i), submodalities: { core: { source: "my own voice" } } }
        : { modality: "kinesthetic", direction: "internal", content: content(i), submodalities: { core: { bodyLocation: "chest" } } };

  for (const n of [1, 2, 3, 4, 5, 6, 8]) {
    it(`keeps a ${n}-step chain within 20 to 40 s and in order`, () => {
      const p = clone();
      const s = p.states[0];
      s.strategy.steps = Array.from({ length: n }, (_, i) => step(i));
      s.strategy.fullyInAt = n - 1;
      s.anchorStep = n - 1;
      s.differences = [];
      s.drivers = [];
      const script = buildScript(p, STATE);
      assert.ok(script.totalMs >= TIMING.minTotalMs && script.totalMs <= TIMING.maxTotalMs, `total ${script.totalMs}`);
      assert.deepEqual(
        script.steps.filter((x) => x.kind === "strategy-step").map((x) => x.stepIndex),
        Array.from({ length: n }, (_, i) => i),
      );
    });
  }

  it("clamps a requested target to the 20 to 40 s bounds", () => {
    const short = clone();
    short.states[0].strategy.fullyInAt = 0;
    short.states[0].leverage = null;
    assert.equal(buildScript(short, STATE, "full", { targetMs: 5_000 }).totalMs, TIMING.minTotalMs);
    assert.equal(buildScript(short, STATE, "full", { targetMs: 90_000 }).totalMs, TIMING.maxTotalMs);
    assert.equal(buildScript(short, STATE, "full", { targetMs: 25_000 }).totalMs, 25_000);
  });

  it("runs at the speech floor, not the target, when the words need longer", () => {
    const script = buildScript(fixture, STATE, "full", { targetMs: 20_000 });
    assert.ok(script.totalMs > 20_000 && script.totalMs <= TIMING.maxTotalMs, `total ${script.totalMs}`);
  });

  it("speaks only the top driver per step on chains of five or more steps", () => {
    const p = clone();
    const s = p.states[0];
    s.strategy.steps = [0, 1, 2, 3, 4].map(() => structuredClone(fixture.states[0].strategy.steps[0]));
    s.strategy.fullyInAt = 4;
    const pair = (stepIndex: number): Difference[] => [
      { stepIndex, modality: "visual", attribute: "distance", peak: "close", contrast: "far", ratingDelta: 3 },
      { stepIndex, modality: "visual", attribute: "brightness", peak: "bright", contrast: "dim", ratingDelta: 2 },
    ];
    s.differences = [0, 1, 2, 3, 4].flatMap(pair);
    s.drivers = s.differences.map((_, i) => i);
    const script = buildScript(p, STATE);
    const spoken = script.steps.filter((x) => x.kind === "strategy-step").map((x) => x.driversSpoken);
    assert.deepEqual(spoken, [[0], [2], [4], [6], [8]]);
  });

  it("replays every step when fullyInAt is not set", () => {
    const p = clone();
    p.states[0].strategy.fullyInAt = null;
    assert.deepEqual(timedKinds(p), ["strategy-step", "strategy-step", "strategy-step", "leverage", "anchor-peak"]);
  });

  it("stops the chain at fullyInAt", () => {
    const p = clone();
    p.states[0].strategy.fullyInAt = 1;
    assert.deepEqual(timedKinds(p), ["strategy-step", "strategy-step", "leverage", "anchor-peak"]);
  });
});

describe("variants and refusals", () => {
  it("anchor-only test: rate, the anchor step alone with 10 s of silence, rate", () => {
    const script = buildScript(fixture, STATE, "anchor-only");
    assert.deepEqual(script.steps.map((s) => s.kind), ["rate", "anchor", "rate"]);
    const anchor = script.steps[1];
    assert.equal(anchor.stepIndex, 0);
    assert.equal(anchor.text, "See the first face in the room looking up at me. Bring it close. Make it bright.");
    assert.ok(anchor.plannedMs >= TIMING.anchorOnlySilenceMs + 3_000);
    assert.equal(script.totalMs, anchor.plannedMs);
  });

  it("runs without a leverage line", () => {
    const p = clone();
    p.states[0].leverage = null;
    assert.deepEqual(timedKinds(p), ["strategy-step", "strategy-step", "strategy-step", "anchor-peak"]);
  });

  it("runs without an anchor step, but has no peak and no anchor-only test", () => {
    const p = clone();
    p.states[0].anchorStep = null;
    assert.ok(!timedKinds(p).includes("anchor-peak"));
    assert.throws(() => buildScript(p, STATE, "anchor-only"), ScriptError);
  });

  it("falls back to the anchor step's submodalities when drivers are empty (section 3 skipped)", () => {
    const p = clone();
    p.states[0].drivers = [];
    const peak = buildScript(p, STATE).steps.find((s) => s.kind === "anchor-peak")!;
    assert.equal(peak.driversSpoken, undefined);
    assert.match(peak.text, /Put it in the center\. Make it life size\. Bring it close\. Make it bright\. See it through your own eyes\.$/);
  });

  it("refuses a draft profile, an unknown state, and bad step indexes", () => {
    const draft = clone();
    draft.confirmedAt = null;
    assert.throws(() => buildScript(draft, STATE), /draft/);
    assert.throws(() => buildScript(fixture, "nope"), /no state/);
    const badAnchor = clone();
    badAnchor.states[0].anchorStep = 7;
    assert.throws(() => buildScript(badAnchor, STATE), /anchorStep/);
    const badFull = clone();
    badFull.states[0].strategy.fullyInAt = 3;
    assert.throws(() => buildScript(badFull, STATE), /fullyInAt/);
  });
});

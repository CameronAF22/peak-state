// The deterministic question engine (D-onboarding-012). Playbook sections 1 and 2 for one state:
// choose-state → memory → first-step → (modality) → core submodalities → fully-in → (next-step …) → anchor → confirm.
// Every answer goes into a log; back() replays the log minus its last entry, so the engine is a pure function of its answers.

import {
  chain,
  type Direction,
  type OnboardingEvent,
  type ProfileV2,
  type SensoryModality,
  type State,
  type Step,
} from "@peak-state/contracts";

import { buildQuestion, coreAttributes, PLAYBOOK_SECTION, SUB_QUESTIONS, type QuestionContext, type StateRef } from "../../script/questions.ts";
import type { Answer, EngineOptions, EngineSnapshot, EngineStatus, Question, QuestionEngine, StepView } from "../types.ts";
import { inferDirection, inferModality, parseAnchor, parseStateChoice, parseSubmodality, parseYesNo, type StateChoice } from "./parse.ts";
import { screenAnswer, STOP_MESSAGE } from "./safety.ts";

export * from "./parse.ts";
export * from "./safety.ts";
export * from "./hints.ts";

export const DEFAULT_MAX_STEPS = 6;
const MEMORY_CUE_MAX = 60;

interface DraftStep {
  content: string;
  modality: SensoryModality | "other" | null;
  direction: Direction;
  core: Record<string, string | number>;
  words: Record<string, string>;
}

type Pending =
  | { kind: "choose-state" }
  | { kind: "memory" }
  | { kind: "step"; stepIndex: number }
  | { kind: "modality"; stepIndex: number }
  | { kind: "submodality"; stepIndex: number; attribute: string }
  | { kind: "fully-in"; stepIndex: number }
  | { kind: "anchor" }
  | { kind: "confirm" }
  | { kind: "done" };

interface Run {
  status: EngineStatus;
  state: StateChoice | null;
  memoryCue: string | null;
  steps: DraftStep[];
  fullyInAt: number | null;
  anchorStep: number | null;
  pending: Pending;
  transcript: { who: "guide" | "person"; text: string }[];
  profile: ProfileV2 | null;
  stopReason: string | null;
}

function freshRun(): Run {
  return {
    status: "asking",
    state: null,
    memoryCue: null,
    steps: [],
    fullyInAt: null,
    anchorStep: null,
    pending: { kind: "choose-state" },
    transcript: [],
    profile: null,
    stopReason: null,
  };
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return (at > max / 2 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, "") + "…";
}

/** The contracts Step for a draft step. Words are kept only for sensory steps. */
export function toStep(d: DraftStep): Step {
  const modality = d.modality ?? "other";
  if (modality === "other") return { modality: "other", direction: d.direction, content: d.content, submodalities: {} };
  const submodalities: { core?: Record<string, string | number>; words?: Record<string, string> } = {};
  if (Object.keys(d.core).length > 0) submodalities.core = { ...d.core };
  if (Object.keys(d.words).length > 0) submodalities.words = { ...d.words };
  return { modality, direction: d.direction, content: d.content, submodalities } as Step;
}

/** Create the engine. It asks its first question straight away (a guideTurn event fires). */
export function createEngine(options: EngineOptions = {}): QuestionEngine {
  const now = options.now ?? (() => Date.now());
  const maxSteps = Math.max(1, Math.floor(options.maxSteps ?? DEFAULT_MAX_STEPS));
  let startedAt = now();
  let log: Answer[] = [];
  let run: Run = freshRun();
  let muted = false;

  const emit = (event: OnboardingEvent): void => {
    if (!muted) options.onEvent?.(event);
  };

  const stateRef = (): StateRef => ({ key: run.state?.preset ?? "generic", phrase: run.state?.phrase ?? "" });

  function context(p: Pending): QuestionContext | null {
    const state = stateRef();
    switch (p.kind) {
      case "choose-state":
        return { kind: "choose-state" };
      case "memory":
        return { kind: "memory", state };
      case "step":
        return p.stepIndex === 0 ? { kind: "first-step", state } : { kind: "next-step", state, stepIndex: p.stepIndex };
      case "modality":
        return { kind: "modality", state, stepIndex: p.stepIndex };
      case "submodality": {
        const modality = run.steps[p.stepIndex].modality as SensoryModality;
        return { kind: "submodality", state, stepIndex: p.stepIndex, modality, attribute: p.attribute };
      }
      case "fully-in":
        return { kind: "fully-in", state, stepIndex: p.stepIndex };
      case "anchor":
        return { kind: "anchor", state, steps: run.steps.map((s) => s.content) };
      case "confirm":
        return { kind: "confirm", state, steps: run.steps.map((s) => s.content) };
      case "done":
        return null;
    }
  }

  function currentQuestion(): Question | null {
    if (run.status !== "asking") return null;
    const ctx = context(run.pending);
    return ctx ? buildQuestion(ctx) : null;
  }

  function ask(): void {
    const q = currentQuestion();
    if (!q) return;
    run.transcript.push({ who: "guide", text: q.text });
    emit({ type: "guideTurn", t: now(), text: q.text, section: PLAYBOOK_SECTION[q.kind] });
  }

  function buildState(confirmed: boolean): State | null {
    if (!run.state) return null;
    const steps = run.steps.filter((s) => s.content.length > 0).map(toStep);
    const inSteps = (i: number | null) => (i !== null && i >= 0 && i < steps.length ? i : null);
    return {
      id: run.state.id,
      label: run.state.label,
      words: run.state.words || run.state.label,
      memoryCue: run.memoryCue,
      strategy: { steps, fullyInAt: inSteps(run.fullyInAt), confirmed },
      anchorStep: inSteps(run.anchorStep),
      contrast: null,
      differences: [],
      drivers: [],
      recode: null,
      test: null,
      futurePace: null,
      calibration: { peak: null, contrast: null },
    };
  }

  function buildProfile(confirmed: boolean): ProfileV2 | null {
    const state = buildState(confirmed);
    if (!state) return null;
    return {
      schemaVersion: 2,
      profileId: options.profileId ?? `p-${startedAt.toString(36)}`,
      createdAt: new Date(startedAt).toISOString(),
      confirmedAt: confirmed ? new Date(now()).toISOString() : null,
      states: [state],
    };
  }

  function stop(): void {
    run.status = "stopped";
    run.stopReason = STOP_MESSAGE;
    run.pending = { kind: "done" };
    run.transcript.push({ who: "guide", text: STOP_MESSAGE });
    emit({ type: "guideTurn", t: now(), text: STOP_MESSAGE });
    emit({ type: "stopped", t: now(), reason: "safety", draft: buildProfile(false) });
  }

  function beginSubmodalities(i: number): void {
    const m = run.steps[i].modality;
    if (m && m !== "other") run.pending = { kind: "submodality", stepIndex: i, attribute: coreAttributes(m)[0] };
    else afterStep(i);
  }

  function captureStep(i: number, fullyIn: boolean): void {
    if (!run.state) return;
    emit({ type: "stepCaptured", t: now(), stateId: run.state.id, stepIndex: i, step: toStep(run.steps[i]), fullyIn });
  }

  function arrived(i: number): void {
    run.fullyInAt = i;
    captureStep(i, true);
    run.pending = { kind: "anchor" };
  }

  function afterStep(i: number): void {
    // At the step cap the guide assumes they are fully in rather than asking again.
    if (i + 1 >= maxSteps) arrived(i);
    else run.pending = { kind: "fully-in", stepIndex: i };
  }

  /** Apply one answer. The answer is already logged. */
  function apply(a: Answer): void {
    const text = a.text.trim();
    const pressed = a.choiceValue !== undefined ? currentQuestion()?.choices.find((c) => c.value === a.choiceValue)?.label : undefined;
    const shown = text || pressed || a.choiceValue || "";
    run.transcript.push({ who: "person", text: shown });
    emit({ type: "userTurn", t: now(), text: shown, final: true, via: a.via === "voice" ? "voice" : a.via === "script" ? "script" : "typed" });

    if (!screenAnswer(shown).ok) {
      stop();
      return;
    }

    const p = run.pending;
    switch (p.kind) {
      case "choose-state": {
        const choice = parseStateChoice(text, a.choiceValue);
        if (!choice) break;
        run.state = choice;
        emit({ type: "stateNamed", t: now(), stateId: choice.id, label: choice.label, words: choice.words || choice.label });
        run.pending = { kind: "memory" };
        break;
      }
      case "memory":
        run.memoryCue = a.choiceValue === "there" || !text ? null : truncate(text, MEMORY_CUE_MAX);
        run.pending = { kind: "step", stepIndex: 0 };
        break;
      case "step": {
        const i = p.stepIndex;
        run.steps[i] = { content: shown, modality: inferModality(shown), direction: inferDirection(shown, i), core: {}, words: {} };
        run.steps.length = i + 1;
        if (run.steps[i].modality === null) run.pending = { kind: "modality", stepIndex: i };
        else beginSubmodalities(i);
        break;
      }
      case "modality": {
        const i = p.stepIndex;
        const step = run.steps[i];
        const chosen = a.choiceValue === "visual" || a.choiceValue === "auditory" || a.choiceValue === "kinesthetic" ? a.choiceValue : null;
        step.modality = chosen ?? inferModality(text) ?? "other";
        step.direction = inferDirection(chosen ? step.content : `${step.content}. ${text}`, i);
        beginSubmodalities(i);
        break;
      }
      case "submodality": {
        const i = p.stepIndex;
        const step = run.steps[i];
        const modality = step.modality as SensoryModality;
        const value = parseSubmodality(modality, p.attribute, text, a.choiceValue);
        step.words[p.attribute] = shown;
        if (value !== null) {
          step.core[p.attribute] = value;
          if (run.state) {
            emit({
              type: "submodalityCaptured",
              t: now(),
              stateId: run.state.id,
              target: "peak",
              stepIndex: i,
              modality,
              attribute: p.attribute,
              value,
              words: shown,
            });
          }
        }
        // Asked once per attribute: an unreadable answer keeps the words and moves on.
        const attrs = coreAttributes(modality);
        const next = attrs[attrs.indexOf(p.attribute) + 1];
        if (next) run.pending = { kind: "submodality", stepIndex: i, attribute: next };
        else afterStep(i);
        break;
      }
      case "fully-in": {
        const yn = parseYesNo(text, a.choiceValue);
        if (yn === "yes") arrived(p.stepIndex);
        else if (yn === "no") {
          captureStep(p.stepIndex, false);
          run.pending = { kind: "step", stepIndex: p.stepIndex + 1 };
        }
        break;
      }
      case "anchor": {
        const i = parseAnchor(text, run.steps, a.choiceValue);
        if (i === null) break;
        run.anchorStep = i;
        if (run.state) emit({ type: "anchorStepMarked", t: now(), stateId: run.state.id, stepIndex: i });
        run.pending = { kind: "confirm" };
        break;
      }
      case "confirm": {
        const yn = parseYesNo(text, a.choiceValue);
        if (yn === "yes") {
          run.profile = buildProfile(true);
          run.status = "confirmed";
          run.pending = { kind: "done" };
          if (run.profile) emit({ type: "confirmed", t: now(), profile: run.profile });
        } else if (yn === "no") {
          // Go through the steps again, keeping the state and the memory.
          run.steps = [];
          run.fullyInAt = null;
          run.anchorStep = null;
          run.pending = { kind: "step", stepIndex: 0 };
        }
        break;
      }
      case "done":
        break;
    }
    // A new question, or the same one again when the answer did not say.
    ask();
  }

  function stepViews(): StepView[] {
    return run.steps.map((s, index) => {
      const modality = s.modality ?? "other";
      const checklist =
        modality === "other"
          ? []
          : coreAttributes(modality).map((attribute) => ({
              attribute,
              label: SUB_QUESTIONS[modality][attribute]?.label ?? attribute,
              value: s.core[attribute] ?? null,
              ...(s.words[attribute] !== undefined ? { words: s.words[attribute] } : {}),
            }));
      return { index, modality, direction: s.direction, content: s.content, checklist, isAnchor: run.anchorStep === index };
    });
  }

  function snapshot(): EngineSnapshot {
    const state = buildState(run.status === "confirmed");
    return {
      status: run.status,
      stateId: run.state?.id ?? null,
      stateLabel: run.state?.label ?? null,
      question: currentQuestion(),
      steps: stepViews(),
      chain: state ? chain(state) : "",
      fullyInAt: run.fullyInAt,
      anchorStep: run.anchorStep,
      transcript: run.transcript.map((l) => ({ ...l })),
      profile: run.profile ? structuredClone(run.profile) : null,
      stopReason: run.stopReason,
    };
  }

  function start(): void {
    run = freshRun();
    ask();
  }

  start();

  return {
    snapshot,
    answer(a: Answer): EngineSnapshot {
      if (run.status !== "asking") return snapshot();
      if (!a.text.trim() && !a.choiceValue) return snapshot();
      const entry: Answer = { ...a };
      log.push(entry);
      apply(entry);
      return snapshot();
    },
    back(): EngineSnapshot {
      if (log.length === 0) return snapshot();
      const replay = log.slice(0, -1);
      log = [];
      muted = true;
      try {
        run = freshRun();
        ask();
        for (const a of replay) {
          log.push(a);
          apply(a);
        }
      } finally {
        muted = false;
      }
      const q = currentQuestion();
      if (q) emit({ type: "guideTurn", t: now(), text: q.text, section: PLAYBOOK_SECTION[q.kind] });
      return snapshot();
    },
    reset(): EngineSnapshot {
      log = [];
      startedAt = now();
      start();
      return snapshot();
    },
  };
}

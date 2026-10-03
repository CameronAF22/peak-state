// The practice loop for every session after the first (D-onboarding-015):
//   recall (one question per saved step, with the person's own answer) → "how close, 0 to 10?" → one strategy
//   question → changed: new revision, "Okay, let's try again.", back to recall · same: done.
// Deterministic and DOM-free, like the question engine: the page and the voice only show and speak its prompts.

import { getState, repSteps, SUBMODALITIES, type RepSession, type RepStep, type SensoryModality, type State, type StateId, type Step } from "@peak-state/contracts";
import { parseSubmodality } from "../engine/parse.ts";
import { screenAnswer, STOP_MESSAGE } from "../engine/safety.ts";
import { scriptHash, stepLine, stripPerception, toSecondPerson, type PlaybackLine } from "../playback/script.ts";
import { applyChange, readField, type StrategyChange, type StrategyRecord } from "../store/index.ts";
import type { Answer, Choice } from "../types.ts";
import { parseRating } from "./rating.ts";

export const DEFAULT_MAX_TRIES = 3;
export const TRY_AGAIN_LINE = "Okay, let's try again.";

export type PracticePhase = "recall" | "rate" | "question" | "done" | "stopped";

export interface PracticePrompt {
  /** Stable within a session, e.g. "recall:1:0", "rate:1", "question:1". */
  id: string;
  kind: "recall" | "rate" | "question";
  /** The question, shown large. */
  text: string;
  /** What they said last time, shown under the question (recall and question prompts). */
  remembered: string | null;
  /** Everything the voice says for this prompt. */
  spoken: string;
  choices: Choice[];
  stepIndex: number | null;
  /** For a strategy question: the detail being asked about. */
  field: string | null;
}

export interface PracticeSnapshot {
  phase: PracticePhase;
  stateId: StateId;
  stateLabel: string;
  /** 1-based try number. */
  attempt: number;
  maxTries: number;
  prompt: PracticePrompt | null;
  /** A line to show and say before the prompt: "Okay, let's try again.", or a re-ask hint. */
  notice: string | null;
  /** Recall position, for the step chips: index into the recall order, or null. */
  recallAt: number | null;
  /** The step indexes walked in recall, in order (the anchor last when it has one). */
  recallOrder: number[];
  record: StrategyRecord;
  /** Rating given in this try, once given. */
  rating: number | null;
  /** Every change made in this session, oldest first. */
  changes: StrategyChange[];
  /** Every try logged in this session, oldest first. */
  runs: RepSession[];
  /** The stop message to show and speak (never the screened category). */
  stopReason: string | null;
  /** True when the safety screen ended the session, so the page shows the help line. */
  safetyStopped: boolean;
}

export interface PracticeOptions {
  record: StrategyRecord;
  /** Defaults to the profile's first state. */
  stateId?: StateId;
  /** Runs already logged for this state, for repIndex. Default 0. */
  priorRuns?: number;
  /** Practice tries already done for this state, so each session starts on the next strategy question. Default 0. */
  questionOffset?: number;
  maxTries?: number;
  now?: () => number;
  /** Called with the new record each time an answer changes. */
  onChange?: (record: StrategyRecord, change: StrategyChange) => void;
  /** Called with each logged try. */
  onRun?: (session: RepSession) => void;
}

export interface PracticeLoop {
  snapshot(): PracticeSnapshot;
  answer(answer: Answer): PracticeSnapshot;
  /** End the session now; a try in progress is logged with endedBy "user-stop". */
  stop(): PracticeSnapshot;
}

// ── wording ─────────────────────────────────────────────────────────────────

function verb(step: Step): string {
  switch (step.modality) {
    case "visual":
      return "see";
    case "auditory":
      return "hear";
    case "kinesthetic":
      return "feel";
    default:
      return "notice";
  }
}

function recallQuestion(step: Step, position: number, isAnchor: boolean): string {
  if (isAnchor) return "And the one that brings it back fastest: go there now. What do you notice?";
  if (position === 0) return `Step back into that time. What's the very first thing you ${verb(step)}?`;
  return `And then, what's the very next thing you ${verb(step)}?`;
}

/** "Last time, <subject> <value>." for each core detail. */
const SUBJECT: Record<string, string> = {
  location: "the picture was",
  size: "the picture was",
  distance: "the picture was",
  brightness: "the picture was",
  perspective: "you were",
  source: "the voice was",
  volume: "the sound was",
  "auditory.location": "the sound was",
  bodyLocation: "you felt it",
  intensity: "the feeling was",
  movement: "the feeling was",
};

const VALUE_WORDS: Record<string, Record<string, string>> = {
  perspective: { associated: "in it, through your own eyes", dissociated: "watching yourself" },
  location: {
    center: "in the center", left: "on the left", right: "on the right", above: "above you", below: "below you",
    "upper-left": "in the upper left", "upper-right": "in the upper right", "lower-left": "in the lower left", "lower-right": "in the lower right",
    "all-around": "all around you", "inside-head": "inside your head", front: "in front of you", behind: "behind you",
  },
  distance: { "arm-length": "an arm's length away", "across-room": "across the room", far: "far off" },
  movement: { still: "not moving", moving: "moving" },
  brightness: { normal: "normal brightness" },
  volume: { normal: "a normal volume" },
  size: { medium: "medium-sized", "life-size": "life-size", "larger-than-life": "larger than life" },
};

function valueWords(attr: string, value: string | number): string {
  if (typeof value === "number") return attr === "intensity" ? `${value} out of 10` : String(value);
  if (attr === "bodyLocation") return value === "whole-body" ? "through your whole body" : `in your ${value.replace(/-/g, " ")}`;
  return VALUE_WORDS[attr]?.[value] ?? toSecondPerson(value.replace(/-/g, " "));
}

/** A short handle for a step in a question: "the lake at sunrise". */
function shortContent(step: Step): string {
  const { text, selfTalk } = stripPerception(step.content);
  const words = toSecondPerson(text).replace(/[.!?…]+$/, "").split(/\s+/);
  const short = words.length > 12 ? `${words.slice(0, 12).join(" ")}…` : words.join(" ");
  return selfTalk ? `'${short}'` : short;
}

// ── which detail to ask about ───────────────────────────────────────────────

interface Target {
  stepIndex: number;
  field: string;
}

/** Every askable detail: the anchor step first, then the others in order; each step's core details with a value. */
export function questionTargets(state: State): Target[] {
  const steps = state.strategy.steps;
  const order = [...steps.keys()];
  if (state.anchorStep !== null && steps[state.anchorStep]) {
    order.splice(order.indexOf(state.anchorStep), 1);
    order.unshift(state.anchorStep);
  }
  const out: Target[] = [];
  for (const i of order) {
    const step = steps[i];
    if (step.modality === "other") continue;
    for (const attr of Object.keys(SUBMODALITIES[step.modality].core)) {
      if (readField(step, `core.${attr}`) !== null) out.push({ stepIndex: i, field: `core.${attr}` });
    }
  }
  if (out.length === 0) {
    const i = state.anchorStep ?? 0;
    if (steps[i]) out.push({ stepIndex: i, field: "content" });
  }
  return out;
}

function questionPrompt(state: State, target: Target, attempt: number): PracticePrompt {
  const step = state.strategy.steps[target.stepIndex];
  const current = readField(step, target.field);
  const id = `question:${attempt}`;
  if (target.field === "content" || step.modality === "other") {
    const text = `Last time, this step was "${step.content}". Bringing it back now, is it still that, or is it something else?`;
    return { id, kind: "question", text, remembered: step.content, spoken: text, choices: [{ value: "same", label: "Still the same" }], stepIndex: target.stepIndex, field: "content" };
  }
  const attr = target.field.slice(5);
  const modality = step.modality as SensoryModality;
  const now = current === null ? "" : valueWords(attr, current);
  const subject = SUBJECT[modality === "auditory" && attr === "location" ? "auditory.location" : attr] ?? `the ${attr} was`;
  const text =
    attr === "perspective"
      ? `Last time, with ${shortContent(step)}, ${subject} ${now}. Bringing it back now, are you still ${now}, or is it different?`
      : attr === "bodyLocation"
        ? `Last time, with ${shortContent(step)}, ${subject} ${now}. Bringing it back now, do you still feel it ${now}, or somewhere else?`
        : `Last time, with ${shortContent(step)}, ${subject} ${now}. Bringing it back now, is it still ${now}, or is it different?`;
  const vocab = (SUBMODALITIES[modality].core as Record<string, readonly string[] | null>)[attr];
  const others: Choice[] = Array.isArray(vocab) ? vocab.filter((v) => v !== current).map((v) => ({ value: v, label: valueWords(attr, v) })) : [];
  return {
    id,
    kind: "question",
    text,
    remembered: stepLine(step),
    spoken: text,
    choices: [{ value: "same", label: `Still ${now}` }, ...others],
    stepIndex: target.stepIndex,
    field: target.field,
  };
}

const SAME = /\b(same|still|unchanged|no change|hasn't changed|has not changed|didn't change|did not change|keep it|it's fine|that's right|yes|yeah|yep)\b/i;
/** Words that turn "still close" into "not close any more", or "bright" into "bright but further". */
const NEGATION = /\b(not|no longer|anymore|any more|less|but|changed|different|instead)\b|n't\b/i;
/** A bare no: it says something changed but not what, so the question is asked again. */
const BARE_NO = /^\W*(no|nope|nah|different|changed|it changed|it's changed|it'?s different( now)?|not really|not the same|not anymore|not any more|it's not|it isn't)\W*$/i;

type Read = { kind: "same" } | { kind: "change"; to: string | number; words?: string } | { kind: "unclear" };

function short(text: string): boolean {
  return text.split(/\s+/).length <= 4;
}

/** The last 0..10 number in the text: "it went from 8 to 9" is 9. */
function lastNumber(text: string): number | null {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const all = [...text.toLowerCase().matchAll(/\b(10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g)];
  const last = all[all.length - 1]?.[1];
  if (last === undefined) return null;
  return /^\d+$/.test(last) ? Number(last) : words.indexOf(last);
}

/** What the answer to a strategy question says: the same, a new value, or unclear. */
export function readQuestionAnswer(step: Step, field: string, answer: Answer): Read {
  const current = readField(step, field);
  if (answer.choiceValue === "same") return { kind: "same" };
  const text = answer.text.trim();
  const fromChoice = answer.choiceValue !== undefined;
  if (!fromChoice && BARE_NO.test(text)) return { kind: "unclear" };
  const negated = NEGATION.test(text);
  const words = fromChoice || answer.via === "choice" ? undefined : text;

  if (field === "content" || step.modality === "other") {
    if (!text || (SAME.test(text) && !negated && short(text))) return { kind: "same" };
    return text !== current ? { kind: "change", to: text } : { kind: "same" };
  }

  const attr = field.slice(5);
  const modality = step.modality;
  const vocab = (SUBMODALITIES[modality].core as Record<string, readonly string[] | null>)[attr];

  if (vocab === null && attr !== "intensity") {
    // Free text (whose voice): any words are the value, so a short "yes, still" is the same.
    if (!fromChoice && SAME.test(text) && !negated && short(text)) return { kind: "same" };
    const v = parseSubmodality(modality, attr, text, answer.choiceValue);
    return v === null || v === current ? { kind: "same" } : { kind: "change", to: v, ...(words ? { words } : {}) };
  }

  let value = attr === "intensity" && !fromChoice ? lastNumber(text) : parseSubmodality(modality, attr, text, answer.choiceValue);
  if (value === current && negated && typeof current === "string") {
    // "not in the center, it's on the left": drop the old value's words and read again.
    const without = text.replace(new RegExp(`\\b${current.replace(/-/g, "[- ]")}\\b`, "gi"), " ");
    const again = parseSubmodality(modality, attr, without);
    value = again !== null && again !== current ? again : null;
    if (value === null) return { kind: "unclear" };
  }
  if (value === null) return SAME.test(text) && !negated ? { kind: "same" } : { kind: "unclear" };
  if (value === current) return { kind: "same" };
  return { kind: "change", to: value, ...(words ? { words } : {}) };
}

// ── the loop ────────────────────────────────────────────────────────────────

export function createPracticeLoop(options: PracticeOptions): PracticeLoop {
  const now = options.now ?? Date.now;
  const iso = (): string => new Date(now()).toISOString();
  const maxTries = Math.max(1, Math.floor(options.maxTries ?? DEFAULT_MAX_TRIES));
  let record = options.record;
  const stateId = options.stateId ?? record.profile.states[0]?.id;
  if (!stateId || !getState(record.profile, stateId)) throw new Error(`state ${stateId ?? "(none)"} is not in the profile`);

  let phase: PracticePhase = "recall";
  let attempt = 1;
  let recallAt = 0;
  let notice: string | null = null;
  let rating: number | null = null;
  let stopReason: string | null = null;
  let safetyStopped = false;
  const changes: StrategyChange[] = [];
  const runs: RepSession[] = [];

  // The try in progress.
  let tryStartedAt = iso();
  let promptStartedAt = tryStartedAt;
  let steps: RepStep[] = [];
  let anchorPaired = false;

  const state = (): State => getState(record.profile, stateId)!;

  function recallOrder(): number[] {
    const s = state();
    const order = repSteps(s);
    if (s.anchorStep !== null && s.strategy.steps[s.anchorStep]) order.push(s.anchorStep);
    return order;
  }

  function recallPrompt(at: number): PracticePrompt {
    const s = state();
    const order = recallOrder();
    const i = order[at];
    const step = s.strategy.steps[i];
    const isAnchor = s.anchorStep === i && at === order.length - 1;
    const text = recallQuestion(step, at, isAnchor);
    const remembered = stepLine(step);
    return {
      id: `recall:${attempt}:${at}`,
      kind: "recall",
      text,
      remembered,
      spoken: `${text} Last time: ${remembered}`,
      choices: [{ value: "next", label: "Next" }],
      stepIndex: i,
      field: null,
    };
  }

  function ratePrompt(): PracticePrompt {
    const text = `How close did you get to feeling ${toSecondPerson(state().label)}, from 0 to 10?`;
    return {
      id: `rate:${attempt}`,
      kind: "rate",
      text,
      remembered: null,
      spoken: text,
      choices: Array.from({ length: 11 }, (_, n) => ({ value: String(n), label: String(n) })),
      stepIndex: null,
      field: null,
    };
  }

  function target(): Target {
    const targets = questionTargets(state());
    const k = Math.max(0, Math.floor(options.questionOffset ?? 0)) + attempt - 1;
    return targets[k % targets.length];
  }

  function prompt(): PracticePrompt | null {
    switch (phase) {
      case "recall":
        return recallPrompt(recallAt);
      case "rate":
        return ratePrompt();
      case "question":
        return questionPrompt(state(), target(), attempt);
      default:
        return null;
    }
  }

  function scriptLines(): PlaybackLine[] {
    return recallOrder().map((i, at) => ({ kind: "step", stepIndex: i, text: recallPrompt(at).spoken }));
  }

  function logTry(endedBy: RepSession["endedBy"]): void {
    if (steps.length === 0 && endedBy !== "completed") return; // nothing happened in this try
    const session: RepSession = {
      schemaVersion: 1,
      id: `rep_${stateId}_${Date.parse(tryStartedAt).toString(36)}_${attempt}`,
      profileId: record.profile.profileId,
      stateId,
      repIndex: Math.max(0, Math.floor(options.priorRuns ?? 0)) + runs.length,
      kind: "full",
      phase: null,
      trigger: { kind: "practice" },
      arm: "cue",
      startedAt: tryStartedAt,
      endedAt: iso(),
      steps,
      intensityBefore: null,
      intensityAfter: rating,
      recoverySeconds: null,
      recoveryCensored: false,
      anchorPaired,
      signalSource: "none",
      scriptHash: scriptHash(scriptLines()),
      endedBy,
    };
    runs.push(session);
    options.onRun?.(session);
  }

  function startTry(): void {
    tryStartedAt = iso();
    promptStartedAt = tryStartedAt;
    steps = [];
    anchorPaired = false;
    rating = null;
    recallAt = 0;
    phase = "recall";
  }

  function snapshot(): PracticeSnapshot {
    return {
      phase,
      stateId,
      stateLabel: state().label,
      attempt,
      maxTries,
      prompt: prompt(),
      notice,
      recallAt: phase === "recall" ? recallAt : null,
      recallOrder: recallOrder(),
      record,
      rating,
      changes: [...changes],
      runs: [...runs],
      stopReason,
      safetyStopped,
    };
  }

  function safetyStop(): PracticeSnapshot {
    logTry("safety-stop");
    phase = "stopped";
    stopReason = STOP_MESSAGE;
    safetyStopped = true;
    notice = null;
    return snapshot();
  }

  function answer(a: Answer): PracticeSnapshot {
    if (phase === "done" || phase === "stopped") return snapshot();
    const text = a.text ?? "";
    if (text.trim() && a.via !== "choice") {
      const screen = screenAnswer(text);
      if (!screen.ok) return safetyStop();
    }
    const shownAt = promptStartedAt;
    promptStartedAt = iso();
    notice = null;

    if (phase === "recall") {
      const order = recallOrder();
      const i = order[recallAt];
      const s = state();
      const isAnchor = s.anchorStep === i && recallAt === order.length - 1;
      steps.push({ kind: isAnchor ? "anchor-peak" : "strategy-step", stepIndex: i, plannedMs: null, startedAt: shownAt, endedAt: promptStartedAt, delivered: true });
      if (isAnchor) anchorPaired = true;
      recallAt += 1;
      if (recallAt >= order.length) phase = "rate";
      return snapshot();
    }

    if (phase === "rate") {
      const n = a.choiceValue !== undefined && /^(10|\d)$/.test(a.choiceValue) ? Number(a.choiceValue) : parseRating(text);
      if (n === null) {
        notice = "I didn't catch a number. Say or tap anything from 0 to 10.";
        promptStartedAt = shownAt;
        return snapshot();
      }
      rating = n;
      steps.push({ kind: "rate", plannedMs: null, startedAt: shownAt, endedAt: promptStartedAt, delivered: true });
      phase = "question";
      return snapshot();
    }

    // phase === "question"
    const t = target();
    const step = state().strategy.steps[t.stepIndex];
    const read = readQuestionAnswer(step, t.field, a);
    if (read.kind === "unclear") {
      notice = "I didn't catch that. Pick one, or say it's the same.";
      promptStartedAt = shownAt;
      return snapshot();
    }
    logTry("completed");
    if (read.kind === "same") {
      phase = "done";
      return snapshot();
    }
    const next = applyChange(record, { stateId, stepIndex: t.stepIndex, field: t.field, to: read.to, words: read.words, rating }, now);
    const change = next.changes[next.changes.length - 1];
    record = next;
    changes.push(change);
    options.onChange?.(record, change);
    if (attempt >= maxTries) {
      phase = "done";
      notice = "Strategy updated. That's enough for one session; your next practice starts from the new version.";
      return snapshot();
    }
    attempt += 1;
    startTry();
    notice = TRY_AGAIN_LINE;
    return snapshot();
  }

  function stop(): PracticeSnapshot {
    if (phase === "done" || phase === "stopped") return snapshot();
    logTry("user-stop");
    phase = "stopped";
    notice = null;
    return snapshot();
  }

  return { snapshot, answer, stop };
}

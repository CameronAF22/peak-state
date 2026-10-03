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
import { parseRating, stripScale } from "./rating.ts";

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

const SAME = /\b(same|still|unchanged|keep it|it's fine|that's right|yes|yeah|yep)\b/i;
/** Says outright that nothing changed. Read before any negation, so "it hasn't changed" is never a "not". */
const NO_CHANGE = /\b(?:(?:has|have|is|did|does)(?:n't| not) (?:changed|moved|shifted)|(?:didn't|did not|doesn't|does not) (?:change|move|shift)|nothing(?:'s| has| is)? (?:changed|different|moved)|no change|unchanged|(?:the )?same(?: as (?:before|last time))?)\b/gi;
const NOT_SAME = /\bnot (?:quite |really )?(?:the )?same\b/i;
/** A clause holding one of these says what it is not: "not far", "it isn't dim", "no longer in the center". */
const NEGATED = /\b(?:not|no longer|never|anymore|any more|less)\b|n't\b/i;
/** Words that mark a new answer in free text: "still a face, but now it's my daughter". */
const SHIFT = /\b(but|now|instead|actually|different|changed)\b/i;
/** A bare no: it says something changed but not what, so the question is asked again. */
const BARE_NO = /^\W*(no|nope|nah|different|changed|it changed|it's changed|it'?s different( now)?|not really|not the same|not anymore|not any more|it's not|it isn't)\W*$/i;

type Read = { kind: "same" } | { kind: "change"; to: string | number; words?: string } | { kind: "unclear" };

/** The answer in clauses, with "it hasn't changed" phrases taken out and noted. */
function clauses(text: string): { saysSame: boolean; rest: string; positive: string[] } {
  const notSame = NOT_SAME.test(text);
  let saysSame = false;
  const cleaned = text.replace(NOT_SAME, " ").replace(NO_CHANGE, () => {
    saysSame = true;
    return " ";
  });
  const parts = cleaned.split(/[,;.!?]|\b(?:but|and|though|although|so)\b/i).map((c) => c.trim()).filter(Boolean);
  return { saysSame: saysSame && !notSame, rest: cleaned, positive: parts.filter((c) => !NEGATED.test(c)) };
}

/** The last 0..10 number in the text, with any "out of 10" scale taken out: "it went from 8 to 9" is 9. */
function lastNumber(text: string): number | null {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  const all = [...stripScale(text).matchAll(/\b(10|[0-9]|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g)];
  const last = all[all.length - 1]?.[1];
  if (last === undefined) return null;
  return /^\d+$/.test(last) ? Number(last) : words.indexOf(last);
}

function normal(v: string): string {
  return v.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "at", "in", "on", "it", "was", "is", "my", "i", "to", "with", "that", "this", "there"]);

/** The same thing in other words: most of the saved answer's meaningful words come back ("the lake, early" ≈ "the lake at sunrise early"). */
function sameWords(text: string, saved: string): boolean {
  const key = (v: string) => normal(v).split(/\s+/).filter((w) => w && !STOP_WORDS.has(w));
  const was = key(saved);
  if (was.length < 2) return false;
  const now = new Set(key(text));
  return was.filter((w) => now.has(w)).length / was.length >= 0.75;
}

/** What the answer to a strategy question says: the same, a new value, or unclear. */
export function readQuestionAnswer(step: Step, field: string, answer: Answer): Read {
  const current = readField(step, field);
  if (answer.choiceValue === "same") return { kind: "same" };
  const text = answer.text.trim();
  const fromChoice = answer.choiceValue !== undefined;
  if (!fromChoice && BARE_NO.test(text)) return { kind: "unclear" };
  const words = fromChoice || answer.via === "choice" ? undefined : text;
  const attr = field.startsWith("core.") ? field.slice(5) : null;
  const vocab = attr && step.modality !== "other" ? (SUBMODALITIES[step.modality].core as Record<string, readonly string[] | null>)[attr] : undefined;

  if (!attr || step.modality === "other" || (vocab === null && attr !== "intensity")) {
    // Free text (the step's words, or whose voice): the answer itself is the new value, unless it says it is the same.
    if (!text) return { kind: "same" };
    if (fromChoice && attr) {
      const v = parseSubmodality(step.modality as Exclude<Step["modality"], "other">, attr, text, answer.choiceValue);
      return v === null || v === current ? { kind: "same" } : { kind: "change", to: v };
    }
    const { saysSame, rest } = clauses(text);
    const now = typeof current === "string" ? normal(current) : "";
    if (now && (normal(text).includes(now) || sameWords(text, now))) return { kind: "same" };
    if ((saysSame || SAME.test(text)) && !NOT_SAME.test(text)) return SHIFT.test(rest) ? { kind: "unclear" } : { kind: "same" };
    if (!attr) return { kind: "change", to: text };
    const v = parseSubmodality(step.modality as Exclude<Step["modality"], "other">, attr, text, answer.choiceValue);
    return v === null || v === current ? { kind: "same" } : { kind: "change", to: v, ...(words ? { words } : {}) };
  }

  const modality = step.modality as Exclude<Step["modality"], "other">;
  if (fromChoice) {
    const v = parseSubmodality(modality, attr, text, answer.choiceValue);
    return v === null || v === current ? { kind: "same" } : { kind: "change", to: v };
  }

  // Read only what the answer says it is, never what it says it is not: "not far, still close" is close.
  const { saysSame, positive } = clauses(text);
  const values = positive
    .map((c) => (attr === "intensity" ? lastNumber(c) : parseSubmodality(modality, attr, c)))
    .filter((v): v is string | number => v !== null);
  const changed = values.filter((v) => v !== current);
  if (changed.length) return { kind: "change", to: changed[changed.length - 1], ...(words ? { words } : {}) };
  if (values.length || saysSame || (SAME.test(text) && !NOT_SAME.test(text))) return { kind: "same" };
  return { kind: "unclear" };
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

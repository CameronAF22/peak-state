// The question bank for the onboarding question harness, as data (D-onboarding-012).
// Sections 1 and 2 of docs/hackathon/elicitation-playbook.md: the strategy and the core submodalities.
// Every question carries exactly two suggestion phrasings, shown when the person takes longer than the hint delay,
// so they can find the descriptive language. The guide reflects the person's own words and never paraphrases into virtues.

import { SUBMODALITIES, type SensoryModality } from "@peak-state/contracts";
import type { Choice, PresetState, Question, QuestionKind } from "../src/types.ts";

export type Pair = [string, string];

/** Which suggestion set a question draws from: a preset state, or the generic set for a custom state. */
export type SuggestionSetKey = PresetState | "generic";

/** The state as the question bank needs it. */
export interface StateRef {
  key: SuggestionSetKey;
  /** The words placed into {state}, e.g. "content" or "calm before a pitch". */
  phrase: string;
}

// ── states ──────────────────────────────────────────────────────────────────

export const PRESET_STATES: readonly { value: PresetState; label: string }[] = [
  { value: "content", label: "Content" },
  { value: "destressed", label: "Destressed" },
];

/** Testing assumes this state when nothing else is chosen. */
export const DEFAULT_STATE: PresetState = "content";

// ── question text ───────────────────────────────────────────────────────────

export const TEXT = {
  chooseState: "What state do you want to choose?",
  memory: "Can you remember a specific time when you felt totally {state}? Step back into it. Tell me when you're there.",
  firstStep:
    "What was the very first thing that made you feel totally {state}? Something you saw, something you heard, or the touch of something?",
  nextStep:
    "After that, what was the very next thing? Did you make a picture in your mind, say something to yourself, or have a certain feeling?",
  modality: "Was that more something you saw, something you heard, or something you felt?",
  fullyIn: "Were you fully {state} at that point, or was there a next thing?",
  anchor: "Which one of these, if I gave it back to you, would bring {state} back fastest?",
  confirm: "So {playback}. Is that the order?",
} as const;

/** Playbook section numbers, for guideTurn events. */
export const PLAYBOOK_SECTION: Record<QuestionKind, string> = {
  "choose-state": "1.1",
  memory: "1.2",
  "first-step": "1.3",
  "next-step": "1.4",
  modality: "1.4",
  submodality: "2",
  "fully-in": "1.5",
  anchor: "2",
  confirm: "1.6",
};

/** Section 2 core questions, per modality, in the order they are asked. Keys follow SUBMODALITIES[modality].core. */
export const SUB_QUESTIONS: Record<SensoryModality, Record<string, { label: string; text: string }>> = {
  visual: {
    location: { label: "Where", text: "Look at that picture again. Where is it: straight ahead, off to one side, above or below?" },
    size: { label: "Size", text: "How big is it: small, life-size, or bigger than life?" },
    distance: { label: "Distance", text: "How far away is it: close, at arm's length, or further off?" },
    brightness: { label: "Brightness", text: "Is it bright, dim, or somewhere in between?" },
    perspective: { label: "Whose eyes", text: "Are you seeing it through your own eyes, or watching yourself in it?" },
  },
  auditory: {
    source: { label: "Source", text: "Whose voice is that, or what is making the sound?" },
    volume: { label: "Volume", text: "How loud is it: quiet, normal, or loud?" },
    location: { label: "Where from", text: "Where does it come from: inside your head, in front, behind, or to one side?" },
  },
  kinesthetic: {
    bodyLocation: { label: "Where in the body", text: "Where in your body do you feel it?" },
    intensity: { label: "Intensity", text: "How strong is it, from 0 to 10?" },
    movement: { label: "Moving or still", text: "Is the feeling moving, or is it still?" },
  },
};

/** Human labels for the contracts vocabulary values, used on the choice buttons and in checklists. */
export const VALUE_LABELS: Record<SensoryModality, Record<string, Record<string, string>>> = {
  visual: {
    location: {
      center: "Straight ahead",
      left: "Left",
      right: "Right",
      above: "Above",
      below: "Below",
      "upper-left": "Upper left",
      "upper-right": "Upper right",
      "lower-left": "Lower left",
      "lower-right": "Lower right",
      "all-around": "All around me",
    },
    size: { small: "Small", medium: "Medium", "life-size": "Life-size", "larger-than-life": "Bigger than life" },
    distance: { close: "Close", "arm-length": "Arm's length", "across-room": "Across a room", far: "Far away" },
    brightness: { dim: "Dim", normal: "In between", bright: "Bright" },
    perspective: { associated: "Through my own eyes", dissociated: "Watching myself" },
  },
  auditory: {
    volume: { quiet: "Quiet", normal: "Normal", loud: "Loud" },
    location: {
      "inside-head": "Inside my head",
      front: "In front",
      behind: "Behind",
      left: "Left",
      right: "Right",
      above: "Above",
      "all-around": "All around me",
    },
  },
  kinesthetic: {
    bodyLocation: {
      head: "Head",
      face: "Face",
      throat: "Throat",
      chest: "Chest",
      stomach: "Stomach",
      shoulders: "Shoulders",
      arms: "Arms",
      hands: "Hands",
      back: "Back",
      legs: "Legs",
      feet: "Feet",
      "whole-body": "Whole body",
    },
    movement: { still: "Still", moving: "Moving" },
  },
};

/** Quick picks for intensity (any 0..10 is accepted). */
export const INTENSITY_CHOICES: readonly number[] = [2, 4, 6, 8, 10];

export const MODALITY_CHOICES: readonly Choice[] = [
  { value: "visual", label: "Something I saw" },
  { value: "auditory", label: "Something I heard or said to myself" },
  { value: "kinesthetic", label: "Something I felt" },
];

/** The core attributes for a modality, in the order they are asked. */
export function coreAttributes(modality: SensoryModality): string[] {
  return Object.keys(SUBMODALITIES[modality].core);
}

/** The human label for a vocabulary value, or the value itself. */
export function valueLabel(modality: SensoryModality, attribute: string, value: string | number): string {
  return VALUE_LABELS[modality][attribute]?.[String(value)] ?? String(value);
}

// ── suggestions ─────────────────────────────────────────────────────────────
// Two phrasings per question. Step suggestions parse to a modality; submodality suggestions parse to a vocabulary value
// (both checked in test/unit/script.test.ts). {state} is filled in.

export interface StateSuggestions {
  memory: Pair;
  /** Step 1 (index 0). */
  firstStep: Pair;
  /** Step 2 onward: index stepIndex - 1, cycling. Neighbouring steps never share a pair. */
  nextSteps: Pair[];
  modality: Pair;
  fullyIn: Pair;
  anchor: Pair;
  confirm: Pair;
  submodality: Record<SensoryModality, Record<string, Pair>>;
}

export const CHOOSE_STATE_SUGGESTIONS: Pair = ["Content, settled and easy", "Destressed, like the weight is off"];

export const SUGGESTIONS: Record<SuggestionSetKey, StateSuggestions> = {
  content: {
    memory: ["A slow Sunday morning, coffee on the porch, nowhere to be", "Lying in the grass after a long walk"],
    firstStep: ["I saw the evening light on the water", "I heard the kettle click off in the kitchen"],
    nextSteps: [
      ["I said to myself, this is enough", "I felt my shoulders drop"],
      ["I felt a slow warmth spread through my chest", "I pictured the whole afternoon open in front of me"],
      ["I felt my breath go long and slow", "I told myself, nothing needs fixing"],
      ["I saw everything I care about, right here", "I felt my whole body settle into the chair"],
      ["I said, quietly, this is good", "I felt my hands go warm and loose"],
    ],
    modality: ["It was more something I saw", "It was more of a feeling in my body"],
    fullyIn: ["Yes, that's when I was fully {state}", "No, there was one more thing after that"],
    anchor: ["The first one brings it back fastest", "The last one, right at the end"],
    confirm: ["Yes, that's the order", "Not quite, let me go through it again"],
    submodality: {
      visual: {
        location: ["It's straight ahead of me, in the middle", "It's a little off to the left"],
        size: ["It's life-size, like I'm really there", "It's huge, it fills everything"],
        distance: ["It's close, right in front of me", "It's far off, out toward the horizon"],
        brightness: ["It's bright, like full daylight", "It's soft and dim, like dusk"],
        perspective: ["Through my own eyes, I'm in it", "I'm watching myself, like from outside"],
      },
      auditory: {
        source: ["My own voice, calm and slow", "The sound of the kettle in the kitchen"],
        volume: ["Quiet, almost a whisper", "Normal, like a conversation"],
        location: ["It's inside my head", "It comes from in front of me"],
      },
      kinesthetic: {
        bodyLocation: ["In my chest, right in the middle", "In my shoulders, they let go"],
        intensity: ["About a 7 out of 10", "Gentle, maybe a 4"],
        movement: ["It's moving, spreading out slowly", "It's still, just settled there"],
      },
    },
  },
  destressed: {
    memory: ["Walking out of the office on a Friday, phone off", "The first evening of a holiday, bags still packed"],
    firstStep: ["I felt the cool air on my face as I stepped outside", "I heard the rain start on the window"],
    nextSteps: [
      ["I said to myself, it's all handled", "I saw the to-do list fade out"],
      ["I felt my jaw unclench and my breath slow down", "I heard a quiet voice say, you can stop now"],
      ["I pictured a wide, empty beach", "I felt the tightness in my chest let go"],
      ["I told myself, one thing at a time", "I felt my shoulders sink down"],
      ["I saw the room go soft and still", "I heard my own breathing, slow and even"],
    ],
    modality: ["More like a feeling, somewhere in my body", "More like something I heard myself say"],
    fullyIn: ["Yes, fully {state} right there", "No, there was a next thing"],
    anchor: ["The very first one, that's the fastest", "The last one, where it all let go"],
    confirm: ["Yes, that's right", "No, the order's a bit different"],
    submodality: {
      visual: {
        location: ["It's all around me, like I'm standing in it", "It's right in front of me, in the center"],
        size: ["It's bigger than life, wide open", "Small, like a photo"],
        distance: ["Far away, in the distance", "About arm's length away"],
        brightness: ["Normal light, nothing special", "Bright and clear, like a sunny day"],
        perspective: ["I see it from my own eyes", "I can see myself in it, from the outside"],
      },
      auditory: {
        source: ["My own voice, slow and kind", "The rain on the window"],
        volume: ["Soft and quiet", "Loud and clear"],
        location: ["All around me", "Behind me, a little"],
      },
      kinesthetic: {
        bodyLocation: ["My shoulders, they drop down", "My whole body, all over"],
        intensity: ["A strong 8", "About a 5, medium"],
        movement: ["It's moving, like a wave washing down", "Still and steady"],
      },
    },
  },
  generic: {
    memory: ["A specific day when it was just right", "One moment I can step straight back into"],
    firstStep: ["I saw the place where it happened", "I heard someone say my name"],
    nextSteps: [
      ["I said to myself, this is it", "I felt it rise up in my chest"],
      ["I felt my whole body change", "I saw it in my mind, clear as day"],
      ["I heard a voice in my head say, yes", "I felt a lift right through me"],
      ["I pictured what came next", "I told myself, keep going"],
      ["I felt it settle in my body", "I saw myself right in the middle of it"],
    ],
    modality: ["Mostly something I saw", "Mostly something I felt"],
    fullyIn: ["Yes, I was fully {state} then", "No, something else came after"],
    anchor: ["The first one", "The last one"],
    confirm: ["Yes, that's it", "No, not quite"],
    submodality: {
      visual: {
        location: ["Right in the middle, straight ahead", "Up and to the right"],
        size: ["About life-size", "Small, like a postcard"],
        distance: ["Close, almost touching distance", "Across the room from me"],
        brightness: ["Bright, really vivid", "Kind of dim and faded"],
        perspective: ["Through my own eyes", "Watching myself, like a movie of me"],
      },
      auditory: {
        source: ["My own voice", "Someone I know well"],
        volume: ["Quiet", "Loud"],
        location: ["Inside my head", "Off to my right"],
      },
      kinesthetic: {
        bodyLocation: ["In my stomach", "Right across my chest"],
        intensity: ["A 6 out of 10", "Very strong, maybe 9"],
        movement: ["Moving, rising up", "Still, it stays put"],
      },
    },
  },
};

// ── building a question ─────────────────────────────────────────────────────

export type QuestionContext =
  | { kind: "choose-state" }
  | { kind: "memory"; state: StateRef }
  | { kind: "first-step"; state: StateRef }
  | { kind: "next-step"; state: StateRef; stepIndex: number }
  | { kind: "modality"; state: StateRef; stepIndex: number }
  | { kind: "submodality"; state: StateRef; stepIndex: number; modality: SensoryModality; attribute: string }
  | { kind: "fully-in"; state: StateRef; stepIndex: number }
  | { kind: "anchor"; state: StateRef; steps: string[] }
  | { kind: "confirm"; state: StateRef; steps: string[] };

function fill(text: string, state: StateRef): string {
  return text.replaceAll("{state}", state.phrase);
}

function fillPair(pair: Pair, state: StateRef): [string, string] {
  return [fill(pair[0], state), fill(pair[1], state)];
}

/** The two step suggestions for a step index: step 1 has its own, later steps cycle so neighbours differ. */
export function stepSuggestions(key: SuggestionSetKey, stepIndex: number): Pair {
  const set = SUGGESTIONS[key];
  if (stepIndex <= 0) return set.firstStep;
  return set.nextSteps[(stepIndex - 1) % set.nextSteps.length];
}

function shorten(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return (at > max / 2 ? cut.slice(0, at) : cut) + "…";
}

const PRONOUNS: Record<string, string> = {
  i: "you",
  "i'm": "you're",
  "i've": "you've",
  "i'd": "you'd",
  "i'll": "you'll",
  me: "you",
  my: "your",
  mine: "yours",
  myself: "yourself",
};

/**
 * One step as the guide plays it back: "I saw the light" becomes "you saw the light".
 * Only the lead-in up to the first comma changes person, so quoted self-talk stays in the person's own words.
 * A step that does not start with "I" is quoted as said.
 */
export function playbackPhrase(content: string): string {
  const text = content.trim().replace(/[.!?]+$/, "");
  const m = /^(?:and |then |so )*i\s+(.*)$/is.exec(text);
  if (!m) return `“${text}”`;
  const rest = m[1];
  const comma = rest.search(/[,:;“"]/);
  const head = comma === -1 ? rest : rest.slice(0, comma);
  const tail = comma === -1 ? "" : rest.slice(comma);
  const swapped = head
    .replace(/^(am|was)\b/i, (w) => (w.toLowerCase() === "am" ? "are" : "were"))
    .replace(/[A-Za-z']+/g, (w) => PRONOUNS[w.toLowerCase()] ?? w);
  return `you ${swapped}${tail}`;
}

/** "first you saw the light, then you said to yourself, this is enough, and then you felt your shoulders drop" */
export function playbackLine(steps: string[]): string {
  const parts = steps.map(playbackPhrase);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `first ${parts[0]}`;
  const middle = parts.slice(1, -1).map((p) => `then ${p}`);
  return [`first ${parts[0]}`, ...middle, `and then ${parts[parts.length - 1]}`].join(", ");
}

function submodalityChoices(modality: SensoryModality, attribute: string): Choice[] {
  if (modality === "kinesthetic" && attribute === "intensity") {
    return INTENSITY_CHOICES.map((n) => ({ value: String(n), label: String(n) }));
  }
  const vocab = (SUBMODALITIES[modality].core as Record<string, readonly string[] | null>)[attribute];
  if (!vocab) return [];
  return vocab.map((value) => ({ value, label: valueLabel(modality, attribute, value) }));
}

/** The question for a point in the flow, filled in for the state and step. */
export function buildQuestion(ctx: QuestionContext): Question {
  switch (ctx.kind) {
    case "choose-state":
      return {
        id: "choose-state",
        kind: "choose-state",
        text: TEXT.chooseState,
        choices: PRESET_STATES.map((s) => ({ value: s.value, label: s.label })),
        suggestions: [...CHOOSE_STATE_SUGGESTIONS],
        section: "strategy",
      };
    case "memory":
      return {
        id: "memory",
        kind: "memory",
        text: fill(TEXT.memory, ctx.state),
        choices: [{ value: "there", label: "I'm there" }],
        suggestions: fillPair(SUGGESTIONS[ctx.state.key].memory, ctx.state),
        section: "strategy",
      };
    case "first-step":
      return {
        id: "first-step",
        kind: "first-step",
        text: fill(TEXT.firstStep, ctx.state),
        choices: [],
        suggestions: fillPair(stepSuggestions(ctx.state.key, 0), ctx.state),
        section: "strategy",
      };
    case "next-step":
      return {
        id: `next-step:${ctx.stepIndex}`,
        kind: "next-step",
        text: fill(TEXT.nextStep, ctx.state),
        choices: [],
        suggestions: fillPair(stepSuggestions(ctx.state.key, ctx.stepIndex), ctx.state),
        section: "strategy",
      };
    case "modality":
      return {
        id: `modality:${ctx.stepIndex}`,
        kind: "modality",
        text: TEXT.modality,
        choices: MODALITY_CHOICES.map((c) => ({ ...c })),
        suggestions: fillPair(SUGGESTIONS[ctx.state.key].modality, ctx.state),
        section: "strategy",
      };
    case "submodality": {
      const q = SUB_QUESTIONS[ctx.modality][ctx.attribute];
      if (!q) throw new Error(`no core question for ${ctx.modality}.${ctx.attribute}`);
      return {
        id: `sub:${ctx.modality}:${ctx.attribute}:${ctx.stepIndex}`,
        kind: "submodality",
        text: q.text,
        choices: submodalityChoices(ctx.modality, ctx.attribute),
        suggestions: fillPair(SUGGESTIONS[ctx.state.key].submodality[ctx.modality][ctx.attribute], ctx.state),
        target: { stepIndex: ctx.stepIndex, modality: ctx.modality, attribute: ctx.attribute },
        section: "submodalities",
      };
    }
    case "fully-in":
      return {
        id: `fully-in:${ctx.stepIndex}`,
        kind: "fully-in",
        text: fill(TEXT.fullyIn, ctx.state),
        choices: [
          { value: "yes", label: fill("Fully {state}", ctx.state) },
          { value: "no", label: "There was a next thing" },
        ],
        suggestions: fillPair(SUGGESTIONS[ctx.state.key].fullyIn, ctx.state),
        section: "strategy",
      };
    case "anchor":
      return {
        id: "anchor",
        kind: "anchor",
        text: fill(TEXT.anchor, ctx.state),
        choices: ctx.steps.map((content, i) => ({ value: String(i), label: `${i + 1}. ${shorten(content, 48)}` })),
        suggestions: fillPair(SUGGESTIONS[ctx.state.key].anchor, ctx.state),
        section: "submodalities",
      };
    case "confirm":
      return {
        id: "confirm",
        kind: "confirm",
        text: TEXT.confirm.replace("{playback}", playbackLine(ctx.steps)),
        choices: [
          { value: "yes", label: "Yes, that's the order" },
          { value: "no", label: "No, let's go again" },
        ],
        suggestions: fillPair(SUGGESTIONS[ctx.state.key].confirm, ctx.state),
        section: "playback",
      };
  }
}

/** Every question the bank can produce, for each suggestion set and step up to maxSteps. Used by tests and the harness. */
export function everyQuestion(maxSteps = 6): Question[] {
  const out: Question[] = [buildQuestion({ kind: "choose-state" })];
  const keys: SuggestionSetKey[] = ["content", "destressed", "generic"];
  const modalities: SensoryModality[] = ["visual", "auditory", "kinesthetic"];
  for (const key of keys) {
    const state: StateRef = { key, phrase: key === "generic" ? "calm before a pitch" : key };
    out.push(buildQuestion({ kind: "memory", state }), buildQuestion({ kind: "first-step", state }));
    for (let i = 0; i < maxSteps; i++) {
      if (i > 0) out.push(buildQuestion({ kind: "next-step", state, stepIndex: i }));
      out.push(buildQuestion({ kind: "modality", state, stepIndex: i }));
      for (const modality of modalities) {
        for (const attribute of coreAttributes(modality)) {
          out.push(buildQuestion({ kind: "submodality", state, stepIndex: i, modality, attribute }));
        }
      }
      out.push(buildQuestion({ kind: "fully-in", state, stepIndex: i }));
    }
    const steps = ["I saw the light", "I said to myself, this is it", "I felt my shoulders drop"];
    out.push(buildQuestion({ kind: "anchor", state, steps }), buildQuestion({ kind: "confirm", state, steps }));
  }
  return out;
}

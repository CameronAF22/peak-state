// Answer parsing for the question engine. Deterministic keyword and synonym maps, no model.
// A choice button value always wins over parsing the words.

import { SUBMODALITIES, type Direction, type SensoryModality, type StateId } from "@peak-state/contracts";
import type { PresetState } from "../types.ts";

type Rule<V> = readonly [V, RegExp];

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

/** The rule whose pattern matches earliest in the text; ties go to the longest match, then to list order. */
function earliest<V>(text: string, rules: readonly Rule<V>[]): V | null {
  const t = normalise(text);
  let best: { value: V; index: number; length: number } | null = null;
  for (const [value, re] of rules) {
    const m = re.exec(t);
    if (!m) continue;
    if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length)) {
      best = { value, index: m.index, length: m[0].length };
    }
  }
  return best ? best.value : null;
}

// ── modality and direction ──────────────────────────────────────────────────

const MODALITY_RULES: readonly Rule<SensoryModality>[] = [
  ["visual", /\b(saw|see|sees|seeing|seen|look|looks|looked|looking|picture|pictures|pictured|picturing|image|images|light|watch|watched|watching|vision|visualis\w*|visualiz\w*|colou?rs?|bright)\b/],
  ["auditory", /\b(heard|hear|hears|hearing|said|say|says|saying|told|tell|tells|telling|voice|voices|sound|sounds|sounded|music|song|songs|listen|listened|listening|whisper\w*|talk|talked|talking|spoke|noise)\b/],
  ["kinesthetic", /\b(felt|feel|feels|feeling|touch|touched|warm|warmth|breath|breathe|breathed|breathing|body|shoulders?|chest|stomach|belly|gut|jaw|hands?|relax|relaxed|relaxing|tension|tense|tight|tightness|heavy|lighter|loose|loosen|loosened|sink|sank|settle|settled)\b/],
];

/** The sense a step answer describes, from the earliest sense word. Null when no sense word is present. */
export function inferModality(text: string): SensoryModality | null {
  return earliest(text, MODALITY_RULES);
}

const DIRECTION_RULES: readonly Rule<Direction>[] = [
  ["internal", /\b(to myself|told myself|myself|in my (mind|head)|in my mind's eye|imagin\w*|pictur\w*|remember\w*|thought|thinking)\b/],
  ["external", /\b(out loud|in front of me|around me|outside|on my (skin|face|hands)|the air|someone|somebody|touch\w*)\b/],
];

/**
 * Outside or inside. The first step defaults to external and later steps to internal, as the playbook expects,
 * unless the words carry a clear cue ("to myself", "in my mind", "out loud", "in front of me").
 */
export function inferDirection(text: string, stepIndex: number): Direction {
  return earliest(text, DIRECTION_RULES) ?? (stepIndex === 0 ? "external" : "internal");
}

// ── submodalities ───────────────────────────────────────────────────────────

const LEFT = /\b(the|my) left\b|\bleft[- ]hand\b|\bleft side\b|^left\b/;
const RIGHT = /\b(the|my) right\b|\bright[- ]hand\b|\bright side\b|^right\.?$/;

const SUB_RULES: Record<SensoryModality, Record<string, readonly Rule<string>[]>> = {
  visual: {
    location: [
      ["upper-left", /\b(upper|top) left\b|\bup (and )?(to the )?left\b/],
      ["upper-right", /\b(upper|top) right\b|\bup (and )?(to the )?right\b/],
      ["lower-left", /\b(lower|bottom) left\b|\bdown (and )?(to the )?left\b/],
      ["lower-right", /\b(lower|bottom) right\b|\bdown (and )?(to the )?right\b/],
      ["all-around", /\ball around\b|\beverywhere\b|\bsurround\w*|\b360\b/],
      ["center", /\b(center|centre|centred|centered|middle|straight ahead|in front|ahead of me|dead ahead)\b/],
      ["left", LEFT],
      ["right", RIGHT],
      ["above", /\babove\b|\boverhead\b|\bup high\b|\bhigh up\b|\bat the top\b/],
      ["below", /\bbelow\b|\bdown low\b|\bbeneath\b|\bunder(neath)?\b|\bat the bottom\b/],
    ],
    size: [
      ["larger-than-life", /\b(larger|bigger) than life\b|\bhuge\b|\benormous\b|\bmassive\b|\bgiant\b|\bfills (everything|my whole view|the whole)\b|\bvast\b/],
      ["life-size", /\blife[- ]?size[d]?\b|\breal size\b|\bactual size\b|\bnormal size\b|\bfull size\b/],
      ["medium", /\bmedium\b|\bmid[- ]?size\w*\b|\bmoderate\b|\blike a (tv|screen|window|painting)\b/],
      ["small", /\bsmall\b|\btiny\b|\blittle\b|\bpostcard\b|\bphoto\b|\bminiature\b/],
    ],
    distance: [
      ["close", /\bclose\b|\bnear\b|\bup close\b|\bright in front\b|\btouching distance\b/],
      ["arm-length", /\barm'?s'? ?length\b|\barm length\b|\bwithin reach\b|\ban arm away\b/],
      ["across-room", /\bacross (the|a) room\b|\bfew (feet|metres|meters|steps)\b|\bacross the table\b|\bother side of the room\b|\bmiddle distance\b/],
      ["far", /\bfar\b|\bfurther\b|\bfarther\b|\bdistant\b|\bin the distance\b|\bhorizon\b|\bmiles\b|\bway off\b/],
    ],
    brightness: [
      ["bright", /\bbright\w*\b|\bvivid\b|\bdaylight\b|\bsunny\b|\bsunlit\b|\bglow\w*\b|\bbrilliant\b|\bdazzling\b|\blit up\b/],
      ["dim", /\bdim\w*\b|\bdark\w*\b|\bfaded?\b|\bdusk\w*\b|\bmuted\b|\bshadow\w*\b|\blow light\b|\bcandle\w*\b/],
      ["normal", /\bnormal\b|\bordinary\b|\bin[- ]between\b|\bregular\b|\bnatural\b|\beveryday\b|\bmedium\b/],
    ],
    perspective: [
      ["associated", /\b(through|from) my (own )?eyes\b|\bmy own eyes\b|\bi'?m in it\b|\bi am in it\b|\binside it\b|\bfirst[- ]person\b|\bas if i'?m there\b/],
      ["dissociated", /\b(watching|watch|see|seeing|saw) myself\b|\bfrom (the )?outside\b|\bthird[- ]person\b|\blike a (film|movie) of me\b|\bi can see me\b/],
    ],
  },
  auditory: {
    volume: [
      ["quiet", /\bquiet\w*\b|\bsoft(ly)?\b|\bgentle\b|\bwhisper\w*\b|\bhushed\b|\bfaint\b|\bbarely\b|\bunder my breath\b/],
      ["loud", /\bloud\w*\b|\bbooming\b|\bblasting\b|\bfull volume\b/],
      ["normal", /\bnormal\b|\bregular\b|\bconversation\w*\b|\btalking volume\b|\bspeaking voice\b|\bordinary\b|\bmedium\b|\bin[- ]between\b/],
    ],
    location: [
      ["inside-head", /\b(inside|in) my head\b|\bin my mind\b|\binside\b/],
      ["all-around", /\ball around\b|\beverywhere\b|\bsurround\w*/],
      ["front", /\bin front\b|\bahead\b|\bfront\b/],
      ["behind", /\bbehind\b|\bfrom the back\b/],
      ["left", LEFT],
      ["right", RIGHT],
      ["above", /\babove\b|\boverhead\b|\bup high\b|\bfrom up\b/],
    ],
  },
  kinesthetic: {
    bodyLocation: [
      ["whole-body", /\bwhole body\b|\ball over\b|\beverywhere\b|\bentire body\b|\bhead to toe\b|\bthrough me\b/],
      ["head", /\bhead\b|\bforehead\b/],
      ["face", /\bface\b|\bjaw\b|\bcheeks?\b|\bmouth\b/],
      ["throat", /\bthroat\b|\bneck\b/],
      ["chest", /\bchest\b|\bheart\b|\bribs\b|\blungs?\b/],
      ["stomach", /\bstomach\b|\bbelly\b|\bgut\b|\btummy\b|\babdomen\b/],
      ["shoulders", /\bshoulders?\b/],
      ["arms", /\barms?\b/],
      ["hands", /\bhands?\b|\bfingers?\b|\bpalms?\b/],
      ["back", /\b(my|the|lower|upper) back\b|\bspine\b/],
      ["legs", /\blegs?\b|\bknees?\b|\bthighs?\b/],
      ["feet", /\bfeet\b|\bfoot\b|\btoes\b/],
    ],
    movement: [
      ["still", /\bstill\b|\bsteady\b|\bsettled\b|\bstays? (put|there)\b|\bnot moving\b|\bsolid\b|\bresting\b/],
      ["moving", /\bmov(e|es|ing|ement)\b|\bspread\w*\b|\bflow\w*\b|\bris(es|ing)\b|\bwash\w*\b|\bpuls\w*\b|\bmelt\w*\b|\bripple\w*\b|\bswirl\w*\b|\bbuzz\w*\b|\btingl\w*\b|\bwaves?\b|\bdrift\w*\b|\bsinking\b/],
    ],
  },
};

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const INTENSITY_PHRASES: readonly Rule<number>[] = [
  [10, /\b(max|maximum|off the charts|totally|completely|as strong as it gets)\b/],
  [8, /\b(very|really|super) strong\b|\bintense\b|\bpowerful\b/],
  [7, /\b(pretty |quite )?strong\b/],
  [5, /\bmoderate\b|\bmedium\b|\bmiddle\b|\bhalfway\b/],
  [3, /\bmild\b|\bgentle\b|\bslight\b|\bfaint\b|\bsoft\b|\bsubtle\b/],
];

/** 0..10 from the first integer, else the first number word, else a strength phrase ("very strong" is 8). */
export function parseIntensity(text: string): number | null {
  const t = normalise(text);
  const digit = /\b(10|[0-9])\b/.exec(t);
  if (digit) return Number(digit[1]);
  const word = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(t);
  if (word) return NUMBER_WORDS[word[1]];
  return earliest(t, INTENSITY_PHRASES);
}

function coreVocab(modality: SensoryModality, attribute: string): readonly string[] | null | undefined {
  return (SUBMODALITIES[modality].core as Record<string, readonly string[] | null>)[attribute];
}

/** True when the value is allowed for this core attribute. */
export function isCoreValue(modality: SensoryModality, attribute: string, value: unknown): boolean {
  const vocab = coreVocab(modality, attribute);
  if (vocab === undefined) return false;
  if (modality === "kinesthetic" && attribute === "intensity") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;
  }
  if (vocab === null) return typeof value === "string" && value.trim().length > 0;
  return typeof value === "string" && vocab.includes(value);
}

/**
 * A core submodality value from the person's words, or null when it cannot be read.
 * Auditory source is free text, so any non-empty answer is the value. A valid choice value wins.
 */
export function parseSubmodality(
  modality: SensoryModality,
  attribute: string,
  text: string,
  choiceValue?: string,
): string | number | null {
  const vocab = coreVocab(modality, attribute);
  if (vocab === undefined) return null;
  const isIntensity = modality === "kinesthetic" && attribute === "intensity";

  if (choiceValue !== undefined) {
    const v = isIntensity ? Number(choiceValue) : choiceValue;
    if (isCoreValue(modality, attribute, v)) return v;
  }
  if (isIntensity) return parseIntensity(text);
  if (vocab === null) {
    const t = text.trim();
    return t.length > 0 ? t : null;
  }
  const rules = SUB_RULES[modality][attribute];
  return rules ? earliest(text, rules) : null;
}

// ── yes / no, anchor, state ─────────────────────────────────────────────────

const YES_NO: readonly Rule<"yes" | "no">[] = [
  ["no", /\b(no|nope|nah|not yet|not fully|not quite|not really|there was a next|next thing|one more|something else|after that|different)\b/],
  ["yes", /\b(yes|yeah|yep|yup|fully|that's it|that was it|that's right|correct|exactly|i was there|all the way)\b/],
];

/** "yes", "no", or null when the answer does not say. A choice value of "yes" or "no" wins. */
export function parseYesNo(text: string, choiceValue?: string): "yes" | "no" | null {
  if (choiceValue === "yes" || choiceValue === "no") return choiceValue;
  return earliest(text, YES_NO);
}

const ORDINALS: readonly Rule<number | "last">[] = [
  [0, /\b(first|1st|step one|number one|step 1)\b/],
  [1, /\b(second|2nd|step two|number two|step 2)\b/],
  [2, /\b(third|3rd|step three|number three|step 3)\b/],
  [3, /\b(fourth|4th|step four|number four|step 4)\b/],
  [4, /\b(fifth|5th|step five|number five|step 5)\b/],
  [5, /\b(sixth|6th|step six|number six|step 6)\b/],
  ["last", /\b(last|final|the end)\b/],
];

const MODALITY_NOUNS: readonly Rule<SensoryModality>[] = [
  ["visual", /\b(picture|image|seeing|saw|see|sight)\b/],
  ["auditory", /\b(sound|voice|words|saying|said|heard|hearing|self-talk)\b/],
  ["kinesthetic", /\b(feeling|felt|body|touch)\b/],
];

/**
 * Which step the person picked as the anchor: a valid choice index, an ordinal ("the first one", "the last one"),
 * a sense ("the feeling"), or a step whose words they repeat. Null when none fits.
 */
export function parseAnchor(
  text: string,
  steps: readonly { content: string; modality: SensoryModality | "other" | null }[],
  choiceValue?: string,
): number | null {
  const n = steps.length;
  if (n === 0) return null;
  if (choiceValue !== undefined && /^\d+$/.test(choiceValue)) {
    const i = Number(choiceValue);
    if (i >= 0 && i < n) return i;
  }
  const ord = earliest(text, ORDINALS);
  if (ord === "last") return n - 1;
  if (typeof ord === "number" && ord < n) return ord;

  const mod = earliest(text, MODALITY_NOUNS);
  if (mod) {
    const i = steps.findIndex((s) => s.modality === mod);
    if (i !== -1) return i;
  }

  const words = new Set(normalise(text).split(/[^a-z']+/).filter((w) => w.length > 3));
  let best = -1;
  let bestScore = 0;
  steps.forEach((s, i) => {
    const score = normalise(s.content)
      .split(/[^a-z']+/)
      .filter((w) => w.length > 3 && words.has(w)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best === -1 ? null : best;
}

export interface StateChoice {
  preset: PresetState | null;
  id: StateId;
  /** Short, in the person's words (or the preset's label). */
  label: string;
  /** What goes into {state} in the questions. */
  phrase: string;
  /** How they said it. */
  words: string;
}

const PRESET_LABEL: Record<PresetState, string> = { content: "Content", destressed: "Destressed" };

/** A state id from a label: lower-case, dashes, starts with a letter, at most 32 characters. */
export function slugify(label: string): StateId {
  let s = normalise(label)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z]/.test(s)) s = `s-${s}`.replace(/-+$/, "");
  s = s.slice(0, 32).replace(/-+$/, "");
  return s.length > 0 && s !== "s" ? s : "state";
}

function presetFrom(lead: string): PresetState | null {
  if (/^content(ed)?\b/.test(lead)) return "content";
  if (/^(de-?stress(ed)?|un-?stressed|stress[- ]free)\b/.test(lead)) return "destressed";
  return null;
}

/**
 * The state from the answer to "What state do you want to choose?". A preset button, an answer that starts with a
 * preset word ("Content, settled and easy"), or any other words as a custom state. Null for an empty answer.
 */
export function parseStateChoice(text: string, choiceValue?: string): StateChoice | null {
  const words = text.trim();
  if (choiceValue === "content" || choiceValue === "destressed") {
    return { preset: choiceValue, id: choiceValue, label: PRESET_LABEL[choiceValue], phrase: choiceValue, words: words || PRESET_LABEL[choiceValue] };
  }
  const lead = words
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^(i('d| would)? (want|like|wanna) to (be|feel)|i want to|to (be|feel)|feeling|being)\s+/i, "")
    .replace(/^(totally|really|more|very|just)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  if (!lead) return null;
  const preset = presetFrom(lead.toLowerCase());
  if (preset) return { preset, id: preset, label: PRESET_LABEL[preset], phrase: preset, words };
  let label = lead.length > 40 ? lead.slice(0, 40).replace(/\s+\S*$/, "") : lead;
  if (!label) label = lead.slice(0, 40);
  const phrase = /^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
  return { preset: null, id: slugify(label), label, phrase, words };
}

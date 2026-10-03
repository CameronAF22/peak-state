// The playback script: the person's own strategy, spoken back as short, gentle instructions in their order,
// ending on the anchor step. Pure and deterministic, so the same profile always yields the same lines and hash.

import { getState, repSteps, type ProfileV2, type State, type Step, type StateId } from "@peak-state/contracts";

export type PlaybackLineKind = "intro" | "step" | "anchor";

export interface PlaybackLine {
  kind: PlaybackLineKind;
  /** Index into strategy.steps; -1 for the intro. */
  stepIndex: number;
  text: string;
}

// ── wording helpers ─────────────────────────────────────────────────────────

const SWAPS: [RegExp, string][] = [
  [/\bI am\b/g, "you are"],
  [/\bI'm\b/g, "you're"],
  [/\bI've\b/g, "you've"],
  [/\bI'll\b/g, "you'll"],
  [/\bI'd\b/g, "you'd"],
  [/\bI was\b/g, "you were"],
  [/\bI\b/g, "you"],
  [/\bmyself\b/gi, "yourself"],
  [/\bmine\b/gi, "yours"],
  [/\bmy\b/gi, "your"],
  [/\bme\b/gi, "you"],
];

/** Turn the person's first-person words into the guide's second person, leaving quoted self-talk untouched. */
export function toSecondPerson(text: string): string {
  // Split on quoted segments ('…', "…", ‘…’, “…”); only the even (unquoted) parts are rewritten.
  const parts = text.split(/("[^"]*"|“[^”]*”|‘[^’]*’|(?<![A-Za-z])'(?:[^']|(?<=[A-Za-z])'(?=[A-Za-z]))*'(?![A-Za-z]))/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let out = part;
      for (const [re, to] of SWAPS) out = out.replace(re, to);
      return out;
    })
    .join("")
    .trim();
}

/**
 * The person's own phrasing for one detail, ready to drop mid-sentence: "It's close, right in front of me"
 * becomes "close, right in front of you". Undefined when they only picked the plain label (the vocabulary
 * phrase reads better then) or gave no words.
 */
function words(step: Step, attribute: string): string | undefined {
  const raw = step.submodalities.words?.[attribute]?.trim();
  if (!raw) return undefined;
  const core = (step.submodalities as { core?: Record<string, unknown> }).core ?? {};
  const value = core[attribute];
  const plain = raw.toLowerCase().replace(/[.!]+$/, "");
  if (value !== undefined && (plain === String(value).toLowerCase() || plain === String(value).replace(/-/g, " ").toLowerCase())) return undefined;
  if (/^[a-z -]{1,24}$/i.test(raw) && raw.split(/\s+/).length <= 3) return raw.toLowerCase(); // a bare label such as "Head"
  const trimmed = raw.replace(/^(?:it'?s|it is|it was|they'?re|they are|they were)\s+/i, "").replace(/[.!]+$/, "");
  return lowerFirst(toSecondPerson(trimmed));
}

/** Drop the "I saw / I heard / I felt" opener so the guide's own verb leads: "I felt my shoulders drop" → "your shoulders drop". */
export function stripPerception(content: string): { text: string; selfTalk: boolean } {
  const t = content.trim();
  const said = t.match(/^I\s+(?:said|say|told|tell)\s+(?:to\s+)?myself,?\s*(.+)$/i);
  if (said) return { text: said[1].replace(/^["'‘“]|["'’”]$/g, "").trim(), selfTalk: true };
  const stripped = t.replace(/^(?:I|you)\s+(?:could\s+|can\s+|would\s+|just\s+)?(?:saw|see|seen|noticed|notice|heard|hear|felt|feel|sensed|sense|watched|watch|looked at|look at)\s+/i, "");
  return { text: stripped.replace(/^(?:I'm|I am|I was)\s+/i, ""), selfTalk: false };
}

const VISUAL_PHRASES: Record<string, Record<string, string>> = {
  distance: { close: "close", "arm-length": "about an arm's length away", "across-room": "across the room", far: "far off" },
  brightness: { dim: "dim", normal: "as bright as it was", bright: "bright" },
  size: { small: "small", medium: "medium-sized", "life-size": "life-size", "larger-than-life": "larger than life" },
};

const VOLUME: Record<string, string> = { quiet: "quietly", normal: "at an easy volume", loud: "loud and clear" };
const MOVEMENT: Record<string, string> = { still: "still and steady", moving: "and let it move" };

function phrase(map: Record<string, string>, value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return map[value] ?? value.replace(/-/g, " ");
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const up = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?…]$/.test(up) ? up : `${up}.`;
}

/** "close, dim and small". Items that already hold a comma keep the list readable with a final ", and". */
function joinList(items: (string | undefined)[]): string {
  const xs = items.filter((x): x is string => Boolean(x));
  if (xs.length <= 1) return xs.join("");
  const sep = xs.some((x) => x.includes(",")) ? ", and " : " and ";
  return `${xs.slice(0, -1).join(", ")}${sep}${xs[xs.length - 1]}`;
}

/** The verb that opens a step, by sense. */
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

/** One instruction for one step, using the person's words and the core details they gave. */
export function stepLine(step: Step): string {
  const { text: bare, selfTalk } = stripPerception(step.content);
  const content = selfTalk ? `'${bare}'` : lowerFirst(toSecondPerson(bare));
  switch (step.modality) {
    case "visual": {
      const core = step.submodalities.core ?? {};
      const details = joinList([
        words(step, "distance") ?? phrase(VISUAL_PHRASES.distance, core.distance),
        words(step, "brightness") ?? phrase(VISUAL_PHRASES.brightness, core.brightness),
        words(step, "size") ?? phrase(VISUAL_PHRASES.size, core.size),
      ]);
      return details ? `${sentence(`See ${content}`)} Bring it ${details}.` : sentence(`See ${content}`);
    }
    case "auditory": {
      const core = step.submodalities.core ?? {};
      const source = core.source ? toSecondPerson(core.source) : selfTalk ? "your own voice" : undefined;
      const volume = words(step, "volume") ?? phrase(VOLUME, core.volume);
      const head = source && !content.toLowerCase().includes(source.toLowerCase()) ? `Hear ${lowerFirst(source)} say ${content}` : `Hear ${content}`;
      return sentence(volume ? `${head}, ${volume}` : head);
    }
    case "kinesthetic": {
      const core = step.submodalities.core ?? {};
      const where = words(step, "bodyLocation") ?? (core.bodyLocation ? core.bodyLocation.replace(/-/g, " ") : undefined);
      const mentioned = where ? content.toLowerCase().includes(where.toLowerCase()) : true;
      const place = where && !mentioned ? (core.bodyLocation === "whole-body" && !words(step, "bodyLocation") ? " through your whole body" : ` in your ${where}`) : "";
      const movement = words(step, "movement") ?? phrase(MOVEMENT, core.movement);
      return sentence(`Feel ${content}${place}${movement ? `, ${movement}` : ""}`);
    }
    default:
      return sentence(`Notice ${content}`);
  }
}

function anchorLine(step: Step): string {
  const { text, selfTalk } = stripPerception(step.content);
  const what = selfTalk ? `yourself say '${text}'` : lowerFirst(toSecondPerson(text));
  return `And now, just ${verb(step)} ${what} … and let it fill you.`;
}

function introLine(state: State): string {
  return `Let's run your ${state.label} strategy. Get comfortable, and follow along at your own pace.`;
}

/** The rating prompts shown and spoken before and after a run. */
export function ratingPrompt(state: State, when: "before" | "after"): string {
  return when === "before"
    ? `Before we start: how ${state.label} do you feel right now, from 0 to 10?`
    : `And now: how ${state.label} do you feel, from 0 to 10?`;
}

/**
 * The ordered playback lines for one state: an intro, one line per strategy step in the person's order
 * (up to fullyInAt), then a return to the anchor step. Throws if the state is not in the profile.
 */
export function buildPlaybackLines(profile: ProfileV2, stateId: StateId): PlaybackLine[] {
  const state = getState(profile, stateId);
  if (!state) throw new Error(`state ${stateId} is not in the profile`);
  const lines: PlaybackLine[] = [{ kind: "intro", stepIndex: -1, text: introLine(state) }];
  for (const i of repSteps(state)) {
    lines.push({ kind: "step", stepIndex: i, text: stepLine(state.strategy.steps[i]) });
  }
  const anchor = state.anchorStep;
  if (anchor !== null && state.strategy.steps[anchor]) {
    lines.push({ kind: "anchor", stepIndex: anchor, text: anchorLine(state.strategy.steps[anchor]) });
  }
  return lines;
}

/** A short, stable hash of the script (FNV-1a, 32 bit), so runs of the same script group together. */
export function scriptHash(lines: PlaybackLine[]): string {
  let h = 0x811c9dc5;
  const s = lines.map((l) => `${l.kind}|${l.stepIndex}|${l.text}`).join("\n");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, "0")}`;
}

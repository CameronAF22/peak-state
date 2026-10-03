// Fixed, neutral templates around the person's own words (D-reps-010).
// Nothing here adds content: every sentence carries a value from the profile.
// Values come from contracts' controlled vocabulary (SUBMODALITIES), so "life-size" reads "life size".

import type { Difference, SensoryModality, Step } from "./shapes.ts";

type Phrase = (value: string) => string;
type Modality = Step["modality"];

const lead: Record<Modality, Record<"external" | "internal", Phrase>> = {
  visual: { external: (c) => `See ${c}.`, internal: (c) => `Picture ${c}.` },
  auditory: { external: (c) => `Hear ${c}.`, internal: (c) => `Say to yourself ${c}.` },
  kinesthetic: { external: (c) => `Feel ${c}.`, internal: (c) => `Feel ${c}.` },
  other: { external: (c) => `Notice ${c}.`, internal: (c) => `Notice ${c}.` },
};

const spaced = (v: string) => v.replace(/-/g, " ");

const inBody: Phrase = (v) => (/^(my|your|the|a|an)\s/i.test(v) ? `Feel it in ${v}.` : `Feel it in your ${spaced(v)}.`);

const PLACE: Record<string, string> = {
  center: "in the center",
  left: "to the left",
  right: "to the right",
  "upper-left": "up and to the left",
  "upper-right": "up and to the right",
  "lower-left": "down and to the left",
  "lower-right": "down and to the right",
  "all-around": "all around you",
};

const HEARD: Record<string, string> = {
  "inside-head": "inside your head",
  front: "in front of you",
  behind: "behind you",
  left: "on your left",
  right: "on your right",
  above: "above you",
  "all-around": "all around you",
};

const DISTANCE: Record<string, string> = {
  close: "Bring it close.",
  "arm-length": "Hold it at arm's length.",
  "across-room": "Put it across the room.",
  far: "Put it far away.",
};

// Per-modality attribute templates. Anything missing falls back to "Make it {v}."
const attribute: Record<SensoryModality, Record<string, Phrase>> = {
  visual: {
    location: (v) => `Put it ${PLACE[v] ?? spaced(v)}.`,
    distance: (v) => DISTANCE[v] ?? `Bring it ${spaced(v)}.`,
    perspective: (v) =>
      /^assoc/i.test(v) ? "See it through your own eyes." : /^dissoc/i.test(v) ? "Watch yourself in it." : `Make it ${spaced(v)}.`,
    motion: (v) => (/movie|moving/i.test(v) ? "Let it move." : /still/i.test(v) ? "Hold it still." : `Make it ${spaced(v)}.`),
    colour: (v) => (v === "colour" ? "Make it in colour." : `Make it ${spaced(v)}.`),
  },
  auditory: {
    source: (v) => `Hear it in ${v}.`,
    location: (v) => `Hear it ${HEARD[v] ?? spaced(v)}.`,
  },
  kinesthetic: {
    bodyLocation: inBody,
    intensity: (v) => `Turn it up to ${v}.`,
    movement: (v) => (v === "still" ? "Let it stay still." : `Let it keep ${spaced(v)}.`),
    direction: (v) => (/ing$/.test(v) ? `Let it keep ${v}.` : `Let it move ${v}.`),
  },
};

export function stepLead(step: Step): string {
  return lead[step.modality][step.direction](step.content.trim());
}

export function submodalityPhrase(modality: SensoryModality, name: string, value: string | number): string {
  const v = String(value).trim();
  const template = attribute[modality]?.[name];
  return template ? template(v) : `Make it ${spaced(v)}.`;
}

export function driverPhrase(difference: Difference): string {
  return submodalityPhrase(difference.modality, difference.attribute, difference.peak);
}

function coreEntries(step: Step): [string, string | number][] {
  if (step.modality === "other") return [];
  const core: Record<string, string | number | undefined> = step.submodalities.core ?? {};
  return Object.entries(core).filter((e): e is [string, string | number] => e[1] !== "" && e[1] !== null && e[1] !== undefined);
}

/** First core submodality of a step that has a value, as a phrase, or null. */
export function coreDetail(step: Step): string | null {
  return allCoreDetails(step)[0] ?? null;
}

export function allCoreDetails(step: Step): string[] {
  if (step.modality === "other") return [];
  const modality = step.modality;
  return coreEntries(step).map(([name, value]) => submodalityPhrase(modality, name, value));
}

export const rateBefore = (label: string) => `On a scale of 0 to 10, how strong is ${label} right now?`;
export const rateAfter = (label: string) => `And now, 0 to 10, how strong is ${label}?`;
export const peakLead = "Now, at full strength.";

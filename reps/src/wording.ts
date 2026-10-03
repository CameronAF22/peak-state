// Fixed, neutral templates around the person's own words (D-reps-010).
// Nothing here adds content: every sentence carries a value from the profile.

import type { Difference, Modality, StrategyStep } from "./shapes.ts";

type Phrase = (value: string) => string;

const lead: Record<Modality, Record<"external" | "internal", Phrase>> = {
  visual: { external: (c) => `See ${c}.`, internal: (c) => `Picture ${c}.` },
  auditory: { external: (c) => `Hear ${c}.`, internal: (c) => `Say to yourself ${c}.` },
  kinesthetic: { external: (c) => `Feel ${c}.`, internal: (c) => `Feel ${c}.` },
  olfactory: { external: (c) => `Smell ${c}.`, internal: (c) => `Smell ${c}.` },
  gustatory: { external: (c) => `Taste ${c}.`, internal: (c) => `Taste ${c}.` },
};

const inBody: Phrase = (v) => (/^(my|your|the|a|an)\s/i.test(v) ? `Feel it in ${v}.` : `Feel it in your ${v}.`);

// Per-modality attribute templates. Anything missing falls back to "Make it {v}."
const attribute: Partial<Record<Modality, Record<string, Phrase>>> = {
  visual: {
    location: (v) => `Put it ${v}.`,
    distance: (v) => `Bring it ${v}.`,
    perspective: (v) =>
      /^assoc/i.test(v) ? "See it through your own eyes." : /^dissoc/i.test(v) ? "Watch yourself in it." : `Make it ${v}.`,
    motion: (v) => (/movie|moving/i.test(v) ? "Let it move." : /still/i.test(v) ? "Hold it still." : `Make it ${v}.`),
  },
  auditory: {
    source: (v) => `Hear it in ${v}.`,
    location: (v) => `Hear it ${v}.`,
    inOut: (v) => `Hear it ${v}.`,
  },
  kinesthetic: {
    bodyLocation: inBody,
    intensity: (v) => `Turn it up to ${v}.`,
    movement: (v) => `Let it keep ${v}.`,
    direction: (v) => `Let it move ${v}.`,
  },
};

export function stepLead(step: StrategyStep): string {
  return lead[step.modality][step.direction](step.content.trim());
}

export function submodalityPhrase(modality: Modality, name: string, value: string | number): string {
  const v = String(value).trim();
  const template = attribute[modality]?.[name];
  return template ? template(v) : `Make it ${v}.`;
}

export function driverPhrase(difference: Difference): string {
  return submodalityPhrase(difference.modality, difference.attribute, difference.peak);
}

/** First core submodality of a step that has a value, as a phrase, or null. */
export function coreDetail(step: StrategyStep): string | null {
  for (const [name, value] of Object.entries(step.submodalities?.core ?? {})) {
    if (value !== "" && value !== null && value !== undefined) return submodalityPhrase(step.modality, name, value);
  }
  return null;
}

export function allCoreDetails(step: StrategyStep): string[] {
  return Object.entries(step.submodalities?.core ?? {})
    .filter(([, value]) => value !== "" && value !== null && value !== undefined)
    .map(([name, value]) => submodalityPhrase(step.modality, name, value));
}

export const rateBefore = (label: string) => `On a scale of 0 to 10, how strong is ${label} right now?`;
export const rateAfter = (label: string) => `And now, 0 to 10, how strong is ${label}?`;
export const peakLead = "Now, at full strength.";

// The per-turn stop-line screen (D-onboarding-009). Conservative keywords only: a hit stops elicitation.
// Peak State is a performance and state-recall tool, not therapy, diagnosis or a crisis service (README.md).

export type ScreenResult = { ok: true } | { ok: false; reason: string };

/** What the guide says when it stops. Shared so every surface uses the same words. */
export const STOP_MESSAGE =
  "It sounds like something heavy is going on, so let's stop here. Peak State is not the right support for this. " +
  "Please reach out to a person you trust, and if you are in danger or might hurt yourself, contact your local emergency services now.";

const STOP_LINES: readonly (readonly [string, RegExp])[] = [
  ["suicide", /\bsuicid\w*|\bkill(ing)? myself\b|\bend (it all|my life)\b|\b(want|wanted|wanting) to die\b|\bbetter off dead\b|\bno reason to live\b|\btake my (own )?life\b/],
  ["self-harm", /\bself[- ]?harm\w*|\b(hurt|hurting|harm|harming|cut|cutting) myself\b|\boverdos\w*/],
  ["abuse", /\babus(e|ed|er|ive|ing)\b|\bassault\w*|\brap(e|ed|ist)\b|\bmolest\w*|\bdomestic violence\b|\bbeat(s|ing)? me\b|\bhits? me\b/],
  ["panic", /\bpanic attacks?\b|\bpanicking\b|\bcan'?t breathe\b/],
  ["crisis", /\bcrisis\b|\bemergency\b|\bbreakdown\b|\bnot safe\b|\bunsafe\b|\bin danger\b|\bhopeless\b|\bflashbacks?\b|\btrauma\w*/],
];

/** Screen one answer. A hit returns the category as the reason. */
export function screenAnswer(text: string): ScreenResult {
  const t = text.toLowerCase().replace(/[’‘]/g, "'");
  for (const [reason, re] of STOP_LINES) {
    if (re.test(t)) return { ok: false, reason };
  }
  return { ok: true };
}

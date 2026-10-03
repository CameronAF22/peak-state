// A 0..10 closeness rating from what the person said or typed (D-onboarding-015).
// "7", "seven", "about a seven", "7 out of 10", "out of ten I'd say six", "6.5" (rounds to 7). Null when no number.

const WORDS: Record<string, number> = {
  zero: 0, nought: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** The text in lower case with the scale taken out, so "out of 10" or "8/10" never reads as the answer 10. */
export function stripScale(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    // Drop the scale itself so "out of 10" or "from 0 to 10" is never read as the answer.
    .replace(/\b(?:out of|from|scale of|scale from|between)\s+(?:0|1|zero|one)\s+(?:to|and)\s+(?:10|ten)\b/g, " ")
    .replace(/\b(?:on a|on the)\s+scale\b/g, " ")
    .replace(/\bout of\s+(?:10|ten)\b/g, " ")
    .replace(/\/\s*10\b/g, " ");
}

export function parseRating(text: string): number | null {
  const t = stripScale(text);
  // "one hundred", "100%": not a 0 to 10 answer.
  if (/\b(hundred|thousand|percent)\b|%|\b\d{3,}\b/.test(t)) return null;
  const digit = /(?<![\d.])(10|\d)(?:[.,](\d+))?(?![\d])/.exec(t);
  if (digit) {
    const n = Number(`${digit[1]}.${digit[2] ?? "0"}`);
    return n >= 0 && n <= 10 ? Math.round(n) : null;
  }
  const word = /\b(zero|nought|one|two|three|four|five|six|seven|eight|nine|ten)\b/.exec(t.replace(/\bnot one\b|\bno one\b|\bsomeone\b|\banyone\b|\bthat one\b|\bthis one\b/g, " "));
  if (word) return WORDS[word[1]];
  // "nothing", "not at all", "none" with no number: a zero, not a missing answer.
  if (/\b(nothing|none|not at all|no feeling|not even a little)\b/.test(t)) return 0;
  return null;
}

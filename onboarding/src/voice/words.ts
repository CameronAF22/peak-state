// Word splitting and timing for the spoken-word highlight (D-onboarding-021). Pure and deterministic.
// Adapters that know when each word is spoken report it (browser boundary events, GPT live audio); otherwise the
// page estimates: 2.6 words per second with a 1.0 s pause after each sentence (D-reps-010).

export interface WordToken {
  text: string;
  /** Character offset of the word in the line. */
  start: number;
  /** Character offset just after the word. */
  end: number;
}

export const WORDS_PER_SECOND = 2.6;
export const SENTENCE_PAUSE_MS = 1000;

/** The words of a line: runs of non-space characters, with their offsets. */
export function splitWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const start = m.index ?? 0;
    out.push({ text: m[0], start, end: start + m[0].length });
  }
  return out;
}

/** The word containing charIndex, or the next word after it (boundary events point at a word's first character). */
export function wordIndexAtChar(words: readonly WordToken[], charIndex: number): number {
  if (words.length === 0) return -1;
  for (let i = 0; i < words.length; i++) {
    if (charIndex < words[i].end) return i;
  }
  return words.length - 1;
}

/** True when a word ends a sentence: . ! ? or … , optionally followed by closing quotes or brackets. */
export function endsSentence(word: string): boolean {
  return /[.!?…]["'”’)\]]*$/.test(word);
}

export interface Timeline {
  /** When each word starts, in ms from the start of the line. */
  starts: number[];
  /** When the line is done, in ms. */
  total: number;
}

export interface PaceOptions {
  wordsPerSecond?: number;
  sentencePauseMs?: number;
}

/** The estimated start time of every word in the line. */
export function wordTimeline(words: readonly (WordToken | string)[], opts: PaceOptions = {}): Timeline {
  const perWord = 1000 / Math.max(0.1, opts.wordsPerSecond ?? WORDS_PER_SECOND);
  const pause = Math.max(0, opts.sentencePauseMs ?? SENTENCE_PAUSE_MS);
  const starts: number[] = [];
  let t = 0;
  words.forEach((w, i) => {
    starts.push(Math.round(t));
    t += perWord;
    const text = typeof w === "string" ? w : w.text;
    // No pause after the last word: the line is over.
    if (i < words.length - 1 && endsSentence(text)) t += pause;
  });
  return { starts, total: Math.round(t) };
}

/** The word being spoken at `ms` into the line: -1 before it starts, starts.length once it is over. */
export function wordAtTime(timeline: Timeline, ms: number): number {
  if (ms < 0) return -1;
  if (ms >= timeline.total) return timeline.starts.length;
  let i = 0;
  while (i + 1 < timeline.starts.length && timeline.starts[i + 1] <= ms) i++;
  return i;
}

/**
 * Map a word index in what was spoken to a word index in what is shown. The spoken line can carry more than the
 * shown text (a notice before a practice question) or say it differently. When the shown text appears inside the
 * spoken text the mapping is exact (-1 before it, shown.length after it); otherwise it is proportional.
 */
export function mapWordIndex(spoken: string, shown: string, spokenIndex: number): number {
  const shownWords = splitWords(shown);
  const spokenWords = splitWords(spoken);
  if (shownWords.length === 0 || spokenWords.length === 0) return -1;
  if (spoken === shown) return Math.min(spokenIndex, shownWords.length);
  const at = shown.trim() ? spoken.indexOf(shown.trim()) : -1;
  if (at >= 0) {
    const offset = wordIndexAtChar(spokenWords, at);
    const i = spokenIndex - offset;
    if (i < 0) return -1;
    return Math.min(i, shownWords.length);
  }
  if (spokenIndex >= spokenWords.length) return shownWords.length;
  return Math.min(shownWords.length - 1, Math.floor((spokenIndex / spokenWords.length) * shownWords.length));
}

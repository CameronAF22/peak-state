// The hint timer: when the person has not answered within the delay, show the question's two suggestions,
// so they can find language for the experience. UI-agnostic; the harness passes its own timer functions in tests.

import { HINT_DELAY_MS, type Question } from "../types.ts";

export interface HintTimerOptions {
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Start the timer for one question. Returns a cancel function; call it when the person answers or the question changes. */
export function startHintTimer(
  question: Question,
  onShow: (suggestions: [string, string]) => void,
  options: HintTimerOptions = {},
): () => void {
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let done = false;
  const handle = setTimer(() => {
    if (done) return;
    done = true;
    onShow(question.suggestions);
  }, options.delayMs ?? HINT_DELAY_MS);
  return () => {
    if (done) return;
    done = true;
    clearTimer(handle);
  };
}

// The hint timer: after `delayMs` with no typing and no partial transcript on a question,
// the question's two suggested phrasings are shown. Restarted on every bit of activity until it fires.

import { HINT_DELAY_MS } from "../types.ts";

export interface HintTimer {
  /** Start (or restart) the countdown for a newly shown question. Hides any shown hints. */
  start(questionId: string): void;
  /** The person did something (typed, partial transcript): restart the countdown unless hints already show. */
  activity(): void;
  /** Stop counting (question answered, flow left the question). */
  cancel(): void;
  readonly shown: boolean;
  readonly questionId: string | null;
}

/** ?hint=<ms> overrides the default delay (for tests and demos). */
export function hintDelayFromUrl(search: string = globalThis.location?.search ?? ""): number {
  const raw = new URLSearchParams(search).get("hint");
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : HINT_DELAY_MS;
}

export function createHintTimer(delayMs: number, onShow: (questionId: string) => void): HintTimer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let qid: string | null = null;
  let shown = false;

  const clear = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const arm = (): void => {
    clear();
    const id = qid;
    if (id === null) return;
    timer = setTimeout(() => {
      timer = null;
      if (qid !== id) return;
      shown = true;
      onShow(id);
    }, delayMs);
  };

  return {
    start(questionId) {
      qid = questionId;
      shown = false;
      arm();
    },
    activity() {
      if (!shown && qid !== null) arm();
    },
    cancel() {
      clear();
      qid = null;
      shown = false;
    },
    get shown() {
      return shown;
    },
    get questionId() {
      return qid;
    },
  };
}

// The spoken-word highlight (D-onboarding-021): while the guide speaks a line, the word being spoken carries a soft
// warm-white glow; spoken words return to normal and upcoming words sit slightly dimmer. Word timing comes from the
// voice adapter when it reports it (onWord), otherwise from the paced estimate in src/voice/words.ts, starting when
// the line appears. The line's text content never changes: each word is wrapped in a span, spaces stay text nodes.

import type { VoiceAdapter } from "../../types.ts";
import { mapWordIndex, splitWords, wordAtTime, wordTimeline } from "../../voice/words.ts";

interface Current {
  el: HTMLElement;
  text: string;
  spans: HTMLElement[];
  index: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** The adapter has reported a word for this line: the estimate stands down. */
  live: boolean;
}

/** How long to wait for the adapter's first word before estimating instead. */
const ADAPTER_GRACE_MS = 1600;

let voice: VoiceAdapter | null = null;
let current: Current | null = null;

function wrap(el: HTMLElement, text: string): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const w of splitWords(text)) {
    if (w.start > at) frag.append(text.slice(at, w.start));
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = w.text;
    frag.append(span);
    spans.push(span);
    at = w.end;
  }
  if (at < text.length) frag.append(text.slice(at));
  el.replaceChildren(frag);
  return spans;
}

function setIndex(c: Current, index: number): void {
  if (current !== c || index === c.index) return;
  c.index = index;
  c.spans.forEach((s, i) => {
    s.classList.toggle("now", i === index);
    s.classList.toggle("said", i < index);
  });
  if (index >= c.spans.length) finish(c);
}

function finish(c: Current): void {
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
  c.el.classList.remove("speaking");
  for (const s of c.spans) s.classList.remove("now", "said");
  if (current === c) current = null;
}

function estimate(c: Current, startedAt: number): void {
  const timeline = wordTimeline(c.spans.map((s) => s.textContent ?? ""));
  const tick = (): void => {
    if (current !== c || c.live) return;
    const elapsed = performance.now() - startedAt;
    const i = wordAtTime(timeline, elapsed);
    setIndex(c, Math.max(0, i));
    if (i >= timeline.starts.length) return;
    const next = i + 1 < timeline.starts.length ? timeline.starts[i + 1] : timeline.total;
    c.timer = setTimeout(tick, Math.max(16, next - elapsed));
  };
  tick();
}

/** Follow a newly shown line: wraps its words and starts highlighting them as they are spoken. */
export function followSpoken(el: HTMLElement, text: string): void {
  if (current) finish(current);
  const spans = wrap(el, text);
  if (spans.length === 0) return;
  const c: Current = { el, text, spans, index: -1, timer: null, live: false };
  current = c;
  el.classList.add("speaking");
  const startedAt = performance.now();
  if (!voice || voice.kind === "typed" || !voice.onWord) {
    estimate(c, startedAt);
    return;
  }
  // A real voice: wait for its word events, and estimate if none come (speech unavailable, no boundary events).
  c.timer = setTimeout(() => {
    if (current === c && !c.live) estimate(c, performance.now());
  }, ADAPTER_GRACE_MS);
}

/** Stop highlighting (the line was replaced or the run ended). */
export function clearSpoken(): void {
  if (current) finish(current);
}

/** Listen to a voice adapter's word progress. Returns an unsubscribe. */
export function attachSpokenVoice(v: VoiceAdapter): () => void {
  voice = v;
  const off = v.onWord?.((index, spokenText) => {
    const c = current;
    if (!c) return;
    const i = mapWordIndex(spokenText, c.text, index);
    if (i < 0) return; // a notice before the shown line
    if (!c.live) {
      c.live = true;
      if (c.timer) clearTimeout(c.timer);
      c.timer = null;
    }
    setIndex(c, i);
  });
  return () => {
    off?.();
    if (voice === v) voice = null;
  };
}

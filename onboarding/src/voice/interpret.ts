// Spoken-answer interpretation for GPT live (D-onboarding-028). Speech-to-text fragments are noisy: background sound,
// fillers, half sentences, misheard words. Before an answer reaches the engine, a small LLM reads the raw words with
// the question and its choices and returns its best guess at what the person meant, or says to keep waiting, or that
// it was not speech for this question. The same request and parsing run in the Worker and the local dev proxy.
// Pure helpers here; no secrets. The safety boundary in README.md applies: this only cleans up wording.

/** What the guide is waiting for, so recognition can adapt (shorter waits for a choice or a number). */
export interface AnswerContext {
  question: string;
  choices: string[];
  expects: "choice" | "number" | "open";
}

export interface Interpretation {
  verdict: "answer" | "incomplete" | "noise";
  /** The cleaned answer in the person's own words (empty unless verdict is "answer"). */
  text: string;
}

export const DEFAULT_INTERPRET_MODEL = "gpt-5.4-mini";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
export const MAX_HEARD_CHARS = 2000;

const FILLER = new Set(["um", "umm", "uh", "uhh", "er", "erm", "hmm", "hm", "mm", "mhm", "ah", "oh", "eh", "like", "so", "okay", "ok", "yeah", "well"]);
const TRAILING_UNFINISHED = /(?:\b(?:and|but|so|or|because|then|um+|uh+|er+|like|the|a|an|to|of|with|my|i|it's|it|was|is|when|that)|,|\.\.\.|…|-)\s*$/i;

/** Words in a line, lowercased, punctuation stripped. */
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
}

/** True when nothing but fillers or noise was heard. */
export function isFillerOnly(text: string): boolean {
  const words = wordsOf(text);
  return words.length === 0 || words.every((w) => FILLER.has(w));
}

/** True when the words stop mid-thought ("and then I…", "um", a trailing comma). */
export function looksUnfinished(text: string): boolean {
  return TRAILING_UNFINISHED.test(text.trim());
}

/**
 * How much of what the mic heard is the guide's own line coming back through the speakers (0..1): the share of heard
 * words that appear in the line. Full duplex keeps the mic open while the guide talks, so echo must be dropped.
 */
export function echoOverlap(heard: string, line: string): number {
  const h = wordsOf(heard);
  if (h.length === 0) return 0;
  const l = new Set(wordsOf(line));
  return h.filter((w) => l.has(w)).length / h.length;
}

const INSTRUCTIONS = [
  "You clean up speech-to-text for a guided voice exercise in a wellbeing practice app (not therapy).",
  "You get the question the guide just asked, any quick-pick choices, what kind of answer is expected, and the raw words the speech recogniser heard.",
  "The raw words may contain recognition errors, split or merged words, fillers, false starts, background speech, or the guide's own voice echoing.",
  'Return verdict "answer" with text set to your best guess at what the person meant, in their own words, lightly cleaned: fix misheard words using the question and choices as context, drop fillers and false starts, keep their meaning and phrasing. If they only named one of the choices, return that choice exactly as written; if they described it in their own words, keep their words (they are replayed to them later).',
  'Return verdict "incomplete" with empty text when they are clearly mid-sentence and likely to keep talking.',
  'Return verdict "noise" with empty text when the words are not an attempt to answer this question (background chatter, a cough or filler only, the guide\'s own words).',
  "Never add content they did not say, never answer for them, never give advice.",
].join(" ");

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "text"],
  properties: {
    verdict: { type: "string", enum: ["answer", "incomplete", "noise"] },
    text: { type: "string" },
  },
} as const;

/** The OpenAI Responses API request for one interpretation. */
export function buildInterpretRequest(model: string, ctx: AnswerContext, heard: string): Record<string, unknown> {
  return {
    model,
    reasoning: { effort: "none" },
    instructions: INSTRUCTIONS,
    input: JSON.stringify({
      question: ctx.question.slice(0, 600),
      choices: ctx.choices.slice(0, 20).map((c) => c.slice(0, 80)),
      expects: ctx.expects,
      heard: heard.slice(0, MAX_HEARD_CHARS),
    }),
    text: { format: { type: "json_schema", name: "spoken_answer", schema: SCHEMA, strict: true } },
    max_output_tokens: 300,
    store: false,
  };
}

/** Reads the structured answer out of a Responses API reply. Null when it is not usable. */
export function parseInterpretResponse(reply: unknown): Interpretation | null {
  const out = (reply as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] })?.output;
  if (!Array.isArray(out)) return null;
  for (const item of out) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c?.type !== "output_text" || typeof c.text !== "string") continue;
      try {
        const v = JSON.parse(c.text) as Partial<Interpretation>;
        if (v.verdict === "answer" || v.verdict === "incomplete" || v.verdict === "noise") {
          const text = typeof v.text === "string" ? v.text.trim() : "";
          if (v.verdict === "answer" && !text) return { verdict: "noise", text: "" };
          return { verdict: v.verdict, text: v.verdict === "answer" ? text : "" };
        }
      } catch {
        // not JSON
      }
    }
  }
  return null;
}

/** Validates the page's request body for the interpret route. */
export function readInterpretBody(body: unknown): { ctx: AnswerContext; heard: string } | null {
  const b = body as { question?: unknown; choices?: unknown; expects?: unknown; heard?: unknown } | null;
  if (!b || typeof b.heard !== "string" || !b.heard.trim() || b.heard.length > MAX_HEARD_CHARS) return null;
  const expects = b.expects === "choice" || b.expects === "number" ? b.expects : "open";
  const choices = Array.isArray(b.choices) ? b.choices.filter((c): c is string => typeof c === "string") : [];
  return { ctx: { question: typeof b.question === "string" ? b.question : "", choices, expects }, heard: b.heard };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface InterpreterOptions {
  /** Default "/api/answer/interpret" (the Worker, or the Vite dev server locally). */
  endpoint?: string;
  headers?: () => Record<string, string>;
  fetch?: FetchLike;
  /** Give up and use the raw words after this long. Default 4000 ms. */
  timeoutMs?: number;
}

/**
 * The page-side interpreter. It never blocks the exercise: on any failure or timeout it returns the raw words as the
 * answer (or noise when only fillers were heard).
 */
export function createInterpreter(opts: InterpreterOptions = {}): (ctx: AnswerContext, heard: string) => Promise<Interpretation> {
  const endpoint = opts.endpoint ?? "/api/answer/interpret";
  const timeoutMs = opts.timeoutMs ?? 4000;
  return async (ctx, heard) => {
    const raw: Interpretation = isFillerOnly(heard) ? { verdict: "noise", text: "" } : { verdict: "answer", text: heard.trim() };
    const fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchLike | undefined);
    if (!fetchFn) return raw;
    try {
      const res = await Promise.race([
        fetchFn(endpoint, {
          method: "POST",
          headers: { ...(opts.headers?.() ?? {}), "Content-Type": "application/json" },
          body: JSON.stringify({ question: ctx.question, choices: ctx.choices, expects: ctx.expects, heard }),
        }),
        new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
      ]);
      if (!res || !res.ok) return raw;
      const v = JSON.parse(await res.text()) as Partial<Interpretation>;
      if (v.verdict === "answer" && typeof v.text === "string" && v.text.trim()) return { verdict: "answer", text: v.text.trim() };
      if (v.verdict === "incomplete" || v.verdict === "noise") return { verdict: v.verdict, text: "" };
      return raw;
    } catch {
      return raw;
    }
  };
}

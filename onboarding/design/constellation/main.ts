// Constellation: the question harness as a dark sky with one drifting point of light.
// Each captured step leaves a still star; the strategy becomes a small constellation the light travels on playback.
// Same engine, hint timer, playback runner, storage and voice adapters as the harness (onboarding/src).
// URL options: ?hint=<ms> hint delay · ?speed=fast short playback pauses · ?voice=typed|browser|gpt-live.

import type { OnboardingEvent, RepSession } from "@peak-state/contracts";
import { createEngine } from "../../src/engine/index.ts";
import { createHintTimer, hintDelayFromUrl } from "../../src/harness/hints.ts";
import { h, mount } from "../../src/harness/view/dom.ts";
import { chainFromProfile, stepViewsFromProfile } from "../../src/harness/view/steps.ts";
import { createVoiceControls } from "../../src/harness/view/voice.ts";
import { appendRun, clearStrategy, DEFAULT_PAUSE_MS, loadStrategy, runsFor, runStrategy, saveStrategy } from "../../src/playback/index.ts";
import type { Answer, EngineSnapshot, Question, SavedStrategy, StepView, VoiceAdapter, VoiceKind, VoiceStatus } from "../../src/types.ts";
import { createVoice, loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../../src/voice/index.ts";
import { createApi } from "../../src/sync/index.ts";
import { createSky, type LightMode, type StarModel } from "./sky.ts";

/** Exposed on window.__harness for tests and debugging (same shape as the harness). */
export interface HarnessApi {
  snapshot(): EngineSnapshot;
  answer(answer: Answer): EngineSnapshot;
  events: OnboardingEvent[];
  saved(): SavedStrategy | null;
}

// ── options ─────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const hintDelay = hintDelayFromUrl(location.search);
const fast = params.get("speed") === "fast";
const debugLive = params.get("debug") === "live";
// On the Cloudflare Worker, GPT live needs the account signed in on the harness page (same browser storage).
const accountApi = createApi();
const pauseMs = fast ? 150 : DEFAULT_PAUSE_MS;
const KINDS: VoiceKind[] = ["typed", "browser", "gpt-live"];

const stage = document.getElementById("stage") as HTMLElement;
const corner = document.getElementById("corner") as HTMLElement;
const voiceToggle = document.getElementById("voice-toggle") as HTMLButtonElement;
const voicePanel = document.getElementById("voice-panel") as HTMLElement;
const voiceRoot = document.getElementById("voice-root") as HTMLElement;
const sky = createSky(document.getElementById("sky") as HTMLCanvasElement, document.getElementById("stars") as HTMLElement);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── engine ──────────────────────────────────────────────────────────────────

const events: OnboardingEvent[] = [];
const engine = createEngine({ onEvent: (e) => events.push(e) });
let snap: EngineSnapshot = engine.snapshot();

type Mode = "elicit" | "saved";
let saved: SavedStrategy | null = loadStrategy();
let mode: Mode = saved ? "saved" : "elicit";

// ── voice (a tiny corner control around the harness's own voice controls) ──

let settings: VoiceSettings = loadVoiceSettings();
const urlVoice = params.get("voice");
if (urlVoice && (KINDS as string[]).includes(urlVoice)) settings = { ...settings, kind: urlVoice as VoiceKind };

let voice: VoiceAdapter = createVoice("typed");
let voiceUnsubs: (() => void)[] = [];
let voiceStarted = false;

const VOICE_WORD: Record<VoiceKind, string> = { typed: "typing", browser: "voice", "gpt-live": "live voice" };

const controls = createVoiceControls(voiceRoot, settings, (next) => {
  settings = next;
  saveVoiceSettings(settings);
  void switchVoice(true);
});

function setStatus(s: VoiceStatus): void {
  controls.setStatus(s);
  voiceToggle.dataset.state = s.state;
  voiceToggle.dataset.kind = s.kind;
  const label = voiceToggle.querySelector(".voice-word");
  if (label) label.textContent = s.state === "error" ? `${VOICE_WORD[s.kind]} · problem` : s.state === "listening" ? "listening" : VOICE_WORD[s.kind];
}

voiceToggle.addEventListener("click", () => {
  voicePanel.hidden = !voicePanel.hidden;
  voiceToggle.setAttribute("aria-expanded", voicePanel.hidden ? "false" : "true");
});
document.addEventListener("pointerdown", (e) => {
  if (!voicePanel.hidden && !corner.contains(e.target as Node)) {
    voicePanel.hidden = true;
    voiceToggle.setAttribute("aria-expanded", "false");
  }
});

async function switchVoice(start: boolean): Promise<void> {
  for (const u of voiceUnsubs) u();
  voiceUnsubs = [];
  try {
    voice.stop();
  } catch {
    /* ignore */
  }
  voice = createVoice(
    settings.kind,
    settings.kind === "gpt-live" ? { apiKey: settings.apiKey ?? "", model: settings.model, debug: debugLive, headers: () => accountApi.authHeaders() } : undefined,
  );
  voiceUnsubs.push(voice.onStatus(setStatus), voice.onTranscript(onTranscript));
  voiceStarted = false;
  if (!start && settings.kind !== "typed") {
    setStatus({ kind: settings.kind, state: "idle", detail: "Click anywhere on the page to start the voice" });
    return;
  }
  voiceStarted = true;
  setStatus({ kind: settings.kind, state: settings.kind === "typed" ? "ready" : "connecting" });
  try {
    await voice.start();
  } catch (err) {
    setStatus({ kind: settings.kind, state: "error", detail: err instanceof Error ? err.message : String(err) });
    if (settings.kind === "gpt-live" && !settings.apiKey) {
      voicePanel.hidden = false;
      controls.openSettings();
    }
    return;
  }
  if (mode === "elicit" && snap.question) speak(snap.question.text);
}

function speak(text: string): void {
  if (voice.kind === "typed") return;
  voice.speak(text).catch(() => {});
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function spokenNumber(text: string): number | null {
  const digits = text.match(/\b(10|[0-9])\b/);
  if (digits) return Number(digits[1]);
  const lower = text.toLowerCase();
  const i = NUMBER_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(lower));
  return i >= 0 ? i : null;
}

function onTranscript(text: string, final: boolean): void {
  if (mode === "saved") {
    if (final && rating) {
      const n = spokenNumber(text);
      if (n !== null) rating(n);
    }
    return;
  }
  if (!snap.question) return;
  if (!final) {
    if (input) input.value = text;
    hints.activity();
    return;
  }
  const t = text.trim();
  if (t) answer({ text: t, via: "voice" });
}

// ── helpers ─────────────────────────────────────────────────────────────────

const SENSE_WORD: Record<string, string> = { visual: "picture", auditory: "sound", kinesthetic: "feeling", olfactory: "smell", gustatory: "taste", other: "" };

function starsFrom(steps: StepView[]): StarModel[] {
  return steps.map((s) => ({ index: s.index, modality: s.modality, content: s.content, isAnchor: s.isAnchor }));
}

/** Fade a fresh block of content into the stage. */
function present(...children: (Node | null | false)[]): void {
  const block = h("div", { class: "block" });
  for (const c of children) if (c) block.append(c);
  mount(stage, block);
}

function eyebrow(text: string): HTMLElement {
  return h("p", { class: "eyebrow", "data-testid": "section-label" }, text);
}

// ── elicitation ─────────────────────────────────────────────────────────────

const hints = createHintTimer(hintDelay, (qid) => {
  if (mode === "elicit" && questionKey(snap) === qid) showHints();
});

let input: HTMLInputElement | null = null;
let hintSlot: HTMLElement | null = null;
let usedSuggestion: string | null = null;
let lastKey = "";

function questionKey(s: EngineSnapshot): string {
  return s.question ? `${s.question.id}|${s.transcript.length}` : s.status;
}

function answer(a: Answer): void {
  hints.cancel();
  apply(engine.answer(a));
}

function apply(next: EngineSnapshot): void {
  snap = next;
  if (snap.status === "confirmed" && snap.profile) {
    hints.cancel();
    saved = saveStrategy(snap.profile);
    mode = "saved";
    lastKey = "";
    justSaved = true;
    speak("Your strategy is saved.");
  }
  render();
}

function lightFor(q: Question | null): LightMode {
  if (!q) return { kind: "still" };
  switch (q.kind) {
    case "choose-state":
    case "memory":
      return { kind: "drift" };
    case "first-step":
    case "next-step":
      return { kind: "pending" };
    case "modality":
    case "submodality":
    case "fully-in": {
      const i = q.target?.stepIndex ?? snap.steps.length - 1;
      return i >= 0 ? { kind: "star", index: i } : { kind: "pending" };
    }
    case "anchor":
    case "confirm":
      return { kind: "constellation" };
  }
}

function sectionText(q: Question): string {
  const state = snap.stateLabel ?? "";
  if (q.kind === "choose-state") return "";
  if (q.target) return `${state} · step ${q.target.stepIndex + 1} · the details`;
  if (q.kind === "first-step") return `${state} · step 1`;
  if (q.kind === "next-step") return `${state} · step ${snap.steps.length + 1}`;
  if (q.kind === "anchor" || q.kind === "confirm") return `${state} · ${snap.chain}`;
  return state;
}

function renderQuestion(q: Question): void {
  usedSuggestion = null;
  const send = (): void => {
    const text = input?.value.trim() ?? "";
    if (!text) {
      input?.focus();
      return;
    }
    const via: Answer["via"] = usedSuggestion !== null && text === usedSuggestion.trim() ? "suggestion" : "typed";
    answer({ text, via });
  };
  input = h("input", {
    class: "line-input",
    type: "text",
    "data-testid": "answer-input",
    "aria-label": "Your answer",
    autocomplete: "off",
    spellcheck: "true",
    placeholder: q.kind === "choose-state" ? "or name your own" : q.choices.length ? "or in your own words" : "in your own words",
    oninput: () => hints.activity(),
    onkeydown: (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" && !ke.isComposing) {
        ke.preventDefault();
        send();
      }
    },
  });
  hintSlot = h("div", { class: "hints", "aria-live": "polite" });
  const isAnchor = q.kind === "anchor";
  const choices = q.choices.length
    ? h(
        "div",
        { class: `choices${q.kind === "choose-state" ? " big" : ""}${q.choices.length > 5 ? " many" : ""}`, role: "group", "aria-labelledby": "question-text" },
        q.choices.map((c) =>
          h(
            "button",
            {
              class: "choice",
              type: "button",
              "data-testid": "choice",
              "data-value": c.value,
              onclick: () => answer({ text: c.label, via: "choice", choiceValue: c.value }),
              onpointerenter: isAnchor ? () => sky.setPreview(Number(c.value)) : null,
              onpointerleave: isAnchor ? () => sky.setPreview(null) : null,
              onfocus: isAnchor ? () => sky.setPreview(Number(c.value)) : null,
              onblur: isAnchor ? () => sky.setPreview(null) : null,
            },
            c.label,
          ),
        ),
      )
    : null;
  const label = sectionText(q);
  present(
    label ? eyebrow(label) : null,
    h("h1", { class: "q", id: "question-text", "data-testid": "question" }, q.text),
    choices,
    h(
      "div",
      { class: "answer" },
      input,
      h("button", { class: "send", type: "button", "data-testid": "send", "aria-label": "Send", onclick: send }, h("span", { "aria-hidden": "true" }, "→")),
    ),
    hintSlot,
  );
}

function showHints(): void {
  const q = snap.question;
  if (!q || !hintSlot) return;
  const fill = (text: string): void => {
    if (!input) return;
    input.value = text;
    usedSuggestion = text;
    input.focus();
    input.setSelectionRange(text.length, text.length);
  };
  mount(
    hintSlot,
    h(
      "div",
      { class: "suggestions", "data-testid": "suggestions", role: "group", "aria-label": "Suggested phrasings" },
      q.suggestions.map((text) =>
        h(
          "button",
          {
            class: "hint",
            type: "button",
            "data-testid": "suggestion",
            title: "Put these words in the line, then press Enter (double-click to send)",
            onclick: () => fill(text),
            ondblclick: () => answer({ text, via: "suggestion" }),
          },
          text,
        ),
      ),
    ),
  );
}

function renderStop(): void {
  present(
    h(
      "div",
      { class: "stop", "data-testid": "stop-banner", role: "alert" },
      h("h1", { class: "q" }, "Let's stop here."),
      h("p", { class: "stop-text" }, snap.stopReason ?? "Peak State is not the right support for this."),
      h("p", { class: "stop-text soft" }, "You don't have to carry this alone."),
      h("button", { class: "quiet-link", type: "button", "data-testid": "reset", onclick: () => apply(engine.reset()) }, "start over"),
    ),
  );
}

function renderElicit(): void {
  document.body.dataset.mode = snap.status === "stopped" ? "stopped" : "elicit";
  sky.setStars(starsFrom(snap.steps));
  sky.setActive(null);
  sky.setDim(snap.status === "stopped");
  sky.setMode(snap.status === "stopped" ? { kind: "still" } : lightFor(snap.question));
  renderCorner();

  const key = questionKey(snap);
  if (key === lastKey) return;
  lastKey = key;
  sky.setPreview(null);
  if (snap.status === "stopped") {
    hints.cancel();
    input = null;
    renderStop();
    const lastGuide = [...snap.transcript].reverse().find((t) => t.who === "guide");
    if (lastGuide) speak(lastGuide.text);
    return;
  }
  if (!snap.question) return;
  renderQuestion(snap.question);
  hints.start(key);
  document.body.dataset.questionAt = String(Date.now()); // when the hint countdown started (tests read it)
  speak(snap.question.text);
  if (snap.transcript.some((t) => t.who === "person")) input?.focus({ preventScroll: true });
}

// ── corner: back · start over ───────────────────────────────────────────────

const navRoot = document.getElementById("nav") as HTMLElement;

function renderCorner(): void {
  if (mode !== "elicit" || snap.status !== "asking") {
    mount(navRoot);
    return;
  }
  const canGoBack = snap.transcript.some((t) => t.who === "person");
  mount(
    navRoot,
    canGoBack ? h("button", { class: "quiet-link", type: "button", "data-testid": "back", onclick: () => apply(engine.back()) }, "back") : null,
    canGoBack ? h("button", { class: "quiet-link", type: "button", "data-testid": "reset", onclick: () => apply(engine.reset()) }, "start over") : null,
  );
}

// ── saved strategy and playback ─────────────────────────────────────────────

let running = false;
let stopRequested = false;
let justSaved = false;
let rating: ((n: number) => void) | null = null;
let lastResult: string | null = null;

function savedState(): { stateId: string; label: string } | null {
  const st = saved?.profile.states[0];
  return st ? { stateId: st.id, label: st.label } : null;
}

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function runLog(runs: RepSession[]): HTMLElement {
  const recent = runs.slice(-3).reverse();
  return h(
    "div",
    { class: "run-log", "data-testid": "run-log", "data-count": runs.length },
    runs.length === 0
      ? h("p", { class: "faint" }, "each run is logged with how you felt before and after")
      : recent.map((r) =>
          h(
            "p",
            { class: "run-entry", "data-testid": "run-entry", "data-ended-by": r.endedBy },
            h("span", { class: "run-n" }, `run ${r.repIndex + 1}`),
            h("span", { class: "run-delta" }, `${r.intensityBefore ?? "–"} → ${r.intensityAfter ?? "–"}`),
            h("span", { class: "run-when" }, r.endedBy === "completed" ? when(r.startedAt) : `${when(r.startedAt)} · stopped`),
          ),
        ),
  );
}

function renderSavedMode(): void {
  document.body.dataset.mode = "saved";
  input = null;
  hintSlot = null;
  renderCorner();
  const st = savedState();
  if (!saved || !st) {
    mode = "elicit";
    render();
    return;
  }
  const steps = stepViewsFromProfile(saved.profile, st.stateId);
  sky.setStars(starsFrom(steps));
  sky.setDim(false);
  if (running) return; // the run drives the stage itself
  sky.setActive(null);
  sky.setMode({ kind: "constellation" });
  const runs = runsFor(saved.profile.profileId, st.stateId);
  const chain = chainFromProfile(saved.profile, st.stateId);
  const title = lastResult ?? (justSaved ? "Your strategy is saved." : `Your ${st.label.toLowerCase()} strategy.`);
  present(
    h(
      "div",
      { class: "saved", "data-testid": "saved-card" },
      eyebrow(`${st.label} · ${chain}`),
      h("h1", { class: "q", "data-testid": "saved-title" }, title),
      h(
        "p",
        { class: "saved-sub" },
        lastResult ? "Run it again whenever you want to come back to it." : `${steps.length} ${steps.length === 1 ? "step" : "steps"}, ending on your anchor · strategy saved ${when(saved.savedAt)}`,
      ),
      h("ol", { class: "sr-only" }, steps.map((s) => h("li", { "data-testid": "saved-step", "data-modality": s.modality, "data-anchor": s.isAnchor ? "true" : "false" }, `${SENSE_WORD[s.modality] ?? ""}: ${s.content}${s.isAnchor ? " (anchor)" : ""}`))),
      h("button", { class: "run-btn", type: "button", "data-testid": "run", onclick: () => void run() }, h("span", { class: "run-dot", "aria-hidden": "true" }), "Run my strategy"),
      runLog(runs),
      h(
        "p",
        { class: "saved-links" },
        h("button", { class: "quiet-link", type: "button", "data-testid": "download", onclick: download }, "download"),
        h("span", { class: "dot-sep", "aria-hidden": "true" }, "·"),
        h("button", { class: "quiet-link", type: "button", "data-testid": "new-strategy", onclick: newStrategy }, "start a new one"),
      ),
    ),
  );
}

function render(): void {
  if (mode === "saved") renderSavedMode();
  else renderElicit();
}

function download(): void {
  if (!saved) return;
  const st = savedState();
  const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `peak-state-${st?.stateId ?? "strategy"}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function newStrategy(): void {
  if (running) return;
  clearStrategy();
  saved = null;
  justSaved = false;
  lastResult = null;
  mode = "elicit";
  lastKey = "";
  apply(engine.reset());
}

function readingMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(6000, Math.max(1600, words * 300));
}

/** The playback stage: one line at a time, a quiet stop, and the 0..10 row when a rating is asked. */
function playbackStage(stateLabel: string, total: number): { line: (text: string, stepIndex?: number, anchor?: boolean) => void; rate: (prompt: string) => Promise<number> } {
  const brow = eyebrow(stateLabel);
  const lineSlot = h("div", { class: "line-slot" });
  const ratingSlot = h("div", { class: "rating-slot" });
  const stopBtn = h("button", { class: "quiet-link", type: "button", "data-testid": "stop-run", onclick: () => (stopRequested = true) }, "stop");
  present(h("div", { class: "playback", "data-testid": "playback" }, brow, lineSlot, ratingSlot, h("p", { class: "saved-links" }, stopBtn)));
  const line = (text: string, stepIndex = -1, anchor = false): void => {
    brow.textContent = anchor ? `${stateLabel} · back to your anchor` : stepIndex >= 0 ? `${stateLabel} · step ${stepIndex + 1} of ${total}` : stateLabel;
    mount(lineSlot, h("p", { class: "q playback-line", "data-testid": "playback-line" }, text));
  };
  const rate = (prompt: string): Promise<number> => {
    line(prompt);
    return new Promise<number>((resolve) => {
      const close = (n: number): void => {
        rating = null;
        mount(ratingSlot);
        resolve(n);
      };
      rating = (n) => close(Math.max(0, Math.min(10, Math.round(n))));
      const buttons = Array.from({ length: 11 }, (_, n) =>
        h("button", { class: "rate", type: "button", "data-testid": `rate-${n}`, "aria-label": `${n} out of 10`, onclick: () => close(n) }, String(n)),
      );
      mount(
        ratingSlot,
        h(
          "div",
          { class: "rating", "data-testid": "rating", role: "group", "aria-label": prompt },
          h("div", { class: "rating-row" }, buttons),
          h("div", { class: "rating-scale" }, h("span", {}, "not at all"), h("span", {}, "completely")),
        ),
      );
    });
  };
  return { line, rate };
}

async function run(): Promise<void> {
  const st = savedState();
  if (running || !saved || !st) return;
  const profile = saved.profile;
  running = true;
  stopRequested = false;
  justSaved = false;
  lastResult = null;
  const anchor = profile.states[0].anchorStep;
  const pb = playbackStage(st.label, profile.states[0].strategy.steps.length);
  let lineCount = 0;
  renderCorner();

  let session: RepSession | null = null;
  try {
    session = await runStrategy(
      profile,
      st.stateId,
      {
        onStep(stepIndex, line) {
          lineCount++;
          // The last line returns to the anchor (the runner's script: intro, steps…, anchor).
          pb.line(line, stepIndex, stepIndex >= 0 && stepIndex === anchor && lineCount > profile.states[0].strategy.steps.length);
          if (stepIndex >= 0) {
            sky.setActive(stepIndex);
            sky.setMode({ kind: "star", index: stepIndex });
          } else {
            sky.setActive(null);
            sky.setMode({ kind: "constellation" });
          }
        },
        rate(prompt) {
          sky.setActive(null);
          sky.setMode({ kind: "constellation" });
          speak(prompt);
          return pb.rate(prompt);
        },
        async speak(text) {
          if (voice.kind === "typed") {
            if (!fast) await wait(readingMs(text));
            return;
          }
          await voice.speak(text).catch(() => {});
        },
      },
      {
        pauseMs,
        repIndex: runsFor(profile.profileId, st.stateId).length,
        shouldStop: () => stopRequested,
      },
    );
    appendRun(session);
  } finally {
    running = false;
    rating = null;
  }
  const before = session?.intensityBefore ?? "–";
  const after = session?.intensityAfter ?? "–";
  lastResult = session?.endedBy === "completed" ? `${before} → ${after}. Well done.` : `Stopped. You were at ${before}.`;
  render();
  if (anchor !== null && session?.endedBy === "completed") {
    sky.setMode({ kind: "star", index: anchor });
    sky.bloom(anchor);
    setTimeout(() => {
      if (!running && mode === "saved") sky.setMode({ kind: "constellation" });
    }, 2600);
  }
}

// ── boot ────────────────────────────────────────────────────────────────────

const api: HarnessApi = {
  snapshot: () => engine.snapshot(),
  answer: (a) => {
    answer(a);
    return snap;
  },
  events,
  saved: () => saved,
};
(window as unknown as { __harness: HarnessApi }).__harness = api;

render();
void switchVoice(settings.kind === "typed");

if (settings.kind !== "typed") {
  const startOnGesture = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.("#corner")) return;
    window.removeEventListener("pointerdown", startOnGesture, true);
    window.removeEventListener("keydown", startOnGesture, true);
    if (!voiceStarted) void switchVoice(true);
  };
  window.addEventListener("pointerdown", startOnGesture, true);
  window.addEventListener("keydown", startOnGesture, true);
}

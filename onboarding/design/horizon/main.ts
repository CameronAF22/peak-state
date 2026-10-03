// Horizon: the question harness as one band of light. A dark screen, a soft dawn-like band low down that
// rises and brightens as the state builds, one line of question text above it, and a quiet underline to answer.
// Same engine, hints, playback and voice modules as the harness (src/); only the presentation differs.
// It is the front page of the deployed demo, with GPT live as the set voice (D-onboarding-024).
// URL options: ?hint=<ms> hint delay · ?speed=fast short playback pauses · ?voice=typed|browser (testing fallback)
// · ?debug=live logs every GPT live event.

import type { OnboardingEvent, RepSession } from "@peak-state/contracts";
import { createEngine } from "../../src/engine/index.ts";
import { createHintTimer, hintDelayFromUrl } from "../../src/harness/hints.ts";
import { h, mount, SENSE_LABEL } from "../../src/harness/view/dom.ts";
import { chainFromProfile, stepViewsFromProfile } from "../../src/harness/view/steps.ts";
import {
  appendRun,
  buildPlaybackLines,
  clearStrategy,
  DEFAULT_PAUSE_MS,
  loadStrategy,
  runsFor,
  runStrategy,
  saveStrategy,
} from "../../src/playback/index.ts";
import type { Answer, EngineSnapshot, Question, SavedStrategy, StepView, VoiceAdapter, VoiceKind, VoiceStatus } from "../../src/types.ts";
import { createVoice, loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../../src/voice/index.ts";
import { ApiError, createApi, type ServerInfo } from "../../src/sync/index.ts";
import { createSignIn } from "./signin.ts";
import { createSky } from "./sky.ts";
import { createVoiceToggle } from "./voice.ts";

interface HarnessApi {
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
// On the Cloudflare Worker, GPT live needs a signed-in account (the sheet below, or the harness page: same storage).
const accountApi = createApi();
let server: ServerInfo | null = null;
const serverChecked = accountApi.health().then((s) => (server = s));
const pauseMs = fast ? 150 : DEFAULT_PAUSE_MS;
const KINDS: VoiceKind[] = ["typed", "browser", "gpt-live"];

const stage = document.getElementById("stage") as HTMLElement;
const nav = document.getElementById("nav") as HTMLElement;
const voiceRoot = document.getElementById("voice-root") as HTMLElement;
const sky = createSky();

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── engine and modes ────────────────────────────────────────────────────────

const events: OnboardingEvent[] = [];
const engine = createEngine({ onEvent: (e) => events.push(e) });
let snap: EngineSnapshot = engine.snapshot();

type Mode = "elicit" | "saved" | "playing";
let saved: SavedStrategy | null = loadStrategy();
let mode: Mode = saved ? "saved" : "elicit";
/** A short line shown on the saved screen after a run ("You went from 4 to 8."). */
let afterRun: string | null = null;

// ── voice ───────────────────────────────────────────────────────────────────

// GPT live is the set voice; ?voice= picks another one for tests or as a fallback, with the full menu.
let settings: VoiceSettings = { ...loadVoiceSettings(), kind: "gpt-live" };
const urlVoice = params.get("voice");
if (urlVoice && (KINDS as string[]).includes(urlVoice)) settings = { ...settings, kind: urlVoice as VoiceKind };
const voiceFixed = !urlVoice && settings.kind === "gpt-live";

let voice: VoiceAdapter = createVoice("typed");
let voiceUnsubs: (() => void)[] = [];
let voiceStarted = false;

const toggle = createVoiceToggle(voiceRoot, settings, (next) => {
  settings = next;
  saveVoiceSettings(settings);
  void switchVoice(true);
}, voiceFixed);

function needsSignIn(): boolean {
  return settings.kind === "gpt-live" && !settings.apiKey && Boolean(server?.voice) && !accountApi.account();
}

const signIn = createSignIn(async (email, code) => {
  try {
    await accountApi.createAccount(email, code);
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 409)) return err instanceof Error ? err.message : String(err);
    try {
      await accountApi.signIn(email, code);
    } catch (again) {
      return again instanceof Error ? again.message : String(again);
    }
  }
  signIn.close();
  void switchVoice(true);
  return null;
});

function setStatus(s: VoiceStatus): void {
  toggle.setStatus(s);
}

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
    setStatus({ kind: settings.kind, state: "idle", detail: "Tap anywhere to start the voice" });
    return;
  }
  voiceStarted = true;
  setStatus({ kind: settings.kind, state: settings.kind === "typed" ? "ready" : "connecting" });
  try {
    await voice.start();
  } catch (err) {
    setStatus({ kind: settings.kind, state: "error", detail: err instanceof Error ? err.message : String(err) });
    if (settings.kind === "gpt-live" && !settings.apiKey) {
      if (server?.voice && /HTTP 401|Sign in/.test(String(err))) signIn.open();
      else toggle.openSettings();
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
  if (mode !== "elicit") {
    if (final && resolveRating) {
      const n = spokenNumber(text);
      if (n !== null) closeRating(n);
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

// ── small pieces ────────────────────────────────────────────────────────────

/** A line of text that fades in each time it is created. */
function line(tag: "h1" | "p", cls: string, text: string, testid?: string): HTMLElement {
  return h(tag, { class: `${cls} fade-in${text.length > 110 ? " long" : ""}`, "data-testid": testid ?? null }, text);
}

function quiet(label: string, testid: string, onclick: () => void, disabled = false): HTMLButtonElement {
  return h("button", { class: "quiet", type: "button", "data-testid": testid, disabled, onclick }, label);
}

/** How built the state is, 0..1, from the steps and details captured so far. */
function levelFor(steps: StepView[], fullyInAt: number | null): number {
  let filled = 0;
  for (const s of steps) {
    const total = s.checklist.length || 1;
    const done = s.checklist.filter((c) => c.value !== null && c.value !== "").length;
    filled += 0.6 + 0.4 * (done / total);
  }
  const base = 0.2 + 0.68 * Math.min(1, filled / 4);
  return Math.min(1, base + (fullyInAt !== null ? 0.12 : 0));
}

function stepLabel(q: Question, s: EngineSnapshot): string {
  const parts: string[] = [];
  if (s.stateLabel) parts.push(s.stateLabel);
  const i = q.target?.stepIndex ?? (q.kind === "first-step" ? 0 : q.kind === "next-step" ? s.steps.length : null);
  if (i !== null && i !== undefined) {
    parts.push(`step ${i + 1}`);
    const m = q.target?.modality ?? s.steps[i]?.modality;
    if (m && q.kind === "submodality") parts.push(SENSE_LABEL[m].toLowerCase());
  }
  if (q.kind === "anchor") parts.push("anchor");
  if (q.kind === "confirm") parts.push("playback");
  return parts.join("  ·  ");
}

// ── elicitation ─────────────────────────────────────────────────────────────

const hints = createHintTimer(hintDelay, (qid) => {
  if (mode === "elicit" && questionKey(snap) === qid) showHints();
});

let input: HTMLInputElement | null = null;
let hintSlot: HTMLElement | null = null;
let currentQ: Question | null = null;
let usedSuggestion: string | null = null;
let renderedKey = "";
let hoverStep: number | null = null;

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
    afterRun = null;
    renderedKey = "";
    speak("Your strategy is saved.");
  }
  render();
}

function send(): void {
  const text = input?.value.trim() ?? "";
  if (!text) {
    input?.focus();
    return;
  }
  const via: Answer["via"] = usedSuggestion !== null && text === usedSuggestion.trim() ? "suggestion" : "typed";
  answer({ text, via });
}

function showHints(): void {
  if (!currentQ || !hintSlot) return;
  const q = currentQ;
  mount(
    hintSlot,
    q.suggestions.map((text, i) =>
      h(
        "button",
        {
          class: "hint",
          type: "button",
          style: `animation-delay:${i * 450}ms`,
          "data-testid": "suggestion",
          title: "Tap to use these words (you can edit them). Double-tap to send.",
          onclick: () => {
            if (!input) return;
            input.value = text;
            usedSuggestion = text;
            input.focus({ preventScroll: true });
            input.setSelectionRange(text.length, text.length);
            stage.querySelector(".q-answer")?.classList.add("filled");
          },
          ondblclick: () => answer({ text, via: "suggestion" }),
        },
        text,
      ),
    ),
  );
  hintSlot.dataset.shown = "true";
}

function renderQuestion(q: Question): void {
  currentQ = q;
  usedSuggestion = null;
  const isState = q.kind === "choose-state";
  input = h("input", {
    class: "q-input",
    type: "text",
    "data-testid": "answer-input",
    autocomplete: "off",
    spellcheck: "true",
    enterkeyhint: "send",
    placeholder: isState ? "or name your own" : q.choices.length ? "or in your own words" : "in your own words",
    "aria-label": "Your answer",
    oninput: () => {
      hints.activity();
      stage.querySelector(".q-answer")?.classList.toggle("filled", !!input?.value.trim());
    },
    onkeydown: (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === "Enter" && !ke.isComposing) {
        ke.preventDefault();
        send();
      }
    },
  });
  hintSlot = h("div", { class: "q-hints", "data-testid": "suggestions", role: "group", "aria-label": "Suggested words" });

  const choices = q.choices.length
    ? h(
        "div",
        { class: `q-choices${isState ? " big" : ""}${q.choices.length > 4 ? " many" : ""}`, role: "group", "aria-label": "Choices" },
        q.choices.map((c, i) =>
          h(
            "button",
            {
              class: "choice fade-in",
              type: "button",
              style: `animation-delay:${250 + i * 70}ms`,
              "data-testid": "choice",
              "data-value": c.value,
              onclick: () => answer({ text: c.label, via: "choice", choiceValue: c.value }),
              onpointerenter: () => {
                if (q.kind !== "anchor") return;
                hoverStep = Number(c.value);
                renderPoints();
              },
              onpointerleave: () => {
                if (q.kind !== "anchor") return;
                hoverStep = null;
                renderPoints();
              },
            },
            c.label,
          ),
        ),
      )
    : null;

  mount(
    stage,
    h(
      "section",
      { class: "q", "data-testid": "question-card", "data-kind": q.kind },
      h("p", { class: "q-label fade-in", "data-testid": "section-label" }, stepLabel(q, snap) || "Peak State"),
      line("h1", "q-text", q.text, "question"),
      choices,
      h(
        "div",
        { class: "q-answer fade-in" },
        input,
        h("button", { class: "q-send", type: "button", "data-testid": "send", "aria-label": "Send", onclick: send }, "→"),
      ),
      hintSlot,
    ),
  );
}

function renderStop(): void {
  currentQ = null;
  input = null;
  mount(
    stage,
    h(
      "section",
      { class: "q stop", "data-testid": "stop-banner", role: "alert" },
      h("p", { class: "q-label fade-in" }, "Let's pause here"),
      line("h1", "q-text", "This sounds heavy, and Peak State isn't the right support for it."),
      line("p", "q-sub", "Please reach out to a person you trust. If you are in danger or might hurt yourself, contact your local emergency services now."),
      h("div", { class: "q-actions fade-in" }, quiet("start over", "reset", () => apply(engine.reset()))),
    ),
  );
}

function renderNav(): void {
  if (mode === "playing") {
    mount(nav, quiet("stop", "stop-run", () => (stopRequested = true)));
    return;
  }
  if (mode !== "elicit" || snap.status === "stopped") {
    mount(nav);
    return;
  }
  const canGoBack = snap.status === "asking" && snap.transcript.some((t) => t.who === "person");
  mount(
    nav,
    quiet("← back", "back", () => apply(engine.back()), !canGoBack),
    snap.transcript.some((t) => t.who === "person") ? quiet("start over", "start-over", () => apply(engine.reset())) : null,
  );
}

function renderPoints(): void {
  if (mode === "elicit") {
    sky.setPoints({ steps: snap.steps, fullyInAt: snap.fullyInAt, activeStep: hoverStep });
  } else if (saved) {
    const st = saved.profile.states[0];
    sky.setPoints({ steps: stepViewsFromProfile(saved.profile, st.id), fullyInAt: st.strategy.fullyInAt, activeStep: playActive });
  }
}

function renderElicit(): void {
  renderNav();
  hoverStep = null;
  renderPoints();
  if (snap.status === "stopped") {
    sky.setMood("stopped");
    sky.setLevel(0.08);
    sky.sweepTo(null);
  } else {
    sky.setMood("calm");
    sky.setLevel(levelFor(snap.steps, snap.fullyInAt));
    sky.sweepTo(null);
  }

  const key = questionKey(snap);
  if (key === renderedKey) return;
  renderedKey = key;
  if (snap.status === "stopped") {
    hints.cancel();
    renderStop();
    speak(snap.stopReason ?? "");
    return;
  }
  if (!snap.question) return;
  renderQuestion(snap.question);
  hints.start(key);
  speak(snap.question.text);
  if (snap.transcript.some((t) => t.who === "person")) input?.focus({ preventScroll: true });
}

// ── saved strategy ──────────────────────────────────────────────────────────

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderRunLog(runs: RepSession[]): HTMLElement {
  const recent = runs.slice(-4).reverse();
  return h(
    "ul",
    { class: "runlog", "data-testid": "run-log", "aria-label": "Run log" },
    recent.map((r) =>
      h(
        "li",
        { "data-testid": "run-entry", "data-ended-by": r.endedBy },
        h("span", {}, `run ${r.repIndex + 1}`),
        h("span", { class: "delta" }, `${r.intensityBefore ?? "–"} → ${r.intensityAfter ?? "–"}`),
        h("span", { class: "when" }, r.endedBy === "completed" ? when(r.startedAt) : `${when(r.startedAt)} · stopped`),
      ),
    ),
  );
}

function renderSaved(): void {
  const st = saved?.profile.states[0];
  if (!saved || !st) {
    mode = "elicit";
    renderedKey = "";
    render();
    return;
  }
  renderNav();
  renderPoints();
  sky.setMood("calm");
  sky.setLevel(afterRun ? 0.9 : 0.72);
  sky.sweepTo(null);
  const runs = runsFor(saved.profile.profileId, st.id);
  mount(
    stage,
    h(
      "section",
      { class: "q saved", "data-testid": "saved-card" },
      h("p", { class: "q-label fade-in" }, afterRun ? "Run logged" : "Strategy saved"),
      line("h1", "q-text", afterRun ?? `Your way back to ${st.label} is saved.`),
      h("p", { class: "chain fade-in", "data-testid": "chain", title: "Your steps in order" }, chainFromProfile(saved.profile, st.id)),
      h(
        "button",
        { class: "run fade-in", type: "button", "data-testid": "run", onclick: () => void run() },
        h("span", { class: "run-glyph", "aria-hidden": "true" }),
        runs.length ? "Run it again" : "Run my strategy",
      ),
      h(
        "p",
        { class: "q-actions fade-in" },
        quiet("download", "download", download),
        h("span", { class: "sep", "aria-hidden": "true" }, "·"),
        quiet("start a new one", "new-strategy", newStrategy),
      ),
      runs.length ? renderRunLog(runs) : null,
    ),
  );
}

function download(): void {
  if (!saved) return;
  const st = saved.profile.states[0];
  const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `peak-state-${st?.id ?? "strategy"}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function newStrategy(): void {
  if (mode === "playing") return;
  clearStrategy();
  saved = null;
  afterRun = null;
  mode = "elicit";
  renderedKey = "";
  apply(engine.reset());
}

// ── playback ────────────────────────────────────────────────────────────────

let playActive: number | null = null;
let stopRequested = false;
let resolveRating: ((n: number) => void) | null = null;
let playLine: HTMLElement | null = null;
let playLabel: HTMLElement | null = null;
let ratingSlot: HTMLElement | null = null;

function closeRating(n: number): void {
  const r = resolveRating;
  resolveRating = null;
  if (ratingSlot) mount(ratingSlot);
  r?.(Math.max(0, Math.min(10, Math.round(n))));
}

function setPlayLine(text: string, label: string): void {
  if (!playLine || !playLabel) return;
  const next = line("h1", "q-text", text, "playback-line");
  playLine.replaceWith(next);
  playLine = next;
  playLabel.textContent = label;
}

function readingMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(6000, Math.max(1200, words * 280));
}

async function run(): Promise<void> {
  const st = saved?.profile.states[0];
  if (mode === "playing" || !saved || !st) return;
  const profile = saved.profile;
  const steps = stepViewsFromProfile(profile, st.id);
  const lines = buildPlaybackLines(profile, st.id);
  mode = "playing";
  stopRequested = false;
  playActive = null;
  afterRun = null;
  renderNav();
  renderPoints();

  playLabel = h("p", { class: "q-label fade-in" }, st.label);
  playLine = line("h1", "q-text", "", "playback-line");
  ratingSlot = h("div", { class: "rating-slot" });
  mount(
    stage,
    h(
      "section",
      { class: "q playing", "data-testid": "playback" },
      playLabel,
      playLine,
      ratingSlot,
    ),
  );

  let lineNo = 0;
  let session: RepSession | null = null;
  try {
    session = await runStrategy(
      profile,
      st.id,
      {
        onStep(stepIndex, text) {
          const kind = lines[lineNo]?.kind;
          lineNo++;
          playActive = stepIndex >= 0 ? stepIndex : null;
          renderPoints();
          sky.sweepTo(playActive);
          if (kind === "anchor") {
            sky.setMood("swell");
            sky.setLevel(1);
          } else {
            sky.setMood("playing");
            sky.setLevel(stepIndex < 0 ? 0.3 : 0.35 + 0.55 * ((stepIndex + 1) / Math.max(1, steps.length)));
          }
          const n = steps.length;
          const label = kind === "intro" ? st.label : kind === "anchor" ? "your anchor" : `${stepIndex + 1} of ${n}  ·  ${SENSE_LABEL[steps[stepIndex]?.modality ?? "other"].toLowerCase()}`;
          setPlayLine(text, label);
        },
        rate(prompt) {
          const first = lineNo === 0;
          playActive = null;
          renderPoints();
          sky.sweepTo(null);
          if (first) {
            sky.setMood("calm");
            sky.setLevel(0.25);
          }
          setPlayLine(prompt, first ? "before" : "after");
          speak(prompt);
          return new Promise<number>((resolve) => {
            resolveRating = resolve;
            if (!ratingSlot) return;
            const buttons = Array.from({ length: 11 }, (_, n) =>
              h(
                "button",
                { class: "rate", type: "button", style: `animation-delay:${200 + n * 40}ms`, "data-testid": `rate-${n}`, "aria-label": `${n} out of 10`, onclick: () => closeRating(n) },
                String(n),
              ),
            );
            mount(
              ratingSlot,
              h(
                "div",
                { class: "rating", "data-testid": "rating", role: "group", "aria-label": prompt },
                h("div", { class: "rating-pad" }, buttons),
                h("div", { class: "rating-scale fade-in" }, h("span", {}, "not at all"), h("span", {}, "completely")),
              ),
            );
          });
        },
        async speak(text) {
          if (voice.kind === "typed") {
            if (!fast) await wait(readingMs(text));
            return;
          }
          await voice.speak(text).catch(() => {});
        },
      },
      { pauseMs, repIndex: runsFor(profile.profileId, st.id).length, shouldStop: () => stopRequested },
    );
    appendRun(session);
  } finally {
    mode = "saved";
    playActive = null;
    resolveRating = null;
  }
  const before = session?.intensityBefore ?? "–";
  const after = session?.intensityAfter ?? "–";
  afterRun = session?.endedBy === "completed" ? `You went from ${before} to ${after}.` : `Stopped. You were at ${before} before.`;
  render();
}

// ── render and boot ─────────────────────────────────────────────────────────

function render(): void {
  if (mode === "saved") renderSaved();
  else if (mode === "elicit") renderElicit();
}

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
  void serverChecked;
  const startOnGesture = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.("#voice-root")) return;
    removeEventListener("pointerdown", startOnGesture, true);
    removeEventListener("keydown", startOnGesture, true);
    if (voiceStarted) return;
    if (needsSignIn()) signIn.open();
    else void switchVoice(true);
  };
  addEventListener("pointerdown", startOnGesture, true);
  addEventListener("keydown", startOnGesture, true);
}

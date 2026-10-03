// Orb: one breathing light, one line of text beneath it, a quiet underline to answer in.
// Captured steps settle as satellites around the orb; playback pulses the orb once per step, ending on the anchor.
// Same engine, hint timer, storage, playback and voice modules as the harness. URL: ?hint=<ms> ?speed=fast ?voice=.

import { repSteps, type RepSession } from "@peak-state/contracts";
import { createEngine } from "../../src/engine/index.ts";
import { createHintTimer, hintDelayFromUrl } from "../../src/harness/hints.ts";
import { h, mount, SENSE_LABEL, svg } from "../../src/harness/view/dom.ts";
import { chainFromProfile, stepViewsFromProfile } from "../../src/harness/view/steps.ts";
import { createVoiceControls } from "../../src/harness/view/voice.ts";
import { appendRun, clearStrategy, DEFAULT_PAUSE_MS, loadStrategy, runsFor, runStrategy, saveStrategy } from "../../src/playback/index.ts";
import type { Answer, EngineSnapshot, SavedStrategy, StepView, VoiceAdapter, VoiceKind, VoiceStatus } from "../../src/types.ts";
import { createVoice, loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../../src/voice/index.ts";
import { createSky, type Mood } from "./sky.ts";

// ── options ─────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const hintDelay = hintDelayFromUrl(location.search);
const fast = params.get("speed") === "fast";
const pauseMs = fast ? 150 : DEFAULT_PAUSE_MS;
const KINDS: VoiceKind[] = ["typed", "browser", "gpt-live"];

const stage = document.getElementById("stage") as HTMLElement;
const caption = document.getElementById("caption") as HTMLElement;
const nav = document.getElementById("nav") as HTMLElement;
const voiceSlot = document.getElementById("voice") as HTMLElement;
const sky = createSky(document.getElementById("sky") as HTMLElement);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const lower = (s: string): string => s.toLowerCase();

// ── engine ──────────────────────────────────────────────────────────────────

const engine = createEngine({ onEvent: () => {} });
let snap: EngineSnapshot = engine.snapshot();
let saved: SavedStrategy | null = loadStrategy();
let mode: "elicit" | "saved" = saved ? "saved" : "elicit";

// ── caption: the words of a step, faint, under the light ──────────────────

let hovered: StepView | null = null;
let pinnedCaption = "";
function setCaption(): void {
  const text = hovered ? `${lower(SENSE_LABEL[hovered.modality])} · ${hovered.content}` : pinnedCaption;
  if (caption.textContent === text) return;
  caption.classList.remove("in");
  caption.textContent = text;
  void caption.offsetWidth;
  if (text) caption.classList.add("in");
}
sky.onFocusStep((s) => {
  hovered = s;
  setCaption();
});

// ── voice ───────────────────────────────────────────────────────────────────

let settings: VoiceSettings = loadVoiceSettings();
const urlVoice = params.get("voice");
if (urlVoice && (KINDS as string[]).includes(urlVoice)) settings = { ...settings, kind: urlVoice as VoiceKind };

let voice: VoiceAdapter = createVoice("typed");
let voiceUnsubs: (() => void)[] = [];
let voiceStarted = false;

const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/></svg>`;
const voicePanel = h("div", { class: "voice-panel", "data-testid": "voice-panel", hidden: true });
const voiceToggle = h(
  "button",
  {
    class: "voice-toggle",
    type: "button",
    "data-testid": "voice-toggle",
    "aria-label": "Voice",
    "aria-expanded": "false",
    title: "Voice: typed",
    onclick: () => {
      voicePanel.hidden = !voicePanel.hidden;
      voiceToggle.setAttribute("aria-expanded", String(!voicePanel.hidden));
    },
  },
  svg(MIC),
);
mount(voiceSlot, voicePanel, voiceToggle);
document.addEventListener("pointerdown", (e) => {
  if (!voicePanel.hidden && !voiceSlot.contains(e.target as Node)) {
    voicePanel.hidden = true;
    voiceToggle.setAttribute("aria-expanded", "false");
  }
});

const controls = createVoiceControls(voicePanel, settings, (next) => {
  settings = next;
  saveVoiceSettings(settings);
  void switchVoice(true);
});

function setStatus(s: VoiceStatus): void {
  controls.setStatus(s);
  voiceToggle.dataset.kind = s.kind;
  voiceToggle.dataset.state = s.state;
  voiceToggle.title = `Voice: ${s.kind === "typed" ? "typed" : s.kind === "browser" ? "browser voice" : "GPT live"} · ${s.state}`;
}

async function switchVoice(start: boolean): Promise<void> {
  for (const u of voiceUnsubs) u();
  voiceUnsubs = [];
  try {
    voice.stop();
  } catch {
    /* ignore */
  }
  voice = createVoice(settings.kind, settings.kind === "gpt-live" ? { apiKey: settings.apiKey ?? "", model: settings.model } : undefined);
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
  const t = text.toLowerCase();
  const i = NUMBER_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t));
  return i >= 0 ? i : null;
}

function onTranscript(text: string, final: boolean): void {
  if (mode === "saved") {
    if (final && pendingRating) {
      const n = spokenNumber(text);
      if (n !== null) pendingRating(Math.max(0, Math.min(10, n)));
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

// ── elicitation ─────────────────────────────────────────────────────────────

const hints = createHintTimer(hintDelay, (qid) => {
  if (mode === "elicit" && questionKey(snap) === qid) showHints();
});

function questionKey(s: EngineSnapshot): string {
  return s.question ? `${s.question.id}|${s.transcript.length}` : s.status;
}

let lastKey = "";
let input: HTMLInputElement | null = null;
let hintSlot: HTMLElement | null = null;
let usedSuggestion: string | null = null;

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
    speak("Your strategy is saved.");
  }
  render();
}

/** A fresh element whose text fades in. */
function line(tag: "h1" | "p", cls: string, text: string, testid?: string): HTMLElement {
  const long = cls === "question" && text.length > 88 ? " long" : "";
  return h(tag, { class: `${cls}${long} fade`, "data-testid": testid ?? null }, text);
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
  const q = snap.question;
  if (!q || !hintSlot) return;
  const hint = (text: string, i: number) =>
    h(
      "button",
      {
        class: "hint",
        type: "button",
        "data-testid": "suggestion",
        style: `--d:${i * 600}ms`,
        title: "Use these words (you can edit them first)",
        onclick: () => {
          if (!input) return;
          input.value = text;
          usedSuggestion = text;
          input.focus();
          form?.classList.add("has-text");
        },
      },
      text,
    );
  mount(hintSlot, hint(q.suggestions[0], 0), hint(q.suggestions[1], 1));
  hintSlot.dataset.shown = "true";
}

let form: HTMLFormElement | null = null;

function renderQuestion(): void {
  const q = snap.question!;
  usedSuggestion = null;
  const isState = q.kind === "choose-state";
  input = h("input", {
    class: "answer",
    type: "text",
    "data-testid": "answer-input",
    autocomplete: "off",
    spellcheck: "true",
    enterkeyhint: "send",
    "aria-label": "Your answer",
    placeholder: isState ? "or name your own" : q.choices.length ? "or say it in your own words" : "in your own words",
    oninput: () => {
      hints.activity();
      form?.classList.toggle("has-text", !!input?.value.trim());
    },
  });
  const sendBtn = h("button", { class: "send", type: "submit", "data-testid": "send", "aria-label": "Send" }, svg(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="M13 6.5 18.5 12 13 17.5"/></svg>`));
  form = h(
    "form",
    {
      class: "field fade",
      style: "--d:500ms",
      onsubmit: (e: Event) => {
        e.preventDefault();
        send();
      },
    },
    input,
    sendBtn,
  );
  hintSlot = h("div", { class: "hints", "data-testid": "hints", role: "group", "aria-label": "Suggested phrasings" });
  const choices = q.choices.length
    ? h(
        "div",
        { class: `choices fade${isState ? " big" : ""}${q.choices.length > 5 ? " many" : ""}${q.kind === "anchor" ? " stack" : ""}`, style: "--d:300ms", role: "group", "aria-label": "Choices" },
        q.choices.map((c) =>
          h(
            "button",
            { class: "choice", type: "button", "data-testid": "choice", "data-value": c.value, onclick: () => answer({ text: c.label, via: "choice", choiceValue: c.value }) },
            q.kind === "anchor" ? (snap.steps[Number(c.value)]?.content ?? c.label.replace(/^\d+\.\s*/, "")) : c.label,
          ),
        ),
      )
    : null;
  mount(stage, h("div", { class: "elicit" }, line("h1", "question", q.text, "question"), choices, form, hintSlot));
}

function renderStopped(): void {
  mount(
    stage,
    h(
      "div",
      { class: "stopped", "data-testid": "stop", role: "alert" },
      line("h1", "question", "Let's stop here.", "stop-title"),
      h("p", { class: "quiet fade", style: "--d:700ms", "data-testid": "stop-message" }, snap.stopReason ?? "Peak State is not the right support for this."),
      h("div", { class: "links fade", style: "--d:2000ms" }, h("button", { class: "link", type: "button", "data-testid": "reset", onclick: () => restart() }, "start over")),
    ),
  );
}

function restart(): void {
  lastKey = "";
  apply(engine.reset());
}

function renderNav(items: { label: string; testid: string; on: () => void; disabled?: boolean }[]): void {
  mount(
    nav,
    items.map((i) => h("button", { class: "link", type: "button", "data-testid": i.testid, disabled: !!i.disabled, onclick: i.on }, i.label)),
  );
}

function renderElicit(): void {
  const q = snap.question;
  const mood: Mood = snap.status === "stopped" ? "rest" : "listening";
  sky.render({ steps: snap.steps, active: q?.target?.stepIndex ?? null, mood });
  const target = q?.target ? snap.steps[q.target.stepIndex] : null;
  pinnedCaption = target ? `${lower(SENSE_LABEL[target.modality])} · ${target.content}` : "";
  setCaption();

  const key = questionKey(snap);
  if (key === lastKey) return;
  lastKey = key;
  if (snap.status === "stopped") {
    hints.cancel();
    renderStopped();
    renderNav([]);
    const lastGuide = [...snap.transcript].reverse().find((t) => t.who === "guide");
    if (lastGuide) speak(lastGuide.text);
    return;
  }
  if (!q) return;
  renderQuestion();
  const answered = snap.transcript.some((t) => t.who === "person");
  renderNav(answered ? [
    { label: "back", testid: "back", on: () => apply(engine.back()) },
    { label: "start over", testid: "start-over", on: () => restart() },
  ] : []);
  hints.start(key);
  speak(q.text);
  if (answered) input?.focus({ preventScroll: true });
}

// ── saved strategy and playback ─────────────────────────────────────────────

let running = false;
let stopRequested = false;
let pendingRating: ((n: number) => void) | null = null;
let lastResult = "";

function savedState(): { stateId: string; label: string } | null {
  const st = saved?.profile.states[0];
  return st ? { stateId: st.id, label: st.label } : null;
}

function senseChain(steps: StepView[]): string {
  return steps.map((s) => lower(SENSE_LABEL[s.modality])).join("  ·  ");
}

function runLog(runs: RepSession[]): HTMLElement {
  const recent = runs.slice(-4);
  return h(
    "p",
    { class: "runs", "data-testid": "run-log", "data-count": runs.length },
    runs.length === 0
      ? h("span", { class: "none" }, "each run is logged with how you felt before and after")
      : [
          h("span", { class: "runs-label" }, runs.length === 1 ? "1 run" : `${runs.length} runs`),
          ...recent.map((r) =>
            h("span", { class: "run-entry", "data-testid": "run-entry", "data-ended-by": r.endedBy, title: new Date(r.startedAt).toLocaleString() }, `${r.intensityBefore ?? "–"} → ${r.intensityAfter ?? "–"}`),
          ),
        ],
  );
}

function renderSaved(): void {
  const st = savedState();
  if (!saved || !st) {
    mode = "elicit";
    render();
    return;
  }
  const steps = stepViewsFromProfile(saved.profile, st.stateId);
  sky.render({ steps, active: null, mood: "saved" });
  pinnedCaption = "";
  setCaption();
  const runs = runsFor(saved.profile.profileId, st.stateId);
  const anchor = steps.find((s) => s.isAnchor);
  mount(
    stage,
    h(
      "div",
      { class: "saved", "data-testid": "saved", "data-chain": chainFromProfile(saved.profile, st.stateId) },
      line("h1", "question", lastResult || `Your ${lower(st.label)} strategy is saved.`, "saved-line"),
      h("p", { class: "quiet fade", style: "--d:400ms", "data-testid": "saved-chain" }, senseChain(steps), anchor ? h("span", { class: "anchor-note" }, `  —  anchored on the ${lower(SENSE_LABEL[anchor.modality])}`) : null),
      h(
        "div",
        { class: "fade", style: "--d:800ms" },
        h("button", { class: "run", type: "button", "data-testid": "run", onclick: () => void run() }, h("span", { class: "run-dot", "aria-hidden": "true" }), "Run my strategy"),
      ),
      h("div", { class: "fade", style: "--d:1200ms" }, runLog(runs)),
    ),
  );
  renderNav([
    { label: "download", testid: "download", on: download },
    { label: "start a new one", testid: "new-strategy", on: newStrategy },
  ]);
}

function render(): void {
  if (mode === "saved") {
    if (!running) renderSaved();
  } else renderElicit();
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
  lastResult = "";
  mode = "elicit";
  restart();
}

function readingMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(6000, Math.max(1200, words * 280));
}

/** The playback screen: one line, the 0..10 numerals when rating, a quiet stop. */
function playbackScreen(): { setLine(text: string): void; rate(prompt: string): Promise<number> } {
  const lineSlot = h("div", { class: "line-slot" });
  const ratingSlot = h("div", { class: "rating-slot" });
  mount(stage, h("div", { class: "playback", "data-testid": "playback" }, lineSlot, ratingSlot));
  renderNav([{ label: "stop", testid: "stop-run", on: () => (stopRequested = true) }]);
  const setLine = (text: string): void => {
    mount(lineSlot, line("h1", "question", text, "playback-line"));
  };
  return {
    setLine(text) {
      mount(ratingSlot);
      setLine(text);
    },
    rate(prompt) {
      setLine(prompt);
      return new Promise<number>((resolve) => {
        const done = (n: number): void => {
          pendingRating = null;
          mount(ratingSlot);
          resolve(n);
        };
        pendingRating = done;
        const nums = Array.from({ length: 11 }, (_, n) =>
          h("button", { class: "num", type: "button", "data-testid": `rate-${n}`, "aria-label": `${n} out of 10`, style: `--i:${n}`, onclick: () => done(n) }, String(n)),
        );
        mount(
          ratingSlot,
          h(
            "div",
            { class: "rating fade", style: "--d:500ms", "data-testid": "rating", role: "group", "aria-label": prompt },
            h("div", { class: "nums" }, nums),
            h("div", { class: "scale" }, h("span", {}, "not at all"), h("span", {}, "completely")),
          ),
        );
      });
    },
  };
}

async function run(): Promise<void> {
  const st = savedState();
  if (running || !saved || !st) return;
  const profile = saved.profile;
  const steps = stepViewsFromProfile(profile, st.stateId);
  const anchor = profile.states[0].anchorStep;
  const repCount = repSteps(profile.states[0]).length;
  running = true;
  stopRequested = false;
  lastResult = "";
  const screen = playbackScreen();
  let played = 0;
  sky.render({ steps, active: null, done: 0, mood: "running" });

  let session: RepSession | null = null;
  try {
    session = await runStrategy(
      profile,
      st.stateId,
      {
        onStep(stepIndex, text) {
          screen.setLine(text);
          if (stepIndex >= 0) {
            const isAnchorLine = anchor !== null && played === repCount;
            sky.render({ steps, active: stepIndex, done: played, mood: "running" });
            sky.pulse(isAnchorLine);
            played++;
          } else {
            sky.render({ steps, active: null, done: 0, mood: "running" });
          }
        },
        rate(prompt) {
          sky.render({ steps, active: null, done: played, mood: "running" });
          speak(prompt);
          return screen.rate(prompt);
        },
        async speak(text) {
          if (voice.kind === "typed") {
            if (!fast) await wait(readingMs(text));
            return;
          }
          await voice.speak(text).catch(() => {});
        },
      },
      { pauseMs, repIndex: runsFor(profile.profileId, st.stateId).length, shouldStop: () => stopRequested },
    );
    appendRun(session);
  } finally {
    running = false;
    pendingRating = null;
  }
  const before = session?.intensityBefore ?? "–";
  const after = session?.intensityAfter ?? "–";
  lastResult = session?.endedBy === "completed" ? `Done. You went from ${before} to ${after}.` : "Stopped. Come back to it any time.";
  render();

}

// ── boot ────────────────────────────────────────────────────────────────────

(window as unknown as { __harness: unknown }).__harness = {
  snapshot: () => engine.snapshot(),
  answer: (a: Answer) => {
    answer(a);
    return snap;
  },
  saved: () => saved,
};

if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) document.documentElement.dataset.motion = "reduced";

render();
void switchVoice(settings.kind === "typed");

if (settings.kind !== "typed") {
  const startOnGesture = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.("#voice")) return;
    window.removeEventListener("pointerdown", startOnGesture, true);
    window.removeEventListener("keydown", startOnGesture, true);
    if (!voiceStarted) void switchVoice(true);
  };
  window.addEventListener("pointerdown", startOnGesture, true);
  window.addEventListener("keydown", startOnGesture, true);
}

// The question harness page: pick a state, answer the strategy questions one at a time (two suggested phrasings
// appear after the hint delay), save the strategy, then run it back with one click.
// After the first session, Practice runs the recall → rate → one question → try again loop (D-onboarding-015), and
// a signed-in account keeps the strategy and every run on the server (D-onboarding-017).
// URL options: ?hint=<ms> hint delay · ?speed=fast short playback pauses · ?voice=typed|browser|gpt-live.

import type { OnboardingEvent, RepSession } from "@peak-state/contracts";
import { createEngine } from "../engine/index.ts";
import { appendRun, clearStrategy, DEFAULT_PAUSE_MS, runsFor, runStrategy, toSecondPerson } from "../playback/index.ts";
import { createPracticeLoop, type PracticeLoop, type PracticeSnapshot } from "../practice/loop.ts";
import { reminderLine, summarize } from "../progress/index.ts";
import { loadRecord, newRecord, saveRecord, type StrategyRecord } from "../store/index.ts";
import { createApi, pushRecord, syncAll, type ServerInfo } from "../sync/index.ts";
import type { Answer, EngineSnapshot, VoiceAdapter, VoiceKind, VoiceStatus } from "../types.ts";
import { createVoice, loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../voice/index.ts";
import { createHintTimer, hintDelayFromUrl } from "./hints.ts";
import { createAccountControls } from "./view/account.ts";
import { h, mount } from "./view/dom.ts";
import { createPracticeView } from "./view/practice.ts";
import { createQuestionView } from "./view/question.ts";
import { createPlaybackPanel, renderRunLog, renderSavedCard, type PlaybackPanel } from "./view/saved.ts";
import { chainFromProfile, renderSteps, stepViewsFromProfile } from "./view/steps.ts";
import { createVoiceControls } from "./view/voice.ts";

/** Exposed on window.__harness for tests and debugging. */
export interface HarnessApi {
  snapshot(): EngineSnapshot;
  answer(answer: Answer): EngineSnapshot;
  events: OnboardingEvent[];
  saved(): StrategyRecord | null;
  /** The practice loop's snapshot while one is open. */
  practice(): PracticeSnapshot | null;
}

// ── options ─────────────────────────────────────────────────────────────────

const params = new URLSearchParams(location.search);
const hintDelay = hintDelayFromUrl(location.search);
const fast = params.get("speed") === "fast";
const pauseMs = fast ? 150 : DEFAULT_PAUSE_MS;
const KINDS: VoiceKind[] = ["typed", "browser", "gpt-live"];

const mainCol = document.getElementById("main-col") as HTMLElement;
const sideCol = document.getElementById("side-col") as HTMLElement;
const voiceRoot = document.getElementById("voice-root") as HTMLElement;
const accountRoot = document.getElementById("account-root") as HTMLElement | null;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── engine ──────────────────────────────────────────────────────────────────

const events: OnboardingEvent[] = [];
const engine = createEngine({ onEvent: (e) => events.push(e) });
let snap: EngineSnapshot = engine.snapshot();

type Mode = "elicit" | "saved";
let saved: StrategyRecord | null = loadRecord();
let mode: Mode = saved ? "saved" : "elicit";

// ── voice ───────────────────────────────────────────────────────────────────

let settings: VoiceSettings = loadVoiceSettings();
const urlVoice = params.get("voice");
if (urlVoice && (KINDS as string[]).includes(urlVoice)) settings = { ...settings, kind: urlVoice as VoiceKind };

let voice: VoiceAdapter = createVoice("typed");
let voiceUnsubs: (() => void)[] = [];
let voiceStarted = false;

const controls = createVoiceControls(voiceRoot, settings, (next) => {
  settings = next;
  saveVoiceSettings(settings);
  void switchVoice(true);
});

function setStatus(s: VoiceStatus): void {
  controls.setStatus(s);
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
    settings.kind === "gpt-live" ? { apiKey: settings.apiKey ?? "", model: settings.model, getApiKey: serverVoice() ? () => api.realtimeKey(settings.model) : undefined } : undefined,
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
      if (server?.voice && !api.account()) account?.open();
      else controls.openSettings();
    }
    return;
  }
  if (mode === "elicit" && snap.question) speak(snap.question.text);
  else if (practice) speakPractice(practice.snapshot());
}

/** Speak without blocking the page; typed voice resolves immediately. */
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
  if (mode === "saved" && practice && practice.snapshot().prompt) {
    if (!final) practiceView.setDraft(text);
    else if (text.trim()) answerPractice({ text: text.trim(), via: "voice" });
    return;
  }
  if (mode === "saved") {
    if (final && panel) {
      const n = spokenNumber(text);
      if (n !== null) panel.answerRating(n);
    }
    return;
  }
  if (!snap.question) return;
  if (!final) {
    questionView.setDraft(text);
    hints.activity();
    return;
  }
  const t = text.trim();
  if (t) answer({ text: t, via: "voice" });
}

// ── elicitation view ────────────────────────────────────────────────────────

const hints = createHintTimer(hintDelay, (qid) => {
  if (mode === "elicit" && questionKey(snap) === qid) questionView.showHints();
});

const questionView = createQuestionView({
  answer: (a) => answer(a),
  back: () => apply(engine.back()),
  reset: () => apply(engine.reset()),
  activity: () => hints.activity(),
});

const stopSlot = h("div", {});
const transcriptBox = h("div", { class: "transcript", "data-testid": "transcript", "aria-label": "Transcript" });
const transcriptCard = h("div", { class: "card" }, h("h2", { class: "card-title" }, "Transcript"), transcriptBox);

function questionKey(s: EngineSnapshot): string {
  return s.question ? `${s.question.id}|${s.transcript.length}` : "";
}

let lastKey = "";

function answer(a: Answer): void {
  hints.cancel();
  apply(engine.answer(a));
}

function apply(next: EngineSnapshot): void {
  snap = next;
  if (snap.status === "confirmed" && snap.profile) {
    hints.cancel();
    saved = saveRecord(newRecord(snap.profile));
    void pushStrategy();
    mode = "saved";
    lastKey = "";
    speak("Your strategy is saved.");
    render();
    return;
  }
  render();
}

function renderTranscript(): void {
  if (snap.transcript.length === 0) {
    mount(transcriptBox, h("p", { class: "empty" }, "The conversation appears here."));
    return;
  }
  mount(
    transcriptBox,
    snap.transcript.map((t) => h("div", { class: `turn ${t.who}`, "data-who": t.who }, t.text)),
  );
  transcriptBox.scrollTop = transcriptBox.scrollHeight;
}

function renderStop(): void {
  if (snap.status !== "stopped") {
    mount(stopSlot);
    return;
  }
  mount(
    stopSlot,
    h(
      "div",
      { class: "stop-banner", "data-testid": "stop-banner", role: "alert" },
      h("h2", {}, "Let's stop here"),
      h("p", {}, snap.stopReason ?? "Peak State is not the right support for this."),
      h("p", {}, "If you are in distress, reach out to someone you trust or local emergency services."),
      h("div", {}, h("button", { class: "btn", type: "button", "data-testid": "reset", onclick: () => apply(engine.reset()) }, "Start over")),
    ),
  );
}

let elicitMounted = false;

function renderElicit(): void {
  if (!elicitMounted) {
    mount(mainCol, stopSlot, questionView.el, transcriptCard);
    elicitMounted = true;
  }
  renderStop();
  questionView.el.hidden = !snap.question;
  questionView.render(snap);
  renderTranscript();
  renderSteps(sideCol, { title: "Your strategy", chain: snap.chain, steps: snap.steps, fullyInAt: snap.fullyInAt, activeStep: null });

  const key = questionKey(snap);
  if (key !== lastKey) {
    lastKey = key;
    if (snap.question) {
      hints.start(key);
      speak(snap.question.text);
      // Focus the box for typing, but leave focus alone on the very first screen (state choice buttons).
      if (snap.transcript.some((t) => t.who === "person")) questionView.focus();
    } else {
      hints.cancel();
      const lastGuide = [...snap.transcript].reverse().find((t) => t.who === "guide");
      if (snap.status === "stopped" && lastGuide) speak(lastGuide.text);
    }
  }
}

// ── saved strategy and playback ─────────────────────────────────────────────

let running = false;
let stopRequested = false;
let panel: PlaybackPanel | null = null;
let activeStep: number | null = null;

function savedState(): { stateId: string; label: string } | null {
  const st = saved?.profile.states[0];
  return st ? { stateId: st.id, label: st.label } : null;
}

function renderSavedMode(): void {
  elicitMounted = false;
  const st = savedState();
  if (!saved || !st) {
    mode = "elicit";
    render();
    return;
  }
  const steps = stepViewsFromProfile(saved.profile, st.stateId);
  const chain = chainFromProfile(saved.profile, st.stateId);
  const runs = runsFor(saved.profile.profileId, st.stateId);
  const reminder = reminderLine(summarize(runs, st.stateId), toSecondPerson(st.label));
  if (practice) practiceView.render(practice.snapshot(), steps, reminder);
  mount(
    mainCol,
    renderSavedCard(
      { saved, stateLabel: st.label, chain, steps, running, practicing: practiceOpen(), reminder: runs.length ? reminder : null, revision: saved.revision },
      { run: () => void run(), practice: startPractice, download, newStrategy },
    ),
    practice ? practiceView.el : null,
    panel?.el ?? null,
    renderRunLog(runs),
  );
  renderSteps(sideCol, {
    title: "Your strategy",
    chain,
    steps,
    fullyInAt: saved.profile.states[0].strategy.fullyInAt,
    activeStep,
  });
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
  if (running || practiceOpen()) return;
  clearStrategy();
  saved = null;
  panel = null;
  practice = null;
  activeStep = null;
  mode = "elicit";
  lastKey = "";
  apply(engine.reset());
}

/** How long to leave a line on screen when nothing is spoken (typed voice). */
function readingMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.min(6000, Math.max(1200, words * 280));
}

async function run(): Promise<void> {
  const st = savedState();
  if (running || practiceOpen() || !saved || !st) return;
  practice = null;
  const profile = saved.profile;
  running = true;
  stopRequested = false;
  activeStep = null;
  // Stop ends the run after the line being spoken.
  panel = createPlaybackPanel(stepViewsFromProfile(profile, st.stateId), () => {
    stopRequested = true;
  });
  const p = panel;
  render();
  p.el.scrollIntoView({ behavior: "smooth", block: "nearest" });

  let session: RepSession | null = null;
  try {
    session = await runStrategy(
      profile,
      st.stateId,
      {
        onStep(stepIndex, line) {
          p.setLine(stepIndex, line);
          activeStep = stepIndex >= 0 ? stepIndex : null;
          renderSavedSide();
        },
        rate(prompt) {
          activeStep = null;
          renderSavedSide();
          speak(prompt);
          return p.rate(prompt);
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
    void pushRuns([session]);
  } finally {
    running = false;
    activeStep = null;
  }
  const before = session?.intensityBefore ?? "–";
  const after = session?.intensityAfter ?? "–";
  p.finish(session?.endedBy === "completed" ? `Done. You went from ${before} → ${after}.` : `Stopped. Your rating before was ${before}.`);
  render();
}

function renderSavedSide(): void {
  if (!saved) return;
  const st = savedState();
  if (!st) return;
  renderSteps(sideCol, {
    title: "Your strategy",
    chain: chainFromProfile(saved.profile, st.stateId),
    steps: stepViewsFromProfile(saved.profile, st.stateId),
    fullyInAt: saved.profile.states[0].strategy.fullyInAt,
    activeStep,
  });
}

// ── practice loop (D-onboarding-015) ────────────────────────────────────────

let practice: PracticeLoop | null = null;

const practiceView = createPracticeView({
  answer: (a) => answerPractice(a),
  stop: () => {
    if (!practice) return;
    showPractice(practice.stop());
  },
  close: () => {
    practice = null;
    render();
    (mainCol.querySelector('[data-testid="practice"]') as HTMLElement | null)?.focus({ preventScroll: true });
  },
});

function practiceOpen(): boolean {
  const p = practice?.snapshot();
  return Boolean(p && p.phase !== "done" && p.phase !== "stopped");
}

function currentReminder(): string | null {
  const st = savedState();
  if (!saved || !st) return null;
  return reminderLine(summarize(runsFor(saved.profile.profileId, st.stateId), st.stateId), toSecondPerson(st.label));
}

function speakPractice(p: PracticeSnapshot): void {
  if (p.prompt) {
    speak([p.notice, p.prompt.spoken].filter(Boolean).join(" "));
  } else if (p.phase === "done") {
    speak([p.notice, currentReminder()].filter(Boolean).join(" "));
  } else if (p.phase === "stopped" && p.stopReason) {
    speak(p.stopReason);
  }
}

function showPractice(p: PracticeSnapshot): void {
  render();
  speakPractice(p);
  if (p.prompt && p.prompt.kind !== "recall") practiceView.focus();
}

function startPractice(): void {
  const st = savedState();
  if (running || practiceOpen() || !saved || !st) return;
  panel = null;
  const runs = runsFor(saved.profile.profileId, st.stateId);
  practice = createPracticeLoop({
    record: saved,
    stateId: st.stateId,
    priorRuns: runs.length,
    questionOffset: runs.filter((r) => r.trigger.kind === "practice" && r.endedBy === "completed").length,
    onChange: (record) => {
      saved = saveRecord(record);
      void pushStrategy();
    },
    onRun: (session) => {
      appendRun(session);
      void pushRuns([session]);
    },
  });
  render();
  practiceView.el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  const first = practice.snapshot();
  const reminder = runs.length ? currentReminder() : null;
  speak([reminder, first.prompt?.spoken].filter(Boolean).join(" "));
}

function answerPractice(a: Answer): void {
  if (!practice) return;
  showPractice(practice.answer(a));
}

// ── account and sync (D-onboarding-017) ─────────────────────────────────────

const api = createApi();
let server: ServerInfo | null = null;
let syncing = false;
let syncNote: string | null = null;

function serverVoice(): boolean {
  return Boolean(server?.voice && api.account());
}

const account = accountRoot
  ? createAccountControls(accountRoot, {
      async create(email, code) {
        await api.createAccount(email, code);
        await sync();
      },
      async signIn(email, code) {
        await api.signIn(email, code);
        await sync();
      },
      async signOut() {
        await api.signOut().catch(() => {});
        renderAccount();
        if (settings.kind === "gpt-live") void switchVoice(false);
      },
    })
  : null;

function renderAccount(): void {
  if (!account) return;
  if (!server?.accounts) {
    account.render(null);
    return;
  }
  account.render({ email: api.account()?.email ?? null, syncing, note: syncNote });
}

// One push at a time, each sending the latest save, so an older push can never land after a newer one.
let pushing: Promise<void> = Promise.resolve();
function pushStrategy(): Promise<void> {
  pushing = pushing.then(pushLatest, pushLatest);
  return pushing;
}

async function pushLatest(): Promise<void> {
  if (!saved || !api.account()) return;
  const mine = saved;
  try {
    // Without a remote copy in hand, pushRecord learns it from the first 409 and decides again.
    const result = await pushRecord(api, mine, undefined, undefined);
    syncNote = null;
    if (result !== mine && saved === mine && !running && !practiceOpen()) {
      saved = result;
      render();
    }
  } catch (err) {
    syncNote = `Not saved to your account yet: ${err instanceof Error ? err.message : err}`;
  }
  renderAccount();
}

async function pushRuns(runs: RepSession[]): Promise<void> {
  if (!api.account()) return;
  try {
    await api.postReps(runs);
  } catch {
    // Kept locally; the next sync sends whatever the account is missing.
  }
}

async function sync(): Promise<void> {
  if (!api.account() || syncing) return;
  syncing = true;
  renderAccount();
  try {
    const result = await syncAll(api);
    syncNote = null;
    if (!running && !practiceOpen() && result.record) {
      const untouched = !snap.transcript.some((t) => t.who === "person");
      if (mode === "saved" || untouched) {
        saved = result.record;
        mode = "saved";
        render();
      }
    }
  } catch (err) {
    syncNote = `Sync failed: ${err instanceof Error ? err.message : err}`;
  } finally {
    syncing = false;
    renderAccount();
  }
  if (settings.kind === "gpt-live" && !voiceStarted) void switchVoice(false);
}

// ── boot ────────────────────────────────────────────────────────────────────

const harnessApi: HarnessApi = {
  snapshot: () => engine.snapshot(),
  answer: (a) => {
    answer(a);
    return snap;
  },
  events,
  saved: () => saved,
  practice: () => practice?.snapshot() ?? null,
};
(window as unknown as { __harness: HarnessApi }).__harness = harnessApi;

render();
void switchVoice(settings.kind === "typed");
void api.health().then((info) => {
  server = info;
  renderAccount();
  if (info) void sync();
});

// Speech and microphones need a user gesture: start a remembered non-typed voice on the first interaction.
if (settings.kind !== "typed") {
  const startOnGesture = (e: Event): void => {
    if ((e.target as Element | null)?.closest?.("#voice-root")) return; // the voice controls handle themselves
    window.removeEventListener("pointerdown", startOnGesture, true);
    window.removeEventListener("keydown", startOnGesture, true);
    if (!voiceStarted) void switchVoice(true);
  };
  window.addEventListener("pointerdown", startOnGesture, true);
  window.addEventListener("keydown", startOnGesture, true);
}

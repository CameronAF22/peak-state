// The question harness page: pick a state, answer the strategy questions one at a time (two suggested phrasings
// appear after the hint delay), save the strategy, then run it back with one click.
// After the first session, Practice runs the recall → rate → one question → try again loop (D-onboarding-015), and
// a signed-in account keeps the strategy and every run on the server (D-onboarding-017).
// URL options: ?hint=<ms> hint delay · ?speed=fast short playback pauses · ?voice=typed|browser|gpt-live
// · ?debug=live logs every GPT live event to the console.

import type { OnboardingEvent, RepSession } from "@peak-state/contracts";
import { createEngine } from "../engine/index.ts";
import { appendRun, clearStrategy, DEFAULT_PAUSE_MS, runsFor, runStrategy, toSecondPerson } from "../playback/index.ts";
import { createPracticeLoop, type PracticeLoop, type PracticeSnapshot } from "../practice/loop.ts";
import { reminderLine, summarize } from "../progress/index.ts";
import { conditioning, type Conditioning } from "@peak-state/reps";
import { loadRecord, newRecord, saveRecord, type StrategyRecord } from "../store/index.ts";
import { createApi, pushRecord, syncAll, type ServerInfo } from "../sync/index.ts";
import type { Answer, EngineSnapshot, VoiceAdapter, VoiceKind, VoiceStatus } from "../types.ts";
import { createVoice, loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../voice/index.ts";
import { createInterpreter, type AnswerContext, type Interpretation } from "../voice/interpret.ts";
import { screenAnswer, STOP_MESSAGE } from "../engine/safety.ts";
import { parseRating } from "../practice/rating.ts";
import { splitWords, wordTimeline } from "../voice/words.ts";
import { createHintTimer, hintDelayFromUrl } from "./hints.ts";
import { createAccountControls } from "./view/account.ts";
import { h, mount } from "./view/dom.ts";
import { createPracticeView } from "./view/practice.ts";
import { attachSpokenVoice } from "./view/spoken.ts";
import { createQuestionView } from "./view/question.ts";
import { createPlaybackPanel, renderRunLog, renderSavedCard, type PlaybackPanel } from "./view/saved.ts";
import { chainFromProfile, renderSteps, stepViewsFromProfile } from "./view/steps.ts";
import { createVoiceControls } from "./view/voice.ts";
import { createOuraWidget } from "./view/oura.ts";

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
const debugLive = params.get("debug") === "live";
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

// GPT live is the set voice for the live demo (D-onboarding-026); ?voice=typed|browser picks another one, with the full
// menu, for tests and as a fallback.
let settings: VoiceSettings = { ...loadVoiceSettings(), kind: "gpt-live" };
const urlVoice = params.get("voice");
if (urlVoice && (KINDS as string[]).includes(urlVoice)) settings = { ...settings, kind: urlVoice as VoiceKind };
const voiceFixed = !urlVoice && settings.kind === "gpt-live";

let voice: VoiceAdapter = createVoice("typed");
let voiceUnsubs: (() => void)[] = [];
let voiceStarted = false;

const controls = createVoiceControls(voiceRoot, settings, (next) => {
  settings = next;
  saveVoiceSettings(settings);
  void switchVoice(true);
}, voiceFixed);

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
    settings.kind === "gpt-live"
      ? {
          apiKey: settings.apiKey ?? "",
          model: settings.model,
          debug: debugLive,
          headers: () => api.authHeaders(),
          answerContext,
          interpret,
        }
      : undefined,
  );
  voiceUnsubs.push(voice.onStatus(setStatus), voice.onTranscript(onTranscript), attachSpokenVoice(voice));
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
      if (server?.voice && !api.account()) setTimeout(() => account?.open(), 0);
      else if (/API key/.test(String(err))) controls.openSettings();
    }
    return;
  }
  if (mode === "elicit" && snap.question) speak(snap.question.text);
  else if (practice) speakPractice(practice.snapshot());
}

// What the guide is waiting for, so GPT live waits the right time and the clean-up has context (D-onboarding-028).
const CHOICE_KINDS = new Set(["choose-state", "modality", "submodality", "fully-in", "anchor", "confirm"]);
const cleanup = createInterpreter({ headers: () => api.authHeaders() });
/** The safety screen sees what was actually heard: words it flags skip the clean-up and go straight to the engine. */
function interpret(ctx: AnswerContext, heard: string): Promise<Interpretation> {
  if (!screenAnswer(heard).ok) return Promise.resolve({ verdict: "answer", text: heard.trim() });
  return cleanup(ctx, heard);
}

function answerContext(): AnswerContext | null {
  if (mode === "saved") {
    const p = practice?.snapshot().prompt;
    if (p) return { question: p.text, choices: p.choices.map((c) => c.label), expects: p.kind === "rate" ? "number" : "open" };
    return { question: "How strongly do you feel it now, from 0 to 10?", choices: [], expects: "number" };
  }
  const q = snap.question;
  if (!q) return null;
  return { question: q.text, choices: q.choices.map((c) => c.label), expects: CHOICE_KINDS.has(q.kind) ? "choice" : "open" };
}

/** Speak without blocking the page; typed voice resolves immediately. */
function speak(text: string): void {
  if (voice.kind === "typed") return;
  voice.speak(text).catch(() => {});
}


function onTranscript(text: string, final: boolean): void {
  if (mode === "saved" && practice && practice.snapshot().prompt) {
    if (!final) practiceView.setDraft(text);
    else if (text.trim()) answerPractice({ text: text.trim(), via: "voice" });
    return;
  }
  if (mode === "saved") {
    if (!final) return;
    // Voice during a run is screened too; a stop line ends the run and shows the help message.
    if (!screenAnswer(text).ok) {
      stopRequested = true;
      showSafetyStop();
      return;
    }
    if (panel) {
      const n = parseRating(text);
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
  back: () => goBack(),
  reset: () => startOver(),
  activity: () => hints.activity(),
});

const stopSlot = h("div", {});
const transcriptBox = h("div", { class: "transcript", "data-testid": "transcript", "aria-label": "Transcript" });
const transcriptCard = h("div", { class: "card" }, h("h2", { class: "card-title" }, "Transcript"), transcriptBox);

function questionKey(s: EngineSnapshot): string {
  return s.question ? `${s.question.id}|${s.transcript.length}` : "";
}

let lastKey = "";

// ── the first session survives a reload (draft of the engine's answer log) ──

const DRAFT_KEY = "peak-state.harness.draft";
const DRAFT_MAX_AGE_MS = 14 * 86_400_000;
let draft: Answer[] = [];

function saveDraft(): void {
  try {
    if (draft.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ answers: draft, savedAt: Date.now() }));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage blocked: the draft lives for this page only */
  }
}

function loadDraft(): Answer[] {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as { answers?: Answer[]; savedAt?: number } | null;
    if (!v || !Array.isArray(v.answers) || Date.now() - (v.savedAt ?? 0) > DRAFT_MAX_AGE_MS) return [];
    return v.answers.filter((a) => a && typeof a.text === "string" && typeof a.via === "string");
  } catch {
    return [];
  }
}

function answer(a: Answer): void {
  hints.cancel();
  draft.push(a);
  apply(engine.answer(a));
  saveDraft();
}

function goBack(): void {
  draft.pop();
  apply(engine.back());
  saveDraft();
}

function startOver(): void {
  draft = [];
  apply(engine.reset());
  saveDraft();
}

function apply(next: EngineSnapshot): void {
  snap = next;
  if (snap.status === "confirmed" && snap.profile) {
    hints.cancel();
    draft = [];
    saveDraft();
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
      h("div", {}, h("button", { class: "btn", type: "button", "data-testid": "reset", onclick: () => startOver() }, "Start over")),
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
  const cond = conditioning(runs, st.stateId);
  if (practice) practiceView.render(practice.snapshot(), steps, reminder);
  mount(
    mainCol,
    renderSavedCard(
      { saved, stateLabel: st.label, chain, steps, running, practicing: practiceOpen(), reminder: runs.length ? reminder : null, revision: saved.revision, conditioning: conditioningLine(cond), anchorTest: cond.nextStep === "anchor-test" && saved.profile.states.find((x) => x.id === st.stateId)?.anchorStep != null },
      {
        run: () => void run(),
        imOff: () => void run({ trigger: { kind: "manual" } }),
        anchorTest: () => void run({ kind: "anchor-only", trigger: { kind: "manual" } }),
        practice: startPractice,
        download,
        newStrategy,
      },
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
    activeStep: activeStep ?? practiceStep(),
  });
}

/** Set when voice during a run hit the safety screen; shown above the saved view until the next run or new strategy. */
let safetyStop = false;

function showSafetyStop(): void {
  safetyStop = true;
  speak(STOP_MESSAGE);
  render();
}

function render(): void {
  if (mode === "saved") renderSavedMode();
  else renderElicit();
  if (mode === "saved" && safetyStop) {
    mainCol.prepend(
      h(
        "div",
        { class: "stop-banner", "data-testid": "stop-banner", role: "alert" },
        h("h2", {}, "Let's stop here"),
        h("p", {}, STOP_MESSAGE),
      ),
    );
  }
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
  safetyStop = false;
  saved = null;
  panel = null;
  practice = null;
  activeStep = null;
  mode = "elicit";
  lastKey = "";
  startOver();
}

/** How long to leave a line on screen when nothing is spoken (typed voice): the paced word estimate, so the
 *  spoken-word highlight reaches the last word before the line moves on. */
function readingMs(text: string): number {
  return Math.min(12_000, Math.max(1200, wordTimeline(splitWords(text)).total + 400));
}

/** The step the practice loop is recalling, lit on the horizon. */
function practiceStep(): number | null {
  const p = practice?.snapshot();
  return p && p.phase === "recall" && p.recallAt !== null ? (p.recallOrder[p.recallAt] ?? null) : null;
}

/** Where conditioning stands (D-reps-003), in one line. */
function conditioningLine(c: Conditioning): string {
  if (c.installed) return "Installed: the anchor alone brings it back.";
  if (c.nextStep === "anchor-test") return `${c.goodReps} good reps. Next, test the anchor on its own.`;
  return `${c.goodReps} good ${c.goodReps === 1 ? "rep" : "reps"} so far. ${c.goodRepsNeeded} more before the anchor test.`;
}

async function run(mode: { trigger?: RepSession["trigger"]; kind?: RepSession["kind"] } = {}): Promise<void> {
  const st = savedState();
  if (running || practiceOpen() || !saved || !st) return;
  practice = null;
  safetyStop = false;
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
      { pauseMs, repIndex: runsFor(profile.profileId, st.stateId).length, shouldStop: () => stopRequested, ...mode },
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
    // Only practice-loop tries move the detail rotation (their ids end in the try number); plain runs do not.
    questionOffset: runs.filter((r) => r.trigger.kind === "practice" && r.endedBy === "completed" && /_\d+$/.test(r.id)).length,
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

/** GPT live on the Worker needs a signed-in account; the first tap opens sign-in instead of failing. */
function needsSignIn(): boolean {
  return settings.kind === "gpt-live" && !settings.apiKey && Boolean(server?.voice) && !api.account();
}

function startLiveAfterSignIn(): void {
  if (settings.kind === "gpt-live") void switchVoice(true);
}

const account = accountRoot
  ? createAccountControls(accountRoot, {
      async create(email, code) {
        await api.createAccount(email, code);
        await sync();
        startLiveAfterSignIn();
      },
      async signIn(email, code) {
        await api.signIn(email, code);
        await sync();
        startLiveAfterSignIn();
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

let syncedOnce = false;

async function sync(): Promise<void> {
  if (!api.account() || syncing) return;
  syncing = true;
  renderAccount();
  try {
    const result = await syncAll(api);
    syncNote = null;
    const first = !syncedOnce;
    syncedOnce = true;
    if (!running && !practiceOpen() && result.record && (mode === "saved" || first)) {
      // On arrival, the account's saved strategy wins over an unfinished first session on this device, so a second
      // device never replaces it by accident; the draft is dropped. Later syncs leave a new strategy in progress alone.
      if (mode !== "saved") {
        draft = [];
        saveDraft();
        snap = engine.reset();
      }
      {
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

// The mocked Oura Ring trigger for the demo (D-onboarding-029). ?oura=off hides it.
if (params.get("oura") !== "off") document.body.append(createOuraWidget());

// Send what did not reach the account when the connection or the tab comes back.
addEventListener("online", () => void sync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && server) void sync();
});

// Pick up an unfinished first session where it was left (the engine is a pure function of its answers).
if (mode === "elicit") {
  for (const a of loadDraft()) {
    const next = engine.answer(a);
    if (next.status === "stopped") break;
    draft.push(a);
    snap = next;
  }
  if (snap.status === "confirmed") apply(snap);
}

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
    // The voice controls handle themselves; opening the Oura card is not a cue to start the voice.
    if ((e.target as Element | null)?.closest?.("#voice-root, .oura")) return;
    window.removeEventListener("pointerdown", startOnGesture, true);
    window.removeEventListener("keydown", startOnGesture, true);
    if (voiceStarted) return;
    if (needsSignIn()) {
      setStatus({ kind: settings.kind, state: "idle", detail: "Sign in to start the live voice" });
      // After this tap: the sign-in popover closes on taps outside it, and this tap is one.
      setTimeout(() => account?.open(), 0);
    } else void switchVoice(true);
  };
  window.addEventListener("pointerdown", startOnGesture, true);
  window.addEventListener("keydown", startOnGesture, true);
}

// GPT live voice: OpenAI's GPT-Live speech-to-speech model (gpt-live-1) over WebRTC, run the way ChatGPT voice runs it
// (D-onboarding-025, D-onboarding-028).
//
// GPT-Live is full duplex: it listens while it speaks, decides by itself when the person has finished, waits through
// pauses, and stops when interrupted. There are no turn-detection or speed settings; behaviour comes from the prompt
// (OpenAI "Prompting GPT-Live": style and pace, silence handling, backchannels, interruptions, delegation policy).
//
// The deterministic engine still decides every question. The model hosts the conversation:
//   speak(question)      → session.instructions.append "ask exactly …" (answering an open delegation when there is one)
//   the person answers   → GPT-Live judges the answer finished and delegates: session.delegation.created
//   the adapter          → gathers the person's words since the question from session.input_transcript.delta,
//                          drops the guide's own echo, asks the interpreter (an LLM with the question and choices)
//                          for its best guess, and emits it as the final transcript
//   not an answer yet    → session.thinking.append to that delegation: keep listening (nothing reaches the engine)
//   the harness          → feeds the engine and calls speak(next question), which answers the delegation
// If the model does not delegate, a semantic end of turn does: after a short quiet gap (shorter for a choice or a
// number) the interpreter judges whether the thought is complete, and "incomplete" keeps listening.
//
// Connection: getUserMedia → RTCPeerConnection + mic + remote audio; data channel "oai-events"; POST { session, sdp }
// to /api/live/session (Vite dev proxy or the Cloudflare Worker, which hold the key) → SDP answer; wait for
// session.started before sending anything. The startup session and each event shape live in one exported function.

import type { GptLiveConfig, VoiceAdapter } from "../types.ts";
import { createVoiceEmitter } from "./emitter.ts";
import { echoOverlap, isFillerOnly, looksUnfinished, wordsOf, type AnswerContext, type Interpretation } from "./interpret.ts";
import { splitWords } from "./words.ts";

export const DEFAULT_GPT_LIVE_MODEL = "gpt-live-1";
/** The route that holds the key and forwards to OpenAI's /v1/live/sessions (Vite dev server or the Worker). */
export const DEFAULT_LIVE_SESSION_ENDPOINT = "/api/live/session";

/** GptLiveConfig plus voice-layer-only options (types.ts is not ours to extend). */
export type GptLiveVoiceConfig = GptLiveConfig & {
  /** Milliseconds to wait for session.started. Default 20000. */
  connectTimeoutMs?: number;
  /** Quiet gap before checking whether an open answer is complete (when the model has not delegated). Default 3000. */
  answerSilenceMs?: number;
  /** The same for a choice or number answer. Default 1800. */
  shortAnswerSilenceMs?: number;
  /** Extra wait when the words stop mid-thought, and after each "incomplete" verdict. Default 2000. */
  unfinishedExtraMs?: number;
  /** Quiet output transcript that ends a spoken line. Default 1200. */
  speakQuietMs?: number;
  /** Log every GPT-Live event to the console. */
  debug?: boolean;
  /** Extra headers for the session route, e.g. the signed-in account on the Cloudflare Worker. */
  headers?: () => Record<string, string>;
  /** What the guide is waiting for, so waits adapt and the interpreter has context. */
  answerContext?: () => AnswerContext | null;
  /** Turns the raw recognised words into the person's intended answer, or says to wait, or that it was noise. */
  interpret?: (ctx: AnswerContext, heard: string) => Promise<Interpretation>;
};

/** Minimal shapes so tests can inject fakes. Real browser objects satisfy them. */
export interface DataChannelLike {
  readyState: string;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface PeerConnectionLike {
  ontrack: ((ev: { streams: readonly unknown[]; track?: unknown }) => void) | null;
  onconnectionstatechange: ((ev?: unknown) => void) | null;
  connectionState?: string;
  addTrack(track: unknown, ...streams: unknown[]): unknown;
  createDataChannel(label: string): DataChannelLike;
  createOffer(): Promise<{ type?: string; sdp?: string }>;
  setLocalDescription(desc: { type?: string; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}

export interface MediaStreamLike {
  getTracks(): { stop(): void }[];
}

export interface AudioElementLike {
  autoplay: boolean;
  muted?: boolean;
  srcObject: unknown;
  play?: () => Promise<void> | void;
}

export interface GptLiveDeps {
  fetch?: (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
  RTCPeerConnection?: new () => PeerConnectionLike;
  getUserMedia?: (constraints: { audio: boolean | Record<string, boolean> }) => Promise<MediaStreamLike>;
  audioEl?: AudioElementLike;
  /** Injected for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
}

/**
 * The guide's startup prompt, in the sections OpenAI recommends for GPT-Live: role and style, how the conversation
 * works, listening (pauses, noise, backchannels, interruptions), delegation, safety.
 */
export const GUIDE_INSTRUCTIONS = `# Role and style
You are the voice guide for Peak State, a practice tool that helps a person step back into a good state they have felt before and notice how they got there. Speak like a calm, kind person sitting with them: slowly, softly and unhurried, about 120 words a minute, with natural pauses between sentences. Keep your own words short and plain. Warm, never cheerful or clinical.

# How this conversation works
The app runs a fixed sequence of questions and gives you each one as an instruction. Ask each question exactly as written, in full. You may add one or two soft words before it, like "Okay." or "Mm, good.", when it follows an answer. Never invent, skip, reorder, merge or add questions. Never answer for the person or suggest what they might say.

# Listening
After you ask, stop and listen. Let the person answer in their own time. They may pause for a long while to remember or to feel; that is welcome. Keep listening while they pause and do not fill the silence. Do not treat breathing, a cough, music, typing or nearby conversation as an answer or a new request. Use backchannels sparingly: at most a quiet "mm" during a long answer. If the person interrupts you, stop speaking at once and listen.

# When they have answered
The app needs every answer to choose the next question, and you cannot continue without it. So after every answer, as soon as the person has clearly finished answering the current question (even a one-word answer, or "I'm there"), delegate so the app can record it and give you the next question. Before delegating, say nothing, or a brief warm acknowledgment like "Mm." Do not repeat, summarize or comment on what they said. Then wait for the app's instruction. If they ask you to repeat the question, repeat it. If you could not make out the answer, gently ask them to say it again instead of delegating. If they ask something else, answer in one short sentence and return to the current question. If the app tells you they are still answering, keep listening.

# Safety
This is a practice tool, not therapy, counselling or a crisis service. Never diagnose or give medical or mental-health advice. If the person sounds distressed or mentions harm, stop the exercise, say gently that this tool is for practice and not a crisis service, and encourage them to reach someone they trust or local emergency services.`;

/** The startup session sent with the WebRTC offer. GPT-Live rejects unknown fields, so keep it minimal. */
export function buildLiveSession(config: GptLiveVoiceConfig): Record<string, unknown> {
  const session: Record<string, unknown> = {
    model: config.model?.trim() || DEFAULT_GPT_LIVE_MODEL,
    instructions: GUIDE_INSTRUCTIONS,
    delegation: { type: "client" },
  };
  if (config.voice) session.audio = { output: { voice: config.voice } };
  return session;
}

/**
 * The event that makes the guide ask the next line. instructions.append is the most reliable way to set what GPT-Live
 * says (commentary is paraphrased). It answers the open delegation when there is one.
 */
export function buildSpeakEvent(text: string, eventId: string, delegationId: string | null = null): Record<string, unknown> {
  return {
    type: "session.instructions.append",
    event_id: eventId,
    delegation_id: delegationId,
    content: `Now say this to the person, exactly as written and in full, slowly, then stop and listen: "${text}"`,
  };
}

/** Context for an open delegation that should not produce a new question (still answering, or not an answer). */
export function buildWaitEvent(reason: "incomplete" | "noise" | "empty" | "recorded", eventId: string, delegationId: string): Record<string, unknown> {
  const content =
    reason === "recorded"
      ? "The answer is recorded. Wait quietly for the app's next instruction."
      : reason === "incomplete"
        ? "The person has not finished answering yet. Keep listening quietly and let them continue."
        : "That was not an answer to the current question. Keep listening quietly. If they stay silent for a long while, gently repeat the current question.";
  return { type: "session.thinking.append", event_id: eventId, delegation_id: delegationId, content };
}

/** Rough speaking time for a line at the guide's slow pace (2 words per second, about 120 a minute). */
export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1200, Math.round((words / 2) * 1000));
}

interface PendingSpeak {
  id: string;
  text: string;
  done: boolean;
  firstOutputAt: number | null;
  /** The guide's spoken transcript so far, and the word last reported for the highlight (D-onboarding-021). */
  heard: string;
  word: number;
  timer: unknown;
  capTimer: unknown;
  resolve: () => void;
}

interface LiveEvent {
  type?: string;
  delta?: string;
  reason?: string;
  start_ms?: number;
  end_ms?: number;
  delegation?: { id?: string; target?: string };
  error?: { message?: string; code?: string; type?: string; param?: string; client_event_id?: string } | null;
}

function describeHttpError(status: number, body: string): string {
  let message = body.trim().slice(0, 300);
  try {
    // OpenAI and the local proxy send { error: { message } }; the Cloudflare Worker sends { error: "…" }.
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    if (typeof parsed?.error === "string") message = parsed.error;
    else if (parsed?.error?.message) message = parsed.error.message;
  } catch {
    // body was not JSON
  }
  const hint =
    status === 401
      ? " Check OPENAI_API_KEY (or the key in the gear)."
      : status === 403
        ? " The key's project may not have access to this model."
        : status === 404
          ? " Check the model id, and that the page is served by `npm run harness` (it provides /api/live/session)."
          : status === 400
            ? " Check the model id and session settings."
            : status === 429
              ? " Rate limited or out of quota."
              : "";
  return `GPT live could not start a session (HTTP ${status}).${hint}${message ? ` ${message}` : ""}`;
}

export function createGptLiveVoice(config: GptLiveVoiceConfig, deps: GptLiveDeps = {}): VoiceAdapter {
  const em = createVoiceEmitter("gpt-live");
  const endpoint = config.endpoint?.trim() || DEFAULT_LIVE_SESSION_ENDPOINT;
  const answerSilenceMs = config.answerSilenceMs ?? 3000;
  const shortAnswerSilenceMs = config.shortAnswerSilenceMs ?? 1800;
  const unfinishedExtraMs = config.unfinishedExtraMs ?? 2000;
  const speakQuietMs = config.speakQuietMs ?? 1200;
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = deps.now ?? (() => Date.now());
  const log = (...args: unknown[]) => {
    if (config.debug) console.debug("[gpt-live]", ...args);
  };

  let pc: PeerConnectionLike | null = null;
  let dc: DataChannelLike | null = null;
  let stream: MediaStreamLike | null = null;
  let audioEl: AudioElementLike | null = null;
  let session = 0; // bumps on stop() so late async steps from an old start() do nothing
  let eventSeq = 0;
  let started = false;
  let connectTimer: unknown;
  let onStarted: ((err?: Error) => void) | null = null;
  const pending: PendingSpeak[] = [];
  /** The person's words since the current question. */
  let heard = "";
  /** Words heard while the guide was speaking, held until judged echo or a real barge-in. */
  let overlapHeard = "";
  let bargedIn = false;
  let lastLine = "";
  /** The delegation GPT-Live opened when it judged the answer finished; the next speak() answers it. */
  let delegation: string | null = null;
  let fallbackTimer: unknown;
  let recordedTimer: unknown;
  let echoTailUntil = 0;
  let interpretSeq = 0;
  let incompletes = 0;

  const nextId = (kind: string): string => `peak_${kind}_${now().toString(36)}_${++eventSeq}`;
  const tidy = (t: string): string => t.trim().replace(/\s+/g, " ");

  function fail(detail: string): void {
    em.setStatus("error", detail);
  }

  function send(ev: Record<string, unknown>): boolean {
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(ev));
      log("→", ev.type, ev.delegation_id ?? "", typeof ev.content === "string" ? ev.content : "");
      return true;
    } catch (err) {
      fail(`GPT live could not send ${String(ev.type)} (${(err as Error)?.message ?? err}).`);
      return false;
    }
  }

  function clearTimer(t: unknown): undefined {
    if (t !== undefined) clearT(t);
    return undefined;
  }

  // ── the guide speaking ──

  function settle(p: PendingSpeak): void {
    if (p.done) return;
    p.done = true;
    p.timer = clearTimer(p.timer);
    p.capTimer = clearTimer(p.capTimer);
    if (p.firstOutputAt !== null) em.emitWord(splitWords(p.text).length, p.text);
    const i = pending.indexOf(p);
    if (i >= 0) pending.splice(i, 1);
    if (pending.length === 0) {
      if (em.status().state === "speaking") em.setStatus("ready");
      echoTailUntil = now() + 700; // the room echo of the last syllables
    }
    p.resolve();
  }

  function settleAll(): void {
    for (const p of [...pending]) settle(p);
  }

  /** Output transcript for the current line: move the word highlight, finish once it goes quiet and had time. */
  function onOutputActivity(delta: string): void {
    const p = pending[0];
    if (!p) return; // the model speaking on its own (an acknowledgment, a repeat): nothing to track
    const t = now();
    if (p.firstOutputAt === null) p.firstOutputAt = t;
    p.heard += delta;
    // Count from where the line itself starts, so a soft lead-in ("Mm. Okay.") does not move the highlight ahead.
    const lineWords = wordsOf(p.text);
    const saidWords = wordsOf(p.heard);
    const from = lineWords.length ? saidWords.indexOf(lineWords[0]!) : -1;
    const total = splitWords(p.text).length;
    const word = from < 0 ? -1 : Math.min(saidWords.length - from - 1, total - 1);
    if (word > p.word) {
      p.word = word;
      em.emitWord(word, p.text);
    }
    const finishAt = Math.max(t + speakQuietMs, p.firstOutputAt + estimateSpeechMs(p.text));
    clearTimer(p.timer);
    p.timer = setT(() => settle(p), finishAt - t);
  }

  // ── the person answering ──

  function context(): AnswerContext {
    return config.answerContext?.() ?? { question: lastLine, choices: [], expects: "open" };
  }

  /**
   * Semantic end of turn when GPT-Live has not delegated: after a quiet gap that adapts to the question, to trailing
   * off, and to earlier "incomplete" verdicts, the interpreter decides whether the answer is complete.
   */
  function armFallback(): void {
    clearTimer(fallbackTimer);
    const base = context().expects === "open" ? answerSilenceMs : shortAnswerSilenceMs;
    fallbackTimer = setT(() => {
      fallbackTimer = undefined;
      void finalize("silence");
    }, base + (looksUnfinished(heard) ? unfinishedExtraMs : 0) + incompletes * unfinishedExtraMs);
  }

  function hear(delta: string): void {
    heard += delta;
    const sofar = tidy(heard);
    if (!sofar) return;
    em.emitTranscript(sofar, false);
    if (em.status().state === "ready") em.setStatus("listening");
    armFallback();
  }

  /** Reply to the open delegation without a new question. */
  function holdDelegation(reason: "incomplete" | "noise" | "empty" | "recorded"): void {
    if (!delegation) return;
    send(buildWaitEvent(reason, nextId("wait"), delegation));
    delegation = null;
  }

  async function finalize(source: "delegation" | "silence"): Promise<void> {
    fallbackTimer = clearTimer(fallbackTimer);
    const raw = tidy(heard);
    if (!raw || isFillerOnly(raw)) {
      if (source === "delegation") holdDelegation("empty");
      if (!raw) return;
      heard = "";
      em.emitTranscript("", false);
      if (em.status().state === "listening") em.setStatus("ready");
      return;
    }
    const mine = ++interpretSeq;
    const asked = heard;
    let v: Interpretation = { verdict: "answer", text: raw };
    if (config.interpret) {
      em.setStatus("listening", "Making sure I heard you");
      try {
        v = await config.interpret(context(), raw);
      } catch {
        v = { verdict: "answer", text: raw };
      }
    }
    // A new question started, or the person kept talking: a later pass handles the fuller answer.
    if (mine !== interpretSeq) return;
    if (heard !== asked) {
      if (source === "delegation") holdDelegation("incomplete");
      return;
    }
    log("interpret", v.verdict, v.text);
    if (v.verdict === "incomplete" && incompletes < 2) {
      incompletes++;
      holdDelegation("incomplete");
      armFallback();
      return;
    }
    if (v.verdict === "noise") {
      heard = "";
      incompletes = 0;
      holdDelegation("noise");
      em.emitTranscript("", false);
      em.setStatus("ready");
      return;
    }
    heard = "";
    incompletes = 0;
    em.setStatus("ready");
    em.emitTranscript(v.verdict === "answer" && v.text ? v.text : raw, true);
    // The harness answers with speak(next question). If it does not (the end, or a screen change), release the model.
    recordedTimer = clearTimer(recordedTimer);
    if (delegation) recordedTimer = setT(() => holdDelegation("recorded"), 2500);
  }

  function handleEvent(ev: LiveEvent): void {
    log("←", ev.type, ev.error ?? ev.delta ?? ev.reason ?? ev.delegation?.id ?? "");
    switch (ev.type) {
      case "session.started":
        started = true;
        onStarted?.();
        return;

      case "session.output_transcript.delta":
        onOutputActivity(ev.delta ?? "");
        return;

      case "session.input_transcript.delta": {
        const delta = ev.delta ?? "";
        const guideTalking = pending.length > 0 || now() < echoTailUntil;
        if (!guideTalking || bargedIn) return hear(delta);
        // The guide's own voice can come back through the mic. Hold what is heard until it is clearly the person
        // (three words or more, mostly not the guide's line), then treat it as a barge-in.
        overlapHeard += delta;
        const words = tidy(overlapHeard).split(" ").filter(Boolean);
        if (words.length >= 3 && !isFillerOnly(overlapHeard) && echoOverlap(overlapHeard, pending[0]?.text ?? lastLine) < 0.4) {
          bargedIn = true;
          const said = overlapHeard;
          overlapHeard = "";
          hear(said);
        }
        return;
      }

      case "session.delegation.created": {
        // GPT-Live judged the answer finished (or wants the app). Answer with the next question or a hold.
        if (delegation) holdDelegation("recorded");
        delegation = ev.delegation?.id ?? null;
        if (!delegation) return;
        void finalize("delegation");
        return;
      }

      case "session.closed":
        if (em.status().state !== "idle") fail(`GPT live session ended (${ev.reason ?? "closed"}). Switch the voice off and on to reconnect.`);
        settleAll();
        return;

      case "error": {
        const msg = ev.error?.message ?? "Unknown GPT live error.";
        const where = ev.error?.param ? ` (${ev.error.param})` : "";
        if (!started && onStarted) {
          onStarted(new Error(`GPT live refused the session: ${msg}${where}`));
          return;
        }
        fail(`GPT live error: ${msg}${where}`);
        const ref = ev.error?.client_event_id;
        const p = ref ? pending.find((x) => x.id === ref) : undefined;
        if (p) settle(p);
        return;
      }

      default:
        // session.instructions.appended, session.thinking.appended, session.usage.updated, … need nothing.
        return;
    }
  }

  function teardown(): void {
    for (const t of [connectTimer, fallbackTimer, recordedTimer]) if (t !== undefined) clearT(t);
    connectTimer = fallbackTimer = recordedTimer = undefined;
    delegation = null;
    overlapHeard = "";
    bargedIn = false;
    onStarted = null;
    started = false;
    heard = "";
    if (dc) {
      dc.onopen = dc.onmessage = dc.onclose = dc.onerror = null;
      try {
        dc.close();
      } catch {
        // ignore
      }
    }
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    if (stream) for (const t of stream.getTracks()) t.stop();
    if (audioEl) audioEl.srcObject = null;
    dc = null;
    pc = null;
    stream = null;
    settleAll();
  }

  async function start(): Promise<void> {
    teardown();
    const mine = ++session;
    const stale = () => mine !== session;

    const fetchFn = deps.fetch ?? (globalThis.fetch as unknown as GptLiveDeps["fetch"]);
    const PC = deps.RTCPeerConnection ?? (globalThis as unknown as { RTCPeerConnection?: new () => PeerConnectionLike }).RTCPeerConnection;
    const gum =
      deps.getUserMedia ??
      ((c: { audio: boolean | Record<string, boolean> }) => {
        type Gum = (c: { audio: boolean | Record<string, boolean> }) => Promise<MediaStreamLike>;
        const md = (globalThis as unknown as { navigator?: { mediaDevices?: { getUserMedia?: Gum } } }).navigator?.mediaDevices;
        if (!md?.getUserMedia) return Promise.reject(new Error("getUserMedia is not available"));
        return md.getUserMedia(c);
      });
    if (!fetchFn || !PC) {
      const detail = "This browser has no WebRTC support, so GPT live cannot connect. Use browser or typed voice.";
      fail(detail);
      throw new Error(detail);
    }

    em.setStatus("connecting");
    try {
      try {
        // Echo cancellation keeps the guide's voice out of the open mic; noise suppression drops room sound.
        stream = await gum({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch (err) {
        throw new Error(`Microphone unavailable or permission denied (${(err as Error)?.message ?? err}). Allow the microphone or type your answers.`);
      }
      if (stale()) return;

      const conn = new PC();
      pc = conn;

      audioEl = deps.audioEl ?? null;
      if (!audioEl) {
        const doc = (globalThis as unknown as { document?: Document }).document;
        if (doc) audioEl = doc.createElement("audio") as unknown as AudioElementLike;
      }
      if (audioEl) audioEl.autoplay = true;
      conn.ontrack = (ev) => {
        if (!audioEl) return;
        audioEl.srcObject = ev.streams[0] ?? null;
        try {
          const r = audioEl.play?.();
          if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
        } catch {
          // autoplay is allowed after the user gesture that started the session
        }
      };
      conn.onconnectionstatechange = () => {
        if (stale()) return;
        if (conn.connectionState === "failed" || conn.connectionState === "disconnected") {
          fail(`GPT live connection ${conn.connectionState}. Restart the voice or switch to browser or typed voice.`);
          settleAll();
        }
      };

      for (const track of stream.getTracks()) conn.addTrack(track, stream);

      const channel = conn.createDataChannel("oai-events");
      dc = channel;
      const ready = new Promise<void>((resolve, reject) => {
        connectTimer = setT(() => reject(new Error("Timed out waiting for the GPT live session to start.")), config.connectTimeoutMs ?? 20_000);
        onStarted = (err) => {
          if (connectTimer !== undefined) clearT(connectTimer);
          connectTimer = undefined;
          onStarted = null;
          if (err) reject(err);
          else resolve();
        };
        channel.onerror = () => reject(new Error("The GPT live data channel failed."));
      });
      ready.catch(() => {}); // handled below; avoid an unhandled rejection if an earlier step throws
      channel.onmessage = (ev) => {
        if (stale()) return;
        let parsed: LiveEvent;
        try {
          parsed = JSON.parse(String(ev.data)) as LiveEvent;
        } catch {
          return;
        }
        handleEvent(parsed);
      };
      channel.onclose = () => {
        if (stale()) return;
        if (em.status().state !== "idle") fail("GPT live session closed.");
        settleAll();
      };

      const offer = await conn.createOffer();
      await conn.setLocalDescription(offer);
      if (stale()) return;

      const headers: Record<string, string> = { ...(config.headers?.() ?? {}), "Content-Type": "application/json" };
      // Only sent to the local harness route, which prefers OPENAI_API_KEY from its own environment.
      if (config.apiKey?.trim()) headers["x-openai-key"] = config.apiKey.trim();
      let res;
      try {
        res = await fetchFn(endpoint, {
          method: "POST",
          body: JSON.stringify({ session: buildLiveSession(config), sdp: offer.sdp ?? "" }),
          headers,
        });
      } catch (err) {
        throw new Error(`Could not reach the GPT live session route (${(err as Error)?.message ?? err}).`);
      }
      const body = await res.text();
      if (stale()) return;
      if (!res.ok) throw new Error(describeHttpError(res.status, body));

      let answer: string | undefined;
      try {
        const parsed = JSON.parse(body) as { transport?: { sdp?: string }; sdp?: string };
        answer = parsed.transport?.sdp ?? parsed.sdp;
      } catch {
        if (body.trimStart().startsWith("v=")) answer = body; // raw SDP answer
      }
      if (!answer) throw new Error(`GPT live session started without an SDP answer: ${body.slice(0, 200)}`);

      await conn.setRemoteDescription({ type: "answer", sdp: answer });
      await ready;
      if (stale()) return;
      em.setStatus("ready");
    } catch (err) {
      if (stale()) return;
      const detail = (err as Error)?.message ?? String(err);
      teardown();
      fail(detail);
      throw err instanceof Error ? err : new Error(detail);
    }
  }

  return {
    kind: "gpt-live",
    start,

    stop() {
      session++;
      send({ type: "session.close" });
      teardown();
      em.setStatus("idle");
    },

    speak(text: string) {
      if (!text.trim() || !started || !dc || dc.readyState !== "open") return Promise.resolve();
      const id = nextId("speak");
      // A new question ends whatever answer was in progress.
      fallbackTimer = clearTimer(fallbackTimer);
      recordedTimer = clearTimer(recordedTimer);
      heard = "";
      overlapHeard = "";
      bargedIn = false;
      incompletes = 0;
      interpretSeq++;
      lastLine = text;
      const answering = delegation;
      delegation = null;
      return new Promise<void>((resolve) => {
        const p: PendingSpeak = { id, text, done: false, firstOutputAt: null, heard: "", word: -1, timer: undefined, capTimer: undefined, resolve };
        pending.push(p);
        em.setStatus("speaking");
        // If no output transcript arrives, assume the line took about its estimated time; a hard cap so a lost event
        // never hangs the harness.
        p.timer = setT(() => settle(p), estimateSpeechMs(text) + 4000);
        p.capTimer = setT(() => settle(p), 20_000 + 90 * text.length);
        if (!send(buildSpeakEvent(text, id, answering))) settle(p);
      });
    },

    onTranscript: em.onTranscript,
    onStatus: em.onStatus,
    onWord: em.onWord,
  };
}

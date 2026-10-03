// GPT live voice: OpenAI's GPT-Live speech-to-speech model (gpt-live-1) over WebRTC (D-onboarding-020).
//
// The model is only a voice. The deterministic engine decides every question; this adapter hands the
// model each line to say and streams back transcripts of what the person says.
//
// Flow (OpenAI GPT-Live WebRTC):
//   getUserMedia(audio) → RTCPeerConnection + mic track + remote audio → <audio>
//   data channel "oai-events" → createOffer / setLocalDescription
//   POST { session, sdp } to the harness route /api/live/session (harness/live-proxy.ts), which adds the
//   project key and calls POST https://api.openai.com/v1/live/sessions → { transport: { sdp: answer } }
//   setRemoteDescription(answer) → wait for "session.started" before sending anything.
//
// GPT-Live is full duplex and has no response.create (without Responses delegation), no turn-detection
// settings and no completed-transcript event. So:
//   - speak() sends session.commentary.append, mutes the mic while the guide talks, and treats the line
//     as finished when the output transcript goes quiet (with a duration estimate and a hard cap);
//   - the remote audio is muted outside speak(), so replies the model makes on its own are not heard;
//   - answers are built from session.input_transcript.delta fragments and are final after a silence gap.
//
// The startup session and the per-line event each live in one exported function so the wire shape is
// easy to fix if the API differs.

import type { GptLiveConfig, VoiceAdapter } from "../types.ts";
import { createVoiceEmitter } from "./emitter.ts";

export const DEFAULT_GPT_LIVE_MODEL = "gpt-live-1";
/** The harness dev server's route; it holds the key and forwards to OpenAI's /v1/live/sessions. */
export const DEFAULT_LIVE_SESSION_ENDPOINT = "/api/live/session";

/** GptLiveConfig plus voice-layer-only options (types.ts is not ours to extend). */
export type GptLiveVoiceConfig = GptLiveConfig & {
  /** Milliseconds to wait for session.started. Default 20000. */
  connectTimeoutMs?: number;
  /** Silence after the last heard fragment that ends an answer. Default 1800. */
  answerSilenceMs?: number;
  /** Quiet output transcript that ends a spoken line. Default 900. */
  speakQuietMs?: number;
  /** Log every GPT-Live event to the console. */
  debug?: boolean;
  /** Extra headers for the session route, e.g. the signed-in account on the Cloudflare Worker. */
  headers?: () => Record<string, string>;
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
  getUserMedia?: (constraints: { audio: boolean }) => Promise<MediaStreamLike>;
  audioEl?: AudioElementLike;
  /** Injected for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
}

const GUIDE_INSTRUCTIONS = [
  "You are the speaking voice of a scripted guide in a wellbeing app called Peak State.",
  "You do not run the conversation. A program decides every line and sends it to you as commentary.",
  "When you receive commentary, say it aloud exactly as written, word for word, in a calm, warm, unhurried voice.",
  "Never add your own questions, greetings, commentary, summaries, follow-ups, or reactions to what the person said.",
  "When the person speaks, listen and stay silent. Do not answer them, acknowledge them, or ask for anything. Wait for the next commentary.",
  "Never give therapy, counselling, diagnosis, medical or mental-health advice.",
].join(" ");

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

/** The event that makes the model say one line. eventId comes back as error.client_event_id. */
export function buildSpeakEvent(text: string, eventId: string): Record<string, unknown> {
  return { type: "session.commentary.append", event_id: eventId, delegation_id: null, content: text };
}

/** Rough speaking time for a line (2.6 words per second, as in D-reps-010). */
export function estimateSpeechMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1200, Math.round((words / 2.6) * 1000));
}

interface PendingSpeak {
  id: string;
  text: string;
  done: boolean;
  firstOutputAt: number | null;
  timer: unknown;
  capTimer: unknown;
  resolve: () => void;
}

interface LiveEvent {
  type?: string;
  delta?: string;
  reason?: string;
  delegation?: { id?: string };
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
  const answerSilenceMs = config.answerSilenceMs ?? 1800;
  const speakQuietMs = config.speakQuietMs ?? 900;
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
  let speakSeq = 0;
  let started = false;
  let connectTimer: unknown;
  let onStarted: ((err?: Error) => void) | null = null;
  const pending: PendingSpeak[] = [];
  let heard = ""; // the answer so far, joined from input transcript fragments
  let answerTimer: unknown;
  let afterSpeakTimer: unknown;

  function fail(detail: string): void {
    em.setStatus("error", detail);
  }

  function send(ev: Record<string, unknown>): boolean {
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(ev));
      log("→", ev.type);
      return true;
    } catch (err) {
      fail(`GPT live could not send ${String(ev.type)} (${(err as Error)?.message ?? err}).`);
      return false;
    }
  }

  function setRemoteAudible(on: boolean): void {
    if (audioEl) audioEl.muted = !on;
  }

  function settle(p: PendingSpeak): void {
    if (p.done) return;
    p.done = true;
    if (p.timer !== undefined) clearT(p.timer);
    if (p.capTimer !== undefined) clearT(p.capTimer);
    const i = pending.indexOf(p);
    if (i >= 0) pending.splice(i, 1);
    if (pending.length === 0) {
      if (em.status().state === "speaking") em.setStatus("ready");
      // Let the last syllables and room echo die away, then listen and silence the model again.
      if (afterSpeakTimer !== undefined) clearT(afterSpeakTimer);
      afterSpeakTimer = setT(() => {
        afterSpeakTimer = undefined;
        if (pending.length > 0) return;
        send({ type: "session.input_audio.unmute" });
        setRemoteAudible(false);
      }, 400);
    }
    p.resolve();
  }

  function settleAll(): void {
    for (const p of [...pending]) settle(p);
  }

  /** Output transcript activity for the current line: finish once it goes quiet and the line had time. */
  function onOutputActivity(): void {
    const p = pending[0];
    if (!p) return;
    const t = now();
    if (p.firstOutputAt === null) p.firstOutputAt = t;
    const finishAt = Math.max(t + speakQuietMs, p.firstOutputAt + estimateSpeechMs(p.text));
    if (p.timer !== undefined) clearT(p.timer);
    p.timer = setT(() => settle(p), finishAt - t);
  }

  function finalizeAnswer(): void {
    answerTimer = undefined;
    const text = heard.trim().replace(/\s+/g, " ");
    heard = "";
    if (text) em.emitTranscript(text, true);
    if (pending.length === 0 && em.status().state === "listening") em.setStatus("ready");
  }

  function handleEvent(ev: LiveEvent): void {
    log("←", ev.type, ev.error ?? ev.delta ?? ev.reason ?? "");
    switch (ev.type) {
      case "session.started":
        started = true;
        onStarted?.();
        return;

      case "session.output_transcript.delta":
        onOutputActivity();
        return;

      case "session.input_transcript.delta": {
        // The mic is muted while the guide speaks; anything that still arrives then is echo.
        if (pending.length > 0 || afterSpeakTimer !== undefined) return;
        heard += ev.delta ?? "";
        const sofar = heard.trim().replace(/\s+/g, " ");
        if (!sofar) return;
        em.emitTranscript(sofar, false);
        if (em.status().state === "ready") em.setStatus("listening");
        if (answerTimer !== undefined) clearT(answerTimer);
        answerTimer = setT(finalizeAnswer, answerSilenceMs);
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
        // session.commentary.appended, session.usage.updated, session.delegation.created, … need nothing.
        return;
    }
  }

  function teardown(): void {
    for (const t of [connectTimer, answerTimer, afterSpeakTimer]) if (t !== undefined) clearT(t);
    connectTimer = answerTimer = afterSpeakTimer = undefined;
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
      ((c: { audio: boolean }) => {
        const md = (globalThis as unknown as { navigator?: { mediaDevices?: { getUserMedia?: (c: { audio: boolean }) => Promise<MediaStreamLike> } } }).navigator?.mediaDevices;
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
        stream = await gum({ audio: true });
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
      setRemoteAudible(false); // nothing is heard until the first speak()
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
      const id = `peak_speak_${now().toString(36)}_${++speakSeq}`;
      // A new question ends whatever answer was in progress.
      if (answerTimer !== undefined) {
        clearT(answerTimer);
        answerTimer = undefined;
      }
      heard = "";
      if (afterSpeakTimer !== undefined) {
        clearT(afterSpeakTimer);
        afterSpeakTimer = undefined;
      }
      return new Promise<void>((resolve) => {
        const p: PendingSpeak = { id, text, done: false, firstOutputAt: null, timer: undefined, capTimer: undefined, resolve };
        pending.push(p);
        em.setStatus("speaking");
        send({ type: "session.input_audio.mute" });
        setRemoteAudible(true);
        // If no output transcript arrives, assume the line took about its estimated time.
        p.timer = setT(() => settle(p), estimateSpeechMs(text) + 3000);
        // Hard cap so a lost event never hangs the harness.
        p.capTimer = setT(() => settle(p), 15_000 + 70 * text.length);
        if (!send(buildSpeakEvent(text, id))) settle(p);
      });
    },

    onTranscript: em.onTranscript,
    onStatus: em.onStatus,
  };
}

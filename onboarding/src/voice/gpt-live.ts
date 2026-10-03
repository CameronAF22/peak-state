// GPT live voice: an OpenAI Realtime speech-to-speech model over WebRTC.
//
// The model is only a voice. The deterministic engine decides every question; this adapter asks the
// model to say that exact text and streams back transcripts of what the person says. Server VAD
// detects turns but never triggers a reply on its own (turn_detection.create_response = false):
// the model speaks only when speak() sends a response.create.
//
// Flow (OpenAI Realtime WebRTC):
//   getUserMedia(audio) → RTCPeerConnection + mic track + remote audio → <audio autoplay>
//   data channel "oai-events" → createOffer / setLocalDescription
//   POST offer SDP to `${endpoint}?model=…` (Content-Type application/sdp, Bearer apiKey)
//   setRemoteDescription(answer) → on channel open, send session.update.
//
// The model id is a setting (default "gpt-live-1"), and the wire shapes for session.update and
// response.create each live in one exported function so they are easy to fix if the API differs.

import type { GptLiveConfig, VoiceAdapter } from "../types.ts";
import { createVoiceEmitter } from "./emitter.ts";

export const DEFAULT_GPT_LIVE_MODEL = "gpt-live-1";
export const DEFAULT_REALTIME_ENDPOINT = "https://api.openai.com/v1/realtime/calls";
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";

/** GptLiveConfig plus voice-layer-only options (types.ts is not ours to extend). */
export type GptLiveVoiceConfig = GptLiveConfig & {
  /** Model for input audio transcription. Default "gpt-4o-transcribe". */
  transcribeModel?: string;
  /** Fetches a short-lived key when apiKey is empty (the server's /api/realtime/token). */
  getApiKey?: () => Promise<string>;
  /** Milliseconds to wait for the data channel to open. Default 20000. */
  connectTimeoutMs?: number;
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
}

const GUIDE_INSTRUCTIONS = [
  "You are the speaking voice of a scripted guide in a wellbeing app called Peak State.",
  "You do not run the conversation. A program decides every line.",
  "When asked to speak, say ONLY the exact text you are given, word for word, in a calm, warm, unhurried voice.",
  "Never add your own questions, greetings, commentary, summaries, follow-ups, or reactions to what the person said.",
  "Never reply to the person on your own. If you are not given text to say, stay silent.",
  "Never give therapy, counselling, diagnosis, medical or mental-health advice.",
].join(" ");

/**
 * The session.update event sent when the data channel opens. Uses the GA Realtime session shape
 * (session.type "realtime", audio.input / audio.output). If the API rejects it, fix it here only.
 */
export function buildSessionUpdate(config: GptLiveVoiceConfig): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  if (config.voice) output.voice = config.voice;
  return {
    type: "session.update",
    session: {
      type: "realtime",
      instructions: GUIDE_INSTRUCTIONS,
      audio: {
        input: {
          transcription: { model: config.transcribeModel ?? DEFAULT_TRANSCRIBE_MODEL },
          turn_detection: {
            type: "server_vad",
            // The app decides when the model speaks. VAD only marks turns for transcription.
            create_response: false,
            interrupt_response: false,
          },
        },
        ...(Object.keys(output).length > 0 ? { output } : {}),
      },
    },
  };
}

/** The exact instruction given to the model for one line. */
export function speakInstruction(text: string): string {
  return `Say exactly this, word for word, and nothing else: "${text}"`;
}

/** The response.create event for one spoken line. speakId is echoed back in response.metadata. */
export function buildSpeakEvent(text: string, speakId: string): Record<string, unknown> {
  return {
    type: "response.create",
    event_id: speakId,
    response: {
      instructions: speakInstruction(text),
      metadata: { peak_speak_id: speakId },
    },
  };
}

interface PendingSpeak {
  id: string;
  responseId: string | null;
  audioStarted: boolean;
  done: boolean;
  timer: unknown;
  resolve: () => void;
}

interface RealtimeEvent {
  type?: string;
  event_id?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  response_id?: string;
  response?: { id?: string; status?: string; metadata?: Record<string, unknown> | null; status_details?: unknown };
  error?: { message?: string; code?: string; type?: string; event_id?: string } | null;
}

function describeHttpError(status: number, body: string): string {
  let message = body.trim().slice(0, 300);
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed?.error?.message) message = parsed.error.message;
  } catch {
    // body was not JSON
  }
  const hint =
    status === 401
      ? " Check the API key."
      : status === 404 || status === 400
        ? " Check the model id and endpoint in voice settings."
        : status === 429
          ? " Rate limited or out of quota."
          : "";
  return `OpenAI Realtime refused the connection (HTTP ${status}).${hint}${message ? ` ${message}` : ""}`;
}

export function createGptLiveVoice(config: GptLiveVoiceConfig, deps: GptLiveDeps = {}): VoiceAdapter {
  const em = createVoiceEmitter("gpt-live");
  const model = config.model?.trim() || DEFAULT_GPT_LIVE_MODEL;
  const endpoint = config.endpoint?.trim() || DEFAULT_REALTIME_ENDPOINT;
  const setT = deps.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let pc: PeerConnectionLike | null = null;
  let dc: DataChannelLike | null = null;
  let stream: MediaStreamLike | null = null;
  let audioEl: AudioElementLike | null = null;
  let session = 0; // bumps on stop() so late async steps from an old start() do nothing
  let speakSeq = 0;
  let connectTimer: unknown;
  const pending: PendingSpeak[] = [];
  const partials = new Map<string, string>(); // item_id → transcript so far

  function fail(detail: string): void {
    em.setStatus("error", detail);
  }

  function settle(p: PendingSpeak): void {
    if (p.done) return;
    p.done = true;
    if (p.timer !== undefined) clearT(p.timer);
    const i = pending.indexOf(p);
    if (i >= 0) pending.splice(i, 1);
    if (pending.length === 0 && em.status().state === "speaking") em.setStatus("ready");
    p.resolve();
  }

  function settleAll(): void {
    for (const p of [...pending]) settle(p);
  }

  function findSpeak(ev: RealtimeEvent): PendingSpeak | undefined {
    const rid = ev.response?.id ?? ev.response_id;
    const meta = ev.response?.metadata?.peak_speak_id;
    if (typeof meta === "string") {
      const byMeta = pending.find((p) => p.id === meta);
      if (byMeta) return byMeta;
    }
    if (rid) {
      const byId = pending.find((p) => p.responseId === rid);
      if (byId) return byId;
    }
    return undefined;
  }

  function handleEvent(ev: RealtimeEvent): void {
    switch (ev.type) {
      case "session.created":
      case "session.updated":
        return;

      case "response.created": {
        const p = findSpeak(ev) ?? pending.find((x) => x.responseId === null);
        if (p && ev.response?.id) p.responseId = ev.response.id;
        return;
      }

      case "output_audio_buffer.started": {
        const p = findSpeak(ev);
        if (p) p.audioStarted = true;
        return;
      }

      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared": {
        const p = findSpeak(ev);
        if (p) settle(p);
        return;
      }

      case "response.done": {
        const p = findSpeak(ev);
        if (!p) return;
        const status = ev.response?.status;
        if (status === "failed") {
          fail(`GPT live could not speak the line (${JSON.stringify(ev.response?.status_details ?? "failed")}).`);
          settle(p);
          return;
        }
        // Over WebRTC, response.done arrives when generation ends; audio may still be playing.
        // If playback started, wait for output_audio_buffer.stopped, with a short safety net.
        if (!p.audioStarted) {
          settle(p);
        } else {
          if (p.timer !== undefined) clearT(p.timer);
          p.timer = setT(() => settle(p), 8000);
        }
        return;
      }

      case "input_audio_buffer.speech_started":
        if (pending.length === 0) em.setStatus("listening");
        return;

      case "input_audio_buffer.speech_stopped":
        if (pending.length === 0) em.setStatus("ready");
        return;

      case "conversation.item.input_audio_transcription.delta": {
        const key = ev.item_id ?? "";
        const so_far = (partials.get(key) ?? "") + (ev.delta ?? "");
        partials.set(key, so_far);
        if (so_far.trim()) em.emitTranscript(so_far.trim(), false);
        return;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const key = ev.item_id ?? "";
        partials.delete(key);
        const text = (ev.transcript ?? "").trim();
        if (text) em.emitTranscript(text, true);
        return;
      }

      case "conversation.item.input_audio_transcription.failed":
        fail(`Transcription failed${ev.error?.message ? `: ${ev.error.message}` : ""}. You can type your answer.`);
        return;

      case "error": {
        const msg = ev.error?.message ?? "Unknown Realtime error.";
        fail(`GPT live error: ${msg}`);
        const ref = ev.error?.event_id;
        const p = ref ? pending.find((x) => x.id === ref) : undefined;
        if (p) settle(p);
        return;
      }

      default:
        return;
    }
  }

  function teardown(): void {
    if (connectTimer !== undefined) {
      clearT(connectTimer);
      connectTimer = undefined;
    }
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
    partials.clear();
    settleAll();
  }

  async function start(): Promise<void> {
    teardown();
    const mine = ++session;
    const stale = () => mine !== session;

    // A typed key wins; otherwise ask the server for a short-lived one (D-onboarding-017).
    let apiKey = config.apiKey?.trim() ?? "";
    if (!apiKey && config.getApiKey) {
      try {
        apiKey = (await config.getApiKey()).trim();
      } catch (err) {
        if (stale()) return;
        const detail = `Could not get a GPT live key from the server (${(err as Error)?.message ?? err}).`;
        fail(detail);
        throw new Error(detail);
      }
      if (stale()) return;
    }
    if (!apiKey) {
      const detail = "GPT live needs an OpenAI API key. Add one in voice settings, or use browser or typed voice.";
      fail(detail);
      throw new Error(detail);
    }

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
        if (doc) {
          const el = doc.createElement("audio");
          el.autoplay = true;
          audioEl = el as unknown as AudioElementLike;
        }
      }
      if (audioEl) audioEl.autoplay = true;
      conn.ontrack = (ev) => {
        if (audioEl) {
          audioEl.srcObject = ev.streams[0] ?? null;
          try {
            const r = audioEl.play?.();
            if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
          } catch {
            // autoplay is allowed after the user gesture that started the session
          }
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
      const opened = new Promise<void>((resolve, reject) => {
        const timer = setT(
          () => reject(new Error("Timed out waiting for the GPT live session to open.")),
          config.connectTimeoutMs ?? 20_000,
        );
        connectTimer = timer;
        channel.onopen = () => {
          clearT(timer);
          connectTimer = undefined;
          try {
            channel.send(JSON.stringify(buildSessionUpdate(config)));
          } catch (err) {
            reject(err);
            return;
          }
          resolve();
        };
        channel.onerror = () => {
          clearT(timer);
          connectTimer = undefined;
          reject(new Error("The GPT live data channel failed."));
        };
      });
      opened.catch(() => {}); // handled below; avoid unhandled rejection if an earlier step throws
      channel.onmessage = (ev) => {
        if (stale()) return;
        let parsed: RealtimeEvent;
        try {
          parsed = JSON.parse(String(ev.data)) as RealtimeEvent;
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

      const url = `${endpoint}?model=${encodeURIComponent(model)}`;
      let res;
      try {
        res = await fetchFn(url, {
          method: "POST",
          body: offer.sdp ?? "",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/sdp" },
        });
      } catch (err) {
        throw new Error(`Could not reach OpenAI Realtime (${(err as Error)?.message ?? err}).`);
      }
      const body = await res.text();
      if (stale()) return;
      if (!res.ok) throw new Error(describeHttpError(res.status, body));

      await conn.setRemoteDescription({ type: "answer", sdp: body });
      await opened;
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
      teardown();
      em.setStatus("idle");
    },

    speak(text: string) {
      const channel = dc;
      if (!text.trim() || !channel || channel.readyState !== "open") return Promise.resolve();
      const id = `peak_speak_${Date.now().toString(36)}_${++speakSeq}`;
      return new Promise<void>((resolve) => {
        const p: PendingSpeak = { id, responseId: null, audioStarted: false, done: false, timer: undefined, resolve };
        pending.push(p);
        // Fallback so a lost event never hangs the harness.
        p.timer = setT(() => settle(p), 15_000 + 70 * text.length);
        em.setStatus("speaking");
        try {
          channel.send(JSON.stringify(buildSpeakEvent(text, id)));
        } catch (err) {
          fail(`GPT live could not send the line (${(err as Error)?.message ?? err}).`);
          settle(p);
        }
      });
    },

    onTranscript: em.onTranscript,
    onStatus: em.onStatus,
  };
}

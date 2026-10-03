import { test } from "node:test";
import assert from "node:assert/strict";

import type { VoiceStatus } from "../../src/types.ts";
import {
  createBrowserVoice,
  createGptLiveVoice,
  createTypedVoice,
  createVoice,
  estimateSpeechMs,
  isBrowserVoiceSupported,
  loadVoiceSettings,
  saveVoiceSettings,
  VOICE_SETTINGS_KEY,
} from "../../src/voice/index.ts";
import type { DataChannelLike, GptLiveDeps, PeerConnectionLike } from "../../src/voice/index.ts";

const tick = () => new Promise<void>((r) => setImmediate(r));

// ── typed ───────────────────────────────────────────────────────────────────

test("typed voice: ready, speak resolves immediately, no transcripts", async () => {
  const v = createTypedVoice();
  assert.equal(v.kind, "typed");
  const statuses: VoiceStatus[] = [];
  v.onStatus((s) => statuses.push(s));
  assert.equal(statuses[0]?.state, "ready");
  await v.start();
  let heard = 0;
  const off = v.onTranscript(() => heard++);
  await v.speak("What state do you want to choose?");
  off();
  assert.equal(heard, 0);
  v.stop();
  assert.equal(statuses.at(-1)?.state, "idle");
});

test("createVoice picks the adapter by kind", () => {
  assert.equal(createVoice("typed").kind, "typed");
  assert.equal(createVoice("browser").kind, "browser");
  assert.equal(createVoice("gpt-live", { apiKey: "k", model: "gpt-live-1" }).kind, "gpt-live");
});

// ── settings ────────────────────────────────────────────────────────────────

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

test("voice settings: defaults, key stored only when remembered", () => {
  const s = memStorage();
  assert.deepEqual(loadVoiceSettings(s), { kind: "typed", model: "gpt-live-1", remember: false });

  saveVoiceSettings({ kind: "gpt-live", model: "gpt-live-1", apiKey: "sk-secret", remember: false }, s);
  assert.ok(!s.m.get(VOICE_SETTINGS_KEY)!.includes("sk-secret"));
  assert.equal(loadVoiceSettings(s).apiKey, undefined);
  assert.equal(loadVoiceSettings(s).kind, "gpt-live");

  saveVoiceSettings({ kind: "gpt-live", model: "custom-model", apiKey: "sk-secret", remember: true }, s);
  assert.deepEqual(loadVoiceSettings(s), { kind: "gpt-live", model: "custom-model", apiKey: "sk-secret", remember: true });

  s.setItem(VOICE_SETTINGS_KEY, "{not json");
  assert.equal(loadVoiceSettings(s).kind, "typed");
  assert.equal(loadVoiceSettings(null).model, "gpt-live-1");
});

// ── gpt-live fakes ──────────────────────────────────────────────────────────

class FakeChannel implements DataChannelLike {
  readyState = "connecting";
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  sent: Record<string, any>[] = [];
  closed = false;
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = "closed";
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  emit(ev: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  types() {
    return this.sent.map((e) => e.type);
  }
}

/** A manual clock: timers fire only when the test advances time. */
function fakeClock() {
  let t = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
  };
}

function setup(opts: { status?: number; body?: string; autoStart?: boolean } = {}) {
  const calls: { url: string; init: { method: string; body: string; headers: Record<string, string> } }[] = [];
  const pcs: FakePC[] = [];
  const stopped: string[] = [];
  const audioEl = { autoplay: false, muted: false, srcObject: null as unknown };
  const clock = fakeClock();

  class FakePC implements PeerConnectionLike {
    ontrack: PeerConnectionLike["ontrack"] = null;
    onconnectionstatechange: PeerConnectionLike["onconnectionstatechange"] = null;
    tracks: unknown[] = [];
    channel: FakeChannel | null = null;
    local: unknown = null;
    remote: { type: string; sdp: string } | null = null;
    closed = false;
    constructor() {
      pcs.push(this);
    }
    addTrack(track: unknown) {
      this.tracks.push(track);
    }
    createDataChannel(label: string) {
      this.channel = new FakeChannel(label);
      return this.channel;
    }
    async createOffer() {
      return { type: "offer", sdp: "v=0 offer-sdp" };
    }
    async setLocalDescription(d: unknown) {
      this.local = d;
    }
    async setRemoteDescription(d: { type: "answer"; sdp: string }) {
      this.remote = d;
      // The server answered: the data channel opens, then GPT-Live announces the session.
      setImmediate(() => {
        this.channel?.open();
        if (opts.autoStart !== false) this.channel?.emit({ type: "session.started", session: { id: "live_1", model: "gpt-live-1" } });
      });
    }
    close() {
      this.closed = true;
    }
  }

  const deps: GptLiveDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      const status = opts.status ?? 201;
      const body = opts.body ?? JSON.stringify({ session: { id: "live_1" }, transport: { type: "webrtc", sdp: "v=0 answer-sdp" } });
      return { ok: status >= 200 && status < 300, status, text: async () => body };
    },
    RTCPeerConnection: FakePC,
    getUserMedia: async () => ({ getTracks: () => [{ id: "mic", stop: () => void stopped.push("mic") }] }),
    audioEl,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
  };
  return { calls, pcs, stopped, audioEl, deps, clock };
}

// ── gpt-live ────────────────────────────────────────────────────────────────

test("gpt-live: posts { session, sdp } to the harness route and is ready on session.started", async () => {
  const { calls, pcs, deps, audioEl } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  const statuses: string[] = [];
  v.onStatus((s) => statuses.push(s.state));
  await v.start();

  assert.equal(calls.length, 1);
  const { url, init } = calls[0]!;
  assert.equal(url, "/api/live/session");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/json");
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.headers["x-openai-key"], undefined, "no key in the page means the server's OPENAI_API_KEY is used");
  const body = JSON.parse(init.body);
  assert.equal(body.sdp, "v=0 offer-sdp");
  assert.equal(body.session.model, "gpt-live-1");
  assert.deepEqual(body.session.delegation, { type: "client" });
  assert.match(body.session.instructions, /exactly as written, word for word/);
  assert.match(body.session.instructions, /Never give therapy/);
  assert.equal(body.session.audio, undefined);
  assert.deepEqual(Object.keys(body.session).sort(), ["delegation", "instructions", "model"]);

  const pc = pcs[0]!;
  assert.equal(pc.tracks.length, 1);
  assert.deepEqual(pc.remote, { type: "answer", sdp: "v=0 answer-sdp" });
  assert.equal(pc.channel!.label, "oai-events");
  assert.deepEqual(pc.channel!.sent, [], "nothing is sent before a line is spoken");
  assert.equal(audioEl.autoplay, true);
  assert.equal(audioEl.muted, true, "the model is not heard until speak()");
  assert.deepEqual(statuses, ["idle", "connecting", "ready"]);

  const remoteStream = { id: "remote" };
  pc.ontrack!({ streams: [remoteStream] });
  assert.equal(audioEl.srcObject, remoteStream);
  v.stop();
});

test("gpt-live: a pasted key goes only to the local route as x-openai-key; voice and endpoint configurable", async () => {
  const { calls, deps } = setup();
  const v = createGptLiveVoice({ apiKey: " sk-test ", model: "gpt-live-1", endpoint: "http://127.0.0.1:9999/live", voice: "marin" }, deps);
  await v.start();
  assert.equal(calls[0]!.url, "http://127.0.0.1:9999/live");
  assert.equal(calls[0]!.init.headers["x-openai-key"], "sk-test");
  assert.deepEqual(JSON.parse(calls[0]!.init.body).session.audio, { output: { voice: "marin" } });
  v.stop();
});

test("gpt-live: waits for session.started; a startup error rejects start with the server's message", async () => {
  const { pcs, deps, stopped } = setup({ autoStart: false });
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  const statuses: VoiceStatus[] = [];
  v.onStatus((s) => statuses.push(s));
  const started = v.start();
  await tick();
  await tick();
  assert.equal(statuses.at(-1)!.state, "connecting");
  pcs[0]!.channel!.emit({ type: "error", error: { type: "invalid_request_error", message: "Unknown field", param: "session.foo" } });
  await assert.rejects(started, /Unknown field \(session\.foo\)/);
  assert.equal(statuses.at(-1)!.state, "error");
  assert.deepEqual(stopped, ["mic"]);
});

test("gpt-live: start times out when session.started never arrives", async () => {
  const { deps, clock } = setup({ autoStart: false });
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1", connectTimeoutMs: 5000 }, deps);
  const started = v.start();
  await tick();
  await tick();
  clock.advance(5000);
  await assert.rejects(started, /Timed out/);
});

test("gpt-live: speak mutes the mic, sends the line as commentary, and finishes when the output goes quiet", async () => {
  const { pcs, deps, clock, audioEl } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const statuses: string[] = [];
  v.onStatus((s) => statuses.push(s.state));

  const text = "Can you remember a time you felt content?"; // 8 words ≈ 3.1 s
  let resolved = false;
  const p = v.speak(text).then(() => (resolved = true));
  assert.deepEqual(ch.types(), ["session.input_audio.mute", "session.commentary.append"]);
  const ev = ch.sent[1]!;
  assert.equal(ev.content, text);
  assert.equal(ev.delegation_id, null);
  assert.match(ev.event_id, /^peak_speak_/);
  assert.equal(audioEl.muted, false);
  assert.equal(statuses.at(-1), "speaking");

  ch.emit({ type: "session.commentary.appended" });
  ch.emit({ type: "session.output_transcript.delta", delta: "Can you remember", start_ms: 0, end_ms: 900 });
  clock.advance(1000);
  ch.emit({ type: "session.output_transcript.delta", delta: " a time you felt content?", start_ms: 900, end_ms: 3000 });
  clock.advance(1000);
  await tick();
  assert.equal(resolved, false, "the line has not had its estimated time yet");
  clock.advance(1200);
  await p;
  assert.equal(statuses.at(-1), "ready");

  // After a short tail the mic opens again and the model is silenced.
  assert.deepEqual(ch.types().slice(2), []);
  clock.advance(400);
  assert.deepEqual(ch.types().slice(2), ["session.input_audio.unmute"]);
  assert.equal(audioEl.muted, true);
  v.stop();
});

test("gpt-live: the word highlight follows the guide's spoken transcript and ends on settle", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const words: [number, string][] = [];
  v.onWord!((i, t) => words.push([i, t]));
  const text = "Where is it now?";
  const p = v.speak(text);
  assert.deepEqual(words, [], "nothing before the guide speaks");
  ch.emit({ type: "session.output_transcript.delta", delta: "Where" });
  assert.deepEqual(words, [[0, text]]);
  ch.emit({ type: "session.output_transcript.delta", delta: " is it" });
  assert.deepEqual(words.at(-1), [2, text]);
  ch.emit({ type: "session.output_transcript.delta", delta: " now? Extra words" });
  assert.deepEqual(words.at(-1), [3, text], "never past the last word of the line");
  clock.advance(5000);
  await p;
  assert.deepEqual(words.at(-1), [4, text], "settling reports the line as finished");
  v.stop();
});

test("gpt-live: speak still finishes if no output transcript arrives", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  let resolved = false;
  const p = v.speak("Hello there.").then(() => (resolved = true));
  clock.advance(1200 + 2900);
  await tick();
  assert.equal(resolved, false);
  clock.advance(100);
  await p;
  assert.equal(resolved, true);
  assert.equal(pcs[0]!.channel!.sent[1]!.type, "session.commentary.append");
  v.stop();
});

test("gpt-live: answer fragments → partial transcripts, final after the silence gap", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1", answerSilenceMs: 1800 }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const heard: [string, boolean][] = [];
  const statuses: string[] = [];
  v.onTranscript((t, f) => heard.push([t, f]));
  v.onStatus((s) => statuses.push(s.state));

  ch.emit({ type: "session.input_transcript.delta", delta: "I saw", start_ms: 600, end_ms: 800 });
  clock.advance(1000);
  ch.emit({ type: "session.input_transcript.delta", delta: " the  lake", start_ms: 800, end_ms: 1200 });
  assert.equal(statuses.at(-1), "listening");
  clock.advance(1700);
  assert.deepEqual(heard, [
    ["I saw", false],
    ["I saw the lake", false],
  ]);
  clock.advance(100);
  assert.deepEqual(heard.at(-1), ["I saw the lake", true]);
  assert.equal(statuses.at(-1), "ready");
  v.stop();
});

test("gpt-live: input heard while the guide speaks (echo) is ignored", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const heard: string[] = [];
  v.onTranscript((t) => heard.push(t));
  const p = v.speak("Where is it?");
  ch.emit({ type: "session.input_transcript.delta", delta: "Where is it" });
  clock.advance(1200 + 3000); // no output transcript: the line ends after its estimate plus 3 s
  await p;
  ch.emit({ type: "session.input_transcript.delta", delta: "echo tail" }); // within the 400 ms tail
  clock.advance(400);
  ch.emit({ type: "session.input_transcript.delta", delta: "Straight ahead" });
  clock.advance(2000);
  assert.deepEqual(heard, ["Straight ahead", "Straight ahead"]);
  v.stop();
});

test("gpt-live: HTTP 401 from the route → status error, start rejects, resources released", async () => {
  const { pcs, stopped, deps } = setup({ status: 401, body: JSON.stringify({ error: { message: "Incorrect API key provided" } }) });
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  const statuses: VoiceStatus[] = [];
  v.onStatus((s) => statuses.push(s));
  await assert.rejects(v.start(), /401/);
  const last = statuses.at(-1)!;
  assert.equal(last.state, "error");
  assert.match(last.detail!, /HTTP 401/);
  assert.match(last.detail!, /OPENAI_API_KEY/);
  assert.match(last.detail!, /Incorrect API key provided/);
  assert.equal(pcs[0]!.closed, true);
  assert.deepEqual(stopped, ["mic"]);
  await v.speak("Anything"); // degrades gracefully after a failed start
});

test("gpt-live: a 2xx without an SDP answer is an error", async () => {
  const { deps } = setup({ body: JSON.stringify({ session: { id: "live_1" } }) });
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await assert.rejects(v.start(), /without an SDP answer/);
});

test("gpt-live: 'error' event → status error and the referenced speak resolves", async () => {
  const { pcs, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  let last: VoiceStatus | undefined;
  v.onStatus((s) => (last = s));
  const p = v.speak("Hi.");
  const id = ch.sent.at(-1)!.event_id;
  ch.emit({ type: "error", error: { message: "content too long", param: "content", client_event_id: id } });
  await p;
  assert.equal(last?.state, "error");
  assert.match(last!.detail!, /content too long \(content\)/);
  v.stop();
});

test("gpt-live: session.closed from the server → error status and pending speak resolves", async () => {
  const { pcs, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  let last: VoiceStatus | undefined;
  v.onStatus((s) => (last = s));
  const p = v.speak("Hi.");
  pcs[0]!.channel!.emit({ type: "session.closed", reason: "expired", usage: { seconds: 60 } });
  await p;
  assert.equal(last?.state, "error");
  assert.match(last!.detail!, /expired/);
  v.stop();
});

test("gpt-live: stop sends session.close, closes channel, peer, mic, and resolves pending speak", async () => {
  const { pcs, stopped, deps, audioEl } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const p = v.speak("A line that never finishes.");
  v.stop();
  await p;
  assert.equal(ch.sent.at(-1)!.type, "session.close");
  assert.equal(ch.closed, true);
  assert.equal(pcs[0]!.closed, true);
  assert.deepEqual(stopped, ["mic"]);
  assert.equal(audioEl.srcObject, null);
});

test("estimateSpeechMs: 2.6 words per second with a 1.2 s floor", () => {
  assert.equal(estimateSpeechMs("Hi."), 1200);
  assert.equal(estimateSpeechMs("one two three four five six seven eight nine ten eleven twelve thirteen"), 5000);
});

// ── browser (fake Web Speech API on globalThis) ─────────────────────────────

interface FakeUtterance {
  text: string;
  lang: string;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function installSpeech(opts: { recognition?: boolean } = {}) {
  const g = globalThis as Record<string, unknown>;
  const spoken: FakeUtterance[] = [];
  const recognizers: FakeRecognition[] = [];
  let cancelled = 0;

  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onresult: ((ev: unknown) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    running = false;
    starts = 0;
    constructor() {
      recognizers.push(this);
    }
    start() {
      this.running = true;
      this.starts++;
    }
    stop() {
      this.abort();
    }
    abort() {
      if (!this.running) return;
      this.running = false;
      this.onend?.();
    }
    result(resultIndex: number, results: { text: string; isFinal: boolean }[]) {
      this.onresult?.({
        resultIndex,
        results: results.map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.isFinal })),
      });
    }
  }

  g.SpeechSynthesisUtterance = class {
    lang = "";
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  };
  g.speechSynthesis = {
    speak(u: FakeUtterance) {
      spoken.push(u);
    },
    cancel() {
      cancelled++;
      for (const u of spoken.splice(0)) u.onend?.();
    },
  };
  if (opts.recognition !== false) g.webkitSpeechRecognition = FakeRecognition;

  return {
    spoken,
    recognizers,
    cancelled: () => cancelled,
    uninstall() {
      delete g.SpeechSynthesisUtterance;
      delete g.speechSynthesis;
      delete g.webkitSpeechRecognition;
      delete g.SpeechRecognition;
    },
  };
}

test("browser voice: unsupported → error status, speak still resolves", async () => {
  assert.equal(isBrowserVoiceSupported(), false);
  const v = createBrowserVoice();
  let last: VoiceStatus | undefined;
  v.onStatus((s) => (last = s));
  await v.start();
  assert.equal(last?.state, "error");
  assert.match(last!.detail!, /Web Speech/);
  await v.speak("Hello");
  v.stop();
});

test("browser voice: speak resolves on utterance end and pauses recognition meanwhile", async () => {
  const env = installSpeech();
  try {
    assert.equal(isBrowserVoiceSupported(), true);
    const v = createBrowserVoice({ lang: "en-GB", rate: 0.9 });
    const statuses: string[] = [];
    v.onStatus((s) => statuses.push(s.state));
    await v.start();
    const rec = env.recognizers[0]!;
    assert.equal(rec.continuous, true);
    assert.equal(rec.interimResults, true);
    assert.equal(rec.lang, "en-GB");
    assert.equal(rec.running, true);
    assert.equal(statuses.at(-1), "listening");

    let resolved = false;
    const p = v.speak("What state do you want to choose?").then(() => (resolved = true));
    assert.equal(env.spoken[0]!.text, "What state do you want to choose?");
    assert.equal(env.spoken[0]!.rate, 0.9);
    assert.equal(rec.running, false, "recognition paused while speaking");
    assert.equal(statuses.at(-1), "speaking");
    await tick();
    assert.equal(resolved, false);

    env.spoken[0]!.onend!();
    await p;
    assert.equal(rec.running, true, "recognition resumes after speaking");
    assert.equal(statuses.at(-1), "listening");

    // Auto-restart when the browser ends recognition on its own (silence).
    const starts = rec.starts;
    rec.abort();
    assert.equal(rec.running, true);
    assert.equal(rec.starts, starts + 1);

    v.stop();
    assert.equal(rec.running, false);
    assert.equal(statuses.at(-1), "idle");
  } finally {
    env.uninstall();
  }
});

test("browser voice: word boundaries report the word being spoken, end reports the line done", async () => {
  const env = installSpeech();
  try {
    const v = createBrowserVoice();
    await v.start();
    const words: [number, string][] = [];
    v.onWord!((i, t) => words.push([i, t]));
    const text = "Where is it: ahead or above?";
    const p = v.speak(text);
    const u = env.spoken[0]! as unknown as { onboundary: (ev: { name?: string; charIndex: number }) => void; onend: () => void };
    u.onboundary({ name: "word", charIndex: 0 });
    u.onboundary({ name: "word", charIndex: 6 });
    u.onboundary({ name: "word", charIndex: 7 }); // same word again: no repeat
    u.onboundary({ name: "sentence", charIndex: 13 });
    u.onboundary({ charIndex: 13 }); // engines that leave out name
    u.onend();
    await p;
    assert.deepEqual(words, [
      [0, text],
      [1, text],
      [3, text],
      [6, text],
    ]);
    v.stop();
  } finally {
    env.uninstall();
  }
});

test("browser voice: interim and final transcripts flow", async () => {
  const env = installSpeech();
  try {
    const v = createBrowserVoice();
    const heard: [string, boolean][] = [];
    v.onTranscript((t, f) => heard.push([t, f]));
    await v.start();
    const rec = env.recognizers[0]!;
    rec.result(0, [{ text: "I feel", isFinal: false }]);
    rec.result(0, [{ text: "I feel calm", isFinal: true }]);
    rec.result(1, [
      { text: "I feel calm", isFinal: true },
      { text: " and warm", isFinal: false },
    ]);
    assert.deepEqual(heard, [
      ["I feel", false],
      ["I feel calm", true],
      ["and warm", false],
    ]);
    v.stop();
  } finally {
    env.uninstall();
  }
});

test("browser voice: stop cancels speech and resolves pending speak; mic denial → error", async () => {
  const env = installSpeech();
  try {
    const v = createBrowserVoice();
    let last: VoiceStatus | undefined;
    v.onStatus((s) => (last = s));
    await v.start();
    const p = v.speak("A long line");
    v.stop();
    await p;
    assert.ok(env.cancelled() >= 1);

    const v2 = createBrowserVoice();
    v2.onStatus((s) => (last = s));
    await v2.start();
    const rec = env.recognizers.at(-1)!;
    rec.onerror!({ error: "not-allowed" });
    assert.equal(last?.state, "error");
    assert.match(last!.detail!, /Microphone permission/);
    v2.stop();
  } finally {
    env.uninstall();
  }
});

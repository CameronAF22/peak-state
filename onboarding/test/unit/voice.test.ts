import { test } from "node:test";
import assert from "node:assert/strict";

import type { VoiceStatus } from "../../src/types.ts";
import {
  createBrowserVoice,
  createGptLiveVoice,
  createTypedVoice,
  createVoice,
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
}

function setup(opts: { status?: number; body?: string } = {}) {
  const calls: { url: string; init: { method: string; body: string; headers: Record<string, string> } }[] = [];
  const pcs: FakePC[] = [];
  const stopped: string[] = [];
  const audioEl = { autoplay: false, srcObject: null as unknown };

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
      // The server answered: the data channel opens shortly after.
      setImmediate(() => this.channel?.open());
    }
    close() {
      this.closed = true;
    }
  }

  const deps: GptLiveDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init });
      const status = opts.status ?? 201;
      return { ok: status >= 200 && status < 300, status, text: async () => opts.body ?? "v=0 answer-sdp" };
    },
    RTCPeerConnection: FakePC,
    getUserMedia: async () => ({ getTracks: () => [{ id: "mic", stop: () => void stopped.push("mic") }] }),
    audioEl,
  };
  return { calls, pcs, stopped, audioEl, deps };
}

// ── gpt-live ────────────────────────────────────────────────────────────────

test("gpt-live: connects with model in URL, bearer auth, SDP body, and session.update on open", async () => {
  const { calls, pcs, deps, audioEl } = setup();
  const v = createGptLiveVoice({ apiKey: "sk-test", model: "gpt-live-1" }, deps);
  const statuses: string[] = [];
  v.onStatus((s) => statuses.push(s.state));
  await v.start();

  assert.equal(calls.length, 1);
  const { url, init } = calls[0]!;
  assert.equal(url, "https://api.openai.com/v1/realtime/calls?model=gpt-live-1");
  assert.ok(url.includes("model=gpt-live-1"));
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer sk-test");
  assert.equal(init.headers["Content-Type"], "application/sdp");
  assert.equal(init.body, "v=0 offer-sdp");

  const pc = pcs[0]!;
  assert.equal(pc.tracks.length, 1);
  assert.deepEqual(pc.remote, { type: "answer", sdp: "v=0 answer-sdp" });
  assert.equal(pc.channel!.label, "oai-events");
  assert.equal(audioEl.autoplay, true);

  const update = pc.channel!.sent[0]!;
  assert.equal(update.type, "session.update");
  const input = update.session.audio.input;
  assert.equal(input.turn_detection.type, "server_vad");
  assert.equal(input.turn_detection.create_response, false);
  assert.equal(input.transcription.model, "gpt-4o-transcribe");
  assert.match(update.session.instructions, /ONLY the exact text/);
  assert.match(update.session.instructions, /Never give therapy/);

  assert.deepEqual(statuses, ["idle", "connecting", "ready"]);

  // Remote audio goes to the audio element.
  const remoteStream = { id: "remote" };
  pc.ontrack!({ streams: [remoteStream] });
  assert.equal(audioEl.srcObject, remoteStream);
  v.stop();
});

test("gpt-live: custom endpoint, model id is URL-encoded, transcribe model and voice configurable", async () => {
  const { calls, pcs, deps } = setup();
  const v = createGptLiveVoice(
    { apiKey: "k", model: "gpt live/1", endpoint: "https://example.test/rt", voice: "marin", transcribeModel: "whisper-1" },
    deps,
  );
  await v.start();
  assert.equal(calls[0]!.url, "https://example.test/rt?model=gpt%20live%2F1");
  const update = pcs[0]!.channel!.sent[0]!;
  assert.equal(update.session.audio.input.transcription.model, "whisper-1");
  assert.equal(update.session.audio.output.voice, "marin");
  v.stop();
});

test("gpt-live: speak sends response.create with the exact text and resolves on response.done", async () => {
  const { pcs, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "k", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const statuses: string[] = [];
  v.onStatus((s) => statuses.push(s.state));

  const text = 'Step into a specific time you felt "content".';
  let resolved = false;
  const p = v.speak(text).then(() => (resolved = true));
  const ev = ch.sent.at(-1)!;
  assert.equal(ev.type, "response.create");
  assert.ok(ev.response.instructions.includes(text));
  assert.match(ev.response.instructions, /^Say exactly this, word for word, and nothing else:/);
  assert.equal(statuses.at(-1), "speaking");

  ch.emit({ type: "response.created", response: { id: "resp_1", status: "in_progress" } });
  await tick();
  assert.equal(resolved, false);
  ch.emit({ type: "response.done", response: { id: "resp_1", status: "completed" } });
  await p;
  assert.equal(resolved, true);
  assert.equal(statuses.at(-1), "ready");
  v.stop();
});

test("gpt-live: when audio is playing, speak waits for output_audio_buffer.stopped", async () => {
  const { pcs, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "k", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  let resolved = false;
  const p = v.speak("Hello.").then(() => (resolved = true));
  const id = ch.sent.at(-1)!.response.metadata.peak_speak_id;
  ch.emit({ type: "response.created", response: { id: "resp_9", metadata: { peak_speak_id: id } } });
  ch.emit({ type: "output_audio_buffer.started", response_id: "resp_9" });
  ch.emit({ type: "response.done", response: { id: "resp_9", status: "completed", metadata: { peak_speak_id: id } } });
  await tick();
  assert.equal(resolved, false);
  ch.emit({ type: "output_audio_buffer.stopped", response_id: "resp_9" });
  await p;
  assert.equal(resolved, true);
  v.stop();
});

test("gpt-live: word progress paced from audio start, capped by the audio transcript, ends on settle", async () => {
  const { pcs, deps } = setup();
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const v = createGptLiveVoice(
    { apiKey: "k", model: "gpt-live-1" },
    {
      ...deps,
      setTimeout: (fn, ms) => {
        const t = { fn, ms, live: true };
        timers.push(t);
        return t;
      },
      clearTimeout: (t) => {
        if (t) (t as { live: boolean }).live = false;
      },
    },
  );
  const startP = v.start();
  await new Promise<void>((r) => setTimeout(r, 20));
  await startP;
  const ch = pcs[0]!.channel!;
  const words: [number, string][] = [];
  v.onWord!((i, t) => words.push([i, t]));
  const text = "See it. Feel it.";
  const p = v.speak(text);
  const id = ch.sent.at(-1)!.response.metadata.peak_speak_id;
  ch.emit({ type: "response.created", response: { id: "resp_w", metadata: { peak_speak_id: id } } });
  assert.deepEqual(words, [], "nothing before the audio starts");
  ch.emit({ type: "output_audio_buffer.started", response_id: "resp_w" });
  assert.deepEqual(words, [[0, text]]);
  const fire = () => {
    const t = timers.filter((x) => x.live).at(-1)!;
    t.live = false;
    t.fn();
    return t.ms;
  };
  assert.equal(fire(), Math.round(1000 / 2.6));
  assert.deepEqual(words.at(-1), [1, text]);
  // The transcript has delivered only two words: the estimate waits for it.
  ch.emit({ type: "response.output_audio_transcript.delta", response_id: "resp_w", delta: "See it." });
  assert.equal(fire(), Math.round(2000 / 2.6 + 1000) - Math.round(1000 / 2.6), "a sentence pause after 'it.'");
  assert.deepEqual(words.at(-1), [1, text]);
  assert.equal(fire(), 120);
  assert.deepEqual(words.at(-1), [1, text]);
  ch.emit({ type: "response.output_audio_transcript.delta", response_id: "resp_w", delta: " Feel it." });
  assert.equal(fire(), 120);
  assert.deepEqual(words.at(-1), [2, text]);
  fire();
  assert.deepEqual(words.at(-1), [3, text]);
  ch.emit({ type: "output_audio_buffer.stopped", response_id: "resp_w" });
  await p;
  assert.deepEqual(words.at(-1), [4, text], "settling reports the line as finished");
  v.stop();
});

test("gpt-live: transcription delta → partial, completed → final", async () => {
  const { pcs, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "k", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const heard: [string, boolean][] = [];
  v.onTranscript((t, f) => heard.push([t, f]));
  ch.emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "it1", delta: "I see" });
  ch.emit({ type: "conversation.item.input_audio_transcription.delta", item_id: "it1", delta: " the lake" });
  ch.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "it1", transcript: "I see the lake." });
  assert.deepEqual(heard, [
    ["I see", false],
    ["I see the lake", false],
    ["I see the lake.", true],
  ]);
  v.stop();
});

test("gpt-live: HTTP 401 → status error and start rejects; resources released", async () => {
  const { pcs, stopped, deps } = setup({ status: 401, body: JSON.stringify({ error: { message: "Incorrect API key provided" } }) });
  const v = createGptLiveVoice({ apiKey: "bad", model: "gpt-live-1" }, deps);
  const statuses: VoiceStatus[] = [];
  v.onStatus((s) => statuses.push(s));
  await assert.rejects(v.start(), /401/);
  const last = statuses.at(-1)!;
  assert.equal(last.state, "error");
  assert.match(last.detail!, /HTTP 401/);
  assert.match(last.detail!, /Incorrect API key provided/);
  assert.equal(pcs[0]!.closed, true);
  assert.deepEqual(stopped, ["mic"]);
  // speak degrades gracefully after a failed start.
  await v.speak("Anything");
});

test("gpt-live: missing API key → error without any network call", async () => {
  const { calls, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  let last: VoiceStatus | undefined;
  v.onStatus((s) => (last = s));
  await assert.rejects(v.start(), /API key/);
  assert.equal(last?.state, "error");
  assert.equal(calls.length, 0);
});

test("gpt-live: 'error' event → status error and the referenced speak resolves", async () => {
  const { pcs, deps } = setup();
  const v = createGptLiveVoice({ apiKey: "k", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  let last: VoiceStatus | undefined;
  v.onStatus((s) => (last = s));
  const p = v.speak("Hi.");
  const id = ch.sent.at(-1)!.event_id;
  ch.emit({ type: "error", error: { message: "Unknown parameter", event_id: id } });
  await p;
  assert.equal(last?.state, "error");
  assert.match(last!.detail!, /Unknown parameter/);
  v.stop();
});

test("gpt-live: stop closes channel, peer, mic, and resolves pending speak", async () => {
  const { pcs, stopped, deps, audioEl } = setup();
  const v = createGptLiveVoice({ apiKey: "k", model: "gpt-live-1" }, deps);
  await v.start();
  const p = v.speak("A line that never finishes.");
  v.stop();
  await p;
  assert.equal(pcs[0]!.channel!.closed, true);
  assert.equal(pcs[0]!.closed, true);
  assert.deepEqual(stopped, ["mic"]);
  assert.equal(audioEl.srcObject, null);
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

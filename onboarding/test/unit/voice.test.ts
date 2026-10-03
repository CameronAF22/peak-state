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

const flush = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

test("gpt-live: posts { session, sdp } with the ChatGPT-style guide prompt and is ready on session.started", async () => {
  const { calls, pcs, deps, audioEl } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  const statuses: string[] = [];
  v.onStatus((s) => statuses.push(s.state));
  await v.start();

  assert.equal(calls.length, 1);
  const { url, init } = calls[0]!;
  assert.equal(url, "/api/live/session");
  assert.equal(init.headers["x-openai-key"], undefined, "no key in the page means the server's key is used");
  const body = JSON.parse(init.body);
  assert.equal(body.sdp, "v=0 offer-sdp");
  assert.deepEqual(Object.keys(body.session).sort(), ["delegation", "instructions", "model"]);
  assert.equal(body.session.model, "gpt-live-1");
  assert.deepEqual(body.session.delegation, { type: "client" });
  const prompt: string = body.session.instructions;
  for (const section of ["# Role and style", "# How this conversation works", "# Listening", "# When they have answered", "# Safety"]) {
    assert.ok(prompt.includes(section), section);
  }
  assert.match(prompt, /about 120 words a minute/);
  assert.match(prompt, /Keep listening while they pause/);
  assert.match(prompt, /cough, music/);
  assert.match(prompt, /after every answer/);
  assert.match(prompt, /not therapy/);

  const pc = pcs[0]!;
  assert.deepEqual(pc.remote, { type: "answer", sdp: "v=0 answer-sdp" });
  assert.equal(pc.channel!.label, "oai-events");
  assert.deepEqual(pc.channel!.sent, [], "nothing is sent before a line is spoken");
  assert.equal(audioEl.autoplay, true);
  assert.deepEqual(statuses, ["idle", "connecting", "ready"]);
  v.stop();
});

test("gpt-live: a pasted key goes only to the local route; voice, endpoint and extra headers configurable", async () => {
  const { calls, deps } = setup();
  const v = createGptLiveVoice(
    { apiKey: " sk-test ", model: "gpt-live-1", endpoint: "http://127.0.0.1:9999/live", voice: "marin", headers: () => ({ authorization: "Bearer t" }) },
    deps,
  );
  await v.start();
  assert.equal(calls[0]!.url, "http://127.0.0.1:9999/live");
  assert.equal(calls[0]!.init.headers["x-openai-key"], "sk-test");
  assert.equal(calls[0]!.init.headers.authorization, "Bearer t");
  assert.deepEqual(JSON.parse(calls[0]!.init.body).session.audio, { output: { voice: "marin" } });
  v.stop();
});

test("gpt-live: waits for session.started; a startup error rejects start with the server's message", async () => {
  const { pcs, deps, stopped } = setup({ autoStart: false });
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  const statuses: VoiceStatus[] = [];
  v.onStatus((s) => statuses.push(s));
  const started = v.start();
  await flush();
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
  await flush();
  clock.advance(5000);
  await assert.rejects(started, /Timed out/);
});

test("gpt-live: speak asks the line through instructions.append, verbatim, and finishes when the output goes quiet", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const statuses: string[] = [];
  const words: [number, string][] = [];
  v.onStatus((s) => statuses.push(s.state));
  v.onWord!((i, t) => words.push([i, t]));

  const text = "Where is it now?"; // 4 words ≈ 2 s at the slow pace
  let resolved = false;
  const p = v.speak(text).then(() => (resolved = true));
  assert.deepEqual(ch.types(), ["session.instructions.append"], "the mic stays open: full duplex");
  const ev = ch.sent[0]!;
  assert.equal(ev.delegation_id, null);
  assert.ok(ev.content.includes(`"${text}"`));
  assert.match(ev.content, /exactly as written and in full/);
  assert.equal(statuses.at(-1), "speaking");

  ch.emit({ type: "session.output_transcript.delta", delta: "Mm. Where" });
  ch.emit({ type: "session.output_transcript.delta", delta: " is it" });
  assert.deepEqual(words.at(-1), [2, text]);
  clock.advance(1500);
  await tick();
  assert.equal(resolved, false, "the line has not had its estimated time yet");
  clock.advance(1000);
  await p;
  assert.deepEqual(words.at(-1), [4, text], "settling reports the line as finished");
  assert.equal(statuses.at(-1), "ready");
  v.stop();
});

test("gpt-live: once the whole line has been heard, the line finishes soon after the voice goes quiet", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const text = "Can you remember a specific time when you felt totally content? Step back into it."; // ≈ 7.5 s estimate
  let resolved = false;
  const p = v.speak(text).then(() => (resolved = true));
  ch.emit({ type: "session.output_transcript.delta", delta: text });
  clock.advance(1100);
  await tick();
  assert.equal(resolved, false);
  clock.advance(100);
  await p;
  assert.equal(resolved, true, "1.2 s after the last word, not after the full estimate");
  v.stop();
});

test("gpt-live: speak still finishes if no output transcript arrives", async () => {
  const { deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  let resolved = false;
  const p = v.speak("Hello there.").then(() => (resolved = true));
  clock.advance(1200 + 3900);
  await tick();
  assert.equal(resolved, false);
  clock.advance(100);
  await p;
  assert.equal(resolved, true);
  v.stop();
});

/** A started session that has asked one question and finished saying it. */
async function asked(opts: { interpret?: (ctx: any, heard: string) => Promise<any>; expects?: "choice" | "number" | "open" } = {}) {
  const s = setup();
  const seen: { ctx: any; heard: string }[] = [];
  const interpret = opts.interpret ?? (async (ctx: any, heard: string) => (seen.push({ ctx, heard }), { verdict: "answer", text: `clean:${heard}` }));
  const v = createGptLiveVoice(
    {
      apiKey: "",
      model: "gpt-live-1",
      answerContext: () => ({ question: "What state do you want to choose?", choices: ["Content", "Excited"], expects: opts.expects ?? "choice" }),
      interpret: async (ctx, heard) => {
        seen.push({ ctx, heard });
        return interpret(ctx, heard);
      },
    },
    s.deps,
  );
  await v.start();
  const ch = s.pcs[0]!.channel!;
  const heard: [string, boolean][] = [];
  v.onTranscript((t, f) => heard.push([t, f]));
  const p = v.speak("What state do you want to choose?");
  s.clock.advance(20_000);
  await p;
  s.clock.advance(1000); // past the echo tail
  ch.sent.length = 0;
  return { ...s, v, ch, heard, seen };
}

test("gpt-live: GPT-Live delegates when the answer is done → interpreter cleans it → final; the next speak answers the delegation", async () => {
  const { v, ch, heard, seen } = await asked();
  ch.emit({ type: "session.input_transcript.delta", delta: "Um" });
  ch.emit({ type: "session.input_transcript.delta", delta: ", con tent" });
  assert.deepEqual(heard, [
    ["Um", false],
    ["Um, con tent", false],
  ]);
  ch.emit({ type: "session.delegation.created", delegation: { id: "item_1", type: "delegation", target: "client" } });
  await flush();
  assert.equal(seen.at(-1)!.heard, "Um, con tent");
  assert.deepEqual(seen.at(-1)!.ctx.choices, ["Content", "Excited"]);
  assert.deepEqual(heard.at(-1), ["clean:Um, con tent", true]);

  void v.speak("Can you remember a time?");
  const ev = ch.sent.at(-1)!;
  assert.equal(ev.type, "session.instructions.append");
  assert.equal(ev.delegation_id, "item_1", "the next question answers GPT-Live's delegation");
  v.stop();
});

test("gpt-live: still talking → thinking.append to keep listening, nothing final; noise → dropped", async () => {
  let verdict: any = { verdict: "incomplete", text: "" };
  const { v, ch, heard } = await asked({ interpret: async () => verdict });
  ch.emit({ type: "session.input_transcript.delta", delta: "I was on the beach and" });
  ch.emit({ type: "session.delegation.created", delegation: { id: "item_2" } });
  await flush();
  assert.equal(ch.sent.at(-1)!.type, "session.thinking.append");
  assert.equal(ch.sent.at(-1)!.delegation_id, "item_2");
  assert.match(ch.sent.at(-1)!.content, /not finished answering/);
  assert.ok(heard.every(([, f]) => !f), "nothing final yet");

  verdict = { verdict: "noise", text: "" };
  ch.emit({ type: "session.input_transcript.delta", delta: " did you see the game" });
  ch.emit({ type: "session.delegation.created", delegation: { id: "item_3" } });
  await flush();
  assert.equal(ch.sent.at(-1)!.delegation_id, "item_3");
  assert.match(ch.sent.at(-1)!.content, /not an answer/);
  assert.deepEqual(heard.at(-1), ["", false], "the draft is cleared");
  assert.ok(heard.every(([, f]) => !f));
  v.stop();
});

test("gpt-live: without a delegation, a semantic end of turn after a quiet gap that adapts to the question", async () => {
  const choice = await asked({ expects: "choice" });
  choice.ch.emit({ type: "session.input_transcript.delta", delta: "Content" });
  choice.clock.advance(1700);
  await flush();
  assert.equal(choice.seen.length, 0);
  choice.clock.advance(100);
  await flush();
  assert.deepEqual(choice.heard.at(-1), ["clean:Content", true], "1.8 s for a choice");
  choice.v.stop();

  const open = await asked({ expects: "open" });
  open.ch.emit({ type: "session.input_transcript.delta", delta: "The first thing was the light and" });
  open.clock.advance(4900); // 3 s plus 2 s for trailing off on "and"
  await flush();
  assert.equal(open.seen.length, 0);
  open.clock.advance(100);
  await flush();
  assert.equal(open.heard.at(-1)![1], true);
  open.v.stop();
});

test("gpt-live: fillers alone never reach the interpreter or the engine", async () => {
  const { ch, heard, seen, clock, v } = await asked();
  ch.emit({ type: "session.input_transcript.delta", delta: "um, hmm" });
  ch.emit({ type: "session.delegation.created", delegation: { id: "item_4" } });
  await flush();
  clock.advance(10_000);
  await flush();
  assert.equal(seen.length, 0);
  assert.ok(heard.every(([, f]) => !f));
  assert.match(ch.sent.at(-1)!.content, /not an answer/);
  v.stop();
});

test("gpt-live: the guide's echo while it speaks is dropped; a real barge-in is heard", async () => {
  const { pcs, deps, clock } = setup();
  const v = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, deps);
  await v.start();
  const ch = pcs[0]!.channel!;
  const heard: string[] = [];
  v.onTranscript((t) => heard.push(t));
  void v.speak("Look at that picture again. Where is it?");
  ch.emit({ type: "session.input_transcript.delta", delta: "Look at that picture" });
  ch.emit({ type: "session.input_transcript.delta", delta: " again" });
  assert.deepEqual(heard, [], "echo of the guide's own line");
  ch.emit({ type: "session.input_transcript.delta", delta: " sorry can you repeat" });
  assert.deepEqual(heard, [], "still mostly the guide's words");
  void v.speak("Look at that picture again. Where is it?");
  ch.emit({ type: "session.input_transcript.delta", delta: "Off to my left side" });
  assert.deepEqual(heard, ["Off to my left side"], "three words that are not the line: a barge-in");
  clock.advance(1);
  v.stop();
});

test("gpt-live: an answer with no next question releases the delegation after a moment", async () => {
  const { ch, clock, v } = await asked();
  ch.emit({ type: "session.input_transcript.delta", delta: "Excited" });
  ch.emit({ type: "session.delegation.created", delegation: { id: "item_5" } });
  await flush();
  ch.sent.length = 0;
  clock.advance(2500);
  assert.equal(ch.sent.at(-1)!.type, "session.thinking.append");
  assert.equal(ch.sent.at(-1)!.delegation_id, "item_5");
  assert.match(ch.sent.at(-1)!.content, /recorded/);
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
  assert.match(last.detail!, /Incorrect API key provided/);
  assert.equal(pcs[0]!.closed, true);
  assert.deepEqual(stopped, ["mic"]);
  await v.speak("Anything");
});

test("gpt-live: the Worker's string error shape is shown; a 2xx without an SDP answer is an error", async () => {
  const worker = setup({ status: 401, body: JSON.stringify({ error: "Sign in first." }) });
  const v1 = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, worker.deps);
  await assert.rejects(v1.start(), /Sign in first\./);
  const empty = setup({ body: JSON.stringify({ session: { id: "live_1" } }) });
  const v2 = createGptLiveVoice({ apiKey: "", model: "gpt-live-1" }, empty.deps);
  await assert.rejects(v2.start(), /without an SDP answer/);
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

test("estimateSpeechMs: 2 words per second (the slow pace) with a 1.2 s floor", () => {
  assert.equal(estimateSpeechMs("Hi."), 1200);
  assert.equal(estimateSpeechMs("one two three four five six seven eight nine ten"), 5000);
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

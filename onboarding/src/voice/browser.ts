// Browser voice: the Web Speech API. speechSynthesis speaks the engine's question text;
// SpeechRecognition (or webkitSpeechRecognition) transcribes the person. Recognition is paused while
// the guide speaks so it never transcribes itself. Everything is feature-detected at call time.

import type { VoiceAdapter } from "../types.ts";
import { createVoiceEmitter } from "./emitter.ts";
import { splitWords, wordIndexAtChar } from "./words.ts";

// Minimal local shapes: SpeechRecognition is not in TypeScript's DOM lib.
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  error: string;
  message?: string;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: RecognitionEvent) => void) | null;
  onerror: ((ev: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export interface BrowserVoiceOptions {
  /** BCP 47 language tag. Default "en-US". */
  lang?: string;
  /** Speech rate, 0.1..10. Default 1. */
  rate?: number;
}

function recognitionCtor(): RecognitionCtor | null {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

function synthesis(): SpeechSynthesis | null {
  const g = globalThis as unknown as { speechSynthesis?: SpeechSynthesis };
  return g.speechSynthesis ?? null;
}

function utteranceCtor(): (new (text: string) => SpeechSynthesisUtterance) | null {
  const g = globalThis as unknown as { SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance };
  return g.SpeechSynthesisUtterance ?? null;
}

/** True when this browser can both speak and listen. */
export function isBrowserVoiceSupported(): boolean {
  return synthesis() !== null && utteranceCtor() !== null && recognitionCtor() !== null;
}

/** Errors after which restarting recognition would only fail again. */
const FATAL_RECOGNITION_ERRORS = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

export function createBrowserVoice(opts: BrowserVoiceOptions = {}): VoiceAdapter {
  const lang = opts.lang ?? "en-US";
  const rate = opts.rate ?? 1;
  const em = createVoiceEmitter("browser");

  let started = false;
  let speaking = 0; // speak() calls in flight
  let recognition: Recognition | null = null;
  let listening = false; // recognition.start() called and not yet ended
  let recognitionFatal = false;
  let unsupportedDetail: string | null = null;
  let partialDetail: string | undefined;
  const pendingSpeaks = new Set<() => void>();

  function missingFeatures(): string[] {
    const missing: string[] = [];
    if (!synthesis() || !utteranceCtor()) missing.push("speech synthesis");
    if (!recognitionCtor()) missing.push("speech recognition");
    return missing;
  }

  function idleState(): void {
    if (!started) return;
    if (unsupportedDetail) em.setStatus("error", unsupportedDetail);
    else if (speaking > 0) em.setStatus("speaking");
    else if (recognition && listening && !recognitionFatal) em.setStatus("listening");
    else if (!recognitionFatal) em.setStatus("ready", partialDetail);
  }

  function startListening(): void {
    if (!started || speaking > 0 || recognitionFatal || listening) return;
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    if (!recognition) {
      recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const result = ev.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (!result) continue;
          if (result.isFinal) {
            const t = text.trim();
            if (t) em.emitTranscript(t, true);
          } else {
            interim += text;
          }
        }
        const partial = interim.trim();
        if (partial) em.emitTranscript(partial, false);
      };
      recognition.onerror = (ev) => {
        if (FATAL_RECOGNITION_ERRORS.has(ev.error)) {
          recognitionFatal = true;
          em.setStatus(
            "error",
            ev.error === "not-allowed" || ev.error === "service-not-allowed"
              ? "Microphone permission was denied. Allow the microphone or type your answers."
              : `Speech recognition failed (${ev.error}). Type your answers instead.`,
          );
        }
        // "no-speech", "aborted", "network": onend follows and we restart.
      };
      recognition.onend = () => {
        listening = false;
        // Browsers end continuous recognition after silence; keep it going while started.
        if (started && speaking === 0 && !recognitionFatal) startListening();
      };
    }
    try {
      recognition.start();
      listening = true;
      idleState();
    } catch {
      // start() throws if already started; treat as listening.
      listening = true;
    }
  }

  function pauseListening(): void {
    if (recognition && listening) {
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      listening = false;
    }
  }

  return {
    kind: "browser",

    async start() {
      started = true;
      recognitionFatal = false;
      const missing = missingFeatures();
      if (missing.length === 2) {
        unsupportedDetail = "This browser has no Web Speech support (speech synthesis and recognition). Type your answers, or try Chrome or Edge.";
        em.setStatus("error", unsupportedDetail);
        return;
      }
      unsupportedDetail = null;
      // Partly supported: keep going with what exists, and say what is missing in the status detail.
      partialDetail =
        missing[0] === "speech recognition"
          ? "This browser can speak but cannot listen. Type your answers, or try Chrome or Edge."
          : missing[0] === "speech synthesis"
            ? "This browser can listen but cannot speak. Questions show on screen only."
            : undefined;
      em.setStatus("ready", partialDetail);
      startListening();
    },

    stop() {
      started = false;
      const synth = synthesis();
      try {
        synth?.cancel();
      } catch {
        // ignore
      }
      if (recognition) {
        recognition.onend = null;
        recognition.onresult = null;
        recognition.onerror = null;
        try {
          recognition.abort();
        } catch {
          // ignore
        }
        recognition = null;
      }
      listening = false;
      speaking = 0;
      for (const done of [...pendingSpeaks]) done();
      pendingSpeaks.clear();
      em.setStatus("idle");
    },

    speak(text: string) {
      const synth = synthesis();
      const Utterance = utteranceCtor();
      if (!synth || !Utterance || !text.trim()) return Promise.resolve();

      speaking++;
      pauseListening();
      em.setStatus("speaking");

      return new Promise<void>((resolve) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
          if (settled) return;
          settled = true;
          if (timer !== undefined) clearTimeout(timer);
          pendingSpeaks.delete(done);
          speaking = Math.max(0, speaking - 1);
          if (speaking === 0) {
            idleState();
            startListening();
          }
          resolve();
        };
        pendingSpeaks.add(done);

        const u = new Utterance(text);
        u.lang = lang;
        u.rate = rate;
        u.onend = () => {
          em.emitWord(words.length, text);
          done();
        };
        u.onerror = done;
        // Word boundaries drive the spoken-word highlight; engines without them simply never call this.
        const words = splitWords(text);
        let lastWord = -1;
        u.onboundary = (ev) => {
          if (ev.name && ev.name !== "word") return;
          const i = wordIndexAtChar(words, ev.charIndex);
          if (i >= 0 && i !== lastWord) {
            lastWord = i;
            em.emitWord(i, text);
          }
        };
        // Some engines never fire onend (long text, background tabs). Do not hang the harness.
        timer = setTimeout(done, 10_000 + (text.length * 90) / Math.max(rate, 0.1));
        try {
          synth.speak(u);
        } catch {
          done();
        }
      });
    },

    onTranscript: em.onTranscript,
    onStatus: em.onStatus,
    onWord: em.onWord,
  };
}

// The ModuleHost the app hands every module (D-experience-005).
// The app owns speech and time, so the demo can mute, fast-forward or script in one place.
import type { ModuleHost } from "./contracts";

/** The contracts ModuleHost plus a sleep on the same scaled clock, for the app's own runners and stubs. */
export interface AppHost extends ModuleHost {
  clock: ModuleHost["clock"] & { sleep(ms: number): Promise<void> };
}

/** Sleep on a module host's clock: real time divided by the demo speed. */
export function sleepOn(host: ModuleHost, ms: number): Promise<void> {
  const own = (host as Partial<AppHost>).clock?.sleep;
  if (own) return own(ms);
  return new Promise<void>((resolve) => setTimeout(resolve, ms / Math.max(0.25, host.clock.speed)));
}

export interface HostOptions {
  /** 1 = real time; 4 = four times faster. Stubs and modules sleep through host.clock. */
  speed: number;
  muted: boolean;
  onSafetyStop(reason: string): void;
}

type RecognitionCtor = new () => {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechAvailable(): { speak: boolean; listen: boolean } {
  return {
    speak: typeof window !== "undefined" && "speechSynthesis" in window,
    listen: recognitionCtor() !== null,
  };
}

export function createHost(opts: HostOptions): AppHost {
  const speed = Math.max(0.25, opts.speed);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms / speed));

  return {
    clock: {
      now: () => Date.now(),
      speed,
      sleep,
    },
    speech: {
      muted: opts.muted,
      speak(text: string) {
        if (opts.muted || !speechAvailable().speak) {
          // Silent: give the reader time proportional to the text.
          return sleep(Math.min(4000, 400 + text.length * 35));
        }
        return new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = Math.min(2, 0.95 * Math.sqrt(speed));
          u.onend = () => resolve();
          u.onerror = () => resolve();
          window.speechSynthesis.speak(u);
        });
      },
      listen(onText) {
        const Ctor = recognitionCtor();
        if (!Ctor || opts.muted) return () => {};
        const rec = new Ctor();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        let active = true;
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            onText(r[0].transcript, r.isFinal);
          }
        };
        rec.onend = () => {
          if (active) rec.start();
        };
        rec.start();
        return () => {
          active = false;
          rec.stop();
        };
      },
    },
    onSafetyStop: opts.onSafetyStop,
  };
}

export function stopSpeaking(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

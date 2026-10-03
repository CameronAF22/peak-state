// Typed voice: nothing is spoken aloud and answers come only from the UI's text box.

import type { VoiceAdapter } from "../types.ts";
import { createVoiceEmitter } from "./emitter.ts";

export function createTypedVoice(): VoiceAdapter {
  const em = createVoiceEmitter("typed", "ready");
  return {
    kind: "typed",
    async start() {
      em.setStatus("ready");
    },
    stop() {
      em.setStatus("idle");
    },
    speak(_text: string) {
      return Promise.resolve();
    },
    onTranscript(_cb) {
      // Typed answers are submitted by the UI directly; there is no audio transcript.
      return () => {};
    },
    onStatus: em.onStatus,
  };
}

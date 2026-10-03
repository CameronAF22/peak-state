// Small listener sets shared by the voice adapters.

import type { VoiceKind, VoiceStatus } from "../types.ts";

export type TranscriptListener = (text: string, final: boolean) => void;
export type StatusListener = (status: VoiceStatus) => void;

export interface VoiceEmitter {
  status(): VoiceStatus;
  setStatus(state: VoiceStatus["state"], detail?: string): void;
  emitTranscript(text: string, final: boolean): void;
  onTranscript(cb: TranscriptListener): () => void;
  /** Subscribing replays the current status once so late subscribers are in sync. */
  onStatus(cb: StatusListener): () => void;
}

export function createVoiceEmitter(kind: VoiceKind, initial: VoiceStatus["state"] = "idle"): VoiceEmitter {
  const transcripts = new Set<TranscriptListener>();
  const statuses = new Set<StatusListener>();
  let current: VoiceStatus = { kind, state: initial };

  return {
    status: () => current,
    setStatus(state, detail) {
      current = detail === undefined ? { kind, state } : { kind, state, detail };
      for (const cb of [...statuses]) {
        try {
          cb(current);
        } catch {
          // a listener's failure never breaks the voice
        }
      }
    },
    emitTranscript(text, final) {
      for (const cb of [...transcripts]) {
        try {
          cb(text, final);
        } catch {
          // ignore
        }
      }
    },
    onTranscript(cb) {
      transcripts.add(cb);
      return () => {
        transcripts.delete(cb);
      };
    },
    onStatus(cb) {
      statuses.add(cb);
      try {
        cb(current);
      } catch {
        // ignore
      }
      return () => {
        statuses.delete(cb);
      };
    },
  };
}

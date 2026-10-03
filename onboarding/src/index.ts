// @peak-state/onboarding: the question harness that elicits one state's strategy and plays it back.
// Other lanes import from here. Cross-lane shapes stay in @peak-state/contracts.

export * from "./types.ts";
export { createEngine, DEFAULT_MAX_STEPS, screenAnswer, STOP_MESSAGE, startHintTimer } from "./engine/index.ts";
export type { HintTimerOptions, ScreenResult } from "./engine/index.ts";
export {
  createVoice,
  createTypedVoice,
  createBrowserVoice,
  createGptLiveVoice,
  isBrowserVoiceSupported,
  loadVoiceSettings,
  saveVoiceSettings,
  DEFAULT_GPT_LIVE_MODEL,
  DEFAULT_VOICE_SETTINGS,
  VOICE_SETTINGS_KEY,
} from "./voice/index.ts";
export type { VoiceSettings, BrowserVoiceOptions, GptLiveVoiceConfig } from "./voice/index.ts";
export {
  buildPlaybackLines,
  stepLine,
  ratingPrompt,
  scriptHash,
  toSecondPerson,
  runStrategy,
  DEFAULT_PAUSE_MS,
  saveStrategy,
  loadStrategy,
  clearStrategy,
  loadRuns,
  runsFor,
  appendRun,
  clearRuns,
  STRATEGY_KEY,
  RUNS_KEY,
} from "./playback/index.ts";
export type { PlaybackLine, PlaybackLineKind, RunOptions, KeyValueStore } from "./playback/index.ts";

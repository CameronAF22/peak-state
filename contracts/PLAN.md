# contracts · lane plan

Owner of every shape the lanes exchange. Ships first so onboarding, sensing, reps and experience can build against fixtures in parallel.

Owns: `schemas/` (except `schemas/coord/`), `examples/`, `contracts/`.

## Principles

1. **JSON Schema is the source of truth.** Draft 2020-12, one file per shape in `schemas/`. TypeScript types in `contracts/src/` mirror them, and a test proves every fixture validates against its schema and type-checks against its type.
2. **One shape per piece of data.** No lane declares its own Profile, frame, event or rep type. If something is missing, message `contracts` and log a `proposed` decision.
3. **v1 stays valid.** `peak-strategies` and `user-state-profile` (and their `examples/`) are not edited. Profile v2 is a new file.
4. **Every record carries `schemaVersion`.** A breaking change bumps it, is a decision with `--type contract`, and every consumer lane gets a message.
5. **Time.** Persisted moments (`confirmedAt`, `startedAt`, `endedAt`) are ISO 8601 strings. High-rate stream times (`SignalFrame.t`, `DetectionEvent.t`) are integer milliseconds since the Unix epoch, so a frame and an event can be compared without parsing.
6. **Safety.** No field stores a mood, diagnosis or free-text distress. Signals are reported as drift from the person's own calibrated on-state. A rep can end with `endedBy: "safety-stop"`.

## M1 · Contracts frozen

### Files

| Path | What |
|---|---|
| `schemas/profile.v2.schema.json` | Profile v2 |
| `schemas/calibration.schema.json` | One calibration recording for one emotion |
| `schemas/signal-frame.schema.json` | One sample from any source |
| `schemas/detection-event.schema.json` | One drift or manual trigger |
| `schemas/rep-session.schema.json` | One logged rep |
| `contracts/package.json`, `tsconfig.json` | Standalone package `@peak-state/contracts`, no runtime deps beyond Ajv in tests |
| `contracts/src/*.ts` | `profile.ts`, `signals.ts`, `reps.ts`, `api.ts`, `index.ts` |
| `contracts/fixtures/*.json` | `profile.demo.json` (complete, three emotions), `profile.draft.json`, `calibration.demo.json`, `frames.drift.json` (scripted baseline → drift → recovery), `detection.drift.json`, `detection.manual.json`, `rep-session.cue.json`, `rep-session.sham.json`, `rep-session.anchor-test.json` |
| `contracts/test/fixtures.test.ts` | Validates every fixture against its schema (Ajv 2020) and against the TS types (`tsc --noEmit`), plus negative cases (two emotions, four emotions, duplicate emotion ids) |
| `contracts/API.md` | Module interfaces and the event flow |

### Profile v2 (first cut)

```jsonc
{
  "schemaVersion": 2,
  "profileId": "profile_demo_ada",
  "displayName": "Ada",                 // optional, greeting only
  "emotions": [                         // exactly 3, unique ids
    {
      "id": "confident",                // slug: ^[a-z][a-z0-9-]{0,31}$
      "label": "Confident",
      "words": "Like I already know the answer before they finish the question",
      "leverage": "So I stop shrinking in the rooms that matter",   // optional; used in the rep
      "strategy": {
        "physiology": { "action": "Stand tall, chest open, slow exhale", "cue": "Plant your feet", "status": "confirmed" },
        "focus":      { "action": "The one person nodding in the room",  "cue": "Find the nod",     "status": "confirmed" },
        "language":   { "action": "I've done harder than this",          "cue": "Say it",           "status": "confirmed" }
      },
      "anchor": { "kind": "gesture", "value": "Press thumb and forefinger together" },  // optional; kind: sound | gesture | word
      "calibration": {                  // optional summary; full record is a Calibration
        "calibrationId": "cal_…", "recordedAt": "…", "source": "simulator",
        "durationSeconds": 30, "hrMean": 72.4, "hrSd": 3.1, "rmssd": 48.2
      }
    }
    // … two more
  ],
  "createdAt": "…",
  "confirmedAt": "…"                    // null = draft; reps refuse a draft profile
}
```

`strategy.*.status` is `confirmed | draft | empty`, same as v1, so onboarding can write a partial profile. `action` and `cue` are nullable only while `status` is not `confirmed`.

### Calibration

`calibrationId`, `profileId`, `emotionId`, `source` (simulator | hr-strap | manual), `startedAt`, `durationSeconds`, `frameCount`, `stats` `{hrMean, hrSd, rmssd, sdnn?}`, `quality` (0 to 1, share of usable frames). The profile keeps only the summary.

### SignalFrame

`t` (epoch ms), `source` (simulator | hr-strap | manual), `hr` (bpm, nullable), `rr` (ms intervals since the last frame, may be empty), `quality` (0 to 1). Optional `scenarioStep` on simulator frames so the demo chart can label baseline / drift / recovery.

### DetectionEvent

`id`, `t`, `kind` (drift | manual), `emotionId` (which on-state it drifted from, nullable for manual), `confidence` (0 to 1), `window` `{seconds, hrMean, rmssd, hrDelta, rmssdDelta, z}` against the calibration baseline, and `gate` `{consecutiveWindows, required, refractorySeconds, sham}`. The window stats are a first guess; sensing confirms them.

### RepSession

`id`, `profileId`, `emotionId`, `trigger` `{kind: detection | manual | practice, detectionId?}`, `mode` (full | anchor-only), `arm` (cue | sham), `startedAt`, `endedAt`, `steps[]` `{kind: anchor | leverage | physiology | focus | language | rate, startedAt, endedAt, completed}`, `intensityBefore` and `intensityAfter` (0 to 10, nullable if skipped), `recoverySeconds` (nullable), `endedBy` (completed | skipped | safety-stop). `mode: anchor-only` is the Robbins "test it" step; the *installed* badge is computed from these sessions, not stored.

### Module API (`contracts/src/api.ts`, `contracts/API.md`)

```ts
onboarding.run(host: ModuleHost): Promise<ProfileV2>
sensing.start(profile: ProfileV2, onEvent: (e: DetectionEvent) => void, onFrame?: (f: SignalFrame) => void): SensingHandle  // { stop(), triggerManual() }
sensing.record(emotionId: string, seconds: number): Promise<Calibration>
reps.run(profile: ProfileV2, emotionId: string, trigger: RepTrigger, host: ModuleHost): Promise<RepSession>
reps.progress(sessions: RepSession[]): ProgressByEmotion
```

`ModuleHost` is the slot experience gives a module to render into, plus `onSafetyStop()`. Event flow: app → `onboarding.run` → Profile → `sensing.start` → DetectionEvent → app picks `emotionId` → `reps.run` → RepSession → app stores it and calls `reps.progress`.

### Inputs received during M0 (fold into the M1 cut, superseding D-contracts-004)

- **experience (D-experience-003):** agreed. Each module exports its API from `<lane>/src/index.ts`; a module with UI exposes `mount(el, props) → unmount()`, framework-agnostic. This replaces the `ModuleHost` guess above. Experience also needs a seeded multi-session RepSession log fixture (cue and sham, one emotion installed): add `contracts/fixtures/rep-log.demo.json`.
- **sensing (D-sensing-003):** take their field names. DetectionEvent: `targetEmotionId` (not `emotionId`), `window {startT, endT, hr, rmssd, quality}`, `gate {consecutive, refractoryMs, sham}`. Calibration stats as `{hr: {mean, sd}, lnRmssd: {mean, sd}, windows, recordedAt}`, one per emotion plus a profile-level `neutral` baseline. Answer: the summary lives on each emotion (and `neutral` on the profile); the full recording is a separate Calibration document.

## M2 onward

- M2: fix whatever the vertical slice exposes; version bumps only through `--type contract` decisions with a message to each consumer.
- M3: confirm calibration and window stats against real strap data; add `hr-strap` fixtures recorded from a real device if one is available.
- M4: freeze. No shape changes after the demo script is pinned.

## Interfaces

**I need**
- onboarding: which profile fields the conversation can actually fill, and whether `leverage` and `displayName` are realistic.
- sensing: the window stats the detector emits, and the frame rate.
- reps: the step list a rep logs, and whether `mode: anchor-only` is the right home for the installed test.
- experience: what `ModuleHost` must offer (a DOM element, a speak function, safety stop).
- coord: who owns the root `package.json` / workspace config, so lanes can `import from "@peak-state/contracts"`.

**I provide**: every schema, type, fixture and the API doc above, to all lanes.

## Risks

- **Late shape churn.** Mitigation: ship first cut fast, freeze at M1, all changes via decisions.
- **Detection stats are a guess.** Sensing may need different fields; the `window` object is the most likely to change.
- **Types drift from schemas.** Mitigation: the fixture test type-checks fixtures and validates them with Ajv in the same run.
- **No package workspace yet.** Until coord sets one up, lanes import by relative path (`../contracts/src`).

## Open questions

1. (human) Is `leverage` (why this emotion matters) part of the MVP profile? The MVP plan uses it in the rep; the brief does not list it. Plan: include as optional.
2. (human) Should a profile be allowed with fewer than three emotions while drafting? Plan: no; always exactly three, drafts use `status` and `confirmedAt: null`.
3. (human) Are rep logs and profiles kept only in `localStorage`, with no export? Plan: browser-only, plus a JSON export the schemas already cover.
4. (sensing) Final window stats and gate fields.
5. (reps) Final step kinds and the installed criterion.

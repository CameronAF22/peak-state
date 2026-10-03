# contracts · lane plan

Owner of every shape the lanes exchange. Ships first so onboarding, sensing, reps and experience can build against fixtures in parallel.

Owns: `schemas/` (except `schemas/coord/`), `examples/`, `contracts/`.

**Revised for the scope change (D-coord-011, D-coord-012).** The MVP has one state that the person chooses, elicited by voice through `docs/hackathon/elicitation-playbook.md`. Shapes hold 1 to 3 states. A strategy is an ordered list of steps with submodalities. The physiology, focus and language triad becomes a derived view and is never stored. This plan replaces the three-emotion first cut (D-contracts-003 and D-contracts-004, superseded).

**M1 status.** Built. The final shapes are D-contracts-008 (Profile v2) and D-contracts-007 (events and API), which take each lane's own field names. Where the sketches below differ, the schemas, `contracts/API.md` and `contracts/README.md` win.

## Principles

1. **JSON Schema is the source of truth** (D-contracts-002). Draft 2020-12, one file per shape in `schemas/`. TypeScript types in `contracts/src/` mirror the schemas. One test validates every fixture with Ajv and type-checks it with `tsc`.
2. **One shape per piece of data.** No lane declares its own Profile, step, frame, event or rep type. If something is missing, message `contracts` and log a `proposed` decision.
3. **v1 stays valid.** `peak-strategies`, `user-state-profile` and their `examples/` are not edited. Profile v2 is a new file.
4. **Every record carries `schemaVersion`.** A breaking change bumps it, is logged as a `--type contract` decision, and every consumer lane gets a message.
5. **Order is data.** Strategy steps are an array whose position is the step index. Everything else refers to a step by that index: `anchorStep`, `fullyInAt`, rep steps and differences.
6. **Hypotheses are labelled.** Differences and drivers carry their measured `ratingDelta`. Any section filled from a rehearsal rather than live (the stage demo pre-fills contrast and drivers) carries `prefilled: true`.
7. **Time.** Persisted moments (`createdAt`, `confirmedAt`, `startedAt`) are ISO 8601 strings. Stream times (`SignalFrame.t`, `DetectionEvent.t`, window bounds) are integer milliseconds since the Unix epoch.
8. **Safety.** No field stores a diagnosis, a mood label from the detector, or the story behind a memory (`memoryCue` is a short private cue only). A session can end with `safety-stop`, and onboarding can return `stopped`.
9. **Package.** `contracts/` is the npm workspace package `@peak-state/contracts` (D-coord-010). It extends `../tsconfig.base.json` and exposes `test` and `typecheck` scripts. Lanes import it by name.

## M1 · Contracts frozen

### Files

| Path | What |
|---|---|
| `schemas/profile.v2.schema.json` | Profile v2: 1 to 3 states with ordered strategies |
| `schemas/calibration.schema.json` | One calibration recording (peak, contrast or neutral) |
| `schemas/signal-frame.schema.json` | One sample from any source |
| `schemas/detection-event.schema.json` | One drift or manual trigger |
| `schemas/rep-session.schema.json` | One logged rep |
| `contracts/package.json`, `tsconfig.json` | `@peak-state/contracts`; Ajv is a dev dependency only |
| `contracts/src/*.ts` | `profile.ts`, `signals.ts`, `reps.ts`, `api.ts`, `derive.ts` (triad view, step-chain notation, driver lookup), `index.ts` |
| `contracts/fixtures/*.json` | `profile.demo.json` (one confirmed state, full playbook, contrast and drivers `prefilled`), `profile.three-states.json` (next-version shape, so 1..3 is tested), `profile.draft.json` (stopped after section 1), `calibration.peak.json`, `calibration.contrast.json`, `frames.drift.json` (scripted baseline → drift → recovery), `detection.drift.json`, `detection.manual.json`, `rep-session.full.json`, `rep-session.sham.json`, `rep-session.anchor-only.json`, `rep-log.demo.json` (seeded multi-session log: cue and sham, ending installed) |
| `contracts/test/*.test.ts` | Every fixture validates against its schema and type-checks. Negative cases: zero states, four states, `anchorStep` out of range, a driver that names no difference, a rep step pointing past the strategy's last step. |
| `contracts/API.md` | Module interfaces and the event flow |

### Profile v2

```jsonc
{
  "schemaVersion": 2,
  "profileId": "profile_demo_ada",
  "displayName": "Ada",                     // optional, greeting only
  "createdAt": "…",
  "confirmedAt": "…",                       // null = draft; reps refuse a draft profile
  "states": [                               // 1..3 (MVP: 1), unique ids
    {
      "id": "calm-before-pitch",            // slug ^[a-z][a-z0-9-]{0,31}$
      "label": "calm before a pitch",       // 1.1, their words
      "words": "Like the room is mine and there's no rush",
      "memoryCue": "the Berlin demo",       // 1.2, private cue, never the story; optional
      "leverage": "So I stop rushing the part that matters",  // optional (reps and onboarding asked for it)
      "strategy": {
        "steps": [                          // 1.3 to 1.5, in order; index = position
          {
            "modality": "visual",           // visual | auditory | kinesthetic | olfactory | gustatory
            "direction": "external",        // external | internal
            "content": "the first face in the room looking up",
            "submodalities": {              // keys for this step's modality only; values in their words
              "core": { "location": "straight ahead", "size": "life size", "distance": "close",
                        "brightness": "bright", "perspective": "associated" },
              "extended": { "motion": "movie" },  // optional
              "other": {}                          // anything outside the lists
            },
            "anchorDetail": null            // optional: scene {…} | song {title, artist, moment} | body {location, movement}
          },
          { "modality": "auditory", "direction": "internal", "content": "'here we go'", "submodalities": { "core": { "source": "my own voice", "volume": "quiet", "location": "behind my eyes" } } },
          { "modality": "kinesthetic", "direction": "internal", "content": "warmth in my chest", "submodalities": { "core": { "bodyLocation": "chest", "intensity": 8, "movement": "spreading up" } } }
        ],
        "fullyInAt": 2,                      // 1.5, step index where they arrived
        "confirmed": true                    // 1.6 playback accepted
      },
      "anchorStep": 0,                       // section 2 "brings it back fastest"; nullable
      "contrast": {                          // section 3; nullable until reached
        "label": "stuck on a small email",
        "submodalities": { "visual": { "core": { "distance": "far", "brightness": "dim" } }, "auditory": { … }, "kinesthetic": { … } },
        "prefilled": true
      },
      "differences": [                       // 3.4 and 3.5
        { "modality": "visual", "attribute": "distance", "peak": "close", "contrast": "far", "ratingDelta": 3 },
        { "modality": "visual", "attribute": "brightness", "peak": "bright", "contrast": "dim", "ratingDelta": 2 },
        { "modality": "auditory", "attribute": "volume", "peak": "quiet", "contrast": "loud", "ratingDelta": 0 }
      ],
      "drivers": [0, 1],                     // 3.6: indexes into differences, largest ratingDelta first, 1..3
      "recode": { "appliedDrivers": [0, 1] },            // 4.1; nullable
      "test": { "before": 3, "after": 7 },               // 4.2, 0..10; nullable
      "futurePace": { "situation": "Thursday's board pitch" },  // 4.3; nullable
      "calibration": {                       // summaries; full recordings are Calibration documents
        "peak": { /* CalibrationSummary, recorded 1.2 to 1.5 */ },
        "contrast": { /* CalibrationSummary, recorded 3.1 to 3.2 */ }
      }
    }
  ],
  "neutral": null                            // optional CalibrationSummary, resting baseline (sensing asked for it)
}
```

Rules the schema enforces where JSON Schema can, and the test checks the rest:

- Steps are added as they are elicited, so there are no empty slots. A section the person has not reached is `null`, not omitted. Unconfirmed steps sit under `strategy.confirmed: false` (this answers onboarding's question).
- Every step reference must point at a real step: `anchorStep`, `fullyInAt`, and `differences[].modality` must match a modality the strategy uses.
- `drivers` hold 1 to 3 indexes into `differences`.
- Submodality keys are fixed per modality (from the playbook):
  - Visual core: `location`, `size`, `distance`, `brightness`, `perspective`. Extended: `motion`, `colour`, `focus`, `frame`.
  - Auditory core: `source`, `volume`, `location`. Extended: `pitch`, `tempo`, `tone`, `inOut`.
  - Kinesthetic core: `bodyLocation`, `intensity` (0 to 10), `movement`. Extended: `temperature`, `pressure`, `rhythm`, `direction`.
  - Values are strings in the person's words, except `intensity`.

### Derived views (`contracts/src/derive.ts`, never stored)

- `triad(state)` maps each step to physiology, focus or language, keeping the steps' order:
  - kinesthetic steps → `physiology`
  - visual steps → `focus`
  - internal auditory steps → `language`
  - external auditory steps (a song) → `focus`
- `chain(state)` gives the notation, for example `"Ve → Ai → Ki"`.
- `driverInstructions(state, stepIndex)` returns the driver submodalities for a step, so reps can speak them ("bring the picture close and bright").

### Calibration

A Calibration document has these fields:

- `schemaVersion`, `calibrationId`, `profileId`, `stateId` (null for neutral)
- `phase`: `peak`, `contrast` or `neutral`
- `source`: `simulator`, `hr-strap` or `manual`
- `startedAt`, `durationSeconds`, `frameCount`, `quality` (0 to 1)
- `stats`: `{hr: {mean, sd}, lnRmssd: {mean, sd}, rmssd, windows}`
- `rating`: 0 to 10, optional. Onboarding adds the person's own rating.

A `CalibrationSummary` is the same without the ids and frame count. `sensing.record()` returns one.

### SignalFrame

`t` (epoch ms), `source` (`simulator`, `hr-strap` or `manual`), `hr` (bpm, nullable), `rr` (ms, may be empty), `quality` (0 to 1). Simulator frames can also carry `scenarioStep`. No change from the first cut.

### DetectionEvent

- `id`, `t`, `kind` (`drift` or `manual`), `targetStateId` (nullable for manual), `confidence` (0 to 1)
- `window`: `{startT, endT, hr, rmssd, quality}`
- `gate`: `{consecutive, refractoryMs, sham}`
- `scores`: `{toPeak, toContrast}`, optional. This is the distance from the person's own peak and contrast calibration; it is new and needs sensing to confirm.

The other field names are sensing's own.

### RepSession

Session fields:

- `schemaVersion`, `id`, `profileId`, `stateId`, `repIndex`
- `kind`: `full` or `anchor-only`
- `trigger`: `{kind: detection | manual | practice | onboarding, detectionId?}`. `onboarding` is for the recode, test and future-pace reps.
- `arm`: `cue` or `sham`
- `startedAt`, `endedAt`
- `steps[]`
- `intensityBefore`, `intensityAfter` (0 to 10, nullable)
- `recoverySeconds` (nullable), `recoveryCensored`
- `anchorPaired`
- `signalSource`: `simulator`, `hr-strap` or `none`
- `scriptHash`
- `endedBy`: `completed`, `skipped`, `user-stop`, `safety-stop` or `timeout`

Each step is `{kind, strategyStepIndex?, driverIndexes?, plannedMs, startedAt, endedAt, delivered}`.

Step `kind` is one of:

- `rate`
- `anchor`, which carries the anchor step's index
- `strategy-step`, which requires `strategyStepIndex`
- `leverage`
- `peak`

What each rep logs:

- **Full rep:** rate, anchor, then each strategy step in the person's own order, then peak, then rate. This replaces D-reps-002's fixed body → focus → words order.
- **Anchor-only rep:** rate, anchor, rate.
- **Sham:** the rate steps only.

*Installed* is computed from the sessions (D-reps-003), never stored.

### Module API (`contracts/src/api.ts`, `contracts/API.md`)

Module shape follows D-experience-003. Each lane exports from `<lane>/src/index.ts`. A module with UI also exposes `mount(el, props) → unmount()`.

```ts
onboarding.run(props): Promise<OnboardingResult>
  // { status: "confirmed", profile } | { status: "stopped", reason: "safety" | "cancel", draft: ProfileV2 | null }
sensing.start(profile, onEvent, onFrame?): SensingHandle      // { stop(), triggerManual() }
sensing.record(stateId | null, phase, seconds): Promise<CalibrationSummary>
reps.run(profile, stateId, trigger, props): RepHandle         // { session: Promise<RepSession>, stop() }
reps.progress(sessions): ProgressByState
```

The event flow:

1. The app calls `onboarding.run`. During it, onboarding calls `sensing.record(…, "peak")` at playbook 1.2 and `sensing.record(…, "contrast")` at 3.1.
2. Onboarding returns a Profile.
3. The app calls `sensing.start`, which emits a DetectionEvent.
4. The app calls `reps.run` with the event's `targetStateId`, which returns a RepSession.
5. The app stores the session and calls `reps.progress`.

## M2 onward

- M2: fix whatever the vertical slice exposes. Shape changes only through `--type contract` decisions, with a message to each consumer.
- M3: confirm the calibration stats and detection `scores` against real strap data. Add `hr-strap` fixtures recorded on a real device if one is available.
- Next version (three emotions): no contract change by design; `profile.three-states.json` already exercises it.
- M4: freeze. No shape changes after the demo script is pinned.

## Interfaces

**I need**
- onboarding: whether the voice flow can fill every field above, and the `OnboardingResult` shape.
- sensing: whether it accepts `phase` on `record()` and the optional `scores` on DetectionEvent.
- reps: whether the `strategy-step` + `strategyStepIndex` step model and `driverInstructions()` cover the new rep script.
- experience: the `props` each `mount()` receives.

**I provide**: every schema, type, fixture, derive helper and the API doc above, to all lanes.

## Risks

- **The shape changed after M0.** A second churn would cost every lane. Mitigation: freeze at M1, and the 1..3 states shape means the next version needs no change.
- **Submodality values are free text.** Comparing peak and contrast (3.4) on strings is fragile. Mitigation: fixed keys per modality, plus binary enums where the playbook offers them (`perspective`, `motion`). Onboarding normalises the rest.
- **Cross-references can't be fully checked in JSON Schema.** Mitigation: a `validateProfile()` helper in `contracts/src` that runs the schema plus the index checks. Every lane uses it.
- **The detection `scores` field is a guess** until sensing confirms it.

## Open questions

1. (human) For the stage demo, pre-fill contrast and drivers from a rehearsal (the playbook's default)? Plan: yes, and they are marked `prefilled: true`.
2. (human) Are `olfactory` and `gustatory` steps worth allowing in the MVP? Plan: allowed in the schema, with no submodality keys beyond `other`.
3. (human) Profiles and rep logs are browser-only, with a JSON export? Plan: yes.
4. (sensing) `phase` on `record()`, and `scores` on DetectionEvent.
5. (reps) The step model above, and whether recode, test and future-pace are logged as RepSessions with trigger `onboarding`.

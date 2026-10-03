# Peak State module API

How the app and the three modules call each other. The types are in `contracts/src/api.ts`. Import everything from `@peak-state/contracts` and never redeclare a shape (D-contracts-007, D-experience-003, D-experience-005).

```ts
import type { ModuleHost, OnboardingModule, SensingModule, RepsModule } from "@peak-state/contracts";
```

## Where each module lives

Each lane exports its module from `<lane>/src/index.ts`:

| Lane | Export | Type |
|---|---|---|
| onboarding | `onboarding` | `OnboardingModule` |
| sensing | `sensing` | `SensingModule` |
| reps | `reps` | `RepsModule` |

A module that has its own view may also export `Mountable<P>`, which is `mount(el, props) → unmount()`. Otherwise the module is headless and the app renders from its events. The app keeps a fixture stub of each interface, chosen with `?<module>=stub|real`.

## ModuleHost

The app builds a `ModuleHost` and hands it to every module. It owns speech and the clock, so the demo can mute, fast-forward or script everything in one place.

```ts
interface ModuleHost {
  el?: HTMLElement;                                   // present when the module may render
  speech: {
    speak(text: string): Promise<void>;
    listen(onText: (text: string, final: boolean) => void): () => void;
    readonly muted: boolean;
  };
  clock: { now(): number; readonly speed: number };  // epoch ms, possibly scaled
  onSafetyStop(reason: string): void;                 // any module calls this on the stop line
}
```

Use `host.clock.now()` instead of `Date.now()` for every timestamp, so a demo running at a different speed stays consistent.

## onboarding

```ts
onboarding.run(host: ModuleHost, options?: {
  onEvent?: (e: OnboardingEvent) => void;
  mode?: "voice" | "typed" | "script";       // script replays a recorded stream
  calibration?: SensingModule["calibration"]; // pass sensing.calibration; omit to run without signals
  draft?: ProfileV2 | null;                   // resume
}): Promise<OnboardingResult>

type OnboardingResult =
  | { status: "confirmed"; profile: ProfileV2 }
  | { status: "stopped"; reason: "safety" | "cancel" | "error"; draft: ProfileV2 | null };
```

Onboarding runs `docs/hackathon/elicitation-playbook.md` and is headless (D-experience-005). It emits `OnboardingEvent`s as it goes (schema: `schemas/onboarding-event.schema.json`):

| Event | When (playbook section) | Carries |
|---|---|---|
| `guideTurn` | the guide speaks | `text`, `section` |
| `userTurn` | transcript, interim and final | `text`, `final`, `via` |
| `stateNamed` | 1.1 | `stateId`, `label`, `words` |
| `stepCaptured` | 1.3 to 1.5 | `stepIndex`, `step`, `fullyIn` |
| `submodalityCaptured` | 2 and 3.2 | `target` (`peak` or `contrast`), `stepIndex`, `modality`, `attribute`, `value` |
| `anchorStepMarked` | 2 | `stepIndex` |
| `calibrationCaptured` | end of 1.5 and of 3.2 | `summary` (CalibrationSummary) |
| `contrastCaptured` | 3.1 | `label`, `prefilled` |
| `driverFound` | 3.6 | `differenceIndex`, `difference` |
| `testRated` | 4.2 | `before`, `after` |
| `confirmed` | 4.4 | `profile` |
| `stopped` | the stop line, cancel or error | `reason`, `draft` |

Every event has `type` and `t` (epoch ms). The last event is always `confirmed` or `stopped`, and it matches the resolved `OnboardingResult`.

Calibration happens during the playbook, not as a separate block (D-onboarding-008):

```ts
const peak = options.calibration.begin(stateId, "peak");      // at 1.2
peak.mark("speech-start"); /* … */ peak.mark("speech-end");  // whenever anyone speaks
state.calibration.peak = await peak.end();                     // at fullyInAt (1.5)
// the same with "contrast" for 3.1 to 3.2
```

## sensing

```ts
sensing.start(profile, stateId, onEvent: (e: DetectionEvent) => void, onFrame?: (f: SignalFrame) => void): SensingHandle
  // SensingHandle: { stop(): void; triggerManual(): void }   triggerManual = the "I'm off" button
sensing.calibration.begin(stateId, phase: "peak" | "contrast"): { mark(kind), end(): Promise<CalibrationSummary> }
sensing.record(stateId, seconds, phase): Promise<CalibrationSummary>   // fixed-length convenience
```

- Frames arrive about once a second (`schemas/signal-frame.schema.json`).
- A `DetectionEvent` reports drift from the person's own calibrated peak, never a mood.
- `gate.sham: true` means this trial withholds the cue. The app still calls `reps.run`, and reps logs a sham session.
- `calibrationMode` says whether the detector used peak and contrast (`contrast`), peak only (`on-only`) or a resting prior (`generic`).

## reps

```ts
reps.run(profile, stateId, trigger: RepTrigger, host: ModuleHost, detection?: DetectionEvent): RepHandle
  // RepHandle: { session: Promise<RepSession>; stop(): void }   stop → endedBy "user-stop"
reps.fromOnboarding(profile, stateId): RepSession[]   // recode, test, future pace as the first reps (D-reps-006)
reps.progress(sessions: RepSession[]): ProgressByState
```

- `run` refuses a draft profile (`confirmedAt: null`).
- A full rep runs:
  1. rate
  2. each strategy step up to `fullyInAt`, in the person's own order, speaking that step's drivers (`driversForStep`)
  3. leverage, when the state has one
  4. `anchor-peak`
  5. rate
- An anchor-only rep is rate, `anchor`, rate. It is the installed test.
- A sham logs only its rate steps (D-reps-005).
- *Installed* is computed by `progress` from the sessions (D-reps-003) and never stored.

## The flow

```
app ── onboarding.run(host, { onEvent, calibration: sensing.calibration })
          │  events ─▶ app renders transcript, step chain (chain(state)), checklists
          │  calibration.begin/end at 1.2–1.5 and 3.1–3.2
          ▼
       OnboardingResult ── stopped ─▶ app shows the stop screen; nothing more runs
          │ confirmed
          ▼
app ── store profile; reps.fromOnboarding(profile, stateId) ─▶ store sessions
app ── sensing.start(profile, stateId, onEvent, onFrame)
          │  onFrame ─▶ live chart
          │  onEvent(DetectionEvent) ─────────────┐   (or the "I'm off" button → triggerManual)
          ▼                                      ▼
app ── reps.run(profile, event.stateId, { kind: event.kind === "manual" ? "manual" : "detection", detectionId: event.id }, host, event)
          ▼
       RepSession ─▶ app stores it ─▶ reps.progress(allSessions) ─▶ progress screen
```

At most one rep runs at a time. The detector's refractory period starts when the event fires.

## Helpers every lane should use

| Helper | From | Use |
|---|---|---|
| `validateProfile(p)` | `validate.ts` | Schema plus cross-references (step and difference indexes). Run it on every profile you create or load. |
| `validateRepSession(s, profile?)` | `validate.ts` | Schema plus step indexes against the profile |
| `validateSignalFrame`, `validateDetectionEvent`, `validateCalibration`, `validateOnboardingEvent` | `validate.ts` | Schema |
| `chain(state)` | `derive.ts` | `"Ve → Ai → Ki"` |
| `triad(state)` | `derive.ts` | The physiology, focus and language view, steps in order |
| `drivers(state)`, `driversForStep(state, i)` | `derive.ts` | Drivers resolved to `{attribute, peakValue, contrastValue, ratingDelta}` |
| `repSteps(state)` | `derive.ts` | Step indexes a full rep replays |
| `SUBMODALITIES` | `profile.ts` | The controlled vocabulary per modality, for prompts and pickers |
| `fixtures.*` | `fixtures.ts` | Every fixture as a typed constant |

## Safety

Every module keeps the stop line from `README.md`. Onboarding returns `stopped` with reason `safety`. Reps ends with `endedBy: "safety-stop"`. Both call `host.onSafetyStop(reason)`. No shape stores a diagnosis, a mood from the detector, or the story behind a memory or contrast: `memoryCue` and `contrast.label` are short labels only.

# Experience lane · plan

Owner lane: `experience`. Owns `app/` and `demo/`.
Mission: the web app a judge touches (onboard, calibrate, live, rep, progress), wired to the other lanes' modules, plus the three-minute demo.

**Revised for the scope change** (D-coord-011, D-coord-012, `docs/hackathon/elicitation-playbook.md`):

- The MVP has **one state** that the person chooses and names in their own words.
- Onboarding is a **voice playbook**: strategy order, then submodalities, then drivers found by contrast, then recode, test and future pace.
- A strategy is an **ordered list of steps** (for example `Ve → Ai → Ki`). The physiology, focus and language triad is only a derived view.

Every screen shows one state. Layouts leave room for 1 to 3, so the next version, which offers three emotions, needs no redesign.

## Stack

- **Vite + React + TypeScript**, static build, offline once loaded (D-experience-002).
- `app/` is the npm workspace package `@peak-state/app` (D-coord-010). It extends `../tsconfig.base.json`, exposes `test` and `typecheck`, and imports the other lanes by package name (`@peak-state/onboarding`, `@peak-state/sensing`, `@peak-state/reps`, `@peak-state/contracts`).
- The live chart is a small canvas component, so there is no chart library.
- Persistence (M3) uses `localStorage` under versioned keys for the Profile and the RepSession log. Reps does not persist anything. The app owns the log and passes it back to reps (agreed with reps).

## The five screens

Navigation is a linear flow with a step bar: `onboard → calibrate → live → rep → progress`. Demo mode can jump to any screen with fixture data. A persistent safety footer (the stop line from `README.md`) and a **Stop** button are on every screen.

| Screen | What it shows | Module / contract | Fixture fallback |
|---|---|---|---|
| **Onboard** (voice-first) | Mic state and live transcript. The person's state name in their words. A **step chain that fills in** as steps are captured (`Ve → Ai → Ki`, each chip showing the content in their words). Under the active step, a **core-submodality checklist** for its modality (picture: location, size, distance, brightness, associated or dissociated; sound: source, volume, location; feeling: body location, intensity 0 to 10, moving or still). A contrast panel with the differences and the 1 to 3 **drivers**, framed as hypotheses. The anchor step is marked. A final playback in order with the drivers, and a Confirm button. Typed fallback input is always there. | `onboarding` headless session: events in, guide turns and captures out. Result is Profile v2 with `states[]`. | Scripted session from fixtures that fills the chain on a timer. "Use sample profile" button. |
| **Calibrate** | The peak and contrast windows the playbook already recorded (sections 1.2 to 1.5 and 3.1 to 3.2), shown as two bands on the HR/HRV trace: what *on* and *off* look like for this person. Optional re-record. Connect strap button. | `sensing` calibration from the onboarding windows. Calibration is stored on the state. | Fixture calibration |
| **Live** | Live HR/RR trace at 1 Hz with 5 s window features, the on-band, and the gate state (consecutive windows, refractory, sham flag). False fires per minute for the current scenario. A large **I'm off** button. A source badge (simulator, strap or manual). | `sensing.start(profile, onEvent, {source, targetStateId, mode})`, `sensing.manual()`, `connectStrap()` (called from a click) | Pinned scenario `sensing/scenarios/demo.json` |
| **Rep** | Rating 0 to 10, then the person's **own steps in their own order**, each with its driver submodalities spoken as instructions ("bring the picture close and bright"), then the anchor step at the peak, then a second rating. Stop is visible for the whole rep. A sham arm withholds the cue and says so honestly afterwards. | `reps.run(profile, stateId, trigger, host)` returns `{session, stop}` with `onStep`. The app renders each step. | Fixture RepSession |
| **Progress** | Reps for the state, intensity trend, cue vs sham recovery time, the playbook's test result (before and after the recode), and status (`conditioning`, `ready-to-test`, `installed`). Shows **installed** once an anchor-only rep brings the state back. | `reps.progress(sessions)`, `reps.status(profile, sessions)` | Seeded rep log `contracts/fixtures/rep-log.demo.json` |

## How modules plug in

The agreed shape is D-experience-003, which contracts has accepted. Each module's entry point is `<lane>/src/index.ts`. A module with its own UI exposes `mount(el, props) → unmount()`. Every other module is headless (functions plus callbacks), and the app renders it.

```
app/src/modules.ts      registry { onboarding, sensing, reps }, typed by @peak-state/contracts
app/src/host.ts         the ModuleHost the app hands to modules
app/src/stubs/          fixture stub per module, same interface; ?onboarding=stub|real etc.
app/src/screens/*.tsx   five screens
```

**ModuleHost** (my answer to contracts):

```ts
interface ModuleHost {
  el?: HTMLElement;                        // only for modules that mount their own UI
  speech: { speak(text: string): Promise<void>; listen(onText: (t: string, final: boolean) => void): () => void; muted: boolean };
  clock: { now(): number; speed: number }; // the demo can fast-forward deterministically
  onSafetyStop(reason: string): void;      // the app shows the stop end screen
}
```

The app owns the speech adapter (browser speech for now, and whatever D-onboarding-002 settles later), so the demo can mute it, fast-forward it, or switch it to scripted in one place.

**Onboarding** is headless, and the app renders the voice screen. It emits typed events: `guideTurn`, `userTurn` (interim and final), `stateNamed`, `stepCaptured`, `submodalityCaptured`, `contrastCaptured`, `driverFound`, `anchorStepMarked`, `testRated` and `confirmed`. These drive the transcript, the step chain and the checklist. The onboarding lane can keep a default view for its own testing. The event names belong in `contracts/API.md`.

**Which state a detection fires:** the MVP has only one, so it fires that state. With three states (next version), the state picked on Live is `targetStateId`.

## Gates

| Gate | Deliverable |
|---|---|
| **M0** | Plan, stack and module-slot decisions, messages to every lane. Revised for the one-state voice scope. |
| **M1** | `@peak-state/app` scaffold. Five screens as stubs on `contracts/` fixtures: Onboard shows a scripted step chain filling in with checklists, Live runs the stub simulator. Registry with stubs. Safety footer. |
| **M2** | Vertical slice: fixture profile (one state, ordered steps), then a simulated drift, then a fired rep in the person's step order, then a logged RepSession, then progress. Real `sensing` and `reps` wired in as they land. |
| **M3** | Real voice onboarding through the playbook, calibration from the playbook windows, the strap when present (simulator fallback), and the profile and log in `localStorage`. |
| **M4** | `demo/`: the script, the pinned scenario timed with sensing, prefilled contrast and driver results from a rehearsal, a fallback recording, pitch notes, and safety copy on screen. |

## Three-minute demo outline

Onboarding grows to about 90 s. Sections 1 and 4 of the playbook run live with core submodalities only. The contrast and driver results come prefilled from a rehearsal (the playbook's default; it is still an open question for a person).

| Time | Screen | Beat |
|---|---|---|
| 0:00–0:05 | title | One line about what Peak State does. The safety line is visible. |
| 0:05–1:35 | Onboard | By voice, the person names their state ("calm before a pitch") and steps into a memory. The chain fills in `Ve → Ai → Ki` with their words on each chip, and the checklists tick. The contrast and drivers appear prefilled ("closeness and brightness seem to matter most for you"). Recode, test 3 → 7, future pace, playback, confirm. |
| 1:35–1:45 | Calibrate | Peak and contrast bands from the recording made during the playbook. "This is what *on* looks like for you." |
| 1:45–2:15 | Live | The pinned scenario drifts out of the band, the gate counts windows and opens, and the rep fires. Point at **I'm off**. |
| 2:15–2:45 | Rep | Rating 4, then their own steps in their order with drivers spoken, then the anchor step at the peak, then rating 8. Logged. |
| 2:45–3:00 | Progress | Seeded log: the rep count, the trend, cue vs sham recovery, and **installed** after an anchor-only pass. "We measure it; we don't claim it." |

It is offline and deterministic: scripted onboarding, a pinned scenario, and a seeded log. A screen recording is the fallback.

## Interfaces

**Needs**

- `contracts`: types and fixtures for Profile v2 with `states[]` (1 to 3) and ordered steps with submodalities, contrast, differences, drivers, anchor step, test and future pace. Also Calibration (peak and contrast windows), SignalFrame, DetectionEvent and RepSession (steps follow the person's order). Also `rep-log.demo.json`, a scripted onboarding fixture (the timed event stream above), and `API.md` with ModuleHost and the onboarding event names.
- `onboarding`: a headless session emitting the events above, with a scripted mode of about 90 s that runs offline and can be fast-forwarded, and a stopped result for the safety stop.
- `sensing`: `start/stop`, 1 Hz frames plus window features, `manual()`, `connectStrap()`, calibration from the onboarding windows, the pinned demo scenario, and false fires per minute.
- `reps`: `run` with `onStep` replaying the person's step order with drivers, plus `status`, `progress` and the seeded history.

**Provides**

- The app shell, navigation, ModuleHost (speech, clock, safety stop) and screen slots.
- A fixture stub per module, so each lane sees its module in the app early.
- The rep log persistence.
- The demo timeline above (moving to `demo/script.md` at M4) for the other lanes to rehearse against.

## Risks

- **The 90 s voice onboarding is the riskiest beat on stage.** Mitigation: scripted mode by default, one clock that can fast-forward, and a recording.
- **Profile v2 is being redefined.** Mitigation: one adapter file over `@peak-state/contracts`, so the screens never touch raw shapes.
- **Live speech recognition** varies by browser and needs a quiet room. Mitigation: typed fallback and scripted path.
- **Web Bluetooth** works only in Chrome or Edge, over HTTPS or localhost, and needs a user click. Mitigation: simulator by default.
- **Safety copy drift.** Mitigation: one shared safety component plus a stop end screen used by every module through `onSafetyStop`.

## Open questions (for `human`)

1. Which device runs the demo: a laptop with Chrome, or a phone?
2. Is a Web Bluetooth heart-rate strap available on demo day?
3. On stage, is the voice onboarding live speech or scripted? The playbook's default is that sections 1 and 4 run live and contrast and drivers come prefilled. A live LLM call needs a network, which conflicts with "no network" in the definition of done.
4. When is the demo, and how long is the hackathon?

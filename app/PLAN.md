# Experience lane · plan

Owner lane: `experience`. Owns `app/` and `demo/`.
Mission: the web app a judge touches (onboard, calibrate, live, rep, progress), wired to the other lanes' modules, plus the three-minute demo.

Status at M0: `contracts/` does not exist yet. This plan builds against the first-cut shapes in `docs/hackathon/mvp.md` and switches to `contracts/` as soon as the contracts lane publishes it.

## Stack

- **Vite + TypeScript + React**, static build, no server. It runs offline once loaded (all assets bundled, no CDN, no fonts fetched at runtime).
- The app owns all chrome and navigation. Modules plug in through the interfaces in `contracts/API.md`. The app never reaches into a module's internals.
- The live chart is a small canvas component, so there is no chart library to load.
- Persistence (M3) uses `localStorage` under one versioned key per record type: the Profile and the RepSession log. There are no accounts and no cloud storage.
- The other lanes do not need React. A module is either headless (functions and callbacks) or exposes `mount(el: HTMLElement, props) → unmount()`. The app wraps either kind in a React slot.

Rejected: plain TypeScript with no framework (five stateful screens and a live chart get slow to build by hand) and Next.js or another SSR stack (needs a server and doesn't fit offline-first).

## The five screens

Navigation is a linear state machine with a visible step bar: `onboard → calibrate → live → rep → progress`. Demo mode can jump to any screen using fixture data. Every screen shows a persistent footer with the safety line and a **Stop** button.

| Screen | What it shows | Module / contract | Fixture fallback |
|---|---|---|---|
| **Onboard** | Conversation that finds three emotions. Each strategy is played back in the person's words (body, focus, words, anchor). The person confirms. | `onboarding.run() → Profile` (or `onboarding.mount(el, {onDone})`) | Fixture Profile from `contracts/`; a "Use sample profile" button |
| **Calibrate** | For each emotion: a recall prompt, a countdown, and a live HR/HRV trace. Stores what "on" looks like for that emotion. | onboarding calibration step + `sensing` frames → `profile.emotions[i].calibration` | Simulator frames; calibration summary taken from the fixture |
| **Live** | Live HR/RR trace, a band for the on-state, detector gate state (windows, refractory, sham flag), a large **I'm off** button, and the source badge (simulator / strap / manual). | `sensing.start(profile, onEvent)` emits `SignalFrame` and `DetectionEvent` | Pinned simulator scenario that drifts at a fixed time |
| **Rep** | Plays the anchor, then runs the strategy steps in order (body, focus, words). Asks for an intensity rating 0 to 10 before and after. On a sham arm the cue is withheld and the screen says so honestly afterwards. | `reps.run(profile, emotionId, trigger) → RepSession` (or `reps.mount`) | Fixture RepSession |
| **Progress** | Reps per emotion, intensity trend, recovery time for cue vs sham, and an **installed** badge after a successful anchor-only test. | reads the RepSession log; reps provides the aggregation or the installed rule | Fixture RepSession log |

## How modules plug in

```
app/src/modules.ts      one registry: { onboarding, sensing, reps }, each typed by contracts/
app/src/fixtures.ts     loads the fixtures from contracts/ (or examples/) for demo mode
app/src/screens/*.tsx   five screens; each takes module + fixture through props
```

- Each module is imported from its lane's entry point (`onboarding/`, `sensing/`, `reps/`). Which file is the entry point is for `contracts/API.md` to settle; my proposal is `<lane>/src/index.ts`.
- Each slot has a **fixture stub** that implements the same interface from `contracts/` fixtures. The app runs end to end on stubs from day one, and each lane's real module replaces its stub on its own schedule. A query flag (`?onboarding=stub&sensing=real&reps=real`) picks stub or real per module, so the demo can fall back in seconds.
- The app validates every Profile, DetectionEvent and RepSession that crosses a boundary against the `contracts/` schemas in dev builds, so a drift between lanes shows up loudly instead of silently.
- I never define a shape myself. If I need a field, I message `contracts`.

## Gates

| Gate | Deliverable |
|---|---|
| **M0** | This plan, the stack decision, and messages to every lane. |
| **M1** | Vite app scaffold in `app/`. Five screens as stubs on fixture data from `contracts/`. Module registry with fixture stubs. Safety footer. |
| **M2** | Vertical slice in the app: fixture profile, then a simulated drift, then a fired rep, then a logged RepSession, then progress. Real `sensing` and `reps` modules wired in as soon as they exist. |
| **M3** | Real onboarding conversation, calibration, and the Web Bluetooth strap when present (Chrome only, with feature detection that falls back to the simulator). Profile and rep log persisted to `localStorage`. |
| **M4** | `demo/`: the three-minute script, the pinned simulator scenario, a fallback screen recording, pitch notes, and safety copy on screen. |

## Three-minute demo outline

| Time | Screen | Beat |
|---|---|---|
| 0:00–0:10 | title | "Peak State finds the moves you already use to reach your best states, then trains them back in when you drift." Safety line visible. |
| 0:10–1:10 | Onboard | Short conversation (scripted, fast-forwardable) finds *confident*, *calm focus*, *playful*. Playback of one strategy in the person's words: body, focus, sentence, anchor. |
| 1:10–1:40 | Calibrate | Recall *calm focus* for a few seconds on the simulator (or strap). The on-band appears on the trace. |
| 1:40–2:10 | Live | Pinned scenario: the trace drifts out of the band, the gate counts consecutive windows, opens, and a rep fires. Point at the **I'm off** button as the always-available manual path. |
| 2:10–2:40 | Rep | Anchor plays. Body, focus, words. Rating 4 → 8. RepSession logged. |
| 2:40–3:00 | Progress | Reps per emotion, intensity trend, cue vs sham recovery, the *installed* badge on one emotion (seeded log). Close: "We measure it; we don't claim it." |

The demo runs from a pinned simulator scenario with a seeded rep log, so it is the same every time with no network. A screen recording is the fallback.

## Interfaces

**Needs**

- `contracts`: Profile v2, SignalFrame, DetectionEvent and RepSession schemas, TS types, fixtures (including a seeded multi-session RepSession log for progress), and `contracts/API.md` with the module entry points and signatures.
- `onboarding`: `run()` or `mount()` that returns a confirmed Profile, plus the calibration step.
- `sensing`: `start(profile, onEvent)` with `stop()`, a frame stream for the chart, a pinned deterministic demo scenario, and the manual trigger entry point that the app's **I'm off** button calls.
- `reps`: `run(profile, emotionId, trigger)` or `mount()`, the RepSession it produces, and the progress aggregation and installed rule (or a pure function the app can call).

**Provides**

- The app shell, navigation, and a screen slot for each module (`mount(el, props)` or headless).
- Fixture stubs for every module, so each lane can see its own module in the app before the others are ready.
- The demo timeline (above, and later `demo/script.md`) that the other lanes rehearse against.

## Risks

- **`contracts/` lands late.** Mitigation: build on the `mvp.md` first-cut shapes behind one adapter file, then swap.
- **Module UI vs headless mismatch.** Mitigation: support both slot kinds; agree in `contracts/API.md`.
- **Web Bluetooth.** Chrome/Edge desktop and Android only, and it needs HTTPS or localhost. Mitigation: the simulator is the default and the strap is opt-in.
- **Live demo risk.** Mitigation: pinned scenario, seeded log, stub/real switch per module, recorded fallback.
- **Safety copy drift.** Mitigation: one shared safety component in the app shell, never per-screen text.

## Open questions (for `human`)

1. Which device runs the demo: a laptop with Chrome, or a phone? This decides layout and whether the strap is usable.
2. Is a Web Bluetooth heart-rate strap (Polar H10 or similar) available on demo day?
3. Is the onboarding conversation live on stage, or scripted and fast-forwarded? A live LLM call needs a network, which conflicts with "no network" in the definition of done.
4. When is the demo, and how long is the hackathon?

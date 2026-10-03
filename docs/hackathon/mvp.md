# Peak State · hackathon MVP

## The experience in one sentence

A person picks the state they want to get back to and describes it in their own words. In a short voice session, Peak State learns the order of steps they run to get into it (their strategy) and the fine detail of each step (submodalities). Then, when their signals show they have drifted, it runs a 30-second rep that replays their own steps, and keeps count until the state is installed.

**MVP: one state, chosen by the person (D-coord-011).** The next version asks them to choose among three emotions and runs the same playbook for each one. The onboarding procedure is in [elicitation-playbook.md](elicitation-playbook.md).

## The demo, in three minutes

| Step | Time | What the judge sees | Lane |
|---|---|---|---|
| 1. Onboard | 90 s | A voice conversation. The person names their state ("totally motivated") and steps back into a time they had it. The guide finds the first trigger and each next step until they are fully in it (for example: see the crowd, say "here we go", feel it in the chest), plus the core detail of each step. The step chain fills in on screen and is played back in their words. | onboarding |
| 2. Calibrate | 30 s | Recorded during the recall itself. The peak recall gives the on-state, and a brief mild contrast ("a time you felt flat") gives the off-state, with a heart-rate strap or the simulator. | onboarding, sensing |
| 3. Live | 30 s | A live trace of heart rate and HRV. The simulator (or the strap) drifts away from the person's on-state, the detector's gate opens, and a rep fires. A manual "I'm off" button is always there. | sensing |
| 4. Rep | 30 s | The anchor plays, then the guide replays the person's own steps in their own order, with the driver details ("bring the picture close and bright"). The person rates the state 0 to 10 before and after. | reps |
| 5. Progress | 30 s | Reps per emotion, intensity trend, time to recover after a cue compared with a withheld-cue (sham) trial, and an *installed* badge once the anchor alone brings the state back. | reps, experience |

## What "install it like Tony Robbins" means in this build

The research page (`docs/on-aim-closed-loop.html`, brought over from the `add-on-aim-closed-loop-research` branch) maps Robbins' six-step conditioning method onto a closed loop. The MVP keeps that mapping and makes each step something the app does and logs.

| Robbins step | In the MVP |
|---|---|
| Decide what you want | Onboarding names the target state in the person's words |
| Get leverage | One line per emotion on why it matters, used inside the rep |
| Interrupt the pattern | The detector, or the manual button, fires the rep the moment the gate opens |
| New alternative | The person's own strategy: ordered steps with their submodalities, and the drivers found by contrast |
| Condition it | Every rep is logged. The anchor is paired with the peak of each rep |
| Test it | An anchor-only rep. If the person reports the state from the anchor alone, the emotion is *installed* |

These frameworks are coaching hypotheses, not validated science. The demo measures them; it does not claim them. Sham trials (the cue is withheld on a fixed share of detections) are what make "it worked" mean something.

## Scope

**In**

- A web app, demo-first, that runs offline once loaded
- One person-chosen state, elicited by voice with the strategy, submodality and contrast playbook. The data shapes allow 1 to 3 states so that three emotions can follow.
- Simulator signals (deterministic, scriptable for the demo)
- A Web Bluetooth heart-rate strap (standard Heart Rate Service: HR plus RR intervals) as a stretch goal
- A manual trigger
- A rep engine with a full log
- A progress view
- The safety boundary from `README.md`

**Out**

- EEG or EDA hardware. That is the ten-week On-Aim plan, not a weekend.
- Real-time Oura triggering. It is not possible; see `docs/oura-constraints.md`.
- Native mobile
- Music licensing
- Accounts and cloud storage. Profiles stay in the browser.
- Any clinical or diagnostic claim

## Shape of the build

```
app/  (experience) ── loads ──▶ onboarding/ ──▶ Profile v2 ─────────┐
   │                                                                ▼
   ├──────────────── starts ──▶ sensing/  adapters → baseline → detector ──▶ DetectionEvent
   │                                                                │
   └──────────────── runs ────▶ reps/  RepRunner(profile, event) ──▶ RepSession log
                                   ▲
contracts/ + schemas/ ── the types, schemas and fixtures every lane imports
```

Everything runs in the browser for the demo. The lanes meet only at the interfaces in `contracts/`. The contracts lane owns the final shapes. This is the first cut they start from:

- **Profile v2.** `profileId` plus `states` (1 to 3; the MVP uses 1). Each state has a label in the person's words, an ordered `strategy.steps[]` (modality, internal or external, content, submodalities), an anchor step, the contrast, the drivers, and a calibration summary. The physiology, focus and language triad is derived from the steps. The profile also has `confirmedAt`. Superseded first cut: D-contracts-003.
- **SignalFrame.** `t`, `source` (simulator, hr-strap or manual), `hr`, `rr[]`, `quality`.
- **DetectionEvent.** `id`, `t`, `kind` (drift or manual), `confidence`, window stats, and `gate` (consecutive windows, refractory, and whether this trial is a sham).
- **RepSession.** `id`, `emotionId`, `trigger` (detection, manual or practice), `arm` (cue or sham), `steps[]`, `intensityBefore`, `intensityAfter`, `recoverySeconds`.
- **Module API.** `onboarding.run() → Profile`, `sensing.start(profile, onEvent)`, `reps.run(profile, emotionId, trigger) → RepSession`.

## Lanes

| Lane | Owns | First deliverable |
|---|---|---|
| `coord` | protocol, hooks, CI, dashboard, docs | This setup, verified by every lane |
| `contracts` | `schemas/`, `examples/`, `contracts/` | Profile v2 and the event schemas with fixtures (M1) |
| `onboarding` | `onboarding/`, `prompts/` | Elicitation flow that outputs a valid profile from a scripted conversation |
| `sensing` | `sensing/` | Simulator plus detector emitting DetectionEvents from fixtures |
| `reps` | `reps/` | Rep runner that plays one emotion's rep from a fixture profile |
| `experience` | `app/`, `demo/` | App shell with five screens in demo mode |

Briefs: `docs/hackathon/lanes/<lane>.md`. Specs, generated from decisions: `spec/<lane>.md`.

## Milestones

The hackathon's length has not been set yet, so these are ordered gates, not clock times. A lane may start the next gate's work early against fixtures.

| Gate | Done when | Who closes it |
|---|---|---|
| **M0 · Setup verified** | Every lane has claimed, logged a kickoff decision, posted status, written its `PLAN.md`, and pushed. The dashboard shows all six. | coord |
| **M1 · Contracts frozen** | Profile v2, SignalFrame, DetectionEvent and RepSession are schema-valid with fixtures and TypeScript types; every lane has acknowledged them. | contracts |
| **M2 · Vertical slice** | In the app, a fixture profile, a simulated drift, a fired rep and a logged RepSession work end to end. | experience, with all lanes |
| **M3 · Real inputs** | Conversation-driven onboarding, calibration-based baseline, and the strap working when present. | onboarding, sensing |
| **M4 · Demo-ready** | Script rehearsed, simulator scenario pinned, fallback recording made, safety copy in place. | experience |

## Questions for a person

These go to `human` on the dashboard. Lanes keep working on everything that does not depend on the answer.

1. How long is the hackathon, and when is the demo?
2. Which people own which lanes (`humanOwner` in `coord/lanes.json`)?
3. Which voice stack for onboarding? It is voice-first (D-coord-011). The provider is still open (D-onboarding-002). Note that Chrome's built-in speech recognition needs a network.
6. On stage, run the full playbook live, or run the strategy live and pre-fill the contrast and drivers from a rehearsal?
4. Is a Web Bluetooth heart-rate strap available on demo day (Polar H10 or similar)?
5. Which device runs the demo: a laptop with Chrome, or a phone?

## Safety

Peak State is a performance and state-recall tool. It is not therapy, diagnosis or a crisis service. Every prompt, rep script and screen keeps the stop line from `README.md`. If the person describes distress, the guide stops and points them to a human they trust. The detector never claims to read thoughts or moods. It reports a drift from the person's own calibrated on-state.

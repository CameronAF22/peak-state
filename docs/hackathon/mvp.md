# Peak State · hackathon MVP

## The experience in one sentence

A person tells Peak State about the three emotions they are at their best in. Peak State learns the move they already use to reach each one. Then, when their signals show they have drifted, it runs a 30-second rep that brings them back, and keeps count until each state is installed.

## The demo, in three minutes

| Step | Time | What the judge sees | Lane |
|---|---|---|---|
| 1. Onboard | 60 s | A short conversation finds three top emotions (for example *confident*, *calm focus*, *playful*). For each one, the person names the body move, the point of focus and the sentence they already use, plus one anchor: a sound, a gesture or a word. Peak State plays each strategy back in their words. | onboarding |
| 2. Calibrate | 30 s | They recall each emotion for a few seconds with a heart-rate strap on, or with the simulator. Peak State stores what *on* looks like for this person. | onboarding, sensing |
| 3. Live | 30 s | A live trace of heart rate and HRV. The simulator (or the strap) drifts away from the person's on-state, the detector's gate opens, and a rep fires. A manual "I'm off" button is always there. | sensing |
| 4. Rep | 30 s | The anchor plays, then the guide runs the strategy in order: body, focus, words. The person rates the state 0 to 10 before and after. | reps |
| 5. Progress | 30 s | Reps per emotion, intensity trend, time to recover after a cue compared with a withheld-cue (sham) trial, and an *installed* badge once the anchor alone brings the state back. | reps, experience |

## What "install it like Tony Robbins" means in this build

The research page (`docs/on-aim-closed-loop.html`, brought over from the `add-on-aim-closed-loop-research` branch) maps Robbins' six-step conditioning method onto a closed loop. The MVP keeps that mapping and makes each step something the app does and logs.

| Robbins step | In the MVP |
|---|---|
| Decide what you want | Onboarding names three target emotions in the person's words |
| Get leverage | One line per emotion on why it matters, used inside the rep |
| Interrupt the pattern | The detector, or the manual button, fires the rep the moment the gate opens |
| New alternative | The person's own triad: physiology, focus, language |
| Condition it | Every rep is logged. The anchor is paired with the peak of each rep |
| Test it | An anchor-only rep. If the person reports the state from the anchor alone, the emotion is *installed* |

These frameworks are coaching hypotheses, not validated science. The demo measures them; it does not claim them. Sham trials (the cue is withheld on a fixed share of detections) are what make "it worked" mean something.

## Scope

**In**

- A web app, demo-first, that runs offline once loaded
- Exactly three emotions, each with a physiology, focus and language strategy plus one optional anchor
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

- **Profile v2.** `profileId` plus `emotions` (exactly three). Each emotion has an `id`, a `label`, the person's own words, a `strategy` (physiology, focus, language, each with an action and a cue), an optional `anchor` (kind and value), and an optional `calibration` summary. The profile also has `confirmedAt`.
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
3. Which voice and conversation stack for onboarding? The earlier docs assume GPT Live 1. The default for this build is text plus browser speech, with an LLM call behind the conversation.
4. Is a Web Bluetooth heart-rate strap available on demo day (Polar H10 or similar)?
5. Which device runs the demo: a laptop with Chrome, or a phone?

## Safety

Peak State is a performance and state-recall tool. It is not therapy, diagnosis or a crisis service. Every prompt, rep script and screen keeps the stop line from `README.md`. If the person describes distress, the guide stops and points them to a human they trust. The detector never claims to read thoughts or moods. It reports a drift from the person's own calibrated on-state.

# Sensing lane plan

**Mission.** Get signals in and decide when to fire a rep. The detector reports drift from this person's own calibrated peak state toward their own calibrated contrast state. It never claims to read thoughts, moods or anything clinical.

**Scope** (D-coord-011, D-coord-012). The MVP has one state the person chooses, elicited by the voice playbook (`docs/hackathon/elicitation-playbook.md`). Calibration comes from the playbook itself:

- the **peak** window during 1.2 to 1.5, while the person steps into the state
- the **contrast** window during 3.1 to 3.2, the mild "flat or stuck" recall

Shapes hold 1 to 3 states. The detector targets one `stateId`.

**Decisions:**

| Decision | Covers |
|---|---|
| D-sensing-001 | kickoff |
| D-sensing-002 | scenario format |
| D-sensing-004 | adapters |
| D-sensing-005 | two-anchor baseline and gate; supersedes D-sensing-003 |
| D-sensing-006 | phase-based calibration API; *proposed*, needs onboarding and contracts |
| D-sensing-007 | recovery signal for reps |

Inputs follow D-coord-007: the simulator first, then the strap, with manual always available.

## Shape

```
SignalSource (simulator | hr-strap | manual)
   └─ onFrame(SignalFrame, ~1 Hz) ─▶ Windower (20 s window, 5 s hop) ─▶ {hrMean, rmssd, quality}
        ├─ calibration.begin(stateId, peak|contrast) … end() ─▶ CalibrationSummary ×2 ─▶ Baseline axis
        └─ Baseline axis: position peak → contrast ─▶ confidence 0..1
               └─▶ Gate (3 consecutive, refractory, sham) ─▶ DetectionEvent ─▶ onEvent
                       └─▶ Recovery watch (≤180 s) ─▶ onRecovered ─▶ reps
manual ───────────────────────────────────────────────────▶ DetectionEvent{kind: manual}
```

Everything is TypeScript in the npm workspace package `@peak-state/sensing` (D-coord-010). It runs in the browser, with tests under Node, and has no network dependency.

## M1 · Deterministic simulator

A scenario is a JSON file in `sensing/scenarios/`:

```json
{
  "id": "demo-01",
  "seed": 42,
  "hopMs": 1000,
  "profileRef": "examples/<contracts fixture>",
  "segments": [
    { "label": "peak",     "durationS": 30, "hr": { "from": 74, "to": 74 }, "rmssd": { "from": 52, "to": 52 }, "quality": 1 },
    { "label": "contrast", "durationS": 30, "hr": { "from": 82, "to": 82 }, "rmssd": { "from": 30, "to": 30 }, "quality": 1 },
    { "label": "baseline", "durationS": 20, "hr": { "from": 72, "to": 72 }, "rmssd": { "from": 50, "to": 50 }, "quality": 1 },
    { "label": "drift",    "durationS": 25, "hr": { "from": 72, "to": 86 }, "rmssd": { "from": 50, "to": 26 }, "quality": 1 },
    { "label": "recovery", "durationS": 40, "hr": { "from": 86, "to": 73 }, "rmssd": { "from": 26, "to": 48 }, "quality": 1 }
  ],
  "expect": [ { "t": 125, "kind": "drift", "toleranceS": 5 }, { "t": 150, "kind": "recovered", "toleranceS": 10 } ]
}
```

**Segment labels:**

| Label | Role |
|---|---|
| `peak` | calibration anchor |
| `contrast` | calibration anchor |
| `baseline` | not a drift; false fires are counted here |
| `drift` | movement away from peak |
| `recovery` | return toward peak |
| `artifact` | `quality` drops, so the gate must hold |

**Generation and playback:**

- Segments ramp linearly between `from` and `to`.
- The generator produces RR intervals: a mean RR from the target HR, plus alternating successive differences sized to hit the target RMSSD, plus seeded jitter (mulberry32). HR is derived from the RR, so the detector computes RMSSD the same way for simulated and real data.
- Frames go out on a virtual clock, either in real time or as fast as possible. The same seed gives the same frames, byte for byte.
- In demo mode, onboarding's calibration step fast-forwards through the `peak` and `contrast` segments.
- `expect[]` is both the demo script and the test oracle.

## M2 · Two-anchor baseline and detector

**Calibration** (D-sensing-006, proposed). Each playbook phase runs as long as the voice takes, so the API is begin and end, not fixed seconds:

```ts
const h = sensing.calibration.begin(stateId, "peak");   // at playbook 1.2
h.mark("speech-start"); h.mark("speech-end");          // from onboarding's voice activity
const peak = await h.end();                              // at 1.5
```

- Calibration uses 20 s windows on a 10 s hop, so a 40 s phase still gives 3 windows.
- Seconds when someone is speaking are excluded, because talking changes breathing and so RMSSD. Both phases are spoken, but live detection is mostly silent.
- With fewer than 2 usable windows, `quality` is low and the summary is used only as a prior.
- `sensing.record(stateId, seconds, phase)` stays as a fixed-length convenience.

**Axis.** For each feature f in {HR, ln RMSSD}:

```
pos_f = (x_f − peak_f) / (contrast_f − peak_f)    0 at peak, 1 at contrast
sep_f = |contrast_f − peak_f| / pooledSD_f         how well f separates the two
confidence = logistic(k · (Σ w_f · pos_f − 0.5))   with w_f ∝ sep_f; k is set so contrast ≈ 0.8
```

Only movement toward contrast counts. Overshooting beyond peak is not drift.

**Fallbacks**, so the detector never claims more than calibration supports:

| `calibrationMode` | When | What the detector does |
|---|---|---|
| `contrast` | at least one feature has sep ≥ 0.5 | uses the axis |
| `on-only` | neither feature separates | one-sided z-distance from peak (HR up, RMSSD down) |
| `generic` | no calibration | resting prior, clearly labelled |

**Gate.** Unchanged from the research design (`docs/on-aim-closed-loop.html`):

| Parameter | Default | Note |
|---|---|---|
| Window / hop | 20 s / 5 s | RMSSD needs about 20 s of beats |
| Threshold | 0.80 | configurable per person |
| Consecutive windows | 3 | about 15 to 30 s behind onset |
| Quality | every window ≥ 0.8 | artifacts hold the gate |
| Refractory | 60 s in demo mode, 10 min in research mode | a 3-minute demo needs more than one fire |
| Sham rate | 0.25 | seeded; set to 0, or pin a sham per trial in a scenario |

Manual triggers bypass the gate and are never sham. reps honours `gate.sham` (D-reps-004).

**DetectionEvent fields I emit**, using D-contracts-004 names plus two additions:

```
{ id, t, kind: drift|manual, stateId, confidence,
  window { seconds, hrMean, rmssd, hrDelta, rmssdDelta, z, position },
  gate   { consecutiveWindows, required, refractorySeconds, sham },
  calibrationMode: contrast|on-only|generic }
```

- `hrDelta` and `rmssdDelta` are measured against peak.
- `z` is the one-sided distance from peak.
- `position` is the weighted axis position.

**Recovery** (D-sensing-007). After each detection, cue or sham, sensing watches the windows. It calls `onRecovered({detectionId, t, recoverySeconds, source, censored})` once confidence stays below 0.4 for 2 windows. If that hasn't happened after 180 s, it calls with `censored: true`.

**False fires.** Every scenario run reports fires per minute on `baseline` segments, and hit or miss against `expect[]`. Experience shows the number.

**Tests**, all under Node:

- steady baseline gives zero fires
- scripted drift fires within tolerance
- an artifact segment holds the gate
- a drift inside the refractory period does not fire
- the sham count matches the seed
- a non-separable calibration falls back to `on-only`
- speech-marked seconds are excluded
- recovery fires or censors on time
- the same seed gives an identical event stream

## M3 · Real inputs

**Web Bluetooth Heart Rate Service.** `requestDevice({ filters: [{ services: [0x180D] }] })`, then `0x2A37` notifications, about 1 per second. To parse:

- flags bit 0: HR is uint8 or uint16 LE
- bits 1–2: sensor contact, which sets `quality`
- bit 3: energy expended present (skip 2 bytes)
- bit 4: RR present; uint16 LE values in 1/1024 s, converted to ms

The adapter rejects RR outside 300–2000 ms and any beat with more than 20% change from the last. It handles reconnects. It needs Chrome on desktop or Android (HTTPS or localhost), and `connectStrap()` must be called from a user click, so the experience lane owns that button. On browsers without support, the app falls back to the simulator.

**Manual "I'm off".** `sensing.manual()` emits `DetectionEvent{kind: manual, confidence: 1, gate.sham: false}` and starts a recovery watch. It works during refractory too.

**One interface.** `SignalSource { id, start(onFrame), stop() }`.

**Oura** is never a live source (`docs/oura-constraints.md`).

## M4 · Demo

Pin `sensing/scenarios/demo.json` with the experience lane:

- calibration fast-forwards
- live drift starts about 20 s into the Live screen
- one cue fire and one sham, if the demo runs two trials

Record a fallback trace and write `docs/trigger-flow.md`.

## Interfaces

**I provide**

- `sensing.start(profile, onEvent, { stateId, source, mode, onFrame?, onGate?, onRecovered? }) → { stop() }`. Frames come at about 1 Hz, and window features plus gate state every 5 s, for the live chart and the gate display.
- `sensing.calibration.begin(stateId, phase) → { mark(kind), end(): Promise<CalibrationSummary> }`, and `sensing.record(stateId, seconds, phase)`.
- `sensing.manual()` and `sensing.connectStrap()`.
- `runScenario(scenario) → { events, recoveries, falseFiresPerMin, hits }` for tests and the progress view.

**I need**

- **contracts:**
  - `CalibrationSummary` per state with `peak` and `contrast` (shape in D-sensing-006)
  - DetectionEvent `stateId` (in place of `emotionId`), `window.position` and `calibrationMode`
  - the stream rate: SignalFrame at about 1 Hz
- **onboarding:**
  - call `calibration.begin/end` at playbook 1.2 and 1.5, then at 3.1 and 3.2
  - send `speech-start` and `speech-end` marks from voice activity
  - store both summaries on the state
- **reps:** consume `onRecovered` (D-sensing-007).
- **experience:** place the Connect and "I'm off" buttons, and render the gate state.

## Risks

- **Recall barely moves heart rate.** Peak and contrast are recalled, seated and short, so they may not separate. The separability check and the `on-only` fallback keep the detector honest. The demo relies on the simulator.
- **Speech confounds HRV.** Both calibration phases are spoken. Without speech marks, RMSSD mostly measures breathing for talking. Mitigation: speech marks, and the 10 s calibration hop to recover windows.
- **The contrast state is mild by design** (playbook rule). Real drift may go further than contrast, so confidence is allowed above 0.8, and the threshold is at contrast, not beyond it.
- **RMSSD is slow and noisy.** It needs 20 s of beats, and missed beats spike it. Mitigation: RR filtering, plus the quality gate.
- **Web Bluetooth** has no iOS support.
- **Determinism breaks** if anything reads `Date.now()` or `Math.random()`. Everything takes a clock and a seed.

## Open questions

1. (human) Will a standard HRS strap be there on demo day, and on which device and browser?
2. (human) Demo gate defaults: is 60 s refractory with one scripted sham OK?
3. (onboarding) Can the voice stack emit speech-start and speech-end marks for both the guide and the person?
4. (contracts) Do you accept `stateId`, `window.position`, `calibrationMode`, and peak plus contrast calibration summaries per state?
5. (human or onboarding) The 3-minute demo pre-fills contrast and drivers. Does it also pre-fill the contrast calibration, or does the demo use a simulator contrast segment?

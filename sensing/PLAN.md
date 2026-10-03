# Sensing lane plan

**Mission.** Get signals in and decide when to fire a rep. The detector reports drift from this person's own calibrated on-state. It never claims to read thoughts, moods or anything clinical.

Decisions: D-sensing-001 (this plan), D-sensing-002 (scenario format), D-sensing-003 (detector and gate), D-sensing-004 (adapters). Inputs follow D-coord-007: the simulator first, then the strap, with manual always available.

## Shape

```
SignalSource (simulator | hr-strap | manual)
   └─ onFrame(SignalFrame) ─▶ Windower (20 s window, 5 s hop) ─▶ features {hr, rmssd, quality}
                                   └─▶ Baseline (per-emotion calibration) ─▶ drift confidence 0..1
                                          └─▶ Gate (N consecutive, refractory, sham) ─▶ DetectionEvent ─▶ onEvent
manual ─────────────────────────────────────────────────────────────────▶ DetectionEvent{kind: manual}
```

Everything is TypeScript, runs in the browser, and has no network dependency (D-coord-006).

## M1 · Deterministic simulator

A scenario is a JSON file in `sensing/scenarios/`:

```json
{
  "id": "demo-drift-01",
  "seed": 42,
  "hopMs": 1000,
  "profileRef": "examples/<contracts fixture>",
  "segments": [
    { "label": "baseline", "durationS": 40, "hr": { "from": 66, "to": 66 }, "rmssd": { "from": 48, "to": 48 }, "quality": 1 },
    { "label": "drift",    "durationS": 30, "hr": { "from": 66, "to": 88 }, "rmssd": { "from": 48, "to": 22 }, "quality": 1 },
    { "label": "recovery", "durationS": 30, "hr": { "from": 88, "to": 68 }, "rmssd": { "from": 22, "to": 45 }, "quality": 1 }
  ],
  "expect": [ { "t": 55, "kind": "drift", "toleranceS": 5 } ]
}
```

- Segments ramp linearly between `from` and `to`. Labels: `baseline`, `drift`, `recovery`, `artifact`. An `artifact` segment drops `quality` so the gate must hold.
- The generator produces RR intervals: a mean RR from the target HR, plus alternating successive differences sized to hit the target RMSSD, plus small seeded jitter (mulberry32). HR per frame is derived from those RR, so the detector computes RMSSD the same way for simulated and real data.
- Frames go out on a virtual clock, either in real time for the demo or as fast as possible for tests. The same seed gives the same frames, byte for byte.
- `expect[]` states when the detector must fire. The scenario is the demo script and the test fixture at once.

## M2 · Personal baseline and detector

**Baseline.** Calibration (onboarding runs it) records each emotion plus neutral. For each one I store mean and SD of HR and of ln(RMSSD) over 20 s windows. This is the calibration summary on the profile, in whatever shape contracts freezes.

**Drift score.** For the active target emotion: `z_hr = (hr − μ_hr)/σ_hr` and `z_v = (μ_lnrmssd − ln rmssd)/σ_lnrmssd`, so higher means further off. The score is a weighted sum of the positive parts, squashed with a logistic into a confidence from 0 to 1. Only movement away from the on-state counts. Both σ have floors, so a very steady calibration cannot make noise look like drift.

**Gate** (from `docs/on-aim-closed-loop.html`):

| Parameter | Default | Note |
|---|---|---|
| Window / hop | 20 s / 5 s | RMSSD needs about 20 s of beats |
| Threshold | 0.80 | per person, configurable |
| Consecutive windows | 3 | about 15 to 30 s behind onset |
| Quality | every window `quality ≥ 0.8` | artifacts hold the gate |
| Refractory | 60 s in demo mode, 10 min in research mode | a 3-minute demo needs more than one fire |
| Sham rate | 0.25 | seeded PRNG, so the sham pattern is reproducible |

When the gate opens it emits `DetectionEvent{kind: drift, confidence, window stats, gate:{consecutive, refractoryMs, sham}}`. Reps withholds the cue when `sham` is true. Manual triggers skip the gate and are never sham.

**Measuring false fires.** Every scenario run reports fires per minute on `baseline` segments and hit or miss against `expect[]`. The experience lane can show that number on screen.

**Tests.** These run under Node with no browser: steady baseline gives zero fires; scripted drift fires within tolerance; an artifact segment holds the gate; a second drift inside the refractory period does not fire; the sham count over N gate openings matches the seeded expectation; the same seed gives identical event streams.

## M3 · Real inputs

**Web Bluetooth Heart Rate Service.** `requestDevice({ filters: [{ services: [0x180D] }] })`, then GATT `0x180D`, then characteristic `0x2A37` notifications. To parse:

- flags byte bit 0: HR value is uint8 (0) or uint16 LE (1)
- bit 1–2: sensor contact (sets `quality` when supported)
- bit 3: energy expended present (skip 2 bytes)
- bit 4: RR intervals present; the rest of the packet is uint16 LE values in 1/1024 s, converted to ms

The adapter handles disconnect and reconnect, and reports `quality = 0` when contact drops. It needs Chrome on HTTPS or localhost, and `connect()` must be called from a user gesture, so experience owns the button. Firefox and Safari: the adapter reports "unsupported" and the app falls back to the simulator.

**Manual "I'm off".** A source that emits `DetectionEvent{kind: manual, confidence: 1, gate:{sham: false}}` straight to `onEvent`. It is always available, including during refractory.

**One interface.** `SignalSource { id, start(onFrame), stop() }`. The simulator, the strap and manual all implement it, and `sensing.start` picks one.

**Oura** is never a live source. Its heart rate arrives as 5-minute samples after the phone syncs (`docs/oura-constraints.md`), so at most it gives next-morning context.

## M4 · Demo

Pin `sensing/scenarios/demo.json` with experience: the fire times match the rep beats in the 3-minute script, with one cue fire and one sham. Record a fallback trace. Write `docs/trigger-flow.md`.

## Interfaces

**I need**

- contracts: `SignalFrame`, `DetectionEvent` (including `gate.sham`), and the calibration summary shape on Profile v2, as types and fixtures. I'll request `rmssd` and `quality` in the DetectionEvent window stats.
- onboarding: a calibration start and stop per emotion and for neutral. I propose they call `sensing.record(seconds, label)` and store the summary I return.
- experience: who owns the strap "Connect" button and the manual button (I provide the functions, they place them), and the live chart cadence.

**I provide**

- `sensing.start(profile, onEvent, { source, targetEmotionId, mode }) → { stop(), frames: subscribe(cb) }`
- `sensing.record(seconds, label) → Promise<CalibrationSummary>`
- `sensing.manual()`, the "I'm off" trigger
- a live frame stream for the chart (1 Hz frames plus 5 s window features)
- scenario files and a `runScenario(scenario) → {events, falseFiresPerMin, hits}` harness

## Risks

- **RMSSD is slow and noisy.** It needs 20 s of beats, and on the strap ectopic or missed beats spike it. Mitigation: reject RR outside 300–2000 ms and any beat with more than 20% change from the last.
- **Calibration is short** (a few seconds per emotion in the demo), so σ is unstable. Mitigation: σ floors, plus pooling with neutral.
- **Recall barely moves heart rate.** The real strap may show almost no difference between emotions. The demo leans on the simulator, and the strap is a stretch goal.
- **Web Bluetooth** needs Chrome desktop or Android. iOS Safari has no support.
- **Determinism breaks** if anything reads `Date.now()` or `Math.random()`. Everything takes a clock and a seed.

## Open questions

1. (human) Will a Polar H10 or other standard HRS strap be there on demo day, and on which device and browser?
2. (human) Refractory and sham defaults for the demo: is 60 s with one sham in the script acceptable?
3. (contracts) Does the calibration summary live on each emotion in Profile v2, or in a separate Calibration document?
4. (onboarding) How long is calibration per emotion? The mvp says "a few seconds", the onboarding brief says about 60 s. Anything under 20 s yields only one window.

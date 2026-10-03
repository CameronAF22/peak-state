# Lane brief · sensing (Sensing and detection)

**Mission.** Get signals in, and decide when to fire a rep. The detector reports drift from the person's own calibrated on-state. It never claims to read thoughts.

**Owns:** `sensing/`, `docs/oura-constraints.md`, `docs/trigger-flow.md`

**Start from:**

- `docs/on-aim-closed-loop.html`: the gate design (`P > threshold × 3`, refractory, sham) and why heart-rate variability is slow
- `docs/oura-constraints.md`: why Oura is context only

## Builds

| Gate | Deliverable |
|---|---|
| M1 | `sensing/PLAN.md`. A deterministic simulator that emits SignalFrames from a scenario file: baseline, then drift, then recovery. |
| M2 | Personal baseline from calibration (HR and RMSSD per emotion versus neutral). Detector with gate: N consecutive windows, refractory period, sham rate. Emits DetectionEvents. Unit tests on scripted scenarios. |
| M3 | Web Bluetooth adapter for the standard Heart Rate Service (0x180D, characteristic 0x2A37, HR plus RR intervals), and a manual "I'm off" trigger adapter. All share one interface. |
| M4 | The demo scenario, pinned and timed with experience |

## Interfaces

- **Needs:**
  - contracts: SignalFrame, DetectionEvent and calibration
  - onboarding: when calibration starts and stops
- **Provides:**
  - `sensing.start(profile, onEvent)`
  - `sensing.record(seconds)`
  - a live frame stream for the chart in experience

## Definition of done

The simulator demo fires exactly when scripted. False fires per minute are measured and shown. The strap path works on Chrome when a strap is present.

## Your first session: verify the setup (gate M0)

Do these in order. Report anything that does not behave as described: it is a bug in the coordination setup, so message `coord`.

1. Confirm the SessionStart hook printed the coordination board. If it did not, run `python3 tools/coord.py board` and tell `coord`.
2. Claim your lane: `python3 tools/coord.py claim sensing --purpose "M0 setup check and lane plan"`.
3. Prove the edit guard works. Try to create a scratch file in a path another lane owns (for example `tools/guard-test.txt`, which `coord` owns). The edit must be blocked with a message naming the owner. Do not create it any other way.
4. Write `sensing/PLAN.md`: what you will build for M1 to M4, the interfaces you need from other lanes and the ones you provide, risks, and open questions.
5. Log a kickoff decision covering the plan, plus any real choices you made while planning: `python3 tools/coord.py decide --title "…" --decision "…" --context "…" --produces sensing/PLAN.md …`.
6. Message each lane you depend on, or that depends on you, with the one thing you need from them or will give them (`coord.py msg <lane> …`). Questions only a person can answer go to `human`.
7. Post status: `python3 tools/coord.py status --health green --phase M0 --progress 10 --summary "…" --now "…" --next "…"`.
8. Run `python3 tools/coord.py board` and check that the other lanes appear. Run `python3 tools/coord.py inbox`.
9. Commit and push to your branch. The pre-push check must pass. If it blocks, follow its instructions.
10. Stop and report: what worked, what did not, and your plan in five lines. Do not start M1 building until a person says go.

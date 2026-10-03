# reps · lane plan

**Lane:** reps (Repetition and conditioning engine) · **Owns:** `reps/` · **Branch:** `lane/reps`

**Mission.** Install the person's chosen state with measurable reps. Robbins' conditioning steps set the method, and the log makes them testable.

**Scope (D-coord-011, D-coord-012).** The MVP installs **one** state that the person chooses and describes in their own words. Shapes hold 1 to 3 states, so the next version, with three emotions, needs no change here. Every function takes a `stateId`.

Peak State is a performance and state-recall tool, not therapy or diagnosis. Every rep keeps the stop line from `README.md` (see [Safety](#safety)).

> Revision 2. This plan replaces the fixed anchor → physiology → focus → language order (D-reps-002, now superseded). A rep now replays the person's own strategy as elicited by `docs/hackathon/elicitation-playbook.md`.

---

## 1. Where this lane sits in the Robbins mapping

| Robbins step | Who does it | What reps does with it |
|---|---|---|
| 1 · Decide what you want | onboarding (playbook 1.1) | Reads `state.label` and `state.words` from the profile. |
| 2 · Get leverage | onboarding | Speaks the person's leverage line once, if the profile has one. |
| 3 · Interrupt the pattern | the sensing gate or the manual button | Starts the rep. The first step of the person's own chain is the interrupt. |
| 4 · New alternative | onboarding (playbook 1 to 3) | Replays the person's **own step chain, in their order**, with each step's **driver** submodalities spoken as instructions. |
| 5 · Condition it | **reps** | Every rep is one logged trial. The **anchor step** is replayed at the peak, so it is paired with the state at its strongest. Onboarding's recode, test and future pace (playbook 4.1 to 4.3) are logged as the first reps. |
| 6 · Test it | **reps** | The anchor-only test replays the anchor step alone. Sham trials let us compare recovery with a cue against recovery without one. |

Two lessons from `docs/on-aim-closed-loop.html` (sections 3 to 5) shape the design:

- **Anchoring.** An anchor has to be conditioned in the on-state before it works as a cue. That is why the anchor step is replayed at the peak of every rep, and why the installed test plays it alone.
- **Sham trials.** Drift ends by itself. Without withheld-cue trials, every rep looks like it worked.

Robbins' method and NLP submodalities are coaching hypotheses, not validated science. A person's drivers are hypotheses about that person. The app measures them and does not claim them.

---

## 2. Rep script format

A rep is generated from **one state** in the profile. It is a timed sequence that is spoken with browser speech and shown on screen. Only the person's own words are spoken, inside short, neutral templates. Nothing is invented and nothing is judged.

### Inputs from the profile (playbook "What this feeds downstream")

`state.strategy.steps[]`: each step has `modality` (visual, auditory or kinesthetic), `direction` (external or internal), `content`, and `submodalities`. The state also has `anchorStep`, `drivers[]` (one to three attribute differences with their rating deltas), `fullyInAt`, and an optional `leverage` line.

### Sequence

| # | Step kind | Source | Default | What happens |
|---|---|---|---|---|
| 0 | `rate` (before) | none | untimed | One tap, 0 to 10: "How *{label}* are you right now?" On a detection trigger the person can skip it (logged as `null`). It is not part of the timed budget. |
| 1…n | `strategy-step` | `steps[i]`, in order, up to `fullyInAt` | about 8 s each | First the step's content in their words ("See the crowd."), then the **drivers that belong to this step's modality**, as instructions ("Bring it close. Make it bright."). A step with no driver gets one core submodality from its own record, so every step still carries a detail. |
| n+1 | `leverage` | `state.leverage` | 3 s | Optional. Their "why it matters" line, said once. |
| n+2 | `anchor-peak` | `anchorStep` | 4 s | "Now, at full strength:" followed by the anchor step's content and its submodalities. This is the conditioning pairing. |
| last | `rate` (after) | none | untimed | One tap, 0 to 10. Then the rep ends. |

- **Timing.** Steps 1 to n+2 are timed. The budget defaults to **32 s**, with hard bounds of **20 to 40 s**. The generator shares the budget across steps, uses each step's speech length as its floor, and adds a short silence after each step. Typical chains have 3 steps (for example `Ve → Ai → Ki`, about 8 s each). With 5 or more steps, the per-step time shrinks and only the top driver is spoken.
- **Driver phrasing.** A driver is spoken as its peak value in the person's words, through a fixed template per attribute, for example `distance: close` becomes "Bring it close". The templates live in `reps/` and are tested. When there is no template for an attribute, the step falls back to "Make it {peakValue}".
- **Auditory self-talk steps** (`Ai`) say the person's sentence once, slowly, then leave a 2 s silence for them to repeat it.
- **Script object.** `RepScript { stateId, mode: "full" | "anchor-only", steps: [{ kind, stepIndex?, modality?, text, plannedMs }], totalMs, scriptHash }`. The `scriptHash` lets the log show exactly which wording ran.
- **Missing anchor step.** The rep still runs, without the `anchor-peak` step. The state is counted but can never be installed, and progress shows "pick an anchor step to install".
- **Speech.** The runner uses `speechSynthesis` when the browser has it, and otherwise shows the text on screen with the same timing. The clock is injectable, so tests don't wait in real time.

---

## 3. Onboarding's section 4 as the first reps

Coord's direction is that recode, test and future pace count as the first reps. Reps provides `reps.fromOnboarding(profile, stateId) → RepSession[]`. It turns the onboarding record into logged sessions with `trigger.kind: "onboarding"`.

| Playbook step | RepSession | Counts toward |
|---|---|---|
| 4.1 Recode | `phase: "recode"`, `arm: cue`, no `anchor-peak` | Rep count only. It works on the contrast memory, so the anchor isn't paired. |
| 4.2 Test | `phase: "test"`, `intensityBefore: test.before`, `intensityAfter: test.after` | Rep count. It is a good rep if it meets §5. |
| 4.3 Future pace | `phase: "future-pace"`, full chain, `anchorPaired: true` | Rep count. It is a good rep if onboarding captures a 0 to 10 rating after it (requested from onboarding). |

These sessions have no sensing, so `signalSource: "none"` and `recoverySeconds: null`. They never enter the cue-against-sham comparison.

---

## 4. What a RepSession logs

Contracts owns the final shape. I use their field names from D-contracts-004 and ask for the fields marked **new**.

| Field | Type | Why |
|---|---|---|
| `id`, `profileId`, `stateId` | string | `stateId` replaces `emotionId` (**new**: rename) |
| `mode` | `"full"` \| `"anchor-only"` | Keeps the installed test separate from conditioning reps. |
| `trigger` | `{ kind: "detection" \| "manual" \| "practice" \| "onboarding", detectionId? }` | **new:** `onboarding` |
| `phase` | `"recode"` \| `"test"` \| `"future-pace"` \| `null` | **new.** Set only on onboarding reps. |
| `arm` | `"cue"` \| `"sham"` | Taken from `DetectionEvent.gate.sham` (D-reps-004). Manual, practice and onboarding reps are always `cue`. |
| `startedAt`, `endedAt` | ISO time | |
| `steps[]` | `{ kind: "strategy-step" \| "leverage" \| "anchor-peak" \| "rate", stepIndex?, plannedMs, startedAt, endedAt, completed }` | Records which steps actually ran. A sham has only the `rate` steps. **new:** these kinds replace `physiology`, `focus` and `language`. |
| `driversSpoken` | string[] | **new.** Which driver attributes were spoken, so later we can ask which drivers go with fast recovery. |
| `scriptHash` | string | **new** |
| `anchorPaired` | bool | **new.** True when `anchor-peak` completed. |
| `intensityBefore`, `intensityAfter` | 0 to 10 or `null` | |
| `recoverySeconds`, `recoveryCensored` | number or `null`, bool | Recovery time comes from sensing (§6). `recoveryCensored` (**new**) means no recovery happened within the 180 s window. |
| `signalSource` | `"simulator"` \| `"hr-strap"` \| `"none"` | **new** |
| `endedBy` | `"completed"` \| `"skipped"` \| `"user-stop"` \| `"safety-stop"` | **new:** `user-stop`. Stopped reps are kept in the log but left out of every count. |
| `repIndex` | integer | **new.** The nth rep for this state. |

This is enough to tell a cue from a sham for every rep, which is the definition of done.

---

## 5. Sham arm, conditioning count and the installed criterion

**Sham (D-reps-004, unchanged).** The sensing gate rolls the sham once and writes `gate.sham`. A sham plays nothing. After the same total time a cue rep would take, it shows the same rating prompt, so the rating isn't a difference between the arms. Only detection triggers can be shams. The default rate is 0.25. On stage it is 0, or one sham is pinned in the scripted scenario. The log keeps the `arm` field either way. Progress compares median `recoverySeconds` for cue against sham, separately for each signal source. It shows no number until there are at least 3 shams.

**Installed (D-reps-003, proposed; coord confirmed that it still applies to one state).**

- **Good rep.** `mode: full`, `arm: cue`, `endedBy: completed`, `anchorPaired: true`, and `intensityAfter ≥ 7`. Onboarding reps count when they meet this rule.
- **Ready to test.** After **5 good reps**, the next practice offer is the anchor-only test.
- **Anchor-only test.** First the before rating. Then the **anchor step alone**, with its submodalities, and nothing else from the chain. Then 10 s of silence. Then the after rating.
- **Pass.** `intensityAfter ≥ 7` and a rise of at least 2. When signals are present, recovery is logged but not required to pass.
- **Installed.** **2 passes in a row**. After a fail, the state needs 3 more good reps before the next test. If 2 later tests in a row fail, the state drops back to "conditioning". A state with no anchor step can't be installed.
- **Demo.** The demo loads a seeded rep-history fixture that leaves the state one test from installed, so the test on stage installs it.

---

## 6. Interfaces

**Needs**

| From | What |
|---|---|
| contracts | The profile with `states[]` (1 to 3): ordered `strategy.steps[]` with `modality`, `direction`, `content` and `submodalities`, plus `anchorStep`, `drivers[]`, `fullyInAt`, `leverage`, and the section 4 records. Also the RepSession fields in §4, the TS types and a validator. |
| onboarding | The recode, test and future-pace records, plus a 0 to 10 rating after future pace. Also the shared safety-stop copy in `onboarding/copy/`. |
| sensing | `DetectionEvent.gate.sham`, and recovery timing for each `detectionId` (when the signals return to the on-state band, within 180 s, and the signal source). Sensing has offered this. |

**Provides**

```ts
reps.script(profile, stateId, mode?: "full" | "anchor-only"): RepScript
reps.run(profile, stateId, trigger, opts?: { onStep?, clock?, speech? }): RepHandle
  // RepHandle = { session: Promise<RepSession>, stop(reason?: "user-stop" | "safety-stop"): void }
reps.fromOnboarding(profile, stateId): RepSession[]
reps.status(profile, sessions): StateRepStatus[]   // goodReps, "conditioning" | "ready-to-test" | "installed" | "no-anchor"
reps.progress(sessions): ProgressAggregates      // reps per state, intensity trend, cue vs sham recovery, installed
```

Reps does not store anything. Experience persists the log in the browser and passes it back in. Reps is the npm workspace package `@peak-state/reps` (D-coord-010) and imports `@peak-state/contracts` by package name.

---

## 7. Milestones

| Gate | Reps deliverable | Done when |
|---|---|---|
| M0 | This plan, decisions and status, then revision 2 for the one-state scope | Pushed and green |
| M1 | Script generator from the contracts fixture: step order, driver templates, timing | `reps.script` keeps the person's order, speaks only their words and drivers, and stays within 20 to 40 s for chains of 1 to 6 steps |
| M2 | Rep runner: speech with a text fallback, stop, ratings, `fromOnboarding`, schema-valid sessions | Experience fires a rep from a simulated drift and gets back a valid session |
| M3 | Sham arm, conditioning count, anchor-only test, installed status, seeded history fixture | Every rule in §5 is covered by tests |
| M4 | `reps.progress` for the progress screen | The progress screen shows real numbers from the log |

---

## 8. Risks

- **The profile shape is in flux.** D-contracts-003 still says three emotions with a triad. I'll build against the playbook shape and the contracts fixture once it exists, and keep a local adapter in the meantime.
- **Driver phrasing can sound robotic or wrong.** A small, tested template table, with a fallback to "Make it {value}". If no template fits, we speak only the person's own words.
- **Long chains.** If a chain doesn't fit 40 s, per-step time shrinks and only the top driver is spoken. The full chain always plays in order.
- **No sensor.** Recovery is `null` and the installed rule falls back on self-report.
- **Small n.** Progress never claims an effect. It shows counts and medians, and says when there are too few shams.

---

## 9. Open questions

| For | Question |
|---|---|
| human | Confirm the installed criterion in D-reps-003 (5 good reps; then an anchor-step-only test with a rating of at least 7 and a rise of at least 2; two passes in a row). |
| human | On stage, should the sham rate be 0, or should one sham be pinned in the scripted scenario? |
| human | Is a 32 s rep (bounds 20 to 40 s) right for the demo pacing? |
| contracts | Please add the §4 fields, `trigger.kind: onboarding`, `phase`, the `strategy-step` and `anchor-peak` step kinds, and the `stateId` rename. Will drivers carry `{ modality, attribute, peakValue, contrastValue, ratingDelta }`? |
| onboarding | Can you capture a 0 to 10 rating after future pace (4.3), and timestamps for 4.1 to 4.3? |

---

## Safety

- A rep speaks only the person's confirmed words and their own submodality values, inside neutral templates. It contains no clinical, diagnostic or mood-reading language, and it never uses the contrast memory.
- A stop control is on screen for the whole rep. Pressing it ends speech at once and logs `endedBy: user-stop`.
- On a distress signal, the rep ends with `endedBy: safety-stop` and the screen shows the stop line from onboarding's shared copy and `README.md`: Peak State is not the right support, so contact someone you trust or local emergency services.
- Stopped reps are logged and never counted.

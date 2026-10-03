# reps · lane plan

**Lane:** reps (Repetition and conditioning engine) · **Owns:** `reps/` · **Branch:** `lane/reps`

**Mission.** Install each of the person's three states with measurable reps. Robbins' conditioning steps set the method. The log is what makes them testable.

Peak State is a performance and state-recall tool, not therapy or diagnosis. Every rep keeps the stop line from `README.md` (see [Safety](#safety)).

---

## 1. Where this lane sits in the Robbins mapping

From `docs/on-aim-closed-loop.html`, sections 3 to 5, narrowed to the MVP table in `docs/hackathon/mvp.md`:

| Robbins step | Who does it | What reps does with it |
|---|---|---|
| 1 · Decide what you want | onboarding | Reads the three emotions from Profile v2. |
| 2 · Get leverage | onboarding captures it | Speaks the person's one-line "why it matters" inside the focus step, if the profile has one. |
| 3 · Interrupt the pattern | sensing (gate) or the manual button | The anchor opens the rep: it is the interrupt. |
| 4 · New alternative | onboarding captures it | The rep runs the person's triad in a fixed order: physiology, then focus, then language. |
| 5 · Condition it | **reps** | Every rep is one logged trial. The anchor plays again at the peak of the rep, so it is paired with the state at its strongest. Reps per emotion are counted. |
| 6 · Test it | **reps** | The anchor-only test, plus sham trials that let us compare recovery after a cue with recovery after no cue. |

Two lessons from the research carry straight into the design:

- **Anchoring.** An anchor has to be conditioned in the on-state before it works as an interrupt. So the anchor plays at the start (interrupt) *and* at the peak (conditioning), and the installed test plays it on its own.
- **Sham trials.** Drift ends by itself. Without withheld-cue trials every rep looks like it worked. The sham arm is in the log design from day one, even if the stage demo sets the rate to zero.

These frameworks are coaching hypotheses, not validated science. The app measures them. It does not claim them.

---

## 2. Rep script format (M1)

A rep is generated from **one emotion** in Profile v2. It is a fixed sequence of timed steps, spoken with browser speech and shown on screen. Only the person's own words are spoken, joined by short, neutral connectors. Nothing is invented.

| # | Step | Source in Profile v2 | Default | Range | What happens |
|---|---|---|---|---|---|
| 0 | `rate-before` | — | untimed | — | One tap, 0 to 10: "How much *{label}* right now?" Skippable on a detection trigger (logged as `null`). Not part of the timed budget. |
| 1 | `anchor` | `emotion.anchor` | 3 s | 2–4 s | Plays the anchor: a sound plays, a word is spoken, or a gesture prompt is shown ("Make your gesture"). Skipped if there is no anchor. |
| 2 | `physiology` | `strategy.physiology` (action, cue) | 9 s | 6–12 s | Their body move, spoken as something to do now. Body goes first. |
| 3 | `focus` | `strategy.focus` (+ leverage line) | 8 s | 5–10 s | Points attention at their focus. Adds their "why it matters" line if present. |
| 4 | `language` | `strategy.language` | 8 s | 5–10 s | Says their sentence once, slowly, then leaves a silence for them to repeat it. |
| 5 | `peak` | all three + anchor | 4 s | 2–5 s | One line that stacks all three, then the anchor again. This is the conditioning pairing. |
| 6 | `rate-after` | — | untimed | — | One tap, 0 to 10. Then the rep ends. |

- **Timed budget:** steps 1 to 5. The default is **32 s**. The hard bounds are **20 to 40 s**. The generator scales the step durations to fit, using each step's speech length as the floor.
- **Script object:** `RepScript { emotionId, mode: "full" | "anchor-only", steps: [{ kind, text, plannedMs, anchor? }], totalMs, scriptHash }`. `scriptHash` lets the log show exactly which wording ran.
- **No anchor in the profile:** the rep still runs (no steps 1, no anchor in 5). That emotion can be counted, but it cannot be installed. Progress shows "add an anchor to install".
- **Speech:** `speechSynthesis` if it is available. Otherwise the text is shown on screen at the same timing. The clock is injectable, so tests run without waiting.

---

## 3. What a RepSession logs (M2)

The contracts lane owns the final shape. This is what reps needs, using the names in contracts' first cut (D-contracts-004). The fields marked **new** go to contracts as a request.

| Field | Type | Why |
|---|---|---|
| `id` | string | |
| `profileId` | string | **new** · which profile the script came from |
| `emotionId` | string | |
| `mode` | `"full"` \| `"anchor-only"` | Keeps the installed test apart from conditioning reps (D-contracts-004 name). |
| `trigger` | `{ kind: "detection" \| "manual" \| "practice", detectionId? }` | Links the rep to the DetectionEvent that fired it. |
| `arm` | `"cue"` \| `"sham"` | Taken from `DetectionEvent.gate.sham`. It is always `cue` for manual and practice triggers. |
| `startedAt`, `endedAt` | ISO time | **new** |
| `steps[]` | `{ kind, plannedMs, startedAt, endedAt, completed: bool }`, kind one of `anchor`, `physiology`, `focus`, `leverage`, `language`, `peak`, `rate` | Which steps actually ran. A sham has none. `leverage` is logged as its own step inside the focus budget. **new:** `peak`, `plannedMs`. |
| `scriptHash` | string | **new** · the exact wording that ran |
| `anchorPaired` | bool | **new** · true if the anchor played at the peak. Counts toward conditioning. |
| `intensityBefore`, `intensityAfter` | 0–10 or `null` | The person's own rating. |
| `recoverySeconds` | number or `null` | From the trigger time to the first time sensing reports the signals back inside the person's on-state band. |
| `recoveryCensored` | bool | **new** · true if there was no recovery inside the window (180 s), so `null` means "not recovered" rather than "not measured". |
| `signalSource` | `"simulator"` \| `"hr-strap"` \| `"none"` | **new** · recovery from a manual-only session is never compared with recovery from a sensed one. |
| `endedBy` | `"completed"` \| `"skipped"` \| `"user-stop"` \| `"safety-stop"` | D-contracts-004 name; **new:** `user-stop`. Stopped reps are kept in the log and left out of the counts. |
| `repIndex` | integer | **new** · the nth rep for this emotion, so trends do not depend on sort order. |

That is enough to tell a cue from a sham for every rep (definition of done).

---

## 4. Sham trials (M3)

- **Who decides.** The sensing gate rolls the sham at detection time and writes `gate.sham` into the DetectionEvent. Reps honours it and does not roll its own die. That keeps one random draw per trial in one place.
- **What a sham does.** Nothing plays. After the same total time as a cue rep (rate-before, then the script length, then rate-after), the rating prompt appears. The rating prompt appears in both arms, so the only difference between arms is the rep itself.
- **What is never a sham.** Manual triggers (the person asked for help) and practice reps (they are conditioning). Only detection triggers can be shams.
- **Rate.** Default **0.25**, as in the research page. The demo can set it to 0 on stage, or pin one sham trial in the scripted simulator scenario so the progress screen has a real comparison to show. The field stays in the log either way.
- **What it buys.** The progress view compares median `recoverySeconds` for cue against sham, by signal source, only for detection triggers. With fewer than 3 shams it shows "not enough sham trials yet" instead of a number.

---

## 5. Conditioning count and the installed criterion (M3)

Logged as a **proposed** decision because a person should confirm the numbers.

- **A good rep** is a `mode: full`, `cue`-arm rep with `endedBy: completed`, `anchorPaired: true` and `intensityAfter ≥ 7`.
- **Ready to test.** After **5 good reps** for an emotion, the next practice offer is an anchor-only test.
- **The anchor-only test** is `mode: "anchor-only"`: rate-before, then the anchor alone, then **10 s** of silence, then rate-after. No physiology, focus or language.
- **Pass.** `intensityAfter ≥ 7` and `intensityAfter − intensityBefore ≥ 2`. When signals are present, recovery is logged too. It is not required for a pass, because the strap may not be there.
- **Installed.** **2 passes in a row**. One lucky test does not install a state.
- **Fail.** The emotion needs 3 more good reps before the next test.
- **Lost.** If 2 later anchor-only tests in a row fail, the badge drops back to "conditioning". Tests keep being offered after 5 more good reps.
- **No anchor, no install.** An emotion without an anchor never shows the badge.
- **Demo.** Five reps will not fit in three minutes. The demo loads a seeded rep history fixture so that one emotion is one test away from installed, and the live test on stage installs it.

---

## 6. Interfaces

**Needs**

| From | What | Used for |
|---|---|---|
| contracts | Profile v2 (with an optional per-emotion `leverage` line) and its fixture | Generating the script |
| contracts | RepSession schema, with the fields in §3 | The log |
| contracts | TypeScript types and a validator | Tests |
| sensing | `DetectionEvent` with `gate.sham` | The arm, and linking the trigger |
| sensing | A recovery signal: `onRecovered(detectionEventId, t)` or a predicate over SignalFrames that says the signals are back in the on-state band | `recoverySeconds` |

**Provides**

```ts
reps.script(profile, emotionId, mode?: "full" | "anchor-only"): RepScript
reps.run(profile, emotionId, trigger, opts?: { onStep?, clock?, speech? }): RepHandle
  // RepHandle = { session: Promise<RepSession>, stop(reason?: "user-stop" | "safety-stop"): void }
reps.status(profile, sessions: RepSession[]): EmotionRepStatus[]
  // per emotion: goodReps, state ("conditioning" | "ready-to-test" | "installed" | "no-anchor"), next action
reps.progress(sessions: RepSession[]): ProgressAggregates
  // reps per emotion, intensity trend, recovery cue vs sham by source, installed flags
```

Reps is pure about storage. It returns sessions, and experience persists them in the browser and passes them back in. Whether `run` returns a promise of the session or a handle is up to contracts' `API.md`. A handle is needed so the stop button works.

---

## 7. Milestones

| Gate | Reps deliverable | Done when |
|---|---|---|
| M0 | This plan, a kickoff decision, the installed criterion (proposed), status, messages | Pushed and green on the board |
| M1 | Script generator against the contracts fixture. Unit tests for timing bounds and wording (only the person's words) | `reps.script` passes for all three fixture emotions, 20 ≤ total ≤ 40 s |
| M2 | Rep runner: timed steps, browser speech with an on-screen fallback, stop, ratings, a RepSession that passes schema validation | Experience can fire a rep from a simulated drift and get a valid session |
| M3 | Sham arm, the conditioning count, the anchor-only test, installed status, the seeded history fixture for the demo | Rules in §5 covered by tests |
| M4 | `reps.progress` aggregates for experience's progress screen | Progress screen shows real numbers from the log |

---

## 8. Risks

- **Contract drift.** If the RepSession shape lands without the §3 fields, cue against sham and the installed rule cannot be computed. Mitigation: send the request to contracts now, and build against fixtures.
- **Recovery needs sensing.** With manual input only, `recoverySeconds` is `null`. The installed rule is built on self-report so it still works, and recovery is a bonus.
- **Browser speech differs** across devices and some voices are slow. Step durations stretch to fit the speech, up to the 40 s cap; past that the speech is cut and the text stays on screen.
- **Small n.** A demo has a handful of trials. The progress view never claims an effect. It shows counts and medians, and says when there are too few shams.
- **Rating is itself a cue.** The rate-after prompt appears in both arms, at the same time, so it does not bias cue against sham.

---

## 9. Open questions

| For | Question |
|---|---|
| human | Confirm the installed criterion in §5 (5 good reps, rating ≥ 7 and rise ≥ 2, 2 tests in a row). |
| human | Sham rate on stage: 0, or one pinned sham trial in the scripted scenario? The log design keeps the arm either way. |
| human | Default rep length: 32 s, inside 20 to 40 s. Is that right for the demo pacing (the rep step is 30 s in the script)? |
| contracts | Add the §3 RepSession fields and a per-emotion `leverage` line to Profile v2? Is `reps.run` a promise or a handle? |
| sensing | Where does `gate.sham` live, and how will you report "recovered" for a detection? |
| experience | Which emotion fires on a detection: the one the person picked on the live screen? Who persists the rep log (proposal: experience, in browser storage)? |

---

## Safety

- The rep speaks only the person's confirmed words plus neutral connectors. No clinical, diagnostic or mood-reading language.
- A stop control is on screen for the whole rep. Stopping ends speech at once and logs `endedBy: user-stop`.
- If the app sees a distress signal (a person's "stop, this isn't okay", or a flag from experience), the rep ends with `endedBy: safety-stop` and the screen shows the stop line from `README.md`: Peak State is not the right support, contact someone you trust or local emergency services.
- Stopped reps are logged and never counted toward conditioning.

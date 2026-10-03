# Onboarding · lane plan

Owner lane: `onboarding`. Branch: `lane/onboarding`.

Current decisions:

| Decision | Covers | Status |
|---|---|---|
| D-onboarding-011 | This plan | accepted |
| D-onboarding-006 | Playbook conversation | accepted |
| D-onboarding-007 | Voice stack | **proposed** |
| D-onboarding-008 | Calibration | accepted |
| D-onboarding-009 | Safety | accepted |
| D-onboarding-010 | Stage demo split | **proposed** |

These supersede D-onboarding-001 to 005, which assumed three emotions with fixed triad slots. Scope comes from D-coord-011 and D-coord-012.

**Goal.** In one voice session, a first-time user names one state in their own words. They end with a confirmed profile that holds:

- the ordered **steps** they run to get into the state
- the **submodalities** of each step, with the anchor step marked
- a mild **contrast** state and the 1 to 3 **drivers**, as tested hypotheses
- recode, test and future-pace results
- a peak calibration window and a contrast calibration window

Nothing in the profile was invented by the guide. The procedure is `docs/hackathon/elicitation-playbook.md`, sections 1 to 4.

**Next version.** The person chooses among three emotions, and the same script runs once per emotion. The script is data parameterised by state, and the profile holds 1 to 3 states, so the upgrade needs no code change.

## 1. The voice session (D-onboarding-006)

The voice rules: one question at a time, wait for silence, the person can interrupt, reflect their own words, and ask **how** an experience is represented, never **what** it is about. A menu ("a picture, a sound, or a feeling?") always accepts another answer.

| Section | The guide | Captured | Exit when |
|---|---|---|---|
| 0 Frame | About 15 s on what will happen, then asks to start | (nothing) | Yes; a no ends with nothing saved |
| 1 Strategy | 1.1 Names the state in their words. 1.2 Steps into a specific memory (**peak window opens**). 1.3 First trigger: seen, heard or touched (external). 1.4 to 1.5 "And the next thing?" until fully in. 1.6 Plays back the order | `state.label`, `words`, `memoryCue` (a short private cue, not the story), `steps[]` {modality, direction, content}, `fullyInAt` | The person confirms the order. **Peak window closes** at `fullyInAt`, minimum 20 s |
| 2 Submodalities | For each step, the core questions for its modality only (picture: location, size, distance, brightness, associated or dissociated; sound: source, volume, direction; feeling: body location, 0 to 10, moving or still). Extended questions only if time allows. Then "which one, given back to you, brings it back fastest?" | `steps[i].submodalities`, `anchorStep` | Every step has its core attributes, or they are marked unknown after one follow-up |
| 3 Contrast | 3.1 A small, recent, mild flat or stuck time (**contrast window opens**). 3.2 The same questions for the strategy's modalities only (**window closes**). 3.3 Break state. 3.4 The app computes the differences. 3.5 Tests one difference at a time, largest first, as a 0 to 10 delta, undoing each before the next. 3.6 Reads back the top 1 to 3 as findings to test, not facts | `contrast.label`, `contrast.submodalities`, `differences[]` {attribute, peak, contrast, ratingDelta}, `drivers[]` | Drivers read back, or the section is skipped under the safety rules (§3) |
| 4 Use it | 4.1 Recode: gives the stuck time the drivers. 4.2 Test: 0 to 10 before and after. 4.3 Future pace: an upcoming situation. 4.4 Final playback, in their order, with the drivers | `recode.appliedDrivers`, `test.before/after`, `futurePace.situation`, `confirmedAt` | The person confirms the playback |

**How data is saved.** The model never speaks JSON. It calls structured tools:

- `set-state`
- `add-step`
- `set-submodality`
- `set-anchor-step`
- `set-contrast`
- `set-rating`
- `set-future-pace`
- `confirm`

The scripted path emits the same events. One extractor turns the event log, or a raw transcript for the M2 fixture, into the profile. A field is saved only if a user utterance backs it.

Differences and drivers are computed by onboarding code, not by the model. A difference is a submodality whose peak and contrast values differ. A driver is one of the up-to-three differences with the largest absolute `ratingDelta`.

**Derived triad.** The physiology, focus and language view is computed and never stored: feeling steps map to physiology, picture steps to focus, and self-talk steps to language. I'll ship it as a helper in onboarding unless contracts wants it in `contracts/`.

## 2. Voice stack (D-onboarding-007, proposed)

- **Primary.** The guide speaks and listens, with barge-in and end of turn on silence. The screen shows the live transcript, plus the step chain (`Ve → Ai → Ki`) and a submodality checklist per step as they fill in.
- **Default browser stack.** Web Speech API: SpeechRecognition for input, speechSynthesis for output. It needs no server.
- **Model.** A person picks. My proposal is Claude (`claude-sonnet-5-5`, for turn latency) driving the playbook through the tools above.
- **Fallbacks, in order:**
  1. Typed input, with the guide spoken or silent.
  2. A deterministic scripted path with recorded answers: no network, key or microphone, and fast-forwardable. This is the stage default and the offline guarantee (D-coord-006).
- **Open with experience.** How a key or proxy reaches the model on the live path.

## 3. Safety (D-onboarding-009)

- **Per-turn screen.** Every spoken or typed turn passes a deterministic screen in `onboarding/safety/` before the model sees it. Every prompt also carries the stop line from `README.md`.
- **On a hit:** stop, say Peak State is not the right support, and point to a person they trust or local emergency services. Save nothing from that turn and end in a `stopped` state the app renders.
- **Mild contrast only.** The guide always asks for a small, recent, mild time. If the answer sounds heavy (loss, harm or trauma words, or the person rates it as bad), the guide does not explore it. It asks once for a smaller one; if that fails too, it skips section 3 and leaves the drivers empty. Reps then fall back to speaking the anchor step's submodalities.
- **Break state.** It runs straight after 3.2, and whenever the session stops during section 3.
- **No story.** The guide never asks what the contrast was about and stores only a short label. No clinical labels or interpretations are stored anywhere.
- **Shared copy.** The stop copy is one shared string set so reps and experience use the same words.

## 4. Calibration (D-onboarding-008)

There is no separate block. Windows open and close inside the playbook:

- `peak:<stateId>`: from 1.2 to `fullyInAt`
- `contrast:<stateId>`: from 3.1 to 3.2

Each window has a 20 s minimum, sensing's floor for one RMSSD window. If the person moves on sooner, the guide holds a short silent recall ("stay with it a moment").

The summaries are stored on the state with a quality flag. With no strap and no simulator, onboarding still completes; calibration is empty and sensing uses its generic baseline. In the scripted demo the simulator returns pinned peak and contrast windows.

## 5. Builds by gate

| Gate | Deliverable | Paths |
|---|---|---|
| M1 | `prompts/playbook-voice.md`: the guide's system prompt, rules and tools. `onboarding/script/`: the playbook as data (phases, questions, captured fields, exit rules), parameterised by state so it can loop up to 3 times | `prompts/`, `onboarding/script/` |
| M2 | Extractor: event log or transcript to profile, validated with contracts' validator. Difference and driver computation. Derived-triad helper. A fixture conversation, its expected profile, and unit tests | `onboarding/extract/`, `onboarding/fixtures/` |
| M3 | Voice session: Web Speech in and out, barge-in, live transcript events, typed and scripted fallbacks, and the model behind it. Calibration windows wired to sensing. `onboarding.run()` and `mount()` | `onboarding/conversation/`, `onboarding/voice/`, `onboarding/calibration/` |
| M4 | Playback copy, stop copy and break-state lines; a safety screen covering every path; the stage demo split (D-onboarding-010) rehearsed | `onboarding/safety/`, `onboarding/copy/`, `onboarding/fixtures/` |

The lane folder becomes the npm workspace package `@peak-state/onboarding` (D-coord-010). Other lanes are imported by package name, and types come from `contracts/`, never redeclared.

The old prompts (`prompts/strategy-extraction.md`, `docs/elicitation.md`, `docs/state-change.md`) stay as background. In M1, `docs/state-change.md` gets a note that the triad is now a derived view.

## 6. Interfaces

**Needs**

| From | What |
|---|---|
| contracts | The new Profile shape per D-coord-012: `states[]` (1 to 3); per state `label`, `words`, `memoryCue`, `strategy.steps[]` {modality, direction, content, submodalities}, `fullyInAt`, `anchorStep`, `contrast`, `differences[]`, `drivers[]`, `recode`, `test`, `futurePace`, `calibration` {peak, contrast}, `confirmedAt`. A controlled vocabulary for core submodality keys and values, so differences can be computed. A stopped or cancelled result for `run()`. |
| sensing | Start and stop windows by label, for example `const w = sensing.window('peak:s1'); …; await w.stop() → CalibrationSummary` with a quality flag. Works before `start()`, and on the simulator (pinned) and the strap. |
| experience | The Onboard slot hosts the voice screen through `mount(el, {onDone, onStop})`, or uses headless `run()` plus transcript and step events. Who renders the transcript and step chain. The key or proxy for the live model. |

**Provides**

- `onboarding.run({mode: 'voice' | 'typed' | 'scripted', fastForward?}) → Promise<Profile | Stopped>` and `mount(el, {onDone, onStop})`
- An event stream while it runs: transcript lines, step added, submodality set and window open or close, so experience can draw the step chain live
- To reps: the person's step order, the anchor step, drivers with deltas, and the recode and future-pace results as the first reps; plus the shared stop copy
- A fixture conversation and its profile, usable by every lane

## 7. Risks

- **Length.** The full playbook takes 6 to 10 minutes by voice. The stage split (D-onboarding-010, proposed) runs sections 1 and 4 live and pre-fills 2 and 3. In real use, core submodalities only.
- **Speech recognition.** Web Speech accuracy varies by browser, accent and room noise. Every answer is played back for confirmation, and the typed fallback is one tap away. Chrome is needed for SpeechRecognition.
- **Invented content.** LLMs paraphrase into virtues. Tool calls must quote the user, and the extractor rejects fields with no backing utterance.
- **Contrast safety.** Section 3 deliberately visits a negative state. It is mild by prompt, screened, broken after, and skippable.
- **Weak evidence.** NLP drivers are hypotheses (playbook, Source). The guide reads them back as findings to test, and the rep log is the test.
- **Contract churn.** D-contracts-003 still says exactly three emotions with triad slots. I build against fixtures only after contracts redefines the shape.

## 8. Open questions

For a person (`human`):
1. **Voice stack and model (D-onboarding-007):** Web Speech plus Claude, or a realtime speech API?
2. **Stage demo split (D-onboarding-010):** sections 1 and 4 live, with 2 and 3 pre-filled?
3. **Contrast threshold:** what rating (or which words) counts as too heavy to explore?

For other lanes:
- **contracts:** the submodality vocabulary, and whether the derived triad helper lives in `contracts/` or in onboarding
- **sensing:** whether open-ended windows (start/stop) are acceptable in place of `record(seconds)`
- **experience:** whether onboarding owns the voice screen, or experience renders it from events

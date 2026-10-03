# Onboarding · lane plan

Owner lane: `onboarding`. Branch: `lane/onboarding`. Decisions: D-onboarding-001 to 005.

**Goal.** In one conversation of under three minutes, a first-time user ends with a confirmed Profile v2: three top emotions, each with their own physiology, focus and language strategy plus an optional anchor, played back in their words, with a short calibration of what each state looks like in their signals. Nothing in the profile is invented by the guide.

**Starting material.** `prompts/strategy-extraction.md` (one state, three strategies, stack check) and `docs/state-change.md` (the triad, if-then cues, no added techniques). Both assume one peak state, and `docs/elicitation.md` says "one peak, not a catalog". The MVP needs three, so these get a three-emotion successor rather than a rewrite. The old prompts stay as the source of the rules.

## 1. The conversation (D-onboarding-003)

One conversation and one pass. The guide asks one question at a time, uses the person's own words, and never reads field names or JSON aloud.

| Step | What the guide does | Exit when |
|---|---|---|
| 0 Frame | About 15 s: "three emotions you're at your best in, the move you already use for each, then a quick replay." Asks to start. | Yes. A no ends with nothing saved. |
| 1 Name three | "Think of three times you were unmistakably at your best, and how each felt." For each, a concrete moment, then a label in their words (*confident*, *calm focus*, *playful*). Asks which matters most, to set the order. | Three labels accepted. If only two come, keep two and say so; never fill in a third. |
| 2 Triad × 3 | For each emotion in rank order: | |
| 2a Physiology | "In that moment, what did your body do that you could repeat in the next 30 seconds?" Posture, breath or a small movement. | Confirmed, or one follow-up spent |
| 2b Focus | "What was your attention on: a specific thing, person or picture?" Reject a quality ("the goal") once. | Same |
| 2c Language | "What do you say to yourself that starts it? A few words is enough." If none, "what would you say?" | Same |
| 2d Anchor (optional) | "Is there a sound, a gesture or a word that belongs to this one?" Kind + value. | Given or declined |
| 2e Leverage | "In one line, why does this one matter to you?" Used by the rep's Get Leverage step. | One line, or skipped |
| 2f Cue | "When does this one apply?" Stored as the if-then situation cue on the strategy. | One answer |
| 3 Playback | Speaks body → focus → words → anchor in their words. "Is that right, and did it bring it back even a little?" Yes saves the emotion. Partly: "which one was flat?", replace only that slot, replay once. No: keep the draft unconfirmed. | Per emotion |
| 4 Confirm | When all three emotions are confirmed, set `confirmedAt`. | Profile valid against contracts/ |

Budget: about 50 s per emotion, which needs one follow-up per slot (the old prompt allowed two). When time or patience runs out, the slot stays empty and is marked unconfirmed. An abstract answer is rejected once ("what would I see you do?"); after that the guide moves on.

**How fields get saved.** The conversation model never emits JSON in speech. It calls structured tools: `set-emotion`, `set-strategy {emotionId, slot, action, cue}`, `set-anchor`, `set-leverage`, `confirm-emotion`. The scripted demo path drives the same events. One extractor turns the event log (or a raw transcript, for the M2 fixture) into Profile v2.

## 2. Calibration (D-onboarding-004)

After playback, one neutral block (sit quietly, label `neutral`) gives sensing a reference, then one block per emotion:

1. 5 s settle: "Sit how you sit when you're *confident*."
2. 20 s guided recall: the guide replays that emotion's triad in their words while onboarding calls `sensing.record(20, emotionId)` (signature agreed with sensing; the duration is a parameter).
3. A 0 to 10 rating: "How much of it came back?"
4. Store sensing's summary on `emotion.calibration`: the stats contracts defines (for example HR mean and spread, RMSSD, quality, source), plus the rating.

A skip is always allowed. With no calibration, sensing uses its generic baseline. Poor-quality windows are flagged, not dropped. In demo mode the simulator returns a pinned on-state and the step can be fast-forwarded to fit the 30 s demo slot.

Open: the brief says about 20 s, `coord/lanes.json` says about 60 s, and the demo table gives the whole step 30 s. I chose 20 s; this is flagged to coord and sensing.

## 3. Safety stop (D-onboarding-005)

- Every user turn passes a deterministic screen in `onboarding/safety/` (distress, intent to harm, requests for clinical help) **before** the model sees it. It also works on the scripted offline path, where no model runs.
- Every prompt also carries the stop instruction from `README.md`, as `strategy-extraction.md` already does.
- On a hit: stop elicitation, say Peak State is not the right support, point to someone they trust or local emergency services, save nothing from that turn, and end in a `stopped` state the app renders. No retry prompt.
- Never store a clinical label, diagnosis or mood interpretation in the profile. Labels are the person's words for a *good* state.
- The stop copy is one shared string set so reps and experience use the same words.

## 4. Builds by gate

| Gate | Deliverable | Paths |
|---|---|---|
| M1 | This plan. `prompts/onboarding-three-emotions.md`: the three-emotion elicitation prompt. `onboarding/script/`: the scripted demo conversation as data. | `onboarding/PLAN.md`, `prompts/`, `onboarding/script/` |
| M2 | Extractor: event log or transcript → Profile v2, validated with contracts' validator. Fixture conversation plus its expected profile. Unit tests. | `onboarding/extract/`, `onboarding/fixtures/` |
| M3 | Live conversation: text chat with Claude behind it, optional Web Speech in and out, scripted fallback. Calibration wired to `sensing.record()`. `onboarding.run()`. | `onboarding/conversation/`, `onboarding/calibration/` |
| M4 | Playback screen copy, safety stop in every prompt plus the pre-check, and stop copy shared with reps and experience. | `onboarding/safety/`, `onboarding/copy/` |

All code is TypeScript in the browser (D-coord-006), with types imported from `contracts/`, never redeclared.

## 5. Interfaces

**Needs**

| From | What | Why |
|---|---|---|
| contracts | Profile v2 schema + TS types + validator; a `calibration` summary shape; room for `leverage`, the person's own words, and an if-then `cue` per strategy | The extractor and the final profile |
| sensing | `record(seconds, label) → Promise<CalibrationSummary>`, which works on the simulator and the strap; sensing's floor is 20 s per label for one RMSSD window | The calibration step |
| experience | Onboard and Calibrate screen slots (D-experience-003): I provide both `run()` and `mount(el, {onDone, onStop})`. Still open: how a key or proxy reaches the LLM | M3 |

**Provides**

- `onboarding.run(opts?: {mode: 'scripted' | 'live', speech?: boolean}) → Promise<Profile>`. It resolves with a confirmed profile, or rejects or returns a stopped result on a safety stop or cancel (the shape is agreed with contracts).
- To reps: per-emotion `leverage` line and anchor, and shared safety stop copy.
- A fixture conversation and its resulting profile, usable by every lane.

## 6. Risks

- **Three minutes is tight.** Three emotions × (three slots + anchor + leverage + cue + playback) is about 21 exchanges. Mitigations: one follow-up per slot, the cue folded into the slot question when the person volunteers it, and the anchor and leverage skippable. The stage demo uses the scripted path.
- **Invented strategies.** An LLM tends to "helpfully" suggest moves. The prompt forbids it. Only confirmed tool calls are saved. The extractor rejects a field with no matching user utterance in the transcript.
- **Offline vs. LLM.** The demo must run offline (D-coord-006), so the scripted path is the default and the LLM path is opt-in. Pending D-onboarding-002.
- **Calibration noise.** 20 s gives only a few HRV windows, so the summary carries a quality flag and sensing should treat it as a prior, not ground truth.
- **Contract churn.** Profile v2 is not frozen until M1. I build against contracts' fixtures and do not invent a second shape.

## 7. Open questions

For a person (`human`):
1. Conversation model and voice stack (D-onboarding-002, proposed): Claude for text plus browser speech, with the scripted path as the demo default?
2. How much of onboarding is scripted on stage: the whole conversation, or a live first emotion with the other two pre-filled?
3. Calibration length: 20 s per emotion (my choice), or the 60 s in `coord/lanes.json`?

For other lanes:
- contracts: add `leverage`, `ownWords`, a per-strategy `cue`, and a calibration summary shape to Profile v2? What shape does a stopped or cancelled `run()` return?
- sensing: `record(seconds)` signature and return shape; does it work before `start()`?
- experience: where the onboarding UI lives, and the key or proxy for the LLM.

# Onboarding playbook · strategy and submodality elicitation by voice

This is the procedure the onboarding voice session runs. It turns one remembered peak state into data the rest of Peak State can replay:

- the **strategy**: the ordered steps the person runs to get into the state
- the **submodalities** of each step: the fine detail of how each step is represented
- the **drivers**: the few details that make the most difference

**Source.** Two linked procedures in Tony Robbins' *Unlimited Power*, as recalled by the product owner; they do not come from his live-event materials. The method comes from neuro-linguistic programming (NLP), which has little controlled evidence behind it. A person's drivers are therefore hypotheses to test with that person, never facts to assume. The test step and the rep log are how we test them.

## Scope for the MVP (D-coord-011)

- **One state per person, chosen by the person.** They pick the state and its content in their own words, for example "totally motivated", "calm before a pitch" or "playful with my kids". The guide offers no menu.
- **The next version** asks the person to choose among three emotions and runs this playbook once per emotion. Data shapes hold 1 to 3 states from day one, so that upgrade adds nothing new to the contract.
- **Voice first.** The guide speaks and listens. The screen shows a live transcript and the step list as it fills in. A typed fallback and a deterministic scripted path exist for a quiet room or no network.

## Rules for the voice guide

- Ask one question at a time and wait for silence. The person may interrupt the guide at any point.
- Reflect back the person's own words. Never paraphrase them into a virtue ("so you feel empowered").
- When you offer a menu ("a picture, a sound, or a feeling?"), always accept another answer.
- Ask **how** an experience is represented, not **what** it is about. The content belongs to the person and is never judged.
- Keep the contrast state mild ("a time you felt flat or stuck about something small"), brief, and never traumatic. Break state immediately after.
- Stop line: if the person describes distress, stop the elicitation, say so plainly, and point them to a person they trust. This is not therapy (see `README.md`).

## 1 · Elicit the strategy

| # | Guide says | Captured |
|---|---|---|
| 1.1 | "What state do you want to be able to get back to? Say it in your own words." | `state.label`, `state.words` |
| 1.2 | "Can you remember a specific time when you were totally *[state]*? Go back to that time and step into it. Tell me when you're there." | `state.memoryCue`: a short private cue only, not the story. Calibration recording starts here. |
| 1.3 | "What was the very first thing that caused you to be totally *[state]*? Something you saw, something you heard, or the touch of something?" | step 1: `modality` visual, auditory or kinesthetic; `direction` external; `content` in their words |
| 1.4 | "After that, what was the very next thing? Did you make a picture in your mind, say something to yourself, or have a certain feeling?" | next step: `modality`, `direction` (usually internal), `content` |
| 1.5 | "And the next thing?" Repeat until the person says they were fully in the state. | further steps; `fullyInAt` is the step where they arrived |
| 1.6 | Playback: "So first you *[see the crowd]*, then you *[say 'here we go']* to yourself, then you *[feel it in your chest]*. Is that the order?" | `strategy.confirmed`. The order matters as much as the parts. |

The written notation is the step chain, for example `Ve → Ai → Ki`: external visual, then internal auditory (self-talk), then internal kinesthetic.

## 2 · Elicit the submodalities of each step

For each step, ask about the representation only for that step's modality. To keep the voice session short, ask the **core** attributes first and the **extended** ones only if time allows.

| Modality | Core (always ask) | Extended |
|---|---|---|
| Picture | location, size, distance; bright or dim; your own eyes or watching yourself | movie or still, colour or black-and-white, focus, frame or panoramic |
| Sound | whose voice, or what source; volume; where it comes from | pitch, tempo, tone, inside the head or outside |
| Feeling | where in the body; intensity 0 to 10; moving or still | temperature, pressure or weight, steady or pulsing, direction of movement |

Anchors from the earlier frame become submodality detail on a step:

- **scene**: the picture step's details (light, distance, focal object)
- **song**: the sound step's source, down to the exact moment in the track
- **body cue**: the feeling step's location and movement

The guide also asks: "Which one of these, if I gave it back to you, would bring the state back fastest?" The answer is the candidate **anchor step**.

## 3 · Find the drivers by contrast

| # | Guide says | Captured |
|---|---|---|
| 3.1 | "Now think of a small, recent time you felt flat or stuck about something. Just a mild one." | `contrast.label` |
| 3.2 | The same submodality questions, only for the modalities that appear in the strategy | `contrast.submodalities` per modality |
| 3.3 | Break state: "Good, let that go. What colour is the wall in front of you?" | (nothing) |
| 3.4 | The app compares the two lists and marks each attribute that differs, for example peak picture close and bright, contrast picture far and dim. | `differences[]` |
| 3.5 | For each difference, one at a time, starting with the largest: "Think of the stuck time again. Bring the picture closer, like the strong one. What happens to the feeling, 0 to 10?" Then undo it before testing the next difference. | `differences[].ratingDelta` |
| 3.6 | The one to three differences with the biggest rating change are the **drivers**. Read them back as findings to test ("for you, closeness and brightness seem to matter most"), not as facts. | `drivers[]` |

## 4 · Use it

| # | Guide says | Captured |
|---|---|---|
| 4.1 | **Recode.** "Take the stuck time and give it the drivers of the strong one: move the picture to the same place, as bright and as close." | `recode.appliedDrivers` |
| 4.2 | **Test.** "Now think of that old situation again. Where are you, 0 to 10?" | `test.before`, `test.after` |
| 4.3 | **Future pace.** "Think of a time coming up when you'll want this. Run the steps there." | `futurePace.situation` |
| 4.4 | Final playback of the confirmed strategy in order, with its drivers | `confirmedAt` |

## What this feeds downstream

| Lane | Uses |
|---|---|
| contracts | Profile shape: `states[]` (1 to 3; the MVP has 1). Each state has an ordered `strategy.steps[]` (`modality`, `direction`, `content`, `submodalities`), an `anchorStep`, a `contrast`, `differences[]`, `drivers[]`, `test`, `futurePace` and `confirmedAt`. The physiology, focus and language triad is a **derived view**: feeling steps map to physiology, picture steps to focus, self-talk steps to language. |
| sensing | Calibration windows come free from the playbook: record during 1.2 to 1.5 (peak) and during 3.1 to 3.2 (contrast). That gives the detector the person's own on-state and off-state, not just a neutral baseline. |
| reps | A rep replays the person's **own step order** (not a fixed body, then focus, then words), with each step's driver submodalities spoken as instructions ("bring the picture close and bright"). The anchor-only test uses the anchor step. Recode, test and future-pace are the first reps. |
| experience | The onboarding screen is voice-first: live transcript, a step chain that fills in (`Ve → Ai → Ki`), and a submodality checklist per step. |

## Time budget

One state through the full playbook takes about 6 to 10 minutes by voice. For the 3-minute stage demo, the default is to run sections 1 and 4 live with core submodalities only, and to pre-fill the contrast and driver results from a rehearsal. That default is open as a question for a person.

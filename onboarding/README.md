# @peak-state/onboarding · question harness

Pick a state (**Content** or **Destressed**, or type your own). Then answer Robbins' strategy questions one at a time until you are fully in the state. Any question left unanswered for 5 seconds shows exactly two suggested phrasings. The confirmed strategy is saved as a contracts Profile v2, and **▶ Run my strategy** plays it back in one click.

Peak State is a performance and state-recall tool. It is not therapy, diagnosis or a crisis service. If you are in distress, stop and reach out to someone you trust or local emergency services.

## Run the harness

```bash
npm install                                   # once, at the repo root
npm run harness -w @peak-state/onboarding     # Vite on http://127.0.0.1:5174/
```

Open the printed URL. The page lives at `/`, because Vite's root is `onboarding/harness/`.

| URL option | Effect |
|---|---|
| `?hint=<ms>` | Hint delay. Default 5000 (`HINT_DELAY_MS`) |
| `?speed=fast` | Short playback pauses (about 150 ms) for testing. Default 1500 ms |
| `?voice=typed\|browser\|gpt-live` | Overrides the saved voice choice for this load |
| `?debug=live` | Logs every GPT live event (sent and received) to the console |

`npm run build:harness -w @peak-state/onboarding` builds a static copy to `onboarding/dist-harness/`.

## Voice options

Pick a voice in the header. A dot next to it shows the voice's status. Typing always works, whichever voice is on.

- **Typed**: nothing is spoken. During playback, each line stays on screen while its step card glows.
- **Browser voice**: uses the Web Speech API (speechSynthesis and SpeechRecognition), so it needs Chrome or Edge. The guide speaks each question. Partial transcripts show live in the answer box, and a final transcript is sent as your answer. During a run, you can say a number to rate.
- **GPT live**: OpenAI's GPT-Live voice (`gpt-live-1`) over WebRTC (D-onboarding-020). GPT-Live sessions must be created server-side with the project key, so the page posts its WebRTC offer to `/api/live/session`. That route is served by the harness dev server (`harness/live-proxy.ts`), which adds the key and calls `POST https://api.openai.com/v1/live/sessions`. Start the harness with the key in its environment:

  ```bash
  OPENAI_API_KEY=sk-… npm run harness -w @peak-state/onboarding
  ```

  On Cloudflare the Worker serves the same route for signed-in accounts, using its `OPENAI_API_KEY` secret (see DEPLOY.md).

  A key pasted in the gear also works. It is sent only to that local route, which uses it when `OPENAI_API_KEY` is unset. The gear also edits the model id. Each question is sent as `session.commentary.append`, and the mic is muted while the guide speaks. The model's audio is muted outside those lines, so replies the model makes on its own are not heard. Answers are assembled from `session.input_transcript.delta` fragments and sent after 1.8 s of silence. GPT-Live says commentary in its own voice and may paraphrase. Run with `?debug=live` to see the spoken transcript.

Microphone and speech start on your first click on the page, because browsers require a user gesture before they will start either.

## What is stored

| localStorage key | Holds |
|---|---|
| `peak-state.harness.strategy` | `SavedStrategy` `{ profile: ProfileV2, savedAt }` |
| `peak-state.harness.runs` | `RepSession[]`, one per run: `kind: "full"`, `trigger: practice`, `arm: cue`. Each passes `validateRepSession` |
| `peak-state.harness.voice` | Voice kind, model, remember flag, and the key only if remember is ticked |

"Start a new one" clears the saved strategy. The run log is kept.

## Code

| Path | What |
|---|---|
| `harness/index.html`, `harness/styles.css`, `harness/main.ts` | Page shell, styles (light and dark), and the entry point |
| `src/harness/` | Page controller (`main.ts`), hint timer (`hints.ts`), and views (`view/`: question card, step chain, saved card and playback, voice controls) |
| `src/playback/` | `storage.ts` (save, load and clear helpers plus the run log), `script.ts` (`buildPlaybackLines(profile, stateId)`), `runner.ts` (`runStrategy(profile, stateId, callbacks, opts)`, which returns a RepSession) |
| `src/engine/`, `script/` | The question engine and the question bank |
| `src/voice/` | Typed, browser and GPT live voice adapters |
| `harness/live-proxy.ts` | Dev and preview server route `/api/live/session`: holds the OpenAI key and starts GPT-Live sessions |
| `src/index.ts` | Public exports for other lanes |

`window.__harness.snapshot()` returns the engine's current `EngineSnapshot`, for tests.

## Tests

```bash
npm test -w @peak-state/onboarding            # unit tests (node:test), incl. test/unit/playback.test.ts
npm run typecheck -w @peak-state/onboarding
npm run test:visual -w @peak-state/onboarding # Playwright: the full flow for content and destressed, screenshots
```

The visual test writes `onboarding/test/e2e/report/`, with one screenshot per checkpoint below for each state. Don't edit files under `onboarding/` while it runs: the Vite dev server reloads the page on every change, and the reload restarts the conversation.

## Manual visual check

Run `npm run harness -w @peak-state/onboarding`, open the printed URL, and check:

| # | Do | You should see |
|---|---|---|
| 1 | Open the page | "What state do you want to choose?" with Content and Destressed buttons |
| 2 | Click Content | The guide asks you to step into a time you felt content |
| 3 | Answer "I'm there" | "What was the very first thing that caused you to feel content?" |
| 4 | Wait 5 seconds without typing | Exactly two suggested phrasings appear under the question |
| 5 | Tap a suggestion and send | Step 1 appears in the step chain with its sense (picture, sound or feeling), then its detail questions start |
| 6 | Answer the detail questions, waiting 5 s on one | Two suggestions again; each answer ticks off on the step's checklist |
| 7 | Say there was a next thing, describe it, and answer its details; then say you're fully in it | The chain shows 2 or more steps in order, for example `Ve → Ki` |
| 8 | Pick the anchor and confirm the playback | "Strategy saved" card listing your steps in order, with a Download button |
| 9 | Reload the page | The saved strategy is still there |
| 10 | Click **Run my strategy** | Rate 0 to 10, then each step lights up in order while it is spoken, ending on the anchor; rate again; the run appears in the log |
| 11 | Repeat with Destressed | The same, with destressed wording and suggestions |

Tapping a suggestion puts its text in the answer box so you can edit it. Double-click the suggestion, or press its **Use ↵**, to send it straight away.

## Practice, accounts and going online

After the first session, **Practice** runs the second-iteration loop (D-onboarding-015): recall by questions with the
person's saved answers, a spoken 0 to 10 rating, one strategy question, and "Okay, let's try again." when an answer
changes. Each change is a new strategy revision with a change log (D-onboarding-014), every run is counted in the
"you've chosen to feel …" reminder (D-onboarding-016), and with an account (email plus invite code) the strategy and
runs sync to a Cloudflare Worker with D1 (D-onboarding-017). Running and deploying it: [DEPLOY.md](DEPLOY.md).

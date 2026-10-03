# Peak State

Peak State helps a person find the sensory cues that already put them in their best emotional and mental state, then use those cues to get back there on demand.

The product is a closed loop with a manual path inside it:

1. **Offer.** Oura data can raise an offer when a rough stretch syncs. The offer does not start a call.
2. **Strategies.** On accept, a GPT Live 1 voice session identifies three moves the person already uses: a body action, a point of focus, and a sentence. That is the required output of the first session.
3. **Intervention.** Later accepts run those three moves and stop. Song, scene, and body anchors remain optional detail inside the three, not a second protocol.

This repository is the shareable frame for that product: the vision, the user journey, the elicitation strategy, the voice prompts, and the profile schema. It also contains client/backend scaffolding and the synthetic workflow lab below. A production client and live voice session remain planned; the original interaction decisions are recorded in [docs/open-questions.md](docs/open-questions.md).

## Hackathon build

The hackathon MVP is planned in [docs/hackathon/mvp.md](docs/hackathon/mvp.md). The plan covers three top emotions, a strategy for each, drift detection and conditioning reps.

Six lanes build it in parallel, coordinated through this repo:

- [CLAUDE.md](CLAUDE.md): the rules every session follows
- [coord/README.md](coord/README.md): the protocol
- [spec/](spec/README.md): the decision log rendered per lane
- The live dashboard: https://cameronaf22.github.io/peak-state/

## What a collaborator should read

| Order | Document | What it settles |
|---|---|---|
| 1 | This README | What the product is and how a session feels |
| 2 | [docs/plan.md](docs/plan.md) | Oura trigger, three strategies, and build order |
| 3 | [docs/oura-constraints.md](docs/oura-constraints.md) | What the Oura API can and cannot detect |
| 4 | [prompts/strategy-extraction.md](prompts/strategy-extraction.md) | Questions that extract the three strategies |
| 5 | [docs/trigger-flow.md](docs/trigger-flow.md) | Webhook, classify, offer, then voice |
| 6 | [docs/elicitation.md](docs/elicitation.md) | How sensory anchors are found and stacked |
| 7 | [docs/open-questions.md](docs/open-questions.md) | Decisions still open |

A filled example profile lives at [examples/sample-profile.json](examples/sample-profile.json).

The Ring 4 REST integration investigation and proposed import sequence are in [docs/oura-import-plan.md](docs/oura-import-plan.md), checked against Oura's current documentation on October 3, 2026.

The separate test app uses server-side OpenAI wording to fit prior answers naturally into follow-up questions and saved-state guidance. Setup and offline fallback behavior are in [docs/ai-guide.md](docs/ai-guide.md).

## Synthetic calming workflow lab

The isolated [workflow lab](docs/synthetic-workflow.md) runs without API keys. It includes nine generated HR/HRV scenarios, configurable percentage triggers, acceptance-gated calming suggestions, a recovery check-in, and explicit helpfulness feedback. The components use local rules; there are no live Oura or LLM calls. Its synthetic intraday HRV stream is not an Oura API capability.

```powershell
cd test/synthetic_lab
python -m peak_state serve --port 8765
```

Open [the localhost demo](http://127.0.0.1:8765). Run its tests with `python -m unittest discover -s tests -v` from that same directory. This lab is separate from the coordinated production lanes and their shared contracts.

## User journey

### First session — Discovery

The person opens Peak State with no profile. The voice agent does five things, in order, and does not skip ahead:

1. **Name the state.** Ask when they last felt unmistakably at their best. Capture a short label in their words ("locked in before a talk", "easy power on the bike").
2. **Auditory anchor.** Ask for the song, section, or sound that belongs to that state. Confirm title, artist, and the exact moment in the track.
3. **Visual anchor.** Ask what they see when that state is present. Prefer one still image they could point at: a photo they have, or a memory described in concrete visual terms.
4. **Kinesthetic anchor.** Ask where the state lives in the body, what the breath is doing, and one or two somatic words they would use to call it back.
5. **Stack check.** Fire the three anchors together once, slowly, and ask whether the state showed up. Keep only the cues they confirm.

Discovery ends when the profile validates against the schema and the person has heard their own anchors played back.

### Later sessions — Re-entry

The person opens the app and already has a profile. The voice agent does not interview them again. It:

1. Sets posture and breath from the kinesthetic anchor.
2. Names the somatic keywords.
3. Brings up the visual anchor.
4. Cues the musical moment.
5. Holds the stack until they report the state, or until the session time box ends.

If a cue fails, the agent asks one repair question and updates that anchor. It does not restart discovery.

## Sensory elicitation strategy

Peak State treats a peak state as something the person has already experienced, not something the app invents. The guide's job is to locate the sensory handles on that memory and bind them so they can be fired again.

Three channels, one cue each:

- **Auditory.** A specific musical moment, not a genre and not a playlist. The handle is "this bar of this song."
- **Visual.** A single scene with light, distance, and a focal object. A photo reference is better than a vague memory when the person has one.
- **Kinesthetic.** A body location, a breath pattern, and a short phrase. This channel leads re-entry because it needs no network and no media license.

The three cues are then stacked: body, then picture, then sound, inside one continuous voice guide. Stacking is what turns three memories into one switch.

Full rules, question order, and failure handling are in [docs/elicitation.md](docs/elicitation.md). The prompts in `prompts/` are the operational version of those rules.

## What this repo is for right now

Use it to align on the interaction before choosing an audio stack. The prompts and the profile schema are the contract. A client, a media integration, and a realtime voice session should implement that contract rather than invent a second one.

## Safety boundary

Peak State is a performance and state-recall tool. It is not therapy, diagnosis, or a crisis service. The prompts tell the guide to stop elicitation if the person describes distress, and to point them toward a human they trust. Do not store clinical interpretations in the profile.

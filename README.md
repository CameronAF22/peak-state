# Peak State

Peak State helps a person find the sensory cues that already put them in their best emotional and mental state, then use those cues to get back there on demand.

The product is a two-phase loop:

1. **Discovery.** A real-time voice guide asks a short, structured set of questions and extracts the person's strongest anchors: one piece of music, one visual memory or photo, and one physical feeling.
2. **Re-entry.** The next time they open the app, the same guide fires those anchors in sequence — voice, image, sound, and body — and walks them back into the state.

This repository is the shareable frame for that product: the vision, the user journey, the elicitation strategy, the voice prompts, and the profile schema. It does not yet contain a client or a live voice session. Those wait on three decisions recorded in [docs/open-questions.md](docs/open-questions.md).

## What a collaborator should read

| Order | Document | What it settles |
|---|---|---|
| 1 | This README | What the product is and how a session feels |
| 2 | [docs/elicitation.md](docs/elicitation.md) | How anchors are found and stacked |
| 3 | [prompts/discovery.md](prompts/discovery.md) | The onboarding voice prompt |
| 4 | [prompts/induction.md](prompts/induction.md) | The re-entry voice prompt |
| 5 | [schemas/user-state-profile.schema.json](schemas/user-state-profile.schema.json) | What we store about a person's anchors |
| 6 | [docs/architecture.md](docs/architecture.md) | How the pieces fit, and what is deliberately unset |
| 7 | [docs/open-questions.md](docs/open-questions.md) | Platform, media, and time-to-state |

A filled example profile lives at [examples/sample-profile.json](examples/sample-profile.json).

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

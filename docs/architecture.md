# Architecture

Peak State stores one profile, three strategies, and a voice session that starts only after the person accepts an offer. Oura can create the offer. GPT Live 1 runs the session. This document names those pieces. It does not pick a cloud or an audio SDK.

## Pieces

```
Oura sync ──▶ webhook ──▶ fetch heartrate ──▶ classify
                                                    │
                                              candidate and
                                              person is available
                                                    ▼
                                              offer (push)
                                                    │
                         accept                     │ decline / expire
                            ▼                       ▼
                    GPT Live 1 session         cooldown
                            │
                            ▼
                    three strategies
                    physiology, focus, language
```

| Piece | Responsibility | Status |
|---|---|---|
| Client | Opens a session, plays voice, shows the visual cue, starts the audio cue | Platform unset. See open questions. |
| Oura connection | OAuth read of daily, heartrate, and workout documents | Specified in `docs/oura-constraints.md` |
| Offer service | Turns a classifier candidate into a push the person can ignore | Specified in `docs/trigger-flow.md` |
| Voice guide | Runs one protocol per session | `prompts/strategy-extraction.md`, `prompts/intervention.md`, plus the earlier discovery and induction prompts |
| Strategies | The three confirmed moves | `schemas/peak-strategies.schema.json` |
| State profile | One peak state and optional sensory anchors | `schemas/user-state-profile.schema.json` |
| Media sources | Resolve a song or photo reference at re-entry | Unset. Profiles store references only. |

## Session rules

- A session is one of `strategy-extraction`, `intervention`, `discovery`, or `induction`. An accepted offer with no confirmed strategies uses extraction. An accepted offer with confirmed strategies uses intervention.
- Nothing in the Oura path opens a microphone. Acceptance on the client does.
- The guide does not switch protocols mid-session except for the one allowed handoff: induction with no confirmed profile redirects to discovery.
- Anchor updates are JSON objects that validate against `schemas/anchor-update.schema.json`. Free-form notes do not change the profile.
- The profile is the source of truth. Transcripts are optional session logs and are not required to re-enter a state.

## What is in scope for the first build

When implementation starts, the first build is done when:

1. A person can complete discovery by voice and produce a profile that validates.
2. A later session can load that profile and run induction without re-asking the discovery questions.
3. The kinesthetic cue plays even if song and photo resolution fail.
4. The guide stops on the safety line in the prompts.

## What is out of scope until the open questions close

- Native versus web audio pipeline
- Spotify, Apple Music, or any other catalog integration
- Storing private photos
- Multiple named states, teams, or sharing a profile
- A universal heart-rate or HRV threshold
- Any voice session that starts without an explicit accept

## Suggested build order

1. Freeze the prompts and schema in this repo (this commit).
2. Decide the first client and the time box (open questions 1 and 3).
3. Run induction with voice plus kinesthetic text only. No music license required.
4. Add visual display from a user-supplied reference.
5. Add a music deep-link only after the sourcing decision.

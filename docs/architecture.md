# Architecture

Peak State is a thin loop around one saved profile and two voice protocols. This document names the pieces and the boundaries. It does not pick a cloud, a database, or an audio SDK. Those choices depend on the open questions.

## Pieces

```
┌─────────────┐     speaks      ┌──────────────────┐
│   Client    │ ◀─────────────▶ │   Voice guide    │
│  (unset)    │   audio + cues  │  discovery or    │
└──────┬──────┘                 │  induction prompt│
       │ loads / saves          └────────┬─────────┘
       ▼                                 │ emits
┌──────────────────┐                     ▼
│  State profile   │◀────────── structured anchor updates
│  (JSON document) │
└──────────────────┘
       │ references only
       ▼
┌──────────────────┐
│  Media sources   │  song ids, photo refs — not owned bytes
│  (unset)         │
└──────────────────┘
```

| Piece | Responsibility | Status |
|---|---|---|
| Client | Opens a session, plays voice, shows the visual cue, starts the audio cue | Platform unset. See open questions. |
| Voice guide | Runs exactly one protocol: discovery or induction | Specified in `prompts/` |
| State profile | Stores one peak state and its three anchors | Specified in `schemas/` |
| Media sources | Resolve a song or photo reference at re-entry | Unset. Profiles store references only. |

## Session rules

- A session is either `discovery` or `induction`. The client chooses from whether a confirmed profile exists.
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
- Measuring physiology

## Suggested build order

1. Freeze the prompts and schema in this repo (this commit).
2. Decide the first client and the time box (open questions 1 and 3).
3. Run induction with voice plus kinesthetic text only. No music license required.
4. Add visual display from a user-supplied reference.
5. Add a music deep-link only after the sourcing decision.

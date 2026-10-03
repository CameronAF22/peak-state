# Sensory elicitation

Discovery exists to extract three anchors and prove they still fire. Everything else in the product hangs on the quality of that extraction.

## Principles

1. **One channel at a time.** Finish auditory before opening visual. Finish visual before opening kinesthetic. Mixed questions produce mixed, weak cues.
2. **Specific over impressive.** "The second chorus of *Holocene*, right when the drums thin out" is an anchor. "Indie music" is not.
3. **Their words, stored as their words.** The profile keeps the person's phrases. The guide does not rename a state into clinical or coaching jargon.
4. **Confirm before saving.** An anchor is saved only after the person agrees that the playback matches what they meant.
5. **One peak, not a catalog.** Version 1 stores a single peak state. Additional states are a later product, not a discovery feature.
6. **The body leads re-entry.** Kinesthetic cues work with the screen off and with no media rights. They are collected last in discovery (so they are grounded in a real memory) and fired first in re-entry.

## Discovery sequence

### 0. Frame (under 20 seconds)

Tell the person what will happen: three short questions about a time they were at their best, then one replay. Ask permission to continue. If they decline, stop.

### 1. Name the state

Ask for a recent, concrete episode, not a trait.

- Good: "Last Thursday in the tunnel before tip-off."
- Weak: "I'm a clutch performer."

Capture:

- `peakState.label` — a few words in their voice
- `peakState.context` — the situation
- `peakState.description` — one sentence they agree to

Do not proceed until the label is something they recognize as the target for later re-entry.

### 2. Auditory

Ask what they heard, or what song belongs to that moment. If they did not have music then, ask which song would drop them into it now. That song is still a valid anchor; record `source` as `associated`, not `in-moment`.

Drill until these are filled or explicitly unknown:

- title and artist
- the moment inside the track (intro, a lyric, a drop, a bar)
- how they hear it (headphones, room, a single line sung internally)

Stop drilling after two follow-ups. Store the best specific cue you have and mark missing fields null. Do not invent a provider id or a URL.

### 3. Visual

Ask what the scene looks like if they glance back at it. Push for one focal object, the light, and how far away it is.

If they have a photo, record a reference (`assetRef`) only after they say it is the right image. The schema stores a reference, not the image bytes. How those bytes are kept is an open question.

If they only have a memory, store `kind: "memory"` and up to five short visual details. Do not ask them to upload anything during the first session.

### 4. Kinesthetic

Ask three things, one at a time:

1. Where in the body the state shows up first.
2. What the breath and posture are doing.
3. One or two words they would whisper to call it back.

Store those words in `keywords` exactly as spoken, lowercased only for matching. Keep the original phrase in the session transcript, not in the profile.

### 5. Stack check

Replay once, in re-entry order, without new questions in the middle:

1. Posture and breath.
2. Somatic keywords.
3. The visual scene, in their details.
4. The musical moment, named precisely.

Then ask a single check: "Did that bring the state back, even a little?"

- **Yes.** Mark `induction.lastStackConfirmedAt` and end discovery.
- **Partly.** Ask which cue was flat. Replace only that cue, then replay the stack once more. One repair pass only.
- **No.** Do not save the stack as confirmed. Keep the draft profile, say so, and offer to retry discovery later. Do not keep interviewing.

## What the guide must not do

- Diagnose mood, trauma, or personality.
- Suggest that a state is the person's identity.
- Play, fetch, or promise a licensed track during discovery. Naming the cue is enough until media sourcing is decided.
- Ask for more than one peak state.
- Continue if the person is distressed, dissociating, or asking for help with harm. Stop the protocol and speak the safety line in the prompt.

## Re-entry elicitation

Re-entry is not a second interview. The guide speaks the saved cues. It may ask at most one question, and only if a cue fails ("the song isn't landing — is there a better moment in it?"). A successful re-entry updates `induction.lastEnteredAt` and nothing else. A repaired cue updates that anchor in place.

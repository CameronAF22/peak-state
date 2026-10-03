# Open questions

These three decisions block the client and the media layer. They do not block the prompts or the profile schema. Recommended defaults are proposals for collaborators to accept or replace.

## 1. First client and audio pipeline

**Question.** Do we ship the first session on the web, or in a native mobile app?

**Why it matters.** The realtime voice API surface is different. A browser can use WebRTC against a realtime voice session. A native app needs its own capture, playback, and interruption handling. Choosing both at once splits the prototype.

**Proposal.** Web first. One page, one realtime voice session, headphones assumed. Mobile waits until the script is proven.

**Decide by writing down:** target runtime, how audio is captured, and how the guide is interrupted when the person speaks.

## 2. Where songs and photos come from

**Question.** How do we source and store the auditory and visual assets?

**Why it matters.** Playing a commercial track inside the app needs a license and a user account with that service. Private photos are personal data. Copying either into our own storage creates privacy and takedown obligations we do not need for version 1.

**Proposal.** Store references only.

- Auditory: title, artist, the moment in the track, and an optional provider URI the person already has the rights to play (`spotify`, `apple_music`, or `unset`). The app may deep-link. It does not stream the file.
- Visual: a memory description, or a reference the client can display from the person's own library. The profile does not contain image bytes.

**Decide by writing down:** which providers are allowed in `anchors.auditory.provider`, and whether a photo ever leaves the device.

## 3. Time-to-state

**Question.** How long may re-entry take?

**Why it matters.** A 30-second stack and a 5-minute visualization are different scripts. The induction prompt is written for a short stack. Stretching it without changing the prompt will make the guide pad.

**Proposal.** 90 seconds for the first confirmed re-entry. The stack itself should be speakable in about 40 seconds. The extra time is silence and one repair question. Discovery may take up to 8 minutes.

**Decide by setting** `induction.targetSeconds` in the product defaults. The field already exists on the profile; `null` means "not chosen yet."

## 4. Can Oura trigger a session in real time?

**Answered.** No. Heart rate is a 5-minute series and is not a webhook type. `daily_stress` is a day tally. HRV on this API is a sleep metric. Webhooks fire after the phone syncs, on the order of half a minute after that sync, not when the body changes. The plan uses webhooks as "new data exists" notices and heart-rate reads as a follow-up fetch. Detail is in [oura-constraints.md](oura-constraints.md).

## 5. What counts as a negative state?

**Question.** Which personal baseline separates a rough stretch from exercise, caffeine, or ordinary effort?

**Why it matters.** A fixed BPM cutoff will offer coaching during workouts and miss people whose "high" heart rate is still moderate.

**Proposal.** No offer ships until the rule is written against that member's own `awake` and `rest` samples, with `workout`, `live`, and `session` samples excluded and a 15-minute buffer after each workout. `day_summary: stressful` is context, not a trigger. Sleep HRV can only create a morning offer.

**Decide by writing** the baseline comparison (window, delta, and how many consecutive 5-minute samples) into the classifier. Until then the fetcher stores snapshots and the classifier emits `ignore`.

## 6. What if the person cannot take the session?

**Question.** How does an offer behave during sleep, meetings, or an explicit pause?

**Why it matters.** A voice session that starts on its own is a failure even when the biometric call is right.

**Proposal.** Offers are push notifications. Quiet hours default to 21:00–08:00 in the member's local time, except a morning-context offer that may appear in the first two hours after the quiet-hours end. One offer per four hours. Pause suppresses everything. No response expires the offer. Decline and expiry start the cooldown. GPT Live 1 is created only on accept.

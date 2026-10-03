# Trigger flow

The backend's job is to decide whether to offer a session. GPT Live 1 starts only after the person accepts on a device they are holding.

## Components

| Piece | Responsibility |
|---|---|
| Oura connection | OAuth tokens for one member. Scopes `daily`, `heartrate`, `workout`. |
| Webhook receiver | Verifies the subscription challenge and the signature, responds 2xx immediately, enqueues the notice. |
| Fetcher | Loads the document named by `object_id`. On any sync notice, also reads `heartrate` since the stored cursor. |
| Classifier | Writes a biometric snapshot and either `ignore` or `candidate`. |
| Offer service | Applies quiet hours, cooldown, pause, and workout suppression. Creates an offer. Sends a push the person can ignore. |
| Client | Shows the offer. On accept, opens GPT Live 1 with the voice-session context. On decline, records it. |
| Voice session | Runs `strategy-extraction` or `intervention`. Writes strategies back. |

## Subscriptions

Create webhook subscriptions for `create` and `update` on:

- `daily_stress`
- `workout`
- `sleep`
- `daily_readiness`

Do not subscribe to heart rate. It is not in the webhook enum. Read it when one of those notices proves the phone synced.

Renew subscriptions before `expiration_time`. If renewal fails, stop offering rather than polling in a tight loop.

## Sequence

1. A notice arrives. The receiver checks the verification token and signature, stores the event id, and returns 2xx. Duplicate `object_id` + `event_time` pairs are dropped.
2. The fetcher loads the document with the member's access token.
3. A `workout` document opens a suppression window from its start through 15 minutes after its end. Samples inside that window are stored and never become candidates.
4. A `sleep` or `daily_readiness` document updates the morning context (sleep HRV, lowest heart rate, readiness). If the local time is inside the waking window and strategies are unconfirmed or the morning context is poor relative to that person's baseline, the offer reason is `morning-context`. This is an offer after waking, not a nighttime call.
5. A `daily_stress` document updates the day tally. The fetcher then reads heartrate samples newer than the cursor.
6. The classifier ignores samples whose `source` is `workout`, `live`, or `session`. Remaining `awake` or `rest` samples are compared with the personal baseline. Until that baseline rule exists, the classifier records the snapshot and emits `ignore`.
7. A `candidate` becomes an offer only when all of these hold:
   - the member has not paused interventions
   - local time is outside quiet hours
   - no offer was created inside the cooldown
   - no workout suppression window is open
   - no voice session is already active
8. The offer is a push notification with the reason in plain language ("Your ring synced a stressed stretch. Want two minutes?"). It expires. It does not open the microphone.
9. Accept creates a voice session. Decline, expiry, and pause write an outcome and start the cooldown. No retry inside the cooldown.

## What GPT Live 1 receives

The session context is the object in `schemas/voice-session.schema.json`. It includes the three strategies when they exist, the offer reason code, and a one-line body note. It does not include the raw heart-rate series, Oura tokens, or a diagnosis.

## Failure behavior

| Failure | Behavior |
|---|---|
| Oura 401 | Mark the connection expired. Ask the person to reconnect. Do not offer. |
| Oura 403 | Subscription lapsed or scope missing. Do not offer. |
| Oura 429 | Back off. Do not poll to compensate. |
| Webhook signature fails | Drop the notice. |
| Person does not respond | Offer expires. No voice session. |
| Person is unavailable | That is a decline or a quiet-hour skip, not a failure to coach. |

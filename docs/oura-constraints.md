# Oura constraints

Sources checked against the Oura API v2 surface published at `api.ouraring.com` and the error-handling note at `cloud.ouraring.com/docs/error-handling`. Webhook `data_type` values below are the enum on `POST /v2/webhook/subscription`. Heart-rate shape is `GET /v2/usercollection/heartrate`. Daily stress shape is `GET /v2/usercollection/daily_stress`.

Oura is a sync-then-notify API. It is not a streaming biofeedback feed. A trigger built on it can be "soon after the phone uploads," never "the moment the body changes."

## Five constraints

### 1. Heart rate is a 5-minute series, and it does not webhook

`GET /v2/usercollection/heartrate` returns samples at 5-minute increments. Each sample has `bpm`, a timestamp, and `source`:

`awake`, `rest`, `sleep`, `workout`, `live`, `session`.

The webhook `data_type` enum includes `daily_stress`, `workout`, `sleep`, `daily_readiness`, and other daily documents. It does not include `heartrate`. A heart-rate change alone does not call us. We see new samples only by reading the series after something else has synced, or by polling.

### 2. Cloud data is only as fresh as the phone sync

The ring talks to the phone. The phone talks to Oura. The API talks to us. Webhook guides describe the notification as arriving about 30 seconds after the mobile app syncs. That clock starts at sync, not at the physiological event. If the phone has not synced, the delay is however long the ring has been away from the phone: minutes or hours. This cannot catch a state change inside an unsynced window.

### 3. The stress document is a day total, not an instant

`daily_stress` stores:

- `day`
- `day_summary`: `restored`, `normal`, or `stressful`
- `stress_high`: seconds in a high-stress zone
- `recovery_high`: seconds in a high-recovery zone

Stress and recovery are mutually exclusive in Oura's own description. A webhook on this document means the day's tally changed. It does not mean "stressed right now." Use it as context. Do not page the person because `day_summary` flipped to `stressful`.

### 4. HRV in this API is a sleep signal

Daytime heart-rate samples do not include an HRV field. Heart-rate variability is carried on sleep documents (`average_hrv` and sleep-period samples), and readiness contributes an HRV-balance score for the morning. A drop in sleep HRV can justify a morning offer after the person is awake. It cannot detect an afternoon crash.

### 5. Access, rate, and subscription limits

- OAuth scopes required here: `daily`, `heartrate`, `workout`. Request nothing else.
- New Oura API applications are capped at ten users until Oura approves a wider release.
- The v2 API is rate limited to 5,000 requests in a 5-minute period. Polling every user every minute will hit that long before it becomes "real time," because the underlying samples are already 5 minutes and still wait on sync.
- A lapsed Oura subscription returns 403. Treat that as "no data," not as a negative state.
- Webhook subscriptions expire and must be renewed. The webhook body is a notice (`event_type`, `data_type`, `object_id`, `user_id`, `event_time`), not the biometric document. The handler still `GET`s the document.

## Signals worth storing

| Signal | Endpoint | Use |
|---|---|---|
| Daytime BPM, source `awake` or `rest` | `heartrate` | Candidate input, only against that person's own baseline, and only after workout suppression |
| BPM source `workout`, `live`, or `session` | `heartrate` | Suppression. Never a trigger |
| Workout interval | `workout` | Suppression window through the workout and 15 minutes after |
| `stress_high` and `day_summary` | `daily_stress` | Same-day context |
| Sleep `average_hrv`, lowest heart rate | `sleep` | Next-morning context |
| Readiness score and HRV-balance contributor | `daily_readiness` | Next-morning context |

No universal BPM or HRV cutoff is defined. A number that is "high" for one person is exercise, caffeine, or a normal afternoon for another. The classifier stays off until a personal baseline rule is written. See open question 2.

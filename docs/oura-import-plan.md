# Importing Oura Ring 4 data

Research checked October 3, 2026. This is an implementation proposal, not a working connection. The repository now contains coordinated production plans, client/backend scaffolding, and an isolated [synthetic workflow lab](synthetic-workflow.md). None implements a live Oura importer yet.

## Feasibility

Oura Ring 4 can supply data through Oura Cloud REST API v2. The path is ring → Oura phone app → Oura Cloud → Peak State backend. Gen3 and later users need an active Oura membership for API access. Data availability depends on phone sync; sleep/readiness commonly require opening the app. An API request cannot force a ring measurement or a phone upload. [Member support](https://support.ouraring.com/hc/en-us/articles/4415266939155-The-Oura-API), [API reference](https://cloud.ouraring.com/v2/docs).

Use OAuth authorization code flow with PKCE and a server-held client secret. Personal access tokens were deprecated in December 2025 and are no longer supported. Register a new application in the [developer portal](https://developer.ouraring.com/). Applications are limited to ten users pending Oura approval. [Authentication](https://cloud.ouraring.com/docs/authentication), [current API specification](https://cloud.ouraring.com/v2/static/json/openapi-1.41.json).

## Data to import first

All paths below are relative to `https://api.ouraring.com/v2/usercollection/`. The initial scopes are `daily heartrate workout`. Optional data types should wait until the product needs them. Field names and units below were checked against the current specification.

| Endpoint | Fields to retain | Peak State use |
|---|---|---|
| `sleep` | `id`, `day`, `bedtime_start`, `bedtime_end`, `type`, `average_hrv`, `average_heart_rate`, `lowest_heart_rate`, `total_sleep_duration`; optionally `hrv` | Morning recovery context; multiple sleep periods can belong to one day |
| `daily_readiness` | `id`, `day`, `timestamp`, `score`, `contributors.hrv_balance`, `temperature_deviation` | Morning context; HRV balance is a score, not raw HRV |
| `daily_stress` | `id`, `day`, `day_summary`, `stress_high`, `recovery_high` | Daily context; stress/recovery durations are seconds |
| `heartrate` | `timestamp`, `timestamp_unix`, `bpm`, `source` | Five-minute samples for a future personal baseline; Unix timestamp is milliseconds |
| `workout` | `id`, `day`, `start_datetime`, `end_datetime`, `activity`, `source`, `intensity` | Suppress workout-related candidates |
| `daily_sleep` (optional) | `id`, `day`, `timestamp`, `score`, `contributors` | Sleep score; `sleep` contains the detailed periods |
| `daily_activity` (optional) | `id`, `day`, `timestamp`, `score`, `steps`, `active_calories`, `total_calories` | Activity context, if needed |

Additional routes include daily SpO2, resilience, cardiovascular age, and VO2 max. Those add consent and interpretation work without being necessary for the first import. See the [API reference](https://cloud.ouraring.com/v2/docs) and its [schema](https://cloud.ouraring.com/v2/static/json/openapi-1.41.json).

Do not infer present emotional state from a daily stress total. Daytime heart-rate rows contain no HRV. Sleep HRV is recovery context, not an afternoon stress detector. Heart rate has no webhook type. Preserve null values as unknown rather than replacing them with zero. For sleep sample arrays, use their returned `timestamp` and `interval`; do not assume every array has the same sampling interval.

## Connection and authentication

1. Configure server secrets: `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_REDIRECT_URI`, and a token-encryption key. Never place secrets or member tokens in a client bundle, profile JSON, prompt, or committed file.
2. Bind a short-lived random `state` and PKCE verifier to the signed-in Peak State member's session.
3. Redirect to `https://cloud.ouraring.com/oauth/authorize` with `response_type=code`, the client ID, exact registered redirect URI, `scope=daily heartrate workout`, `state`, `code_challenge`, and `code_challenge_method=S256`. Oura also documents `https://developer.ouraring.com/authorize` as an alternative for new clients.
4. On callback, verify and consume `state`, handle denial, then exchange the code through `POST https://api.ouraring.com/oauth/token`. Send URL-encoded form data containing `grant_type=authorization_code`, code, redirect URI, client credentials, and the verifier.
5. Encrypt access and refresh tokens, record expiration from `expires_in`, and retain the granted scopes. A member can grant only part of the requested access; import only authorized types.
6. Call `GET /v2/usercollection/personal_info` and retain its `id` to map webhook `user_id` to the local member. The current reference explicitly allows reading this ID with any access token and no additional scopes. Discard other personal fields; no `personal` or `email` consent is needed just for identity mapping.
7. Refresh before expiry using `grant_type=refresh_token`. Refresh tokens are single-use: serialize refresh per connection and atomically save the replacement access token, refresh token, and expiration. Never blindly repeat a refresh after an ambiguous timeout; require reconnect if the rotated token cannot be recovered.

The flow and refresh behavior come from [Oura authentication](https://cloud.ouraring.com/docs/authentication). The identity exception is documented under Personal Info Routes in the [current reference](https://cloud.ouraring.com/v2/docs).

## Historical import

Proposal: import the most recent 30 days for one consenting member, store data, and show import status. Thirty days is an engineering starting window, not a validated baseline or a provider requirement. Keep the classifier disabled, as required by [the product plan](plan.md).

- Supply explicit bounds. Daily/document collections use `start_date` and `end_date`; heart rate uses `start_datetime` and `end_datetime`. Use an HTTP client's query encoder for timezone offsets and other parameters.
- Follow each response's `next_token` until absent or null, retaining the original bounds. A single request is not guaranteed to contain all historical data.
- Write documents by `(connection_id, data_type, id)` and heart-rate rows by `(connection_id, timestamp, source)`. Reimports update those records rather than adding duplicates.
- Preserve Oura's `day` independently of UTC timestamps, plus the member's configured timezone. Do not recalculate daily labels from UTC or infer a timezone from the ring.
- Track measurement time separately from local fetch time. Local fetch time is not proof of a recent phone sync.
- Advance a cursor only after every page in a bounded window has been persisted. Start subsequent reads with an overlap window, provisionally 48 hours, to catch late uploads and corrected records; deduplicate writes. The window needs validation with real sync behavior.
- If a page fails, retain completed writes and retry the unfinished window. Do not report a completed import, overwrite known records with empty results, or fabricate missing values.

Example request after OAuth, using PowerShell and a token supplied to the process environment:

```powershell
$headers = @{ Authorization = "Bearer $env:OURA_ACCESS_TOKEN" }
$uri = 'https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=2026-09-03&end_date=2026-10-03'
$page = Invoke-RestMethod -Uri $uri -Headers $headers
# Persist $page.data. If $page.next_token exists, fetch the next page
# with the same bounds and the URL-encoded next_token before completing.
```

This demonstrates one page, not a complete importer. [Collection parameters and response schemas](https://cloud.ouraring.com/v2/static/json/openapi-1.41.json).

## Ongoing updates

The preferred production path is webhooks plus bounded reconciliation. Set up the receiver and subscriptions before historical import, buffer incoming events during that import, then process them, so changes during backfill are not lost.

- Subscription management is application-level: authenticate with `x-client-id` and `x-client-secret`, not a member bearer token. Do not create a full subscription set for every member. Route notices by the stored Oura user ID.
- Create separate `create`, `update`, and `delete` subscriptions for `sleep`, `daily_readiness`, `daily_stress`, and `workout`: twelve subscriptions for the initial data set. Delete handling prevents removed records from continuing to influence context. Optional endpoints need their own subscriptions if enabled.
- `POST /v2/webhook/subscription` takes `callback_url`, a random `verification_token`, `event_type`, and `data_type`. Expose a public HTTPS callback.
- For verification GETs, compare `verification_token` and return JSON `{ "challenge": "<received challenge>" }`.
- For event POSTs, verify `x-oura-signature` and `x-oura-timestamp` before accepting. Oura documents SHA-256 HMAC with the client secret and uppercase hexadecimal output over timestamp plus serialized body. Preserve the body representation and verify serialization behavior with a real Oura delivery; use constant-time comparison and a timestamp replay policy. The setup verification token is not a substitute for POST signature checking.
- Store a verified notice durably before returning 2xx, within Oura's ten-second processing budget. Perform data fetches in a worker. If enqueueing fails, return a retryable failure.
- Deduplicate by `(user_id, data_type, event_type, object_id, event_time)`. Allowlist types and map the member before constructing a fetch path.
- For create/update, fetch `GET /v2/usercollection/{data_type}/{object_id}` using that member's access token and upsert it. For delete, remove or mark the matching local document and recalculate derived context; do not fetch a deleted document.
- After a relevant sync notice, coalesce a bounded heart-rate collection read per member. There is no heart-rate document ID or heart-rate webhook subscription.
- Renew with `PUT /v2/webhook/subscription/renew/{id}` before returned `expiration_time`; do not assume a fixed lifetime. Run a daily bounded reconciliation, provisionally re-reading the last 48 hours, to recover missed events. Longer outages require a wider catch-up window. Mark updates stale if delivery or renewal fails, and suppress offers until caught up.

Webhooks normally arrive about 30 seconds after mobile sync, which is not a promise about measurement latency. The [webhook reference](https://cloud.ouraring.com/v2/docs#tag/Webhook-Subscription-Routes) defines verification, headers, renewal, and notices.

## Storage and failure behavior

Proposed tables: `oura_connections` (member mapping, encrypted tokens, granted scopes, status); `oura_documents`; `oura_heart_rate_samples`; `oura_import_runs`/cursors; an application webhook-subscription registry; and a durable event queue with deduplication keys. Keep Oura data separate from the existing state profile and voice-session context. A disconnect should revoke access, remove local credentials, stop imports, and apply the member's data-deletion choice.

| Result | Proposed behavior |
|---|---|
| Empty page / null metrics | Record coverage or missingness; no negative-state interpretation |
| 401 | Refresh once under the connection lock and retry the data GET once; reconnect if revoked or refresh fails |
| 403 | Check membership and granted scopes; mark affected access unavailable; do not repeatedly refresh |
| 429 | Honor `Retry-After` and current limit headers; delay affected work with jitter |
| Timeout / 5xx on data GET | Bounded retries; retain cursor and prior records |
| Invalid signature / unknown user | Reject or discard without biometric fetches |
| Partial import / stale connection | Show partial or stale status and suppress offers |

The current schema describes both per-access-token and per-application limits and exposes `X-RateLimit-Limit`, `X-RateLimit-Window`, `X-RateLimit-Reset`, and `X-RateLimit-Tier`. The older [error page](https://cloud.ouraring.com/docs/error-handling) still states 5,000 requests per five minutes. Treat that as legacy guidance, not a guaranteed current quota; use the [current schema](https://cloud.ouraring.com/v2/static/json/openapi-1.41.json) and actual response headers.

## First implementation and acceptance checks

Build a small standalone server importer before selecting the full voice/client stack: OAuth connect/callback/disconnect, encrypted token storage, one-member backfill, import-status view, then webhooks and reconciliation. Runtime and database remain open because this repo has chosen neither.

Before calling it connected, verify with one actual Ring 4 account:

1. Exact redirect, consent denial, state mismatch, PKCE, partial scopes, and the `personal_info.id` mapping.
2. All pages persist; importing the same window twice adds no duplicates; empty/null data is retained as missing.
3. A forced expired access token refreshes; concurrent workers perform one refresh; new refresh credentials replace old ones.
4. Real signed create/update/delete deliveries are accepted, forged/replayed notices are rejected, and duplicates/out-of-order notices converge to current data.
5. A workout update corrects its suppression interval; deleted workouts clear derived intervals; delayed HR samples are imported through overlap/reconciliation.
6. A disconnected account, missing scope, lapsed membership, 429, and unavailable callback produce clear connection status without offers.
7. Stored observation timestamps and actual sync delay are visible. No Oura import starts voice or issues an offer before the personal baseline rule is defined.

Live access is unverified in this investigation: no Oura client credentials, account consent, or Oura callback were provided. The next concrete dependency is registering the Oura application and its callback, then implementing the importer in a chosen server runtime.

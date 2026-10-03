# Peak State online (Cloudflare)

One Worker serves the built question harness and the `/api` (D-onboarding-017). Storage is a D1 database.
Secrets live only in Cloudflare: the invite code and the OpenAI key are never in the repo or the page.

## Run it locally

```bash
cd onboarding
cp .dev.vars.example .dev.vars        # put a local invite code in it (any value)
npm run worker:dev                    # builds the page, applies the D1 migration locally, serves on :8787
```

Open http://127.0.0.1:8787, then Sign in → Create account with any email and the code from `.dev.vars`.

End-to-end check against it:

```bash
ONLINE_URL=http://127.0.0.1:8787 INVITE_CODE=<your local code> npx playwright test online
```

## First deploy

Needs a Cloudflare account and either `npx wrangler login` or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
(token permissions: Workers Scripts Edit, D1 Edit).

```bash
cd onboarding
npx wrangler d1 create peak-state          # copy the printed database_id into wrangler.jsonc
npx wrangler secret put INVITE_CODE        # the invite code people type to create an account
npx wrangler secret put OPENAI_API_KEY     # optional: enables GPT live through short-lived keys
npm run worker:deploy                      # builds, applies migrations remotely, deploys
```

The app is then at `https://peak-state.<your-subdomain>.workers.dev`.

## Later deploys

`npm run worker:deploy`. New tables go in a new file under `migrations/`; the deploy script applies them first.

## What the API does

| Route | What |
| --- | --- |
| `GET /api/health` | Whether accounts and GPT live are set up |
| `POST /api/accounts` | `{email, code}`: create an account, returns a session token |
| `POST /api/sessions` | `{email, code}`: sign in on another device |
| `DELETE /api/sessions` | Sign out this device |
| `GET /api/strategy`, `PUT /api/strategy` | The strategy record; an older revision gets 409 and the server copy |
| `GET /api/reps`, `POST /api/reps` | The run log (contracts RepSession), idempotent by id |
| `GET /api/progress?state=` | Times chosen, good reps, trend, day streak |
| `POST /api/realtime/token` | A short-lived GPT live key, 40 a day per account |

Limits: 20 wrong invite codes per client per day; sessions last 90 days.

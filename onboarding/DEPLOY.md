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
npx wrangler d1 create peak-state          # already done: the id is in wrangler.jsonc and 0001 is applied
npx wrangler secret put INVITE_CODE        # the invite code people type to create an account
npx wrangler secret put OPENAI_API_KEY     # optional: enables GPT live (gpt-live-1) for signed-in accounts
npm run worker:deploy                      # builds, applies migrations remotely, deploys
```

The app is then at `https://peak-state.<your-subdomain>.workers.dev`.

Pages (D-onboarding-024): `/` is the Horizon design with GPT live as the set voice (first tap asks for an email and the
invite code), `/harness/` is the full harness with practice and accounts, and `/design/` lists the three designs.

### Or from the Cloudflare dashboard (Workers Builds)

Workers & Pages → Create → Import a repository → `CameronAF22/peak-state`, then:

- Project name: `peak-state` (must match `name` in wrangler.jsonc)
- Production branch: the branch to serve
- Root directory: `/`
- Build command: `npm install && npm run build:harness -w @peak-state/onboarding`
- Deploy command: `cd onboarding && npx wrangler deploy`

Then the Worker's Settings → Variables and Secrets: add `INVITE_CODE` (and optionally `OPENAI_API_KEY`) as type
Secret. New migrations still need `npx wrangler d1 migrations apply peak-state --remote` from a machine with access.

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
| `POST /api/live/session` | `{session, sdp}`: starts a GPT live (gpt-live-1) WebRTC session with the server's key and returns the SDP answer; 40 a day per account (D-onboarding-020) |

Limits: 20 wrong invite codes per client per day; sessions last 90 days.

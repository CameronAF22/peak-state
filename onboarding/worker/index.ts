// Cloudflare Worker entry (D-onboarding-017): /api/* runs the API; everything else is the built harness page,
// served by Workers static assets from dist-harness/ (see wrangler.jsonc).

import { createApi, type Database, type Env as ApiEnv } from "./api.ts";

interface Env extends ApiEnv {
  DB: Database;
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return createApi(env)(req);
    return env.ASSETS.fetch(req);
  },
};

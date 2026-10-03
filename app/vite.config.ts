import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The walkthrough is served by the onboarding Worker at /demo/ (D-onboarding-023), so it builds into the
// harness's asset folder. Build order: the harness first (its build empties dist-harness/), then this app,
// which empties only dist-harness/demo/. `npm run build -w @peak-state/app` after `npm run build:harness -w @peak-state/onboarding`.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  base: "/demo/",
  plugins: [react()],
  server: { fs: { allow: [repoRoot] } },
  build: {
    outDir: fileURLToPath(new URL("../onboarding/dist-harness/demo", import.meta.url)),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: "es2022",
  },
});

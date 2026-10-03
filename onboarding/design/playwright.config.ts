// Visual test for the light-and-text design prototypes (onboarding/design/e2e/).
// Run: cd onboarding && npx playwright test -c design/playwright.config.ts [e2e/<variant>.spec.ts]
// DESIGN_PORT picks the port so several runs can go at once. Screenshots land in design/e2e/screens/<variant>/.

import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.DESIGN_PORT ?? 5175);
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  testDir: "e2e",
  outputDir: `e2e/results-${PORT}`,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 860 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } }],
  webServer: {
    command: `npx vite --config ${here}vite.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: here,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

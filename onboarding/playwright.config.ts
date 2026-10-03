// Visual test for the question harness (onboarding/test/e2e/).
// Run: npm run test:visual -w @peak-state/onboarding  (or: cd onboarding && npx playwright test)
// The webServer starts the harness with Vite; screenshots land in test/e2e/report/screens/.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Use the bundled Playwright Chromium; fall back to any chromium under PLAYWRIGHT_BROWSERS_PATH only when asked. */
function fallbackChromium(): string | undefined {
  if (!process.env.PW_CHROMIUM_FALLBACK) return undefined;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const bin of ["chrome-linux/chrome", "chrome-linux64/chrome"]) {
      const p = join(root, dir, bin);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

const executablePath = fallbackChromium();

export default defineConfig({
  testDir: "test/e2e",
  outputDir: "test/e2e/results",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The html reporter wipes its folder in onEnd, so the screens reporter runs after it and copies the
  // checkpoint screenshots (staged in test/e2e/results/screens) to test/e2e/report/screens with a contact sheet.
  reporter: [["list"], ["html", { outputFolder: "test/e2e/report", open: "never" }], ["./test/e2e/screens-reporter.ts"]],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 860 },
    screenshot: "on",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 860 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

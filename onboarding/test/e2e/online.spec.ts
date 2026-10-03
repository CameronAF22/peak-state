// Online flow against the Worker (D-onboarding-015/016/017): create an account with the invite code, practice
// (recall, a typed and a spoken-style rating, one strategy question, "let's try again"), then sign in on a second
// browser and get the updated strategy and every run back.
// Runs only with ONLINE_URL and INVITE_CODE set, e.g. after `npm run worker:dev` with INVITE_CODE in .dev.vars:
//   ONLINE_URL=http://127.0.0.1:8787 INVITE_CODE=local-test-code npx playwright test online

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { validateProfile, validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import { STAGING_DIR } from "./screens-reporter.ts";

const ONLINE_URL = process.env.ONLINE_URL;
const INVITE_CODE = process.env.INVITE_CODE;
const profile = JSON.parse(readFileSync(new URL("../../../contracts/fixtures/profile.demo.json", import.meta.url), "utf8")) as ProfileV2;

test.skip(!ONLINE_URL || !INVITE_CODE, "set ONLINE_URL and INVITE_CODE to run against wrangler dev or a deploy");

async function shot(page: Page, name: string): Promise<void> {
  const file = `online-${name}.png`;
  await page.screenshot({ path: join(STAGING_DIR, file), fullPage: true });
  await test.info().attach(file, { path: join(STAGING_DIR, file), contentType: "image/png" });
}

const practice = (page: Page) => page.evaluate(() => (window as unknown as { __harness: { practice(): { phase: string; prompt: { kind: string } | null } | null } }).__harness.practice());

async function walkRecall(page: Page): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const p = await practice(page);
    if (p?.phase !== "recall") return;
    await page.getByTestId("practice-choice").filter({ hasText: "Next" }).click();
  }
}

test("account, practice loop, and a second device", async ({ browser }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  // This browser already has the demo strategy saved, as after a first session.
  await ctx.addInitScript((p) => {
    if (!localStorage.getItem("peak-state.harness.strategy")) {
      localStorage.setItem("peak-state.harness.strategy", JSON.stringify({ profile: p, savedAt: "2026-10-03T15:00:00.000Z" }));
    }
  }, profile);
  const page = await ctx.newPage();
  await page.goto(`${ONLINE_URL}/?speed=fast`);
  await expect(page.getByTestId("saved-card")).toBeVisible();

  // 1 · account: a wrong code is refused, the right one creates the account
  await page.getByTestId("account-open").click();
  await page.getByTestId("account-email").fill(email);
  await page.getByTestId("account-code").fill("not-the-code");
  await page.getByTestId("account-create").click();
  await expect(page.getByTestId("account-error")).toHaveText(/not right/);
  await page.getByTestId("account-code").fill(INVITE_CODE!);
  await page.getByTestId("account-create").click();
  await expect(page.getByTestId("account-status")).toContainText(email);
  await shot(page, "01-signed-in");

  // 2 · practice: recall by questions with the saved answers
  await page.getByTestId("practice").click();
  await expect(page.getByTestId("practice-question")).toHaveText(/very first thing you see/);
  await expect(page.getByTestId("practice-remembered")).toContainText("first face in the room");
  await shot(page, "02-recall");
  await walkRecall(page);

  // 3 · rating: a sentence with a number in it, as speech would arrive
  await expect(page.getByTestId("practice-question")).toHaveText(/How close did you get/);
  await page.getByTestId("practice-input").fill("about a five out of 10");
  await page.getByTestId("practice-send").click();

  // 4 · one strategy question: change it, hear "let's try again"
  await expect(page.getByTestId("practice-question")).toHaveText(/Bringing it back now/);
  await shot(page, "03-question");
  await page.getByTestId("practice-choice").filter({ hasText: "left" }).first().click();
  await expect(page.getByTestId("practice-notice")).toHaveText("Okay, let's try again.");
  await shot(page, "04-try-again");

  // 5 · second try: rate on the pad, keep the answer, done with the reminder
  await walkRecall(page);
  await page.getByTestId("practice-rate-8").click();
  await page.getByTestId("practice-choice").first().click(); // "Still …"
  await expect(page.getByTestId("practice-summary")).toContainText("You got to 8 out of 10");
  await expect(page.getByTestId("practice-reminder")).toHaveText(/You've chosen to feel calm before a pitch 2 times\. One of those took you to 7 or higher\./);
  await shot(page, "05-done");
  await page.getByTestId("practice-close").click();
  await expect(page.getByTestId("reminder")).toBeVisible();
  await expect(page.getByTestId("run-entry")).toHaveCount(2);

  // 6 · second device: sign in with the same email and code, get the new version and both runs
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const phone = await ctx2.newPage();
  await phone.goto(`${ONLINE_URL}/?speed=fast`);
  await phone.getByTestId("account-open").click();
  await phone.getByTestId("account-email").fill(email);
  await phone.getByTestId("account-code").fill(INVITE_CODE!);
  await phone.getByTestId("account-sign-in").click();
  await expect(phone.getByTestId("saved-card")).toBeVisible();
  await expect(phone.getByTestId("saved-card")).toContainText("version 2");
  await expect(phone.getByTestId("run-entry")).toHaveCount(2);
  await shot(phone, "06-second-device");

  const stored = await phone.evaluate(() => ({
    record: JSON.parse(localStorage.getItem("peak-state.harness.strategy") ?? "null"),
    runs: JSON.parse(localStorage.getItem("peak-state.harness.runs") ?? "[]"),
  }));
  expect(stored.record.revision).toBe(2);
  expect(stored.record.changes[0]).toMatchObject({ field: "core.location", from: "center", to: "left", rating: 5 });
  const pv = validateProfile(stored.record.profile);
  expect(pv.ok, pv.errors.join("\n")).toBe(true);
  for (const r of stored.runs as RepSession[]) {
    const rv = validateRepSession(r, stored.record.profile);
    expect(rv.ok, rv.errors.join("\n")).toBe(true);
    expect(r.trigger.kind).toBe("practice");
  }
  await ctx.close();
  await ctx2.close();
});

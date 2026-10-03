// The spoken-word highlight (D-onboarding-021): while a question is spoken (typed voice: the paced estimate,
// 2.6 words/s), one word at a time carries the warm overlay, earlier words return to normal, and the question's
// text content never changes. Saves spoken-word-highlight.png with the other checkpoint screens.

import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { EngineSnapshot } from "../../src/types.ts";
import { STAGING_DIR } from "./screens-reporter.ts";

const HARNESS_PATH = process.env.HARNESS_PATH ?? "/";

test("spoken-word highlight moves word to word and leaves the text intact", async ({ page }, testInfo) => {
  await page.goto(`${HARNESS_PATH}?voice=typed&hint=60000`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => typeof (window as unknown as { __harness?: unknown }).__harness === "object");
  await page.locator('[data-testid="choice"][data-value="content"]').click();

  const question = page.getByTestId("question");
  const snap = await page.evaluate(() => (window as unknown as { __harness: { snapshot(): EngineSnapshot } }).__harness.snapshot());
  const text = snap.question!.text;
  await expect(question).toHaveText(text);
  // Same text, now one span per word.
  expect(await question.textContent()).toBe(text);
  expect(await question.locator(".w").count()).toBe(text.split(/\s+/).filter(Boolean).length);

  const now = question.locator(".w.now");
  await expect(now).toHaveCount(1);
  await page.waitForTimeout(1500);
  await expect(now).toHaveCount(1);
  const later = await question.locator(".w").evaluateAll((els) => els.findIndex((e) => e.classList.contains("now")));
  expect(later, "the highlight moved on").toBeGreaterThan(1);
  expect(await question.locator(".w.said").count()).toBe(later);
  // The highlighted word glows warm-white; upcoming words are dimmer than spoken ones.
  const colors = await question.locator(".w").evaluateAll((els, i) => ({
    now: getComputedStyle(els[i]).color,
    said: getComputedStyle(els[0]).color,
    next: getComputedStyle(els[els.length - 1]).color,
  }), later);
  expect(colors.now).not.toBe(colors.said);
  expect(colors.next).not.toBe(colors.said);

  const file = "spoken-word-highlight.png";
  await page.screenshot({ path: join(STAGING_DIR, file), fullPage: true });
  await testInfo.attach(file, { path: join(STAGING_DIR, file), contentType: "image/png" });

  // When the line is done, every word is back to normal.
  await expect(question).not.toHaveClass(/speaking/, { timeout: 20_000 });
  await expect(question.locator(".w.now")).toHaveCount(0);
  expect(await question.textContent()).toBe(text);
});

test("spoken-word highlight under reduced motion: still marked, no transition", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${HARNESS_PATH}?voice=typed&hint=60000`);
  await page.waitForFunction(() => typeof (window as unknown as { __harness?: unknown }).__harness === "object");
  await page.locator('[data-testid="choice"][data-value="excited"]').click();
  const now = page.getByTestId("question").locator(".w.now");
  await expect(now).toHaveCount(1);
  expect(await now.evaluate((e) => getComputedStyle(e).transitionDuration)).toBe("0s");
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(scroll.sw, "no horizontal scroll at phone width").toBeLessThanOrEqual(scroll.cw);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(STAGING_DIR, "spoken-word-highlight-phone.png"), fullPage: true });
  await ctx.close();
});

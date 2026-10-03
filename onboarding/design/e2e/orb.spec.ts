// Visual test of the Orb prototype (design/orb/): the full flow for "content" and "destressed", one safety stop,
// and a phone-width question screen. Screenshots land in design/e2e/screens/orb/.
// Run: cd onboarding && DESIGN_PORT=5181 npx playwright test -c design/playwright.config.ts orb.spec.ts

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import type { RepSession } from "@peak-state/contracts";
import type { EngineSnapshot, PresetState, SavedStrategy } from "../../src/types.ts";

declare global {
  interface Window {
    __harness: { snapshot(): EngineSnapshot };
    __activeSeen: number[];
  }
}

const PATH = "/orb/";
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "screens", "orb");
const STRATEGY_KEY = "peak-state.harness.strategy";
const RUNS_KEY = "peak-state.harness.runs";
const HINT_DELAY = 5000;
const TARGET_STEPS: Record<PresetState, number> = { content: 2, destressed: 3 };
/** Lets fades settle before a screenshot. */
const SETTLE = 1700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (page: Page) => page.evaluate(() => window.__harness.snapshot());
/** When the engine last moved on, as the test saw it: the moment the current question appeared. */
let questionAt = Date.now();
const progressKey = (s: EngineSnapshot) => `${s.status}|${s.question?.id ?? "-"}|${s.steps.length}|${s.transcript.length}`;

mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string, settle = SETTLE): Promise<void> {
  if (settle) await sleep(settle);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function waitForProgress(page: Page, before: EngineSnapshot): Promise<EngineSnapshot> {
  const key = progressKey(before);
  await expect.poll(async () => progressKey(await snap(page)), { message: `engine stuck at ${key}`, timeout: 10_000 }).not.toBe(key);
  questionAt = Date.now();
  return snap(page);
}

async function typeAnswer(page: Page, text: string): Promise<EngineSnapshot> {
  const before = await snap(page);
  await page.getByTestId("answer-input").fill(text);
  await page.getByTestId("answer-input").press("Enter");
  return waitForProgress(page, before);
}

async function clickChoice(page: Page, value?: string): Promise<EngineSnapshot> {
  const before = await snap(page);
  const choice = value === undefined ? page.getByTestId("choice").first() : page.locator(`[data-testid="choice"][data-value="${value}"]`);
  await choice.click();
  return waitForProgress(page, before);
}

/** Click a hint (fills the underline), then send it. */
async function useHint(page: Page, index: number): Promise<EngineSnapshot> {
  const before = await snap(page);
  const hint = page.getByTestId("suggestion").nth(index);
  const text = (await hint.textContent())?.trim() ?? "";
  await hint.click();
  await expect(page.getByTestId("answer-input")).toHaveValue(text);
  await page.getByTestId("send").click();
  return waitForProgress(page, before);
}

/** No hints at ~3.8 s; exactly two after the real 5 s. */
async function expectHintsAfterRealDelay(page: Page, shownAt: number): Promise<void> {
  const hints = page.getByTestId("suggestion");
  if (Date.now() - shownAt < 4600) await expect(hints).toHaveCount(0);
  const early = shownAt + 3800 - Date.now();
  if (early > 0) await sleep(early);
  if (Date.now() - shownAt < 4600) expect(await hints.count(), "hints before the 5 s delay").toBe(0);
  await expect(hints.first()).toBeAttached({ timeout: HINT_DELAY + 3000 });
  expect(Date.now() - shownAt, "hints came before 5 s").toBeGreaterThanOrEqual(HINT_DELAY - 400);
  await expect(hints).toHaveCount(2);
  await expect(hints.nth(1)).toBeVisible();
}

async function fresh(page: Page, query = "?voice=typed"): Promise<void> {
  await page.goto(`${PATH}${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
}

for (const state of ["content", "destressed"] as const) {
  test(`orb: ${state}`, async ({ page }) => {
    const target = TARGET_STEPS[state];
    const name = (nn: number, label: string) => `${state}-${String(nn).padStart(2, "0")}-${label}`;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await fresh(page);
    await expect(page.getByTestId("safety-note")).toBeVisible();
    await expect(page.getByTestId("voice-toggle")).toBeVisible();

    // 01 · choose a state: two words and an underline for your own
    let s = await snap(page);
    expect(s.question?.kind).toBe("choose-state");
    await expect(page.getByTestId("question")).toHaveText(/what state/i);
    await expect(page.getByTestId("question")).toHaveCount(1);
    await expect(page.locator('[data-testid="choice"][data-value="content"]')).toBeVisible();
    await expect(page.locator('[data-testid="choice"][data-value="destressed"]')).toBeVisible();
    await expect(page.getByTestId("answer-input")).toHaveAttribute("placeholder", /your own/);
    await expect(page.getByTestId("satellite")).toHaveCount(0);
    await shot(page, name(1, "choose-state"));

    // 02 · memory
    s = await clickChoice(page, state);
    expect(s.question?.kind).toBe("memory");
    await expect(page.getByTestId("question")).toHaveText(new RegExp(state, "i"));
    await shot(page, name(2, "memory"));

    // 03 · first step, no hints yet
    s = await typeAnswer(page, "I'm there");
    expect(s.question?.kind).toBe("first-step");
    const firstAt = Date.now();
    await expect(page.getByTestId("question")).toHaveText(/first thing/i);
    await expect(page.getByTestId("suggestion")).toHaveCount(0);
    await shot(page, name(3, "first-step"));

    // 04 · exactly two hints after the real 5 s
    await expectHintsAfterRealDelay(page, firstAt);
    await shot(page, name(4, "hints"), 2600);

    // 05 · step 1 captured: one satellite around the orb
    s = await useHint(page, 0);
    if (s.question?.kind === "modality") s = await clickChoice(page);
    expect(s.steps).toHaveLength(1);
    await expect(page.getByTestId("satellite")).toHaveCount(1);
    await expect(page.getByTestId("satellite").first()).toHaveAttribute("data-modality", /^(visual|auditory|kinesthetic|other)$/);
    await expect(page.getByTestId("orb")).toHaveAttribute("data-steps", "1");
    await expect(page.getByTestId("caption")).not.toBeEmpty();
    await shot(page, name(5, "step1-captured"), 2200);

    // 06 → 07 · the loop, by question kind, until the anchor question
    let detailHintDone = false;
    let n = 0;
    while (s.status === "asking" && s.question && s.question.kind !== "anchor") {
      if (++n > 80) throw new Error(`stuck on ${s.question.id}`);
      const q = s.question;
      await expect(page.getByTestId("question")).toContainText(q.text.slice(0, 30));
      switch (q.kind) {
        case "submodality":
          if (!detailHintDone) {
            detailHintDone = true;
            await expectHintsAfterRealDelay(page, questionAt);
            await shot(page, name(6, "detail-hints"), 2600);
            s = await useHint(page, 0);
          } else if (q.choices.length > 0) s = await clickChoice(page);
          else s = await typeAnswer(page, q.suggestions[0]);
          break;
        case "modality":
          s = await clickChoice(page);
          break;
        case "fully-in":
          s = await clickChoice(page, s.steps.length >= target ? "yes" : "no");
          break;
        case "next-step":
          await expectHintsAfterRealDelay(page, questionAt);
          s = await useHint(page, 1);
          break;
        case "confirm":
          s = await clickChoice(page, "yes");
          break;
        default:
          s = await typeAnswer(page, "I saw the light on the water");
      }
    }
    expect(detailHintDone).toBe(true);
    expect(s.question?.kind).toBe("anchor");
    expect(s.steps).toHaveLength(target);
    await expect(page.getByTestId("satellite")).toHaveCount(target);
    await expect(page.getByTestId("orb")).toHaveAttribute("data-steps", String(target));
    await expect(page.getByTestId("choice")).toHaveCount(target);
    await shot(page, name(7, "chain-complete"), 2200);

    // 08 · anchor and confirm → saved
    s = await clickChoice(page, "0");
    if (s.question?.kind === "confirm") s = await clickChoice(page, "yes");
    expect(s.status).toBe("confirmed");
    await expect(page.getByTestId("saved-line")).toHaveText(/strategy is saved/i);
    await expect(page.getByTestId("download")).toBeVisible();
    await expect(page.getByTestId("run")).toBeVisible();
    await expect(page.locator('[data-testid="satellite"][data-anchor="true"]')).toHaveCount(1);
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as SavedStrategy | null, STRATEGY_KEY);
    expect(saved?.profile.states[0].id).toBe(state);
    expect(saved?.profile.states[0].strategy.steps).toHaveLength(target);
    expect(saved?.profile.states[0].anchorStep).toBe(0);
    await shot(page, name(8, "strategy-saved"), 2200);

    // 09 · reload: still saved (normal playback pace from here, so each step can be seen)
    await page.goto(`${PATH}?voice=typed`);
    await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
    await expect(page.getByTestId("saved-line")).toHaveText(/strategy is saved/i);
    await expect(page.getByTestId("satellite")).toHaveCount(target);
    await expect(page.getByTestId("run")).toBeVisible();
    await shot(page, name(9, "after-reload"), 2200);

    // 10 · run: rate 4, each satellite lights in order, ending on the anchor
    await page.evaluate(() => {
      const seen: number[] = [];
      window.__activeSeen = seen;
      const record = () => {
        const el = document.querySelector('[data-testid="satellite"][data-active="true"]');
        const i = el ? Number(el.getAttribute("data-index")) : -1;
        if (i >= 0 && seen[seen.length - 1] !== i) seen.push(i);
      };
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-active"] });
    });
    await page.getByTestId("run").click();
    await expect(page.getByTestId("rating")).toBeVisible();
    await expect(page.getByTestId("rate-0")).toBeVisible();
    await expect(page.getByTestId("rate-10")).toBeVisible();
    await page.getByTestId("rate-4").click();
    await expect(page.locator('[data-testid="satellite"][data-active="true"]')).toHaveCount(1, { timeout: 20_000 });
    await expect(page.getByTestId("playback-line")).not.toBeEmpty();
    await shot(page, name(10, "playback-running"), 600);

    // 11 · second rating → run logged
    await expect(page.getByTestId("rate-8")).toBeVisible({ timeout: 90_000 });
    await page.getByTestId("rate-8").click();
    await expect(page.getByTestId("saved-line")).toHaveText(/4 to 8/);
    await expect(page.getByTestId("run-entry")).toHaveCount(1);
    await expect(page.getByTestId("run-entry").first()).toHaveText("4 → 8");
    const seen = await page.evaluate(() => window.__activeSeen);
    expect(seen.slice(0, target), `steps lit in order (saw ${seen.join(",")})`).toEqual([...Array(target).keys()]);
    expect(seen[seen.length - 1], "playback ends on the anchor").toBe(0);
    const runs = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]") as RepSession[], RUNS_KEY);
    expect(runs).toHaveLength(1);
    expect(runs[0].intensityBefore).toBe(4);
    expect(runs[0].intensityAfter).toBe(8);
    expect(runs[0].endedBy).toBe("completed");
    await shot(page, name(11, "run-logged"), 2200);

    expect(errors, "page errors").toEqual([]);
  });
}

test("orb: safety stop (content)", async ({ page }) => {
  await fresh(page);
  await clickChoice(page, "content");
  const s = await typeAnswer(page, "Honestly I just feel hopeless lately");
  expect(s.status).toBe("stopped");
  await expect(page.getByTestId("stop")).toBeVisible();
  await expect(page.getByTestId("stop-message")).toContainText(/person you trust/i);
  await expect(page.getByTestId("answer-input")).toHaveCount(0);
  await expect(page.getByTestId("safety-note")).toBeVisible();
  await shot(page, "content-12-safety-stop", 2800);
});

test("orb: mobile question screen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await fresh(page, "?voice=typed&hint=400");
  await clickChoice(page, "content");
  await typeAnswer(page, "I'm there");
  await expect(page.getByTestId("question")).toHaveText(/first thing/i);
  await expect(page.getByTestId("suggestion")).toHaveCount(2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal scroll at 390px").toBeLessThanOrEqual(0);
  await shot(page, "mobile-question", 2600);
  await ctx.close();
});

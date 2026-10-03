// Visual test of the Horizon design prototype (design/horizon/): the whole flow for "content" and "destressed",
// a safety stop, and a phone-width question screen. Screenshots land in design/e2e/screens/horizon/.
// Run: cd onboarding && DESIGN_PORT=5182 npx playwright test -c design/playwright.config.ts horizon.spec.ts

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { validateProfile, validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import type { EngineSnapshot, PresetState, SavedStrategy } from "../../src/types.ts";

declare global {
  interface Window {
    __harness: { snapshot(): EngineSnapshot };
    __activeSeen: number[];
  }
}

const PATH = "/horizon/";
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), "screens", "horizon");
const STRATEGY_KEY = "peak-state.harness.strategy";
const RUNS_KEY = "peak-state.harness.runs";
const HINT_DELAY = 5000;
const MAX_ITERATIONS = 80;
const TARGET_STEPS: Record<PresetState, number> = { content: 2, destressed: 3 };
/** Lets fades (1.2 s) and the horizon's slow rise settle before a screenshot. */
const SETTLE_MS = 1700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (page: Page) => page.evaluate(() => window.__harness.snapshot());
/** When the engine last moved on: the moment the current question appeared. */
let lastProgressAt = Date.now();
const progressKey = (s: EngineSnapshot) => `${s.status}|${s.question?.id ?? "-"}|${s.steps.length}|${s.transcript.length}`;

mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string, settle = SETTLE_MS): Promise<void> {
  if (settle) await sleep(settle);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function waitForProgress(page: Page, before: EngineSnapshot): Promise<EngineSnapshot> {
  const key = progressKey(before);
  await expect.poll(async () => progressKey(await snap(page)), { message: `engine did not move on from ${key}`, timeout: 10_000, intervals: [50] }).not.toBe(key);
  lastProgressAt = Date.now();
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

/** A hint fills the underline; the arrow sends it. */
async function useSuggestion(page: Page, index: number): Promise<EngineSnapshot> {
  const before = await snap(page);
  const hint = page.getByTestId("suggestion").nth(index);
  const text = (await hint.textContent()) ?? "";
  await hint.click();
  await expect(page.getByTestId("answer-input")).toHaveValue(text);
  await page.getByTestId("send").click();
  return waitForProgress(page, before);
}

/** No hint at ~3.8 s, exactly two visible after the delay, never sooner than it. */
async function expectHintsAfter(page: Page, shownAt: number, delay: number): Promise<void> {
  const hints = page.getByTestId("suggestion");
  await expect(hints).toHaveCount(0);
  const early = shownAt + delay * 0.76 - Date.now();
  if (early > 0) await sleep(early);
  expect(await hints.count(), "hints before the delay").toBe(0);
  await expect(hints.first()).toBeVisible({ timeout: delay + 3000 });
  expect(Date.now() - shownAt, "hints appeared before the delay").toBeGreaterThanOrEqual(delay - 400);
  await expect(hints.filter({ visible: true })).toHaveCount(2);
}

function readSaved(page: Page): Promise<SavedStrategy | null> {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as SavedStrategy) : null;
  }, STRATEGY_KEY);
}

function readRuns(page: Page): Promise<RepSession[]> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]") as RepSession[], RUNS_KEY);
}

for (const state of ["content", "destressed"] as const) {
  test(`horizon: ${state}`, async ({ page }) => {
    test.setTimeout(180_000);
    const target = TARGET_STEPS[state];
    const name = (nn: number, what: string) => `${state}-${String(nn).padStart(2, "0")}-${what}`;
    const stateWord = new RegExp(state, "i");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // "content" proves the real 5 s hint delay; "destressed" runs with a shorter one.
    const delay = state === "content" ? HINT_DELAY : 4000;
    const query = state === "content" ? "?voice=typed&speed=fast" : `?voice=typed&speed=fast&hint=${delay}`;

    await page.goto(`${PATH}${query}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");

    // 01 · choose a state
    let s = await snap(page);
    expect(s.question?.kind).toBe("choose-state");
    await expect(page.getByTestId("question")).toHaveText(/what state/i);
    await expect(page.locator('[data-testid="choice"][data-value="content"]')).toBeVisible();
    await expect(page.locator('[data-testid="choice"][data-value="destressed"]')).toBeVisible();
    await expect(page.getByTestId("answer-input")).toBeVisible();
    await expect(page.getByTestId("safety-note")).toBeVisible();
    await expect(page.getByTestId("voice-toggle")).toBeVisible();
    await expect(page.getByTestId("step")).toHaveCount(0);
    await shot(page, name(1, "choose-state"));

    // 02 · memory
    s = await clickChoice(page, state);
    expect(s.question?.kind).toBe("memory");
    await expect(page.getByTestId("question")).toHaveText(stateWord);
    await expect(page.getByTestId("question")).toHaveCount(1);
    await shot(page, name(2, "memory"));

    // 03 · first step, no hints yet
    s = await typeAnswer(page, "I'm there");
    expect(s.question?.kind).toBe("first-step");
    const firstShownAt = Date.now();
    await expect(page.getByTestId("question")).toHaveText(/first thing/i);
    await expect(page.getByTestId("suggestion")).toHaveCount(0);
    await shot(page, name(3, "first-step"), 1300);

    // 04 · exactly two hints after the delay
    await expectHintsAfter(page, firstShownAt, delay);
    await shot(page, name(4, "hints"));

    // 05 · step 1 captured: a point of light on the horizon
    s = await useSuggestion(page, 0);
    if (s.question?.kind === "modality") s = await clickChoice(page);
    expect(s.steps).toHaveLength(1);
    await expect(page.getByTestId("step")).toHaveCount(1);
    await expect(page.getByTestId("step").first()).toHaveAttribute("data-modality", /^(visual|auditory|kinesthetic|other)$/);
    await shot(page, name(5, "step1-captured"), 2000);

    // 06 → 07 · the loop, by question kind, until the anchor question
    let detailHintDone = false;
    let iterations = 0;
    while (s.status === "asking" && s.question && s.question.kind !== "anchor") {
      if (++iterations > MAX_ITERATIONS) throw new Error(`no anchor question after ${MAX_ITERATIONS} answers; stuck on ${s.question.id}`);
      await expect(page.getByTestId("question")).toContainText(s.question.text.slice(0, 40));
      const q = s.question;
      switch (q.kind) {
        case "submodality":
          if (!detailHintDone) {
            detailHintDone = true;
            await expectHintsAfter(page, lastProgressAt, delay);
            await shot(page, name(6, "detail-hints"));
            s = await useSuggestion(page, 0);
          } else if (q.choices.length > 0) {
            s = await clickChoice(page);
          } else {
            s = await typeAnswer(page, q.suggestions[0]);
          }
          break;
        case "modality":
          s = await clickChoice(page);
          break;
        case "fully-in":
          s = await clickChoice(page, s.steps.length >= target ? "yes" : "no");
          break;
        case "next-step":
          s = await typeAnswer(page, q.suggestions[1]);
          break;
        case "first-step":
        case "memory":
          s = await typeAnswer(page, q.kind === "memory" ? "I'm there" : "I saw the light on the water");
          break;
        case "choose-state":
          s = await clickChoice(page, state);
          break;
        case "confirm":
          s = await clickChoice(page, "yes");
          break;
        default:
          throw new Error(`unexpected question kind ${q.kind}`);
      }
    }
    expect(detailHintDone, "never reached a detail question").toBe(true);
    expect(s.question?.kind).toBe("anchor");
    expect(s.steps).toHaveLength(target);
    await expect(page.getByTestId("step")).toHaveCount(target);
    for (let i = 0; i < target; i++) await expect(page.getByTestId("step").nth(i)).toHaveAttribute("data-index", String(i));
    // Points run left to right in step order.
    const xs = await page.getByTestId("step").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(xs, "points left to right").toEqual([...xs].sort((a, b) => a - b));
    await page.mouse.move(5, 5);
    await shot(page, name(7, "chain-complete"), 2200);

    // 08 · anchor, confirm, saved
    s = await clickChoice(page, "0");
    expect(s.anchorStep).toBe(0);
    if (s.question?.kind === "confirm") s = await clickChoice(page, "yes");
    expect(s.status).toBe("confirmed");
    await expect(page.getByTestId("saved-card")).toBeVisible();
    await expect(page.getByTestId("saved-card")).toContainText(/saved/i);
    await expect(page.getByTestId("step")).toHaveCount(target);
    await expect(page.locator('[data-testid="step"][data-anchor="true"]')).toHaveCount(1);
    await expect(page.getByTestId("chain")).toHaveText(new RegExp(Array(target).fill("\\S+").join("\\s*→\\s*")));
    await expect(page.getByTestId("download")).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByTestId("download").click();
    expect((await download).suggestedFilename()).toBe(`peak-state-${state}.json`);
    const saved = await readSaved(page);
    expect(saved, `localStorage ${STRATEGY_KEY}`).not.toBeNull();
    const profile = saved!.profile as ProfileV2;
    expect(profile.states[0].id).toBe(state);
    expect(profile.states[0].strategy.steps).toHaveLength(target);
    expect(profile.states[0].anchorStep).toBe(0);
    const pv = validateProfile(profile);
    expect(pv.errors, "validateProfile errors").toEqual([]);
    await shot(page, name(8, "strategy-saved"));

    // 09 · reload (without fast playback, so the run can be seen): still saved
    await page.goto(`${PATH}?voice=typed`);
    await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
    await expect(page.getByTestId("saved-card")).toBeVisible();
    await expect(page.getByTestId("step")).toHaveCount(target);
    await expect(page.getByTestId("run")).toBeVisible();
    await shot(page, name(9, "after-reload"));

    // 10 · run: rate 4, each point lit in order while spoken, ending on the anchor
    await page.evaluate(() => {
      const seen: number[] = [];
      window.__activeSeen = seen;
      const record = () => {
        const all = [...document.querySelectorAll('[data-testid="step"]')];
        const i = all.findIndex((el) => el.getAttribute("data-active") === "true");
        if (i >= 0 && seen[seen.length - 1] !== i) seen.push(i);
      };
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-active"] });
    });
    await page.getByTestId("run").click();
    await expect(page.getByTestId("rating")).toBeVisible();
    await page.mouse.move(5, 400);
    await shot(page, name(10, "rating-before"), 1300);
    await page.getByTestId("rate-4").click();
    await expect(page.getByTestId("playback")).toBeVisible();
    await expect(page.locator('[data-testid="step"][data-index="1"][data-active="true"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("playback-line")).not.toHaveText("");
    await shot(page, name(10, "playback-running"), 1500);
    await expect.poll(() => page.evaluate(() => window.__activeSeen.length), { timeout: 40_000 }).toBeGreaterThan(target);
    await shot(page, name(10, "playback-anchor"), 1800);

    // 11 · rate 8, run logged
    await expect(page.getByTestId("rate-8")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("rate-8").click();
    await expect(page.getByTestId("run-entry")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("run-entry").first()).toContainText("4 → 8");
    await expect(page.getByTestId("saved-card")).toContainText(/4 to 8/);
    const seen = await page.evaluate(() => window.__activeSeen);
    expect(seen.slice(0, target), "steps play in order").toEqual([...Array(target).keys()]);
    expect(seen[seen.length - 1], "playback ends on the anchor").toBe(profile.states[0].anchorStep);
    const runs = await readRuns(page);
    expect(runs).toHaveLength(1);
    expect(runs[0].stateId).toBe(state);
    expect(runs[0].intensityBefore).toBe(4);
    expect(runs[0].intensityAfter).toBe(8);
    const rv = validateRepSession(runs[0], profile);
    expect(rv.errors, "validateRepSession errors").toEqual([]);
    await shot(page, name(11, "run-logged"));

    // 12 · safety stop (content only): a stop-line phrase ends the questions calmly
    if (state === "content") {
      await page.getByTestId("new-strategy").click();
      s = await snap(page);
      expect(s.question?.kind).toBe("choose-state");
      s = await clickChoice(page, "content");
      s = await typeAnswer(page, "Honestly I keep having panic attacks lately");
      expect(s.status).toBe("stopped");
      await expect(page.getByTestId("stop-banner")).toBeVisible();
      await expect(page.getByTestId("stop-banner")).toContainText(/person you trust/i);
      await expect(page.getByTestId("answer-input")).toHaveCount(0);
      await expect(page.getByTestId("safety-note")).toBeVisible();
      await shot(page, name(12, "safety-stop"), 2400);
    }

    expect(errors, "uncaught page errors").toEqual([]);
  });
}

test("horizon: phone-width question", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`${PATH}?voice=typed&hint=400`);
  await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
  await clickChoice(page, "content");
  await typeAnswer(page, "I'm there");
  await expect(page.getByTestId("question")).toHaveText(/first thing/i);
  await expect(page.getByTestId("suggestion").filter({ visible: true })).toHaveCount(2, { timeout: 5000 });
  const scroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(scroll.sw, "no horizontal scroll").toBeLessThanOrEqual(scroll.cw);
  await shot(page, "mobile-question", 2200);
  await context.close();
});

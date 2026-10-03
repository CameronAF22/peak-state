// Visual test of the Constellation design prototype (design/constellation/): the whole question flow for
// "content" and "destressed", with full-page screenshots at each checkpoint in design/e2e/screens/constellation/.
// Driven by window.__harness.snapshot().question.kind, so it follows whatever path the engine takes.
// Run: cd onboarding && DESIGN_PORT=5183 npx playwright test -c design/playwright.config.ts constellation.spec.ts

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { validateProfile, validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import type { EngineSnapshot, PresetState, SavedStrategy } from "../../src/types.ts";

declare global {
  interface Window {
    __harness: { snapshot(): EngineSnapshot };
  }
}

const PAGE = "/constellation/";
const SCREENS = join(dirname(fileURLToPath(import.meta.url)), "screens", "constellation");
const STRATEGY_KEY = "peak-state.harness.strategy";
const RUNS_KEY = "peak-state.harness.runs";
/** The real hint delay (HINT_DELAY_MS). The elicitation run never overrides it. */
const HINT_DELAY = 5000;
const BEFORE_HINT_CHECK = 3800;
/** Words fade in over ~1.1 s; hints over ~2 s. Screenshots wait for them. */
const FADE = 1300;
const MAX_ITERATIONS = 80;
const TARGET_STEPS: Record<PresetState, number> = { content: 2, destressed: 3 };

/** When the current question was first seen (the hint countdown starts then). */
let questionAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snap = (page: Page) => page.evaluate(() => window.__harness.snapshot());
const progressKey = (s: EngineSnapshot) => `${s.status}|${s.question?.id ?? "-"}|${s.steps.length}|${s.transcript.length}`;

mkdirSync(SCREENS, { recursive: true });

async function shot(page: Page, state: string, nn: number, name: string, settle = FADE): Promise<void> {
  await sleep(settle);
  await page.screenshot({ path: join(SCREENS, `${state}-${String(nn).padStart(2, "0")}-${name}.png`), fullPage: true });
}

async function waitForProgress(page: Page, before: EngineSnapshot): Promise<EngineSnapshot> {
  const key = progressKey(before);
  await expect.poll(async () => progressKey(await snap(page)), { message: `engine did not move on from ${key}`, timeout: 10_000 }).not.toBe(key);
  questionAt = Number(await page.evaluate(() => document.body.dataset.questionAt ?? Date.now()));
  return snap(page);
}

async function expectHintsAfterRealDelay(page: Page, shownAt: number): Promise<void> {
  const suggestions = page.getByTestId("suggestion");
  await expect(suggestions).toHaveCount(0);
  const waitBefore = shownAt + BEFORE_HINT_CHECK - Date.now();
  if (waitBefore > 0) await sleep(waitBefore);
  expect(await suggestions.count(), "suggestions shown before the 5 s hint delay").toBe(0);
  await expect(suggestions.first()).toBeVisible({ timeout: HINT_DELAY + 3000 });
  expect(Date.now() - shownAt, "suggestions appeared before the 5 s delay").toBeGreaterThanOrEqual(HINT_DELAY - 400);
  await expect(suggestions.filter({ visible: true })).toHaveCount(2);
}

/** Click a suggestion: it fills the underline field; then send. */
async function useSuggestion(page: Page, index: number): Promise<EngineSnapshot> {
  const before = await snap(page);
  const text = (await page.getByTestId("suggestion").nth(index).textContent())?.trim() ?? "";
  await page.getByTestId("suggestion").nth(index).click();
  await expect(page.getByTestId("answer-input")).toHaveValue(text);
  await page.getByTestId("send").click();
  return waitForProgress(page, before);
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

const readSaved = (page: Page) =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as SavedStrategy) : null;
  }, STRATEGY_KEY);

const readRuns = (page: Page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]") as RepSession[], RUNS_KEY);

async function fresh(page: Page, query = "?voice=typed&speed=fast"): Promise<void> {
  await page.goto(`${PAGE}${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
}

for (const state of ["content", "destressed"] as const) {
  test(`constellation: ${state}`, async ({ page }, testInfo) => {
    const target = TARGET_STEPS[state];
    const stateWord = new RegExp(state, "i");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fresh(page);

    // The quiet safety line is always there.
    await expect(page.getByTestId("safety-note")).toBeVisible();
    await expect(page.getByTestId("safety-note")).toContainText(/not therapy/i);
    await expect(page.getByTestId("voice-toggle")).toBeVisible();

    // 01 · choose state: two presets and a field for your own
    let s = await snap(page);
    expect(s.question?.kind).toBe("choose-state");
    await expect(page.getByTestId("question")).toHaveText(/what state/i);
    await expect(page.getByTestId("question")).toHaveCount(1);
    await expect(page.locator('[data-testid="choice"][data-value="content"]')).toBeVisible();
    await expect(page.locator('[data-testid="choice"][data-value="destressed"]')).toBeVisible();
    await expect(page.getByTestId("answer-input")).toHaveAttribute("placeholder", /your own/i);
    await expect(page.getByTestId("suggestion")).toHaveCount(0);
    await expect(page.getByTestId("step")).toHaveCount(0);
    await shot(page, state, 1, "choose-state");

    // 02 · memory
    s = await clickChoice(page, state);
    expect(s.question?.kind).toBe("memory");
    await expect(page.getByTestId("question")).toHaveText(stateWord);
    await shot(page, state, 2, "memory");

    // 03 · first step
    s = await typeAnswer(page, "I'm there");
    expect(s.question?.kind).toBe("first-step");
    const firstShownAt = questionAt;
    await expect(page.getByTestId("question")).toHaveText(/first thing/i);
    await expect(page.getByTestId("suggestion")).toHaveCount(0);
    await shot(page, state, 3, "first-step");

    // 04 · exactly two hints, only after the real 5 s
    await expectHintsAfterRealDelay(page, firstShownAt);
    await shot(page, state, 4, "hints", 2200);

    // 05 · step 1 captured: a star appears
    s = await useSuggestion(page, 0);
    if (s.question?.kind === "modality") s = await clickChoice(page);
    expect(s.steps).toHaveLength(1);
    await expect(page.getByTestId("step")).toHaveCount(1);
    await expect(page.getByTestId("step").first()).toHaveAttribute("data-modality", /^(visual|auditory|kinesthetic|olfactory|gustatory|other)$/);
    await shot(page, state, 5, "step1-captured", 2200);

    // 06 → 07 · loop by question kind until the anchor question
    let detailHintDone = false;
    let iterations = 0;
    while (s.status === "asking" && s.question && s.question.kind !== "anchor") {
      if (++iterations > MAX_ITERATIONS) throw new Error(`no anchor question after ${MAX_ITERATIONS} answers; stuck on ${s.question.id}`);
      const q = s.question;
      await expect(page.getByTestId("question")).toContainText(q.text.slice(0, 40));
      await expect(page.getByTestId("question")).toHaveCount(1);
      switch (q.kind) {
        case "submodality":
          if (!detailHintDone) {
            detailHintDone = true;
            await expectHintsAfterRealDelay(page, questionAt);
            await shot(page, state, 6, "detail-hints", 2200);
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
          await expectHintsAfterRealDelay(page, questionAt);
          s = await useSuggestion(page, 1);
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
    await expect(page.getByTestId("section-label")).toContainText("→");
    await shot(page, state, 7, "chain-complete", 2000);

    // 08 · anchor, confirm, saved
    s = await clickChoice(page, "0");
    expect(s.anchorStep).toBe(0);
    if (s.question?.kind === "confirm") s = await clickChoice(page, "yes");
    expect(s.status).toBe("confirmed");
    await expect(page.getByTestId("saved-card")).toBeVisible();
    await expect(page.getByTestId("saved-title")).toContainText(/saved/i);
    await expect(page.getByTestId("saved-step")).toHaveCount(target);
    await expect(page.getByTestId("step")).toHaveCount(target);
    await expect(page.locator('[data-testid="step"][data-anchor="true"]')).toHaveCount(1);
    await expect(page.getByTestId("download")).toBeVisible();
    const saved = await readSaved(page);
    expect(saved, `localStorage ${STRATEGY_KEY}`).not.toBeNull();
    const profile = saved!.profile as ProfileV2;
    expect(profile.states[0].id).toBe(state);
    expect(profile.states[0].strategy.steps).toHaveLength(target);
    expect(profile.states[0].anchorStep).toBe(0);
    const pv = validateProfile(profile);
    expect(pv.errors, "validateProfile errors").toEqual([]);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download").click()]);
    expect(download.suggestedFilename()).toBe(`peak-state-${state}.json`);
    await shot(page, state, 8, "strategy-saved");

    // 09 · reload (at normal playback speed), still saved
    await page.goto(`${PAGE}?voice=typed`);
    await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
    await expect(page.getByTestId("saved-card")).toBeVisible();
    await expect(page.getByTestId("saved-step")).toHaveCount(target);
    await expect(page.getByTestId("step")).toHaveCount(target);
    await expect(page.getByTestId("run")).toBeVisible();
    await shot(page, state, 9, "after-reload", 1800);

    // 10 · run: rate 4, each star lights in order, ending on the anchor
    await page.evaluate(() => {
      const seen: number[] = [];
      (window as unknown as { __activeSeen: number[] }).__activeSeen = seen;
      const record = () => {
        const el = document.querySelector('[data-testid="step"][data-active="true"]');
        const i = el ? Number(el.getAttribute("data-index")) : -1;
        if (i >= 0 && seen[seen.length - 1] !== i) seen.push(i);
      };
      new MutationObserver(record).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-active"] });
    });
    await page.getByTestId("run").click();
    await expect(page.getByTestId("rating")).toBeVisible();
    await expect(page.getByTestId("rate-0")).toBeVisible();
    await expect(page.getByTestId("rate-10")).toBeVisible();
    await page.getByTestId("rate-4").click();
    await expect(page.getByTestId("playback")).toBeVisible();
    await expect(page.locator('[data-testid="step"][data-index="0"][data-active="true"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("playback-line")).not.toHaveText("");
    await shot(page, state, 10, "playback-running", 1600);

    // 11 · second rating, run logged
    await expect(page.getByTestId("rate-8")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("rate-8").click();
    await expect(page.getByTestId("run-entry")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("run-entry").first()).toContainText("4 → 8");
    const seen = await page.evaluate(() => (window as unknown as { __activeSeen: number[] }).__activeSeen);
    testInfo.annotations.push({ type: "playback order", description: seen.join(" → ") });
    expect(seen.slice(0, target), "stars light in order").toEqual([...Array(target).keys()]);
    expect(seen[seen.length - 1], "playback ends on the anchor").toBe(profile.states[0].anchorStep);
    const runs = await readRuns(page);
    expect(runs).toHaveLength(1);
    expect(runs[0].intensityBefore).toBe(4);
    expect(runs[0].intensityAfter).toBe(8);
    const rv = validateRepSession(runs[0], profile);
    expect(rv.errors, "validateRepSession errors").toEqual([]);
    await shot(page, state, 11, "run-logged", 1800);

    expect(errors, "uncaught page errors").toEqual([]);
  });
}

test("constellation: content safety stop", async ({ page }) => {
  await fresh(page, "?voice=typed&hint=600000");
  await clickChoice(page, "content");
  const s = await typeAnswer(page, "Honestly I keep having panic attacks and I can't breathe");
  expect(s.status).toBe("stopped");
  await expect(page.getByTestId("stop-banner")).toBeVisible();
  await expect(page.getByTestId("stop-banner")).toContainText(/someone you trust|person you trust/i);
  await expect(page.getByTestId("answer-input")).toHaveCount(0);
  await expect(page.getByTestId("safety-note")).toBeVisible();
  await shot(page, "content", 12, "safety-stop", 1800);
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("question")).toHaveText(/what state/i);
});

test("constellation: mobile question screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fresh(page, "?voice=typed&hint=300");
  await clickChoice(page, "content");
  await typeAnswer(page, "I'm there");
  await expect(page.getByTestId("question")).toHaveText(/first thing/i);
  await expect(page.getByTestId("suggestion")).toHaveCount(2);
  await sleep(2200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal scroll on a 390 px screen").toBeLessThanOrEqual(0);
  await page.screenshot({ path: join(SCREENS, "mobile-question.png"), fullPage: true });
});

test("constellation: reduced motion keeps the light still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fresh(page, "?voice=typed&hint=600000");
  await sleep(600);
  // Read the sky canvas's own pixels: an element screenshot would also capture the words fading in over it.
  const frame = () => page.evaluate(() => (document.getElementById("sky") as HTMLCanvasElement).toDataURL("image/png"));
  const a = await frame();
  await sleep(1500);
  const b = await frame();
  expect(a.length, "the sky canvas drew nothing").toBeGreaterThan(1000);
  expect(a === b, "the light moved under prefers-reduced-motion").toBe(true);
  expect(errors).toEqual([]);
});

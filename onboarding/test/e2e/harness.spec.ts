// Visual test of the question harness: the 11 checkpoints of the plan, for "content" and for "destressed".
// Driven by window.__harness.snapshot().question.kind, so it follows whatever path the engine takes.
// Each checkpoint saves a full-page screenshot (copied to test/e2e/report/screens/ by screens-reporter.ts)
// and attaches it to the html report.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { validateProfile, validateRepSession, type ProfileV2, type RepSession } from "@peak-state/contracts";
import type { EngineSnapshot, PresetState, SavedStrategy } from "../../src/types.ts";
import { STAGING_DIR } from "./screens-reporter.ts";

declare global {
  interface Window {
    __harness: { snapshot(): EngineSnapshot };
  }
}

/** Page path; set from onboarding/vite.config.ts. Override with HARNESS_PATH. */
const HARNESS_PATH = process.env.HARNESS_PATH ?? "/";
const STRATEGY_KEY = "peak-state.harness.strategy";
const RUNS_KEY = "peak-state.harness.runs";
/** The real hint delay (HINT_DELAY_MS). The test never overrides it with ?hint=. */
const HINT_DELAY = 5000;
/** When the "not yet" check runs, measured from when the test first saw the question. */
const BEFORE_HINT_CHECK = 3800;
const MAX_ITERATIONS = 80;

const TARGET_STEPS: Record<PresetState, number> = { content: 2, destressed: 3 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const snap = (page: Page) => page.evaluate(() => window.__harness.snapshot());

/** A key that changes whenever the engine moves on (or re-asks after an answer). */
const progressKey = (s: EngineSnapshot) => `${s.status}|${s.question?.id ?? "-"}|${s.steps.length}|${s.transcript.length}`;

class Checkpoints {
  readonly shots: string[] = [];
  constructor(
    private page: Page,
    private info: TestInfo,
    private state: PresetState,
  ) {
    mkdirSync(STAGING_DIR, { recursive: true });
  }

  async shot(nn: number, name: string): Promise<void> {
    const file = `${this.state}-${String(nn).padStart(2, "0")}-${name}.png`;
    const path = join(STAGING_DIR, file);
    await this.page.screenshot({ path, fullPage: true });
    await this.info.attach(file, { path, contentType: "image/png" });
    this.shots.push(file);
  }
}

async function waitForProgress(page: Page, before: EngineSnapshot): Promise<EngineSnapshot> {
  const key = progressKey(before);
  await expect.poll(async () => progressKey(await snap(page)), { message: `engine did not move on from ${key}`, timeout: 10_000 }).not.toBe(key);
  return snap(page);
}

async function questionVisible(page: Page, s: EngineSnapshot): Promise<void> {
  if (s.question) await expect(page.getByTestId("question")).toContainText(s.question.text.slice(0, 40));
}

/** Asserts the two hints are hidden at ~4 s and exactly two show after the real 5 s delay. */
async function expectHintsAfterRealDelay(page: Page, shownAt: number): Promise<void> {
  const suggestions = page.getByTestId("suggestion");
  await expect(suggestions).toHaveCount(0);
  const waitBefore = shownAt + BEFORE_HINT_CHECK - Date.now();
  if (waitBefore > 0) await sleep(waitBefore);
  expect(await suggestions.filter({ visible: true }).count(), "suggestions visible before the 5 s hint delay").toBe(0);
  // Not earlier than the delay: they may appear no sooner than HINT_DELAY after the question.
  await expect(suggestions.first()).toBeVisible({ timeout: HINT_DELAY + 3000 });
  expect(Date.now() - shownAt, "suggestions appeared before the 5 s delay").toBeGreaterThanOrEqual(HINT_DELAY - 400);
  await expect(suggestions.filter({ visible: true })).toHaveCount(2);
}

/** Clicks a suggestion chip, then sends if the chip only filled the input. */
async function useSuggestion(page: Page, index: number): Promise<EngineSnapshot> {
  const before = await snap(page);
  await page.getByTestId("suggestion").nth(index).click();
  await sleep(100);
  const mid = await snap(page);
  if (progressKey(mid) === progressKey(before)) {
    await expect(page.getByTestId("answer-input")).not.toHaveValue("");
    await page.getByTestId("send").click();
  }
  return waitForProgress(page, before);
}

async function typeAnswer(page: Page, text: string): Promise<EngineSnapshot> {
  const before = await snap(page);
  await page.getByTestId("answer-input").fill(text);
  await page.getByTestId("send").click();
  return waitForProgress(page, before);
}

async function clickChoice(page: Page, value?: string): Promise<EngineSnapshot> {
  const before = await snap(page);
  const choice = value === undefined ? page.getByTestId("choice").first() : page.locator(`[data-testid="choice"][data-value="${value}"]`);
  await choice.click();
  return waitForProgress(page, before);
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
  test(`question harness: ${state}`, async ({ page }, testInfo) => {
    const target = TARGET_STEPS[state];
    const cp = new Checkpoints(page, testInfo, state);
    const stateWord = new RegExp(state, "i");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Fresh storage, typed voice, fast playback pauses, the real 5 s hint delay.
    await page.goto(`${HARNESS_PATH}?voice=typed&speed=fast`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");

    // 01 · choose state
    let s = await snap(page);
    expect(s.question?.kind).toBe("choose-state");
    await expect(page.getByTestId("question")).toHaveText(/what state/i);
    await expect(page.locator('[data-testid="choice"][data-value="content"]')).toBeVisible();
    await expect(page.locator('[data-testid="choice"][data-value="destressed"]')).toBeVisible();
    await expect(page.getByTestId("suggestion")).toHaveCount(0);
    await cp.shot(1, "choose-state");

    // 02 · memory
    s = await clickChoice(page, state);
    expect(s.stateId).toBe(state);
    expect(s.question?.kind).toBe("memory");
    await expect(page.getByTestId("question")).toHaveText(stateWord);
    await cp.shot(2, "memory");

    // 03 · first step
    s = await typeAnswer(page, "I'm there");
    expect(s.question?.kind).toBe("first-step");
    const firstShownAt = Date.now();
    await expect(page.getByTestId("question")).toHaveText(/first thing/i);
    await expect(page.getByTestId("question")).toHaveText(stateWord);
    await expect(page.getByTestId("suggestion")).toHaveCount(0);
    await cp.shot(3, "first-step");

    // 04 · two hints after the real 5 s
    await expectHintsAfterRealDelay(page, firstShownAt);
    await cp.shot(4, "hints-after-5s");

    // 05 · step 1 captured
    s = await useSuggestion(page, 0);
    if (s.question?.kind === "modality") s = await clickChoice(page);
    expect(s.steps).toHaveLength(1);
    await expect(page.getByTestId("step")).toHaveCount(1);
    await expect(page.getByTestId("step").first()).toHaveAttribute("data-modality", /^(visual|auditory|kinesthetic|olfactory|gustatory|other)$/);
    await expect(page.getByTestId("section-label")).toBeVisible();
    await cp.shot(5, "step1-captured");

    // 06 → 07 · loop by question kind until the chain is complete (anchor question)
    let submodalityHintDone = false;
    let iterations = 0;
    while (s.status === "asking" && s.question && s.question.kind !== "anchor") {
      if (++iterations > MAX_ITERATIONS) throw new Error(`no anchor question after ${MAX_ITERATIONS} answers; stuck on ${s.question.id}`);
      await questionVisible(page, s);
      const q = s.question;
      switch (q.kind) {
        case "submodality": {
          if (!submodalityHintDone) {
            submodalityHintDone = true;
            const shownAt = Date.now();
            await expectHintsAfterRealDelay(page, shownAt);
            await cp.shot(6, "submodality-hints");
            const before = s;
            s = await useSuggestion(page, 0);
            // The engine may re-ask if the phrasing carried no value; the next pass answers with a button.
            if (s.question?.id === before.question?.id) testInfo.annotations.push({ type: "note", description: `suggestion did not answer ${q.id}` });
          } else if (q.choices.length > 0) {
            s = await clickChoice(page);
          } else {
            // Free-text detail (e.g. "Whose voice is that?"): type the question's first phrasing.
            s = await typeAnswer(page, q.suggestions[0]);
          }
          break;
        }
        case "modality":
          s = await clickChoice(page);
          break;
        case "fully-in":
          s = await clickChoice(page, s.steps.length >= target ? "yes" : "no");
          break;
        case "next-step": {
          const shownAt = Date.now();
          await expectHintsAfterRealDelay(page, shownAt);
          s = await useSuggestion(page, 1);
          break;
        }
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
    expect(submodalityHintDone, "never reached a submodality question").toBe(true);
    expect(s.question?.kind).toBe("anchor");
    expect(s.steps).toHaveLength(target);
    await expect(page.getByTestId("step")).toHaveCount(target);
    await expect(page.getByTestId("chain")).toHaveText(new RegExp(Array(target).fill("\\S+").join("\\s*→\\s*")));
    expect(s.chain.split("→")).toHaveLength(target);
    await cp.shot(7, "chain-complete");

    // 08 · anchor, confirm, saved
    s = await clickChoice(page, "0");
    expect(s.anchorStep).toBe(0);
    if (s.question?.kind === "confirm") s = await clickChoice(page, "yes");
    expect(s.status).toBe("confirmed");
    await expect(page.getByTestId("saved-card")).toBeVisible();
    await expect(page.getByTestId("saved-card")).toContainText(/saved/i);
    await expect(page.getByTestId("saved-step")).toHaveCount(target);
    await expect(page.getByTestId("download")).toBeVisible();
    const saved = await readSaved(page);
    expect(saved, `localStorage ${STRATEGY_KEY}`).not.toBeNull();
    const profile = saved!.profile as ProfileV2;
    expect(typeof saved!.savedAt).toBe("string");
    expect(profile.states[0].id).toBe(state);
    expect(profile.confirmedAt).toBeTruthy();
    expect(profile.states[0].strategy.steps).toHaveLength(target);
    expect(profile.states[0].anchorStep).toBe(0);
    const pv = validateProfile(profile);
    expect(pv.errors, "validateProfile errors").toEqual([]);
    expect(pv.ok).toBe(true);
    await cp.shot(8, "strategy-saved");

    // 09 · reload, still saved
    await page.reload();
    await page.waitForFunction(() => typeof window.__harness?.snapshot === "function");
    await expect(page.getByTestId("saved-card")).toBeVisible();
    await expect(page.getByTestId("saved-step")).toHaveCount(target);
    await expect(page.getByTestId("run")).toBeVisible();
    await cp.shot(9, "after-reload");

    // 10 · run my strategy: rate 4, watch the steps light up, rate 8
    // Record which playback step is active over time, in page.
    await page.evaluate(() => {
      const seen: number[] = [];
      (window as unknown as { __activeSeen: number[] }).__activeSeen = seen;
      const record = () => {
        const all = [...document.querySelectorAll('[data-testid="playback-step"]')];
        const i = all.findIndex((el) => el.getAttribute("data-active") === "true");
        if (i >= 0 && seen[seen.length - 1] !== i) seen.push(i);
      };
      new MutationObserver(record).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-active"] });
    });
    await page.getByTestId("run").click();
    await expect(page.getByTestId("rating")).toBeVisible();
    await page.getByTestId("rate-4").click();
    await expect(page.getByTestId("playback")).toBeVisible();
    const active = page.locator('[data-testid="playback-step"][data-active="true"]');
    await expect(active).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("playback-step")).toHaveCount(target);
    await cp.shot(10, "playback-running");

    // 11 · second rating, run logged
    await expect(page.getByTestId("rate-8")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("rate-8").click();
    await expect(page.getByTestId("run-entry")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByTestId("run-log")).toBeVisible();
    const seen = await page.evaluate(() => (window as unknown as { __activeSeen: number[] }).__activeSeen);
    testInfo.annotations.push({ type: "playback order", description: seen.join(" → ") });
    for (let i = 0; i < target; i++) expect(seen, `playback step ${i} never lit up (saw ${seen.join(",")})`).toContain(i);
    expect(seen.slice(0, target), "steps play in order").toEqual([...Array(target).keys()]);
    expect(seen[seen.length - 1], "playback ends on the anchor").toBe(profile.states[0].anchorStep);
    const runs = await readRuns(page);
    expect(runs, `localStorage ${RUNS_KEY}`).toHaveLength(1);
    const run = runs[0];
    expect(run.stateId).toBe(state);
    expect(run.intensityBefore).toBe(4);
    expect(run.intensityAfter).toBe(8);
    const rv = validateRepSession(run, profile);
    expect(rv.errors, "validateRepSession errors").toEqual([]);
    expect(rv.ok).toBe(true);
    await cp.shot(11, "run-logged");

    expect(errors, "uncaught page errors").toEqual([]);
  });
}

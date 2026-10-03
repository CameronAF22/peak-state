import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RUNS_KEY, STRATEGY_KEY } from "@peak-state/onboarding";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { App, FLOW } from "../src/App";
import { demoProfile, demoRepLog } from "../src/fixtures";
import { resolveModules } from "../src/modules";
import { logRun, runsForProfile, savedStrategy } from "../src/store";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

describe("the /demo/ flow (D-onboarding-023)", () => {
  it("is onboard, rep, progress: calibrate and live are hidden until sensing lands", () => {
    expect(FLOW).toEqual(["onboard", "rep", "progress"]);
  });

  it("runs the real onboarding and reps modules and the sensing stub", () => {
    expect(resolveModules("").using).toEqual({ onboarding: "real", sensing: "stub", reps: "real" });
    expect(resolveModules("?onboarding=stub").using.onboarding).toBe("stub");
    expect(resolveModules("?sensing=real").using.sensing).toBe("stub");
  });
});

describe("every screen renders", () => {
  afterEach(() => {
    delete (globalThis as { location?: unknown }).location;
  });

  it.each(["onboard", "rep", "progress", "calibrate", "live"])("?screen=%s", (screen) => {
    (globalThis as { location?: unknown }).location = { search: `?screen=${screen}` };
    const html = renderToString(createElement(App));
    expect(html).toContain("Peak State is a performance and state-recall tool");
    if (screen === "rep") expect(html).toContain("I&#x27;m off");
    if (screen === "progress") expect(html).toContain("Installed");
  });
});

describe("storage shared with the harness at /", () => {
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
    (globalThis as { localStorage?: unknown }).localStorage = store;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("reads the harness's saved strategy record", () => {
    expect(savedStrategy()).toBeNull();
    const profile = demoProfile();
    store.setItem(STRATEGY_KEY, JSON.stringify({ profile, revision: 3, savedAt: "2026-10-03T19:00:00Z", changes: [] }));
    expect(savedStrategy()).toEqual({ profile, savedAt: "2026-10-03T19:00:00Z" });
  });

  it("ignores a draft strategy", () => {
    store.setItem(STRATEGY_KEY, JSON.stringify({ profile: { ...demoProfile(), confirmedAt: null }, savedAt: "2026-10-03T19:00:00Z" }));
    expect(savedStrategy()).toBeNull();
  });

  it("logs RepSessions into the harness's run log and reads them back per profile", () => {
    const [a, b] = demoRepLog().slice(3, 5);
    logRun(a);
    logRun({ ...b, profileId: "someone-else" });
    expect(JSON.parse(store.getItem(RUNS_KEY)!)).toHaveLength(2);
    expect(runsForProfile(a.profileId)).toEqual([a]);
  });
});

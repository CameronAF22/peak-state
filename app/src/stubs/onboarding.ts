// Fixture stub of the onboarding slot: replays contracts' recorded playbook run
// (contracts/fixtures/onboarding.events.demo.json, about 95 s at speed 1) on the host clock.
// It is the "script" mode of contracts' OnboardingOptions and the demo's offline fallback.
import type { OnboardingEvent, OnboardingResult } from "../contracts";
import { demoOnboardingEvents } from "../fixtures";
import { sleepOn } from "../host";
import type { AppOnboardingModule } from "../slots";

/** Longest pause between two recorded events, so the replay never stalls on a long silence. */
const MAX_GAP_MS = 4000;

export const onboardingStub: AppOnboardingModule = {
  async run(host, options = {}) {
    const events = demoOnboardingEvents();
    const t0 = host.clock.now();
    const shift = t0 - events[0].t;
    let prevT = events[0].t;
    const cancel = (): OnboardingResult => {
      options.onEvent?.({ type: "stopped", t: host.clock.now(), reason: "cancel", draft: null });
      return { status: "stopped", reason: "cancel", draft: null };
    };

    for (const recorded of events) {
      await sleepOn(host, Math.min(MAX_GAP_MS, recorded.t - prevT));
      if (options.signal?.aborted) return cancel();
      prevT = recorded.t;
      const e = { ...recorded, t: recorded.t + shift } as OnboardingEvent;
      options.onEvent?.(e);
      if (e.type === "confirmed") return { status: "confirmed", profile: e.profile };
      if (e.type === "stopped") return { status: "stopped", reason: e.reason, draft: e.draft };
    }
    return cancel();
  },
};

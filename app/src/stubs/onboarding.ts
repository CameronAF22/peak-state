// Fixture stub of the onboarding module: a scripted playbook run (sections 1 and 4 live,
// contrast and drivers prefilled, per D-onboarding-010) that emits the events the
// Onboard screen renders. About 90 s at speed 1.
import type { OnboardingEvent, OnboardingModule, PeakState, ProfileV2 } from "../contracts";
import { demoProfile } from "../fixtures";

class Aborted extends Error {}

export const onboardingStub: OnboardingModule = {
  async run({ host, onEvent, signal }) {
    const src = demoProfile();
    const s0 = src.states[0];
    const check = () => {
      if (signal?.aborted) throw new Aborted();
    };
    const emit = (e: OnboardingEvent) => {
      check();
      onEvent(e);
    };
    const guide = async (section: string, text: string) => {
      emit({ type: "guideTurn", text, section });
      await host.speech.speak(text);
      check();
    };
    const user = async (text: string, ms = 1800) => {
      // Simulate interim transcript, then the final line.
      const words = text.split(" ");
      const half = Math.max(1, Math.floor(words.length / 2));
      emit({ type: "userTurn", text: words.slice(0, half).join(" "), final: false });
      await host.clock.sleep(ms / 2);
      emit({ type: "userTurn", text, final: true });
      await host.clock.sleep(ms / 2);
      check();
    };
    const pause = async (ms: number) => {
      await host.clock.sleep(ms);
      check();
    };

    const draft: PeakState = {
      ...s0,
      strategy: { steps: [], fullyInAt: null, confirmed: false },
      anchorStep: null,
      contrast: null,
      differences: null,
      drivers: null,
      recode: null,
      test: null,
      futurePace: null,
      calibration: null,
    };

    try {
      // 1.1
      await guide("1.1", "What state do you want to be able to get back to? Say it in your own words.");
      await user(`${s0.label}. ${s0.words}.`, 2400);
      emit({ type: "stateNamed", stateId: s0.id, label: s0.label, words: s0.words });

      // 1.2
      await guide("1.2", `Remember a specific time you were totally ${s0.label}. Step into it. Tell me when you're there.`);
      emit({ type: "window", phase: "peak", open: true });
      await user(`Okay. ${s0.memoryCue ?? "I'm there"}. I'm there.`, 2200);

      // 1.3 to 1.5, steps with core submodalities
      const prompts = [
        `What was the very first thing that made you ${s0.label}? Something you saw, heard, or felt?`,
        "And after that, what was the very next thing? A picture, something you said to yourself, or a feeling?",
        "And the next thing?",
      ];
      for (let i = 0; i < s0.strategy.steps.length; i++) {
        const step = s0.strategy.steps[i];
        await guide(i === 0 ? "1.3" : i === 1 ? "1.4" : "1.5", prompts[Math.min(i, prompts.length - 1)]);
        await user(cap(step.content), 2000);
        draft.strategy.steps.push({ ...step, submodalities: { core: {} } });
        emit({ type: "stepCaptured", stateId: s0.id, index: i, step: { ...step, submodalities: { core: {} } } });
        for (const [key, value] of Object.entries(step.submodalities.core)) {
          await pause(650);
          draft.strategy.steps[i].submodalities.core[key] = value;
          emit({ type: "submodalityCaptured", stateId: s0.id, index: i, tier: "core", key, value });
        }
        await pause(400);
      }
      draft.strategy.fullyInAt = s0.strategy.fullyInAt;
      emit({ type: "window", phase: "peak", open: false });

      // 1.6 playback
      const steps = s0.strategy.steps.map((s) => s.content).join(", then ");
      await guide("1.6", `So first ${steps}. Is that the order?`);
      await user("Yes, that's it.", 1200);
      draft.strategy.confirmed = true;

      // 2: anchor step
      await guide("2", "Which one of these, if I gave it back to you, would bring the state back fastest?");
      await user(`The ${s0.strategy.steps[s0.anchorStep ?? 0].content}.`, 1600);
      draft.anchorStep = s0.anchorStep;
      emit({ type: "anchorStepMarked", stateId: s0.id, index: s0.anchorStep ?? 0 });

      // 3: prefilled from rehearsal
      await guide("3", "From your rehearsal, here's what changed between this and a stuck time.");
      if (s0.contrast) {
        draft.contrast = s0.contrast;
        emit({ type: "contrastCaptured", stateId: s0.id, contrast: s0.contrast });
      }
      await pause(1200);
      if (s0.differences && s0.drivers) {
        draft.differences = s0.differences;
        draft.drivers = s0.drivers;
        emit({ type: "driverFound", stateId: s0.id, differences: s0.differences, drivers: s0.drivers });
      }
      const drivers = (s0.drivers ?? []).map((i) => s0.differences?.[i]?.attribute).filter(Boolean).join(" and ");
      await guide("3.6", `For you, ${drivers} seem to matter most. That's a finding to test, not a fact.`);

      // 4.1 to 4.3
      await guide("4.1", "Take the stuck time and give it those drivers: the picture as close and as bright as the strong one.");
      await pause(2500);
      draft.recode = s0.recode;
      await guide("4.2", "Think of that old situation again. Where are you, 0 to 10? And before, it was?");
      await user(`Before it was ${s0.test?.before ?? 3}. Now it's ${s0.test?.after ?? 7}.`, 1800);
      draft.test = s0.test;
      if (s0.test) emit({ type: "testRated", stateId: s0.id, before: s0.test.before, after: s0.test.after });
      await guide("4.3", "Think of a time coming up when you'll want this. Run the steps there.");
      await user(cap(s0.futurePace?.situation ?? "Next week"), 1600);
      draft.futurePace = s0.futurePace;

      // 4.4
      await guide("4.4", `Here's your strategy, in order: ${steps}. Driven by ${drivers}.`);
      draft.calibration = s0.calibration;
      const profile: ProfileV2 = { ...src, states: [draft], confirmedAt: new Date(host.clock.now()).toISOString() };
      emit({ type: "confirmed", profile });
      return { status: "confirmed", profile };
    } catch (e) {
      if (e instanceof Aborted) {
        onEvent({ type: "stopped", reason: "cancel" });
        return { status: "stopped", reason: "cancel", draft: null };
      }
      throw e;
    }
  },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

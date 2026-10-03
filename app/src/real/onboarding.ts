// The real onboarding slot: @peak-state/onboarding's question engine, driven headlessly (D-onboarding-023).
// The engine decides every question; this adapter speaks them through the host, takes answers from the
// screen (typed or tapped) and, in voice mode, from the host's speech recognition, and forwards the
// engine's contracts OnboardingEvents. The full voice guide is the harness at "/".
import { createEngine, type Answer, type EngineSnapshot } from "@peak-state/onboarding";
import type { OnboardingEvent, OnboardingResult, ProfileV2 } from "../contracts";
import type { AppOnboardingModule } from "../slots";

export const engineOnboarding: AppOnboardingModule = {
  run(host, options = {}) {
    return new Promise<OnboardingResult>((resolve) => {
      let done = false;
      let draft: ProfileV2 | null = null;
      const offs: (() => void)[] = [];
      const finish = (result: OnboardingResult) => {
        if (done) return;
        done = true;
        for (const off of offs) off();
        options.onQuestion?.(null, []);
        resolve(result);
      };
      const onEvent = (e: OnboardingEvent) => {
        if (e.type === "stopped") draft = e.draft;
        options.onEvent?.(e);
      };

      const engine = createEngine({ now: () => host.clock.now(), onEvent });

      const show = (snap: EngineSnapshot) => {
        if (snap.status === "confirmed" && snap.profile) return finish({ status: "confirmed", profile: snap.profile });
        if (snap.status === "stopped") {
          host.onSafetyStop("safety");
          return finish({ status: "stopped", reason: "safety", draft });
        }
        options.onQuestion?.(snap.question, snap.steps);
        if (snap.question && !host.speech.muted) void host.speech.speak(snap.question.text);
      };
      const answer = (a: Answer) => {
        if (!done) show(engine.answer(a));
      };

      if (options.answers) {
        offs.push(
          options.answers.subscribe((m) => {
            if (done) return;
            if (m.kind === "back") show(engine.back());
            else answer(m.answer);
          }),
        );
      }
      if (options.mode === "voice") {
        offs.push(
          host.speech.listen((text, final) => {
            if (final && text.trim()) answer({ text: text.trim(), via: "voice" });
          }),
        );
      }
      options.signal?.addEventListener(
        "abort",
        () => {
          if (done) return;
          const current = engine.snapshot();
          onEvent({ type: "stopped", t: host.clock.now(), reason: "cancel", draft: current.profile });
          finish({ status: "stopped", reason: "cancel", draft: current.profile });
        },
        { once: true },
      );

      show(engine.snapshot());
    });
  },
};

// The real reps slot: @peak-state/reps builds the script from the person's own strategy, records the
// RepSession and computes progress; this runner plays the script through the host (speech and the scaled
// clock) and asks the screen for the two ratings. The app owns the log (src/store.ts).
import {
  buildScript,
  conditioning,
  createRecorder,
  fromOnboarding,
  progress,
  progressByState,
  type Conditioning,
  type RepProgress,
  type ScriptStep,
} from "@peak-state/reps";
import type { ModuleHost, RepSession, StateId } from "../contracts";
import { sleepOn } from "../host";
import type { AppRepsModule } from "../slots";

/** How long a sham rep waits between its two ratings, with the cue held back. */
export const SHAM_WAIT_MS = 8000;

class Stopped extends Error {}

export const repsReal: AppRepsModule = {
  run(profile, stateId, trigger, host, detection, ui = {}) {
    const script = buildScript(profile, stateId, ui.kind ?? "full");
    const recorder = createRecorder(script, {
      trigger,
      repIndex: ui.repIndex ?? 0,
      arm: detection?.gate.sham ? "sham" : "cue",
      clock: host.clock,
    });

    let stopRequested = false;
    let wake: () => void = () => {};
    const stopped = new Promise<never>((_, reject) => {
      wake = () => reject(new Stopped());
    });
    stopped.catch(() => {});
    const guard = <T>(p: Promise<T>): Promise<T> => Promise.race([p, stopped]);
    const rate = ui.rate ?? ((prompt: string) => listenForRating(host, prompt));

    const session = (async (): Promise<RepSession> => {
      let rated = 0;
      try {
        for (let i = 0; i < recorder.plan.length; i++) {
          const step: ScriptStep = recorder.plan[i];
          if (stopRequested) throw new Stopped();
          recorder.stepStarted(i);
          ui.onStep?.(step, i);
          if (step.kind === "rate") {
            const value = await guard(rate(step.text));
            if (rated++ === 0) recorder.rateBefore(value);
            else recorder.rateAfter(value);
            if (recorder.arm === "sham" && rated === 1) await guard(sleepOn(host, SHAM_WAIT_MS));
          } else {
            await guard(Promise.all([host.speech.speak(step.text), sleepOn(host, step.plannedMs)]));
          }
          recorder.stepEnded(i, true);
        }
        return recorder.finish("completed");
      } catch (e) {
        if (!(e instanceof Stopped)) throw e;
        return recorder.finish("user-stop");
      }
    })();

    return {
      session,
      stop() {
        stopRequested = true;
        wake();
      },
    };
  },

  fromOnboarding,

  progress: progressByState,
};

/** Without a rating pad: speak the prompt and wait for a spoken whole number 0 to 10. */
function listenForRating(host: ModuleHost, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    void host.speech.speak(prompt);
    const off = host.speech.listen((text, final) => {
      const m = final ? /\b(10|[0-9])\b/.exec(text) : null;
      if (m) {
        off();
        resolve(Number(m[1]));
      }
    });
  });
}

/** What the Progress screen shows for one state: reps' progress plus where conditioning stands (D-reps-003). */
export type StateView = RepProgress & Pick<Conditioning, "goodRepsNeeded" | "anchorPasses">;

export function progressFor(sessions: readonly RepSession[], stateId: StateId): StateView {
  const c = conditioning(sessions, stateId);
  return { ...progress(sessions, stateId), goodRepsNeeded: c.goodRepsNeeded, anchorPasses: c.anchorPasses };
}

import { useEffect, useRef, useState } from "react";
import {
  CORE_KEYS,
  chain,
  type Difference,
  type ModuleHost,
  type OnboardingEvent,
  type OnboardingModule,
  type ProfileV2,
  type StrategyStep,
} from "../contracts";
import { StepChain } from "../components/StepChain";
import { speechAvailable } from "../host";

interface Turn {
  who: "guide" | "user";
  text: string;
  section?: string;
  final: boolean;
}

interface View {
  turns: Turn[];
  label: string | null;
  words: string | null;
  steps: StrategyStep[];
  activeIndex: number | null;
  anchorStep: number | null;
  contrastLabel: string | null;
  differences: Difference[] | null;
  drivers: number[] | null;
  test: { before: number; after: number } | null;
  window: "peak" | "contrast" | null;
  confirmed: ProfileV2 | null;
}

const EMPTY: View = {
  turns: [],
  label: null,
  words: null,
  steps: [],
  activeIndex: null,
  anchorStep: null,
  contrastLabel: null,
  differences: null,
  drivers: null,
  test: null,
  window: null,
  confirmed: null,
};

/** Pure reducer from onboarding events to what the screen shows. Exported for tests. */
export function reduce(v: View, e: OnboardingEvent): View {
  switch (e.type) {
    case "guideTurn":
      return { ...v, turns: [...v.turns, { who: "guide", text: e.text, section: e.section, final: true }] };
    case "userTurn": {
      const turns = [...v.turns];
      const last = turns[turns.length - 1];
      if (last && last.who === "user" && !last.final) turns[turns.length - 1] = { who: "user", text: e.text, final: e.final };
      else turns.push({ who: "user", text: e.text, final: e.final });
      return { ...v, turns };
    }
    case "stateNamed":
      return { ...v, label: e.label, words: e.words };
    case "stepCaptured": {
      const steps = [...v.steps];
      steps[e.index] = e.step;
      return { ...v, steps, activeIndex: e.index };
    }
    case "submodalityCaptured": {
      const steps = [...v.steps];
      const s = steps[e.index];
      if (!s) return v;
      const tier = s.submodalities[e.tier] ?? {};
      steps[e.index] = { ...s, submodalities: { ...s.submodalities, [e.tier]: { ...tier, [e.key]: e.value } } };
      return { ...v, steps, activeIndex: e.index };
    }
    case "anchorStepMarked":
      return { ...v, anchorStep: e.index };
    case "contrastCaptured":
      return { ...v, contrastLabel: e.contrast.label };
    case "driverFound":
      return { ...v, differences: e.differences, drivers: e.drivers };
    case "testRated":
      return { ...v, test: { before: e.before, after: e.after } };
    case "window":
      return { ...v, window: e.open ? e.phase : null };
    case "confirmed":
      return { ...v, confirmed: e.profile, activeIndex: null };
    case "stopped":
      return v;
  }
}

const KEY_LABEL: Record<string, string> = {
  location: "where it is",
  size: "size",
  distance: "distance",
  brightness: "bright or dim",
  perspective: "own eyes or watching",
  source: "whose voice / source",
  volume: "volume",
  bodyLocation: "where in the body",
  intensity: "intensity 0–10",
  movement: "moving or still",
};

export function OnboardScreen({
  host,
  registerStop,
  onboarding,
  onDone,
  onUseSample,
}: {
  host: ModuleHost;
  registerStop(h: () => void): () => void;
  onboarding: OnboardingModule;
  onDone(p: ProfileV2): void;
  onUseSample(): void;
}) {
  const [view, setView] = useState<View>(EMPTY);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const voice = speechAvailable();

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [view.turns]);

  const start = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const unregister = registerStop(() => ctl.abort());
    setView(EMPTY);
    setRunning(true);
    try {
      const result = await onboarding.run({
        host,
        mode: "scripted",
        signal: ctl.signal,
        onEvent: (e) => {
          if (e.type === "stopped" && e.reason === "safety") host.onSafetyStop("safety");
          setView((v) => reduce(v, e));
        },
      });
      if (result.status === "stopped" && result.reason === "safety") host.onSafetyStop("safety");
    } finally {
      unregister();
      setRunning(false);
    }
  };

  const active = view.activeIndex !== null ? view.steps[view.activeIndex] : null;
  const driverSet = new Set(view.drivers ?? []);

  return (
    <section>
      <h1>Find your state</h1>
      <p className="lede">
        One state you choose, in your own words. Peak State learns the steps you already run to get there.
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary big" onClick={start} disabled={running}>
          {view.turns.length ? "Restart" : "Start"} (scripted)
        </button>
        <button onClick={onUseSample} disabled={running}>
          Use sample profile
        </button>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          Live voice: {voice.listen ? "available in this browser" : "not available here"}; arrives with the onboarding module.
        </span>
        {view.window && (
          <span className={`window-pill ${view.window}`}>recording {view.window === "peak" ? "on-state" : "contrast"}…</span>
        )}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Conversation</h2>
          <div className="transcript" ref={transcriptRef} aria-live="polite">
            {view.turns.length === 0 && <p className="muted">The transcript appears here as you talk.</p>}
            {view.turns.map((t, i) => (
              <div key={i} className={`turn ${t.who}${t.final ? "" : " interim"}`}>
                {t.section && <span className="sec">§ {t.section}</span>}
                {t.text}
              </div>
            ))}
          </div>
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card">
            <h2>
              {view.label ? <>“{view.label}”</> : "Your state"}
              {view.steps.length > 0 && <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>{chain({ strategy: { steps: view.steps, fullyInAt: null, confirmed: false } })}</span>}
            </h2>
            {view.words && <p className="muted" style={{ marginTop: 0 }}>{view.words}</p>}
            <StepChain steps={view.steps} activeIndex={view.activeIndex} anchorStep={view.anchorStep} placeholder={!view.confirmed} />
          </div>

          {active && (
            <div className="card">
              <h2>
                Step {view.activeIndex! + 1}: how it's represented
              </h2>
              <ul className="checklist">
                {CORE_KEYS[active.modality].map((k) => {
                  const val = active.submodalities.core[k];
                  return (
                    <li key={k} className={val !== undefined ? "done" : ""}>
                      <span className="tick">{val !== undefined ? "✓" : "○"}</span>
                      <span>{KEY_LABEL[k] ?? k}</span>
                      <span className="val">{val ?? ""}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {view.differences && (
            <div className="card">
              <h2>What makes the difference{view.contrastLabel && <span className="muted" style={{ fontWeight: 400 }}> vs “{view.contrastLabel}”</span>}</h2>
              <ul className="checklist">
                {view.differences.map((d, i) => (
                  <li key={i} className={driverSet.has(i) ? "done" : ""}>
                    <span className="tick">{driverSet.has(i) ? "★" : "·"}</span>
                    <span>
                      {d.attribute}: {String(d.peak)} vs {String(d.contrast)}
                    </span>
                    <span className="val">{d.ratingDelta === null ? "" : `+${d.ratingDelta}`}</span>
                  </li>
                ))}
              </ul>
              <p className="hypothesis">★ drivers are hypotheses to test with you, not facts. Filled in from your rehearsal.</p>
            </div>
          )}

          {view.test && (
            <div className="card row">
              <div className="stat">
                <span className="v">
                  {view.test.before} → {view.test.after}
                </span>
                <span className="l">Old situation, after giving it your drivers (0–10)</span>
              </div>
            </div>
          )}

          {view.confirmed && (
            <button className="primary big" onClick={() => onDone(view.confirmed!)}>
              Confirm and calibrate →
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

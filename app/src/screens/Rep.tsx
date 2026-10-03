import { useEffect, useRef, useState } from "react";
import { chain, type DetectionEvent, type ModuleHost, type ProfileV2, type RepHandle, type RepSession, type RepStep, type RepsModule } from "../contracts";
import { RatingPad } from "../components/RatingPad";

const KIND_LABEL: Record<RepStep["kind"], string> = {
  rate: "Rate",
  anchor: "Anchor",
  "strategy-step": "Step",
  leverage: "Why it matters",
  peak: "Peak",
};

export function RepScreen({
  host,
  registerStop,
  profile,
  stateId,
  detection,
  reps,
  nextRepIndex,
  onDone,
  onProgress,
}: {
  host: ModuleHost;
  registerStop(h: () => void): () => void;
  profile: ProfileV2;
  stateId: string;
  detection: DetectionEvent | null;
  reps: RepsModule;
  nextRepIndex: number;
  onDone(s: RepSession): void;
  onProgress(): void;
}) {
  const state = profile.states.find((s) => s.id === stateId) ?? profile.states[0];
  const [trail, setTrail] = useState<{ step: RepStep; say: string }[]>([]);
  const [asking, setAsking] = useState<{ prompt: string; resolve(n: number): void } | null>(null);
  const [result, setResult] = useState<RepSession | null>(null);
  const [started, setStarted] = useState(false);
  const handle = useRef<RepHandle | null>(null);
  const arm = detection?.gate.sham ? "sham" : "cue";

  const begin = () => {
    setStarted(true);
    const h = reps.run(
      profile,
      state.id,
      detection ? { kind: detection.kind === "manual" ? "manual" : "detection", detectionId: detection.id } : { kind: "practice" },
      {
        host,
        arm,
        rate: (prompt) => new Promise<number>((resolve) => setAsking({ prompt, resolve })),
        onStep: (step, _i, say) => setTrail((t) => [...t, { step, say }]),
      },
    );
    handle.current = h;
    const unregister = registerStop(() => h.stop("user-stop"));
    h.session
      .then((s) => {
        const logged = { ...s, repIndex: nextRepIndex };
        setResult(logged);
        onDone(logged);
      })
      .finally(unregister);
  };

  // Detection-triggered reps start on arrival; practice reps wait for the person.
  useEffect(() => {
    if (detection) begin();
    return () => handle.current?.stop("user-stop");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = trail[trail.length - 1];
  const strategyLabel = (s: RepStep) =>
    s.kind === "strategy-step" && s.strategyStepIndex !== undefined
      ? `${KIND_LABEL[s.kind]} ${s.strategyStepIndex + 1}`
      : KIND_LABEL[s.kind];

  return (
    <section className="grid">
      <div>
        <h1>Rep · {state.label}</h1>
        <p className="lede">
          Your own steps, in your order: <strong>{chain(state)}</strong>
          {detection && <> · started by {detection.kind === "manual" ? "you" : "a drift from your on-state"}</>}
        </p>
      </div>

      {!started && (
        <div className="card row">
          <button className="primary big" onClick={begin}>Start a practice rep</button>
          <span className="muted">About 30 seconds. Stop any time.</span>
        </div>
      )}

      {started && !result && (
        <div className="card grid">
          <div className="rep-trail" aria-label="Rep steps so far">
            {trail.map((t, i) => (
              <span key={i} className={i === trail.length - 1 ? "now" : ""}>{strategyLabel(t.step)}</span>
            ))}
          </div>
          {asking ? (
            <RatingPad
              prompt={asking.prompt}
              onRate={(n) => {
                asking.resolve(n);
                setAsking(null);
              }}
            />
          ) : (
            <div>
              <div className="rep-kind">{current ? strategyLabel(current.step) : "Getting ready"}</div>
              <div className="rep-step" aria-live="polite">{current?.say || (arm === "sham" ? "Just notice where you are for a moment." : "…")}</div>
            </div>
          )}
          <div className="row">
            <button className="stop" onClick={() => handle.current?.stop("user-stop")}>Stop this rep</button>
          </div>
        </div>
      )}

      {result && (
        <div className="card grid">
          <h2>{result.endedBy === "completed" ? "Rep logged" : `Rep ended (${result.endedBy})`}</h2>
          <div className="row" style={{ gap: 24 }}>
            <div className="stat"><span className="v">{result.intensityBefore ?? "—"} → {result.intensityAfter ?? "—"}</span><span className="l">your rating, 0–10</span></div>
            <div className="stat"><span className="v">{result.arm}</span><span className="l">arm</span></div>
            <div className="stat"><span className="v">#{result.repIndex + 1}</span><span className="l">rep for this state</span></div>
          </div>
          {result.arm === "sham" && (
            <p className="muted">This was a sham trial: the cue was held back on purpose so we can tell whether the rep itself helps.</p>
          )}
          <div className="row">
            <button className="primary big" onClick={onProgress}>See progress →</button>
          </div>
        </div>
      )}
    </section>
  );
}

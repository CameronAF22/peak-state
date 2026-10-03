import { useEffect, useRef, useState } from "react";
import { nextRepIndex, type ScriptStep } from "@peak-state/reps";
import { chain, type DetectionEvent, type ModuleHost, type ProfileV2, type RepHandle, type RepSession, type RepTrigger } from "../contracts";
import { RatingPad } from "../components/RatingPad";
import { progressFor } from "../real/reps";
import type { AppRepsModule } from "../slots";

const KIND_LABEL: Record<ScriptStep["kind"], string> = {
  rate: "Rate",
  "strategy-step": "Step",
  leverage: "Why it matters",
  "anchor-peak": "Peak",
  anchor: "Anchor",
};

function stepLabel(s: ScriptStep): string {
  return s.kind === "strategy-step" && s.stepIndex !== undefined ? `${KIND_LABEL[s.kind]} ${s.stepIndex + 1}` : KIND_LABEL[s.kind];
}

/** How a rep starts: the "I'm off" button, a practice rep, the anchor-only test, or a detection (Live, hidden for now). */
export interface RepStart {
  trigger: RepTrigger;
  kind: "full" | "anchor-only";
}

/** The "I'm off" button: the person says they have drifted, and a full rep starts now. */
export const IM_OFF: RepStart = { trigger: { kind: "manual" }, kind: "full" };

export function RepScreen({
  host,
  registerStop,
  profile,
  stateId,
  sessions,
  detection,
  autoStart,
  reps,
  onDone,
  onProgress,
}: {
  host: ModuleHost;
  registerStop(h: () => void): () => void;
  profile: ProfileV2;
  stateId: string;
  /** Every session for this profile, for the rep index and the anchor-only test offer. */
  sessions: RepSession[];
  detection: DetectionEvent | null;
  /** Start straight away (the "I'm off" button on another screen). */
  autoStart: RepStart | null;
  reps: AppRepsModule;
  onDone(s: RepSession): void;
  onProgress(): void;
}) {
  const state = profile.states.find((s) => s.id === stateId) ?? profile.states[0];
  const [trail, setTrail] = useState<ScriptStep[]>([]);
  const [asking, setAsking] = useState<{ prompt: string; resolve(n: number): void } | null>(null);
  const [result, setResult] = useState<RepSession | null>(null);
  const [running, setRunning] = useState<RepStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<RepHandle | null>(null);
  const arm = detection?.gate.sham ? "sham" : "cue";
  const canTestAnchor = state.anchorStep !== null && progressFor(sessions, state.id).nextStep !== "reps";

  const begin = (how: RepStart) => {
    setTrail([]);
    setResult(null);
    setError(null);
    setRunning(how);
    let h: RepHandle;
    try {
      h = reps.run(profile, state.id, how.trigger, host, detection ?? undefined, {
        kind: how.kind,
        repIndex: nextRepIndex(sessions, state.id),
        rate: (prompt) => new Promise<number>((resolve) => setAsking({ prompt, resolve })),
        onStep: (step) => setTrail((t) => [...t, step]),
      });
    } catch (e) {
      setRunning(null);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    handle.current = h;
    const unregister = registerStop(() => h.stop());
    h.session
      .then((s) => {
        setResult(s);
        setAsking(null);
        onDone(s);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        unregister();
        setRunning(null);
      });
  };

  useEffect(() => {
    if (detection) begin({ trigger: { kind: detection.kind === "manual" ? "manual" : "detection", detectionId: detection.id }, kind: "full" });
    else if (autoStart) begin(autoStart);
    return () => handle.current?.stop();
    // Start once per mount; App remounts this screen on speed, voice or Stop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = trail[trail.length - 1];

  return (
    <section className="grid">
      <div>
        <h1>Rep · {state.label}</h1>
        <p className="lede">
          Your own steps, in your order: <strong>{chain(state)}</strong>
          {running?.trigger.kind === "manual" && <> · started by you</>}
          {running?.trigger.kind === "detection" && <> · started by a drift from your on-state</>}
        </p>
      </div>

      {!running && !result && (
        <div className="card grid" style={{ gap: 12 }}>
          <div className="row">
            <button className="primary big" onClick={() => begin(IM_OFF)}>I'm off</button>
            <span className="muted">Press it when you notice you've drifted from “{state.label}”. A rep takes about 30 seconds. Stop any time.</span>
          </div>
          <div className="row">
            <button onClick={() => begin({ trigger: { kind: "practice" }, kind: "full" })}>Practice rep</button>
            {canTestAnchor && <button onClick={() => begin({ trigger: { kind: "practice" }, kind: "anchor-only" })}>Anchor-only test</button>}
          </div>
          <p className="note" style={{ margin: 0 }}>Live sensing comes later. For now you start each rep yourself.</p>
        </div>
      )}

      {error && (
        <div className="card">
          <p style={{ margin: 0 }}>This strategy can't run as a rep yet: {error}</p>
        </div>
      )}

      {running && !result && (
        <div className="card grid">
          <div className="rep-trail" aria-label="Rep steps so far">
            {trail.map((s, i) => (
              <span key={i} className={i === trail.length - 1 ? "now" : ""}>{stepLabel(s)}</span>
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
              <div className="rep-kind">{current ? stepLabel(current) : "Getting ready"}</div>
              <div className="rep-step" aria-live="polite">
                {current && current.kind !== "rate" ? current.text : arm === "sham" ? "Just notice where you are for a moment." : "…"}
              </div>
            </div>
          )}
          <div className="row">
            <button className="stop" onClick={() => handle.current?.stop()}>Stop this rep</button>
          </div>
        </div>
      )}

      {result && (
        <div className="card grid">
          <h2>{result.endedBy === "completed" ? "Rep logged" : `Rep ended (${result.endedBy}) and logged`}</h2>
          <div className="row" style={{ gap: 24 }}>
            <div className="stat"><span className="v">{result.intensityBefore ?? "—"} → {result.intensityAfter ?? "—"}</span><span className="l">your rating, 0–10</span></div>
            <div className="stat"><span className="v">{result.kind}</span><span className="l">{result.arm} arm</span></div>
            <div className="stat"><span className="v">#{result.repIndex + 1}</span><span className="l">rep for this state</span></div>
          </div>
          {result.arm === "sham" && (
            <p className="muted">This was a sham trial: the cue was held back on purpose so we can tell whether the rep itself helps.</p>
          )}
          <div className="row">
            <button className="primary big" onClick={onProgress}>See progress →</button>
            <button onClick={() => setResult(null)}>Another rep</button>
          </div>
        </div>
      )}
    </section>
  );
}

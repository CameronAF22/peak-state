import { useEffect, useRef, useState } from "react";
import type { DetectionEvent, ModuleHost, ProfileV2, SensingHandle, SignalFrame } from "../contracts";
import { TraceChart } from "../components/TraceChart";
import type { AppSensingModule, GateView } from "../slots";

// Hidden from the /demo/ flow while sensing is plan only (D-onboarding-023); reachable with ?screen=live.

export function LiveScreen({
  host,
  registerStop,
  profile,
  stateId,
  sensing,
  onDetection,
}: {
  host: ModuleHost;
  registerStop(h: () => void): () => void;
  profile: ProfileV2;
  stateId: string;
  sensing: AppSensingModule;
  onDetection(e: DetectionEvent): void;
}) {
  const [frames, setFrames] = useState<SignalFrame[]>([]);
  const [gate, setGate] = useState<GateView | null>(null);
  const [fired, setFired] = useState<DetectionEvent | null>(null);
  const handle = useRef<SensingHandle | null>(null);
  const state = profile.states.find((s) => s.id === stateId) ?? profile.states[0];

  useEffect(() => {
    const h = sensing.start(
      profile,
      stateId,
      (e) => {
        setFired(e);
        h.stop();
        // A beat so the judge sees the gate open before the rep starts.
        setTimeout(() => onDetection(e), 1500 / host.clock.speed);
      },
      (f) => setFrames((prev) => [...prev.slice(-119), f]),
      setGate,
    );
    handle.current = h;
    const unregister = registerStop(() => h.stop());
    return () => {
      h.stop();
      unregister();
    };
    // Start once per mount; App remounts this screen on speed, voice or Stop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = frames[frames.length - 1];
  const peak = state.calibration?.peak ?? null;
  const contrast = state.calibration?.contrast ?? null;

  return (
    <section className="grid">
      <div>
        <h1>Live · {state.label}</h1>
        <p className="lede">When you drift away from your own on-state for long enough, a rep starts. You can always start one yourself.</p>
      </div>
      <div className="grid two">
        <div className="card">
          <TraceChart frames={frames} peak={peak} contrast={contrast} markers={fired ? [fired.t] : []} />
        </div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card row" style={{ gap: 24 }}>
            <div className="stat"><span className="v">{last?.hr ?? "—"}</span><span className="l">bpm now</span></div>
            <div className="stat"><span className="v">{last ? last.source : "—"}</span><span className="l">source</span></div>
          </div>
          <div className="card grid" style={{ gap: 8 }}>
            <h2>Gate</h2>
            <div className="gate" aria-label={`${gate?.consecutive ?? 0} of ${gate?.required ?? 3} windows off your on-state`}>
              {Array.from({ length: gate?.required ?? 3 }, (_, i) => (
                <span key={i} className={`w${i < (gate?.consecutive ?? 0) || fired ? " on" : ""}`} />
              ))}
            </div>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              {fired
                ? `Gate open (${fired.kind}${fired.gate.sham ? ", sham trial" : ""}). Starting a rep…`
                : `${gate?.consecutive ?? 0} of ${gate?.required ?? 3} five-second windows off your on-state` +
                  (gate?.refractoryRemainingS ? ` · refractory ${gate.refractoryRemainingS}s` : "")}
            </div>
          </div>
          <button className="primary big" onClick={() => handle.current?.triggerManual()} disabled={!!fired}>
            I'm off
          </button>
        </div>
      </div>
    </section>
  );
}

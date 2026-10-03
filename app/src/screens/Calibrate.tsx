import type { CalibrationSummary, ModuleHost, ProfileV2 } from "../contracts";
import { TraceChart } from "../components/TraceChart";

function Summary({ title, c }: { title: string; c: CalibrationSummary | null }) {
  if (!c) return <div className="card muted">{title}: not recorded yet.</div>;
  return (
    <div className="card grid" style={{ gap: 8 }}>
      <h2>{title}</h2>
      <div className="row" style={{ gap: 24 }}>
        <div className="stat"><span className="v">{c.stats.hr.mean}</span><span className="l">heart rate, bpm (±{c.stats.hr.sd})</span></div>
        <div className="stat"><span className="v">{c.stats.rmssd}</span><span className="l">RMSSD, ms</span></div>
        <div className="stat"><span className="v">{c.durationSeconds}s</span><span className="l">{c.source}, quality {Math.round(c.quality * 100)}%</span></div>
      </div>
    </div>
  );
}

export function CalibrateScreen({ profile, onNext }: { host: ModuleHost; registerStop(h: () => void): () => void; profile: ProfileV2; onNext(): void }) {
  const state = profile.states[0];
  const peak = state.calibration?.peak ?? null;
  const contrast = state.calibration?.contrast ?? null;
  return (
    <section className="grid">
      <div>
        <h1>What “{state.label}” looks like for you</h1>
        <p className="lede">
          Recorded while you recalled your state (the on-state) and a small stuck moment (the contrast). Peak State compares you only with
          yourself. It never reads thoughts or moods.
        </p>
      </div>
      <div className="grid two">
        <Summary title="On-state (peak recall)" c={peak} />
        <Summary title="Stuck state (contrast recall)" c={contrast} />
      </div>
      <div className="card">
        <TraceChart frames={[]} peak={peak} contrast={contrast} />
      </div>
      <div className="row">
        <button className="primary big" onClick={onNext}>Go live →</button>
        <span className="muted">Strap and re-record arrive with the sensing module.</span>
      </div>
    </section>
  );
}

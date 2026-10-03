import { useState } from "react";
import type { ProfileV2, RepSession } from "../contracts";
import { progressFor } from "../real/reps";
/** Before/after rating per rep: two series, legend plus direct labels on the latest rep. */
function IntensityChart({ points }: { points: { repIndex: number; before: number | null; after: number | null; arm: string; kind: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const P = { l: 28, r: 72, t: 12, b: 24 };
  const n = points.length;
  const x = (i: number) => P.l + (n <= 1 ? 0.5 : i / (n - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / 10) * (H - P.t - P.b);
  const line = (key: "before" | "after") =>
    points
      .map((p, i) => (p[key] === null ? null : `${x(i)},${y(p[key]!)}`))
      .filter(Boolean)
      .join(" ");
  const last = points[n - 1];
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="legend">
        <span><span className="sw" style={{ background: "var(--series-2)" }} />Before the rep</span>
        <span><span className="sw" style={{ background: "var(--series-1)" }} />After the rep</span>
        <span className="muted">hollow = sham, ◆ = anchor-only</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 760 }} role="img" aria-label="Intensity before and after each rep, 0 to 10">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--border)" />
            <text x={4} y={y(v) + 4} fontSize="11" fill="var(--text-muted)">{v}</text>
          </g>
        ))}
        <polyline points={line("before")} fill="none" stroke="var(--series-2)" strokeWidth={2} strokeLinejoin="round" />
        <polyline points={line("after")} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) =>
          (["before", "after"] as const).map((k) =>
            p[k] === null ? null : p.kind === "anchor-only" ? (
              <rect key={k + i} x={x(i) - 5} y={y(p[k]!) - 5} width={10} height={10} transform={`rotate(45 ${x(i)} ${y(p[k]!)})`}
                fill={k === "after" ? "var(--series-1)" : "var(--series-2)"} stroke="var(--surface-1)" strokeWidth={2} />
            ) : (
              <circle key={k + i} cx={x(i)} cy={y(p[k]!)} r={5}
                fill={p.arm === "sham" ? "var(--surface-1)" : k === "after" ? "var(--series-1)" : "var(--series-2)"}
                stroke={p.arm === "sham" ? (k === "after" ? "var(--series-1)" : "var(--series-2)") : "var(--surface-1)"} strokeWidth={2} />
            ),
          ),
        )}
        {last && last.after !== null && <text x={x(n - 1) + 8} y={y(last.after) + 4} fontSize="12" fill="var(--text-secondary)">after {last.after}</text>}
        {last && last.before !== null && <text x={x(n - 1) + 8} y={y(last.before) + 4} fontSize="12" fill="var(--text-secondary)">before {last.before}</text>}
        {points.map((p, i) => (
          <rect key={"hit" + i} x={x(i) - 14} y={P.t} width={28} height={H - P.t - P.b} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
        {points.map((_, i) => <text key={"x" + i} x={x(i)} y={H - 6} fontSize="11" textAnchor="middle" fill="var(--text-muted)">{i + 1}</text>)}
      </svg>
      <div className="muted" style={{ fontSize: "0.85rem", minHeight: "1.3em" }}>
        {hover !== null
          ? `Rep ${hover + 1} (${points[hover].kind}, ${points[hover].arm}): ${points[hover].before ?? "—"} → ${points[hover].after ?? "—"}`
          : "Hover a rep for its numbers."}
      </div>
    </div>
  );
}

export function ProgressScreen({
  profile,
  sessions,
  seeded,
  onImOff,
}: {
  profile: ProfileV2;
  /** Every session shown for this profile, oldest first. */
  sessions: RepSession[];
  /** How many of them are the seeded demo history (shown, never stored). */
  seeded: number;
  onImOff(): void;
}) {
  const [table, setTable] = useState(false);
  const state = profile.states[0];
  const mine = sessions.filter((s) => s.stateId === state.id);
  const prog = progressFor(mine, state.id);
  const cue = prog.recovery.cue;
  const sham = prog.recovery.sham;
  const status =
    prog.nextStep === "installed"
      ? null
      : state.anchorStep === null
        ? "No anchor step yet"
        : prog.nextStep === "anchor-test"
          ? "Ready for an anchor-only test"
          : `Conditioning: ${prog.goodRepsNeeded} more good rep${prog.goodRepsNeeded === 1 ? "" : "s"} before the anchor test`;

  return (
    <section className="grid">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>Progress · {state.label}</h1>
          <p className="lede">We measure it; we don't claim it. Sham trials hold the cue back so the comparison means something.</p>
        </div>
        {status === null ? (
          <span className="installed" role="status">✓ Installed: the anchor alone brings it back</span>
        ) : (
          <span className="status-pill" role="status">○ {status}</span>
        )}
      </div>

      <div className="row" style={{ gap: 16, alignItems: "stretch" }}>
        <div className="card stat"><span className="v">{prog.reps}</span><span className="l">reps ({prog.goodReps} good, {prog.anchorOnlyStreak} anchor-only passes in a row)</span></div>
        <div className="card stat"><span className="v">{prog.latest ?? "—"}</span><span className="l">latest rating after a rep (best {prog.best ?? "—"})</span></div>
        <div className="card stat"><span className="v">{cue.medianSeconds ?? "—"}s</span><span className="l">back to your on-state with the cue (median of {cue.n})</span></div>
        <div className="card stat"><span className="v">{sham.medianSeconds ?? "—"}s</span><span className="l">cue held back, sham (median of {sham.n})</span></div>
        {state.test && <div className="card stat"><span className="v">{state.test.before} → {state.test.after}</span><span className="l">onboarding test after recode</span></div>}
      </div>

      <div className="card row">
        <button className="primary big" onClick={onImOff}>I'm off</button>
        <span className="muted">Drifted from “{state.label}”? Start a rep now.</span>
        <span className="note">Live sensing comes later: recovery times appear once a heart-rate source can measure them.</span>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h2>Intensity, before and after each rep</h2>
          <button onClick={() => setTable((t) => !t)}>{table ? "Show chart" : "Show table"}</button>
        </div>
        {table ? (
          <table>
            <thead><tr><th>Rep</th><th>Kind</th><th>Arm</th><th className="num">Before</th><th className="num">After</th><th className="num">Recovery (s)</th><th>Ended</th></tr></thead>
            <tbody>
              {mine.map((s, i) => (
                <tr key={s.id}><td>{i + 1}</td><td>{s.kind}</td><td>{s.arm}</td><td className="num">{s.intensityBefore ?? "—"}</td><td className="num">{s.intensityAfter ?? "—"}</td><td className="num">{s.recoverySeconds ?? "—"}</td><td>{s.endedBy}</td></tr>
              ))}
            </tbody>
          </table>
        ) : (
          <IntensityChart points={mine.map((s) => ({ repIndex: s.repIndex, before: s.intensityBefore, after: s.intensityAfter, arm: s.arm, kind: s.kind }))} />
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {seeded > 0
          ? `The first ${seeded} reps are the sample profile's seeded history. Your reps are logged in this browser on top of it.`
          : "Your reps are logged in this browser, in the same log the voice guide at “/” uses."}
      </p>
    </section>
  );
}

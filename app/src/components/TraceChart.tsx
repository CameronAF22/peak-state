import { useEffect, useRef, useState } from "react";
import type { CalibrationSummary, SignalFrame } from "../contracts";

const WINDOW_S = 60;
const PAD = { l: 36, r: 12, t: 10, b: 22 };

interface Props {
  frames: SignalFrame[];
  peak: CalibrationSummary | null;
  contrast: CalibrationSummary | null;
  /** Times (epoch ms) to mark with a vertical rule, e.g. detections. */
  markers?: number[];
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Live heart-rate trace with the person's own on (peak) and off (contrast) bands. */
export function TraceChart({ frames, peak, contrast, markers = [] }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; f: SignalFrame } | null>(null);

  const visible = frames.slice(-WINDOW_S);
  const tEnd = visible.length ? visible[visible.length - 1].t : 0;
  const tStart = tEnd - (WINDOW_S - 1) * 1000;
  const lo = Math.floor(Math.min(...[peak, contrast].filter(Boolean).map((c) => c!.stats.hr.mean - 3 * c!.stats.hr.sd), 60) / 5) * 5;
  const hi = Math.ceil(Math.max(...[peak, contrast].filter(Boolean).map((c) => c!.stats.hr.mean + 3 * c!.stats.hr.sd), 90) / 5) * 5;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const x = (t: number) => PAD.l + ((t - tStart) / ((WINDOW_S - 1) * 1000)) * (w - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (h - PAD.t - PAD.b);

    // Recessive grid and axis labels.
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = cssVar(canvas, "--text-muted");
    ctx.strokeStyle = cssVar(canvas, "--border");
    ctx.lineWidth = 1;
    for (let v = lo; v <= hi; v += 10) {
      ctx.beginPath();
      ctx.moveTo(PAD.l, y(v));
      ctx.lineTo(w - PAD.r, y(v));
      ctx.stroke();
      ctx.fillText(String(v), 4, y(v) + 4);
    }
    ctx.fillText("bpm", 4, PAD.t + 2);
    ctx.fillText("last 60 s", w - PAD.r - 52, h - 6);

    // Bands: mean ± 2 sd of each calibration.
    const band = (c: CalibrationSummary | null, fill: string, label: string) => {
      if (!c) return;
      const top = y(c.stats.hr.mean + 2 * c.stats.hr.sd);
      const bot = y(c.stats.hr.mean - 2 * c.stats.hr.sd);
      ctx.fillStyle = fill;
      ctx.fillRect(PAD.l, top, w - PAD.l - PAD.r, bot - top);
      ctx.fillStyle = cssVar(canvas, "--text-secondary");
      ctx.fillText(label, PAD.l + 6, top + 13);
    };
    band(peak, cssVar(canvas, "--band-peak"), "your on-state");
    band(contrast, cssVar(canvas, "--band-contrast"), "your stuck state");

    // Detection markers.
    ctx.strokeStyle = cssVar(canvas, "--series-2");
    ctx.setLineDash([4, 4]);
    for (const m of markers) {
      if (m < tStart || m > tEnd) continue;
      ctx.beginPath();
      ctx.moveTo(x(m), PAD.t);
      ctx.lineTo(x(m), h - PAD.b);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // HR line, 2px.
    const pts = visible.filter((f) => f.hr !== null);
    if (pts.length > 1) {
      ctx.strokeStyle = cssVar(canvas, "--series-1");
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      pts.forEach((f, i) => (i ? ctx.lineTo(x(f.t), y(f.hr!)) : ctx.moveTo(x(f.t), y(f.hr!))));
      ctx.stroke();
      const last = pts[pts.length - 1];
      ctx.fillStyle = cssVar(canvas, "--series-1");
      ctx.beginPath();
      ctx.arc(x(last.t), y(last.hr!), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hover) {
      ctx.strokeStyle = cssVar(canvas, "--text-muted");
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x(hover.f.t), PAD.t);
      ctx.lineTo(x(hover.f.t), h - PAD.b);
      ctx.stroke();
    }
  }, [visible, peak, contrast, markers, lo, hi, tStart, tEnd, hover]);

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const t = tStart + ((px - PAD.l) / (rect.width - PAD.l - PAD.r)) * (WINDOW_S - 1) * 1000;
    let best: SignalFrame | null = null;
    for (const f of visible) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
    setHover(best ? { x: px, y: e.clientY - rect.top, f: best } : null);
  };

  const last = visible[visible.length - 1];
  return (
    <div className="grid" style={{ gap: 8 }}>
      <div className="chart-wrap">
        <canvas
          ref={ref}
          role="img"
          aria-label={`Heart rate, last 60 seconds. Now ${last?.hr ?? "no signal"} bpm.`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        />
        {hover && (
          <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
            {hover.f.hr ?? "—"} bpm · {Math.round((hover.f.t - tEnd) / 1000)} s · {hover.f.scenarioStep ?? hover.f.source}
          </div>
        )}
      </div>
      <div className="legend">
        <span><span className="sw" style={{ background: "var(--series-1)" }} />Heart rate</span>
        <span><span className="sw" style={{ background: "var(--band-peak)", border: "1px solid var(--series-3)" }} />Your on-state (peak recall)</span>
        <span><span className="sw" style={{ background: "var(--band-contrast)", border: "1px solid var(--series-2)" }} />Your stuck state (contrast recall)</span>
      </div>
    </div>
  );
}

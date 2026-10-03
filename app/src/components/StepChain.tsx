import type { StrategyStep } from "../contracts";
import { stepCode } from "../contracts";

const MODALITY_WORD: Record<string, string> = {
  visual: "picture",
  auditory: "sound",
  kinesthetic: "feeling",
  olfactory: "smell",
  gustatory: "taste",
};

export function StepChain({
  steps,
  activeIndex,
  anchorStep,
  placeholder = true,
}: {
  steps: StrategyStep[];
  activeIndex?: number | null;
  anchorStep?: number | null;
  placeholder?: boolean;
}) {
  return (
    <div className="chain" aria-label={`Strategy: ${steps.map(stepCode).join(", then ") || "no steps yet"}`}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "contents" }}>
          {i > 0 && <span className="arrow" aria-hidden>→</span>}
          <div className={`chip${i === activeIndex ? " active" : ""}`}>
            <div>
              <span className="code">{stepCode(s)}</span>
              <span className="muted" style={{ fontSize: "0.75rem", marginLeft: 6 }}>
                {s.direction} {MODALITY_WORD[s.modality]}
              </span>
              {anchorStep === i && <span className="anchor">★ anchor</span>}
            </div>
            <div className="content">{s.content}</div>
          </div>
        </div>
      ))}
      {placeholder && (
        <>
          {steps.length > 0 && <span className="arrow" aria-hidden>→</span>}
          <div className="chip empty">{steps.length ? "next step…" : "first step…"}</div>
        </>
      )}
    </div>
  );
}

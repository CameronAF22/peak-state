import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Question, StepView } from "@peak-state/onboarding";
import { chain, chainOf, SUBMODALITIES, type ModuleHost, type ProfileV2, type StepHead } from "../contracts";
import { StepChain } from "../components/StepChain";
import { EMPTY_VIEW, reduce, type OnboardView } from "../onboardView";
import { createAnswerChannel, type AppOnboardingModule } from "../slots";
import { saveConfirmed, savedStrategy } from "../store";

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

/** The harness at the site root: the full voice guide that captures and saves a strategy. */
export const HARNESS_URL = "/";

type Run = "engine" | "script";

interface ChecklistRow {
  label: string;
  value: string | number | null;
}

/** The checklist for the step being asked about: the engine's own rows, or the core attributes from the events. */
function checklist(view: OnboardView, live: StepView[], question: Question | null): { index: number; rows: ChecklistRow[] } | null {
  if (live.length) {
    const index = question?.target?.stepIndex ?? live.length - 1;
    const step = live[index];
    return step ? { index, rows: step.checklist.map((c) => ({ label: c.label, value: c.value })) } : null;
  }
  if (view.activeIndex === null) return null;
  const step = view.steps[view.activeIndex];
  if (!step || step.modality === "other") return null;
  const core = (step.submodalities as { core?: Record<string, string | number> }).core ?? {};
  const keys = Object.keys(SUBMODALITIES[step.modality].core);
  return { index: view.activeIndex, rows: keys.map((k) => ({ label: KEY_LABEL[k] ?? k, value: core[k] ?? null })) };
}

export function OnboardScreen({
  host,
  registerStop,
  onboarding,
  scripted,
  onDone,
  onUseSample,
}: {
  host: ModuleHost;
  registerStop(h: () => void): () => void;
  onboarding: AppOnboardingModule;
  scripted: AppOnboardingModule;
  onDone(p: ProfileV2): void;
  onUseSample(): void;
}) {
  const saved = useMemo(savedStrategy, []);
  const [view, setView] = useState<OnboardView>(EMPTY_VIEW);
  const [running, setRunning] = useState<Run | null>(null);
  const [ran, setRan] = useState<Run | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [live, setLive] = useState<StepView[]>([]);
  const [typed, setTyped] = useState("");
  const channel = useRef(createAnswerChannel());
  const abort = useRef<AbortController | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [view.turns]);

  const start = async (kind: Run) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const unregister = registerStop(() => ctl.abort());
    setView(EMPTY_VIEW);
    setQuestion(null);
    setLive([]);
    setRunning(kind);
    setRan(kind);
    try {
      const result = await (kind === "engine" ? onboarding : scripted).run(host, {
        mode: kind === "script" ? "script" : host.speech.muted ? "typed" : "voice",
        signal: ctl.signal,
        answers: channel.current,
        onEvent: (e) => setView((v) => reduce(v, e)),
        onQuestion: (q, steps) => {
          setQuestion(q);
          setLive(steps.filter((s) => s.content.length > 0));
        },
      });
      // A strategy confirmed here is saved the way the harness saves one, so "/" and /demo/ share it.
      if (result.status === "confirmed" && kind === "engine") saveConfirmed(result.profile);
      if (result.status === "stopped" && result.reason === "safety") host.onSafetyStop("safety");
    } finally {
      unregister();
      setRunning(null);
    }
  };

  const send = (e: FormEvent) => {
    e.preventDefault();
    const text = typed.trim();
    if (!text) return;
    channel.current.push({ kind: "answer", answer: { text, via: "typed" } });
    setTyped("");
  };

  const steps: StepHead[] = live.length ? live : view.steps;
  const liveAnchor = live.findIndex((s) => s.isAnchor);
  const anchorStep = live.length ? (liveAnchor >= 0 ? liveAnchor : null) : view.anchorStep;
  const active = checklist(view, live, question);
  const drivers = new Set(view.drivers);
  const idle = running === null && !view.confirmed;
  const savedState = saved?.profile.states[0];

  return (
    <section>
      <h1>Find your state</h1>
      <p className="lede">
        One state you choose, in your own words. Peak State learns the steps you already run to get there, then helps you practise them.
      </p>

      {idle && saved && savedState && (
        <div className="card grid" style={{ marginBottom: 16, gap: 8 }}>
          <h2>
            Your saved strategy: “{savedState.label}”{" "}
            <span className="muted" style={{ fontWeight: 400 }}>{chain(savedState)}</span>
          </h2>
          <StepChain steps={savedState.strategy.steps} anchorStep={savedState.anchorStep} placeholder={false} />
          <div className="row">
            <button className="primary big" onClick={() => onDone(saved.profile)}>Practise this strategy →</button>
            <span className="muted" style={{ fontSize: "0.85rem" }}>Saved {new Date(saved.savedAt).toLocaleString()}.</span>
          </div>
        </div>
      )}

      {idle && (
        <div className="row" style={{ marginBottom: 16 }}>
          <a className="button" href={HARNESS_URL}>Capture my strategy with the voice guide ↗</a>
          <button className={saved ? "" : "primary"} onClick={() => start("engine")}>Answer the questions here</button>
          <button onClick={() => start("script")}>Watch the scripted demo</button>
          <button onClick={onUseSample}>Use sample profile</button>
        </div>
      )}

      {running && (
        <div className="row" style={{ marginBottom: 16 }}>
          <button onClick={() => abort.current?.abort()}>Cancel</button>
          {view.calibrated.length > 0 && <span className="window-pill">calibrated: {view.calibrated.join(", ")}</span>}
        </div>
      )}

      {(running || ran) && (
        <div className="grid two">
          <div className="grid" style={{ alignContent: "start" }}>
            <div className="card">
              <h2>Conversation</h2>
              <div className="transcript" ref={transcriptRef} aria-live="polite">
                {view.turns.length === 0 && <p className="muted">The transcript appears here as you answer.</p>}
                {view.turns.map((t, i) => (
                  <div key={i} className={`turn ${t.who}${t.final ? "" : " interim"}`}>
                    {t.section && <span className="sec">§ {t.section}</span>}
                    {t.text}
                  </div>
                ))}
              </div>
            </div>

            {running === "engine" && question && (
              <div className="card grid" style={{ gap: 10 }}>
                <div>{question.text}</div>
                {question.choices.length > 0 && (
                  <div className="choices" role="group" aria-label="Quick answers">
                    {question.choices.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => channel.current.push({ kind: "answer", answer: { text: c.label, via: "choice", choiceValue: c.value } })}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
                <form className="answer-form" onSubmit={send}>
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={`In your own words, e.g. “${question.suggestions[0]}”`}
                    aria-label="Your answer"
                    autoFocus
                  />
                  <button className="primary" type="submit">Answer</button>
                  <button type="button" onClick={() => channel.current.push({ kind: "back" })}>Back</button>
                </form>
                {!host.speech.muted && <span className="muted" style={{ fontSize: "0.85rem" }}>Voice is on: you can also say your answer.</span>}
              </div>
            )}
          </div>

          <div className="grid" style={{ alignContent: "start" }}>
            <div className="card">
              <h2>
                {view.label ? <>“{view.label}”</> : "Your state"}
                {steps.length > 0 && <span className="muted" style={{ fontWeight: 400, marginLeft: 8 }}>{chainOf(steps)}</span>}
              </h2>
              {view.words && view.words !== view.label && <p className="muted" style={{ marginTop: 0 }}>{view.words}</p>}
              <StepChain steps={steps} activeIndex={running ? active?.index ?? null : null} anchorStep={anchorStep} placeholder={!view.confirmed} />
            </div>

            {active && running && (
              <div className="card">
                <h2>Step {active.index + 1}: how it's represented</h2>
                <ul className="checklist">
                  {active.rows.map((r) => (
                    <li key={r.label} className={r.value !== null ? "done" : ""}>
                      <span className="tick">{r.value !== null ? "✓" : "○"}</span>
                      <span>{r.label}</span>
                      <span className="val">{r.value ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {view.drivers.length > 0 && (
              <div className="card">
                <h2>
                  What makes the difference
                  {view.contrastLabel && <span className="muted" style={{ fontWeight: 400 }}> vs “{view.contrastLabel}”</span>}
                </h2>
                <ul className="checklist">
                  {view.differences.map((d, i) =>
                    d ? (
                      <li key={i} className={drivers.has(i) ? "done" : ""}>
                        <span className="tick">{drivers.has(i) ? "★" : "·"}</span>
                        <span>
                          {d.attribute}: {String(d.peak)} vs {String(d.contrast)}
                        </span>
                        <span className="val">{d.ratingDelta === null ? "" : `+${d.ratingDelta}`}</span>
                      </li>
                    ) : null,
                  )}
                </ul>
                <p className="hypothesis">★ drivers are hypotheses to test with you, not facts. Filled in from a rehearsal.</p>
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
              <div className="card grid" style={{ gap: 8 }}>
                {ran === "engine" && <p className="muted" style={{ margin: 0 }}>Saved. The voice guide at “/” sees the same strategy.</p>}
                <div className="row">
                  <button className="primary big" onClick={() => onDone(view.confirmed!)}>Practise it now →</button>
                  <button
                    onClick={() => {
                      setRan(null);
                      setView(EMPTY_VIEW);
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

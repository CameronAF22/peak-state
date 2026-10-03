import { useCallback, useMemo, useRef, useState } from "react";
import type { DetectionEvent, ProfileV2, RepSession } from "./contracts";
import { demoProfile, demoRepLog } from "./fixtures";
import { createHost, stopSpeaking } from "./host";
import { resolveModules } from "./modules";
import { SafetyFooter, SAFETY_LINE } from "./components/SafetyFooter";
import { OnboardScreen } from "./screens/Onboard";
import { CalibrateScreen } from "./screens/Calibrate";
import { LiveScreen } from "./screens/Live";
import { RepScreen } from "./screens/Rep";
import { ProgressScreen } from "./screens/Progress";

export const SCREENS = ["onboard", "calibrate", "live", "rep", "progress"] as const;
export type Screen = (typeof SCREENS)[number];

const LABELS: Record<Screen, string> = {
  onboard: "Onboard",
  calibrate: "Calibrate",
  live: "Live",
  rep: "Rep",
  progress: "Progress",
};

function initialScreen(): Screen {
  const s = new URLSearchParams(location.search).get("screen");
  return (SCREENS as readonly string[]).includes(s ?? "") ? (s as Screen) : "onboard";
}

export function App() {
  const modules = useMemo(() => resolveModules(location.search), []);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [profile, setProfile] = useState<ProfileV2 | null>(() => (initialScreen() === "onboard" ? null : demoProfile()));
  const [sessions, setSessions] = useState<RepSession[]>(() => demoRepLog());
  const [detection, setDetection] = useState<DetectionEvent | null>(null);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(true);
  const [stopped, setStopped] = useState<string | null>(null);
  // Bumped on Stop so every running screen unmounts and cancels its module.
  const [runId, setRunId] = useState(0);
  const stopHandlers = useRef(new Set<() => void>());

  const stopAll = useCallback((reason: string) => {
    for (const h of stopHandlers.current) h();
    stopHandlers.current.clear();
    stopSpeaking();
    setStopped(reason);
    setRunId((n) => n + 1);
  }, []);

  const host = useMemo(() => createHost({ speed, muted, onSafetyStop: stopAll }), [speed, muted, stopAll]);
  const registerStop = useCallback((h: () => void) => {
    stopHandlers.current.add(h);
    return () => stopHandlers.current.delete(h);
  }, []);

  const go = (s: Screen) => {
    if (s !== "onboard" && !profile) setProfile(demoProfile());
    setStopped(null);
    setScreen(s);
  };

  const active = profile ?? demoProfile();
  const stateId = active.states[0].id;
  const shared = { host, registerStop };
  const k = `${screen}-${runId}-${speed}-${muted}`;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Peak State</span>
        <nav className="steps" aria-label="Steps">
          {SCREENS.map((s, i) => (
            <button key={s} aria-current={s === screen && !stopped ? "step" : undefined} onClick={() => go(s)}>
              {i + 1} · {LABELS[s]}
            </button>
          ))}
        </nav>
        <div className="demo-controls">
          <label>
            Speed{" "}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
              <option value={10}>10×</option>
            </select>
          </label>
          <label>
            <input type="checkbox" checked={!muted} onChange={(e) => setMuted(!e.target.checked)} /> Voice
          </label>
          {(["onboarding", "sensing", "reps"] as const).map((m) => (
            <span key={m} className="badge" title={`${m} module in use`}>
              {m}: {modules.using[m]}
            </span>
          ))}
        </div>
      </header>

      <main>
        {stopped ? (
          <section className="stopped card" aria-live="polite">
            <h1>Stopped</h1>
            <p>{SAFETY_LINE}</p>
            <p className="muted">
              {stopped === "safety"
                ? "The guide stopped because something you said sounded hard. Please reach out to a person you trust."
                : "Nothing else will run until you choose to go on."}
            </p>
            <button onClick={() => go(screen)}>Go back to {LABELS[screen]}</button>
          </section>
        ) : screen === "onboard" ? (
          <OnboardScreen
            key={k}
            {...shared}
            onboarding={modules.onboarding}
            onDone={(p) => {
              setProfile(p);
              go("calibrate");
            }}
            onUseSample={() => {
              setProfile(demoProfile());
              go("calibrate");
            }}
          />
        ) : screen === "calibrate" ? (
          <CalibrateScreen key={k} {...shared} profile={active} onNext={() => go("live")} />
        ) : screen === "live" ? (
          <LiveScreen
            key={k}
            {...shared}
            profile={active}
            stateId={stateId}
            sensing={modules.sensing}
            onDetection={(e) => {
              setDetection(e);
              go("rep");
            }}
          />
        ) : screen === "rep" ? (
          <RepScreen
            key={k}
            {...shared}
            profile={active}
            stateId={detection?.targetStateId ?? stateId}
            detection={detection}
            reps={modules.reps}
            nextRepIndex={sessions.filter((s) => s.stateId === stateId).length}
            onDone={(s) => {
              setSessions((prev) => [...prev, s]);
              setDetection(null);
            }}
            onProgress={() => go("progress")}
          />
        ) : (
          <ProgressScreen profile={active} sessions={sessions} reps={modules.reps} onReset={() => setSessions(demoRepLog())} />
        )}
      </main>

      <SafetyFooter onStop={() => stopAll("user")} />
    </div>
  );
}

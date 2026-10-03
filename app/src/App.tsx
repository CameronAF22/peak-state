import { useCallback, useMemo, useRef, useState } from "react";
import type { DetectionEvent, ProfileV2, RepSession } from "./contracts";
import { demoProfile, demoRepLog } from "./fixtures";
import { createHost, stopSpeaking } from "./host";
import { resolveModules } from "./modules";
import { logRun, runsForProfile, savedStrategy } from "./store";
import { SafetyFooter, SAFETY_LINE } from "./components/SafetyFooter";
import { OnboardScreen } from "./screens/Onboard";
import { CalibrateScreen } from "./screens/Calibrate";
import { LiveScreen } from "./screens/Live";
import { IM_OFF, RepScreen, type RepStart } from "./screens/Rep";
import { ProgressScreen } from "./screens/Progress";

/** The person-facing flow at /demo/ (D-onboarding-023). Calibrate and Live wait for sensing; ?screen= still opens them. */
export const FLOW = ["onboard", "rep", "progress"] as const;
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

/** Outside onboarding, the screens need a profile: the saved strategy if there is one, else the sample. */
function defaultProfile(): ProfileV2 {
  return savedStrategy()?.profile ?? demoProfile();
}

const SAMPLE_ID = demoProfile().profileId;

export function App() {
  const modules = useMemo(() => resolveModules(location.search), []);
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const [profile, setProfile] = useState<ProfileV2 | null>(() => (initialScreen() === "onboard" ? null : defaultProfile()));
  const [logged, setLogged] = useState<RepSession[]>(() => (profile ? runsForProfile(profile.profileId) : []));
  const [detection, setDetection] = useState<DetectionEvent | null>(null);
  const [autoStart, setAutoStart] = useState<RepStart | null>(null);
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
    setAutoStart(null);
    setDetection(null);
    setStopped(reason);
    setRunId((n) => n + 1);
  }, []);

  const host = useMemo(() => createHost({ speed, muted, onSafetyStop: stopAll }), [speed, muted, stopAll]);
  const registerStop = useCallback((h: () => void) => {
    stopHandlers.current.add(h);
    return () => stopHandlers.current.delete(h);
  }, []);

  const choose = (p: ProfileV2) => {
    setProfile(p);
    setLogged(runsForProfile(p.profileId));
  };

  const go = (s: Screen, chosen?: ProfileV2) => {
    if (chosen) choose(chosen);
    else if (s !== "onboard" && !profile) choose(defaultProfile());
    if (s !== "rep") {
      setAutoStart(null);
      setDetection(null);
    }
    setStopped(null);
    setScreen(s);
  };

  const active = profile ?? demoProfile();
  const stateId = active.states[0].id;
  const seeded = active.profileId === SAMPLE_ID ? demoRepLog() : [];
  const sessions = [...seeded, ...logged];
  const shared = { host, registerStop };
  const k = `${screen}-${runId}-${speed}-${muted}`;
  const steps: readonly Screen[] = (FLOW as readonly Screen[]).includes(screen) ? FLOW : [...FLOW, screen];

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Peak State</span>
        <nav className="steps" aria-label="Steps">
          {steps.map((s, i) => (
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
          {(["onboarding", "reps", "sensing"] as const).map((m) => (
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
            scripted={modules.scriptedOnboarding}
            onDone={(p) => go("rep", p)}
            onUseSample={() => go("rep", demoProfile())}
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
              setStopped(null);
              setScreen("rep");
            }}
          />
        ) : screen === "rep" ? (
          <RepScreen
            key={k}
            {...shared}
            profile={active}
            stateId={detection?.stateId ?? stateId}
            sessions={sessions}
            detection={detection}
            autoStart={autoStart}
            reps={modules.reps}
            onDone={(s) => {
              logRun(s);
              setLogged((prev) => [...prev, s]);
              setDetection(null);
              setAutoStart(null);
            }}
            onProgress={() => go("progress")}
          />
        ) : (
          <ProgressScreen
            key={k}
            profile={active}
            sessions={sessions}
            seeded={seeded.length}
            onImOff={() => {
              setAutoStart(IM_OFF);
              go("rep");
            }}
          />
        )}
      </main>

      <SafetyFooter onStop={() => stopAll("user")} />
    </div>
  );
}

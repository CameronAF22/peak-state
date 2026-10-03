#!/usr/bin/env python3
"""Regenerate every fixture in contracts/fixtures/ from one demo story, so they stay consistent.

    python3 contracts/fixtures/_generate.py

Deterministic: no clocks, no randomness. Edit the story here, never the JSON by hand.
The story: Ada chooses "calm before a pitch". Her strategy is Ve -> Ai -> Ki. Contrast and drivers
are pre-filled from a rehearsal (D-onboarding-010). The simulator drifts from peak toward contrast,
the gate opens, reps run, and after 5 good reps two anchor-only passes mark the state installed (D-reps-003).
"""

import copy
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
T0 = datetime(2026, 10, 3, 15, 0, 0, tzinfo=timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def ms(dt):
    return int(dt.timestamp() * 1000)


def write(name, data):
    path = HERE / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


STATE_ID = "calm-before-pitch"
PROFILE_ID = "profile_demo_ada"

CAL_PEAK = {
    "stateId": STATE_ID, "phase": "peak", "source": "simulator",
    "hr": {"mean": 68.2, "sd": 2.1}, "lnRmssd": {"mean": 3.95, "sd": 0.12},
    "windows": 5, "seconds": 40, "quality": "ok", "speechExcludedSeconds": 8,
    "recordedAt": iso(T0 + timedelta(seconds=40)), "rating": 8,
}
CAL_CONTRAST = {
    "stateId": STATE_ID, "phase": "contrast", "source": "simulator",
    "hr": {"mean": 79.5, "sd": 3.0}, "lnRmssd": {"mean": 3.45, "sd": 0.15},
    "windows": 3, "seconds": 24, "quality": "ok", "speechExcludedSeconds": 4,
    "recordedAt": iso(T0 + timedelta(seconds=70)), "rating": 3,
    "separability": {"separable": True, "hr": 4.36, "lnRmssd": 3.68},
}

STEPS = [
    {
        "modality": "visual", "direction": "external",
        "content": "the first face in the room looking up at me",
        "submodalities": {
            "core": {"location": "center", "size": "life-size", "distance": "close", "brightness": "bright", "perspective": "associated"},
            "extended": {"motion": "movie"},
            "words": {"distance": "right there, like across a table"},
        },
        "anchorDetail": {"kind": "scene", "caption": "The first face looking up", "details": ["warm window light", "a coffee cup on the table"]},
    },
    {
        "modality": "auditory", "direction": "internal",
        "content": "'here we go, slow'",
        "submodalities": {
            "core": {"source": "my own voice", "volume": "quiet", "location": "inside-head"},
            "extended": {"tempo": "slow"},
        },
    },
    {
        "modality": "kinesthetic", "direction": "internal",
        "content": "warmth spreading through my chest",
        "submodalities": {
            "core": {"bodyLocation": "chest", "intensity": 8, "movement": "moving"},
            "extended": {"temperature": "warm", "direction": "spreading"},
        },
    },
]

CONTRAST = {
    "label": "stuck on a small email",
    "submodalities": {
        "visual": {"core": {"location": "lower-left", "size": "small", "distance": "far", "brightness": "dim", "perspective": "dissociated"}},
        "auditory": {"core": {"source": "my own voice", "volume": "loud", "location": "inside-head"}, "extended": {"tempo": "fast"}},
        "kinesthetic": {"core": {"bodyLocation": "stomach", "intensity": 3, "movement": "still"}},
    },
    "prefilled": True,
}

# (stepIndex, modality, attribute, peak, contrast, ratingDelta)
DIFFS = [
    (0, "visual", "location", "center", "lower-left", 1),
    (0, "visual", "size", "life-size", "small", 1),
    (0, "visual", "distance", "close", "far", 3),
    (0, "visual", "brightness", "bright", "dim", 2),
    (0, "visual", "perspective", "associated", "dissociated", 1),
    (1, "auditory", "volume", "quiet", "loud", 2),
    (1, "auditory", "tempo", "slow", "fast", 1),
    (2, "kinesthetic", "movement", "moving", "still", 1),
]
DIFFERENCES = [
    {"stepIndex": s, "modality": m, "attribute": a, "peak": p, "contrast": c, "ratingDelta": d} for s, m, a, p, c, d in DIFFS
]
DRIVERS = [2, 3, 5]  # distance, brightness, volume: largest ratingDelta first


def demo_state():
    return {
        "id": STATE_ID,
        "label": "calm before a pitch",
        "words": "Like the room is already mine and there's no rush",
        "memoryCue": "the Berlin demo",
        "leverage": "So I stop rushing the part that matters",
        "strategy": {"steps": copy.deepcopy(STEPS), "fullyInAt": 2, "confirmed": True},
        "anchorStep": 0,
        "contrast": copy.deepcopy(CONTRAST),
        "differences": copy.deepcopy(DIFFERENCES),
        "drivers": list(DRIVERS),
        "recode": {"appliedDrivers": list(DRIVERS)},
        "test": {"before": 3, "after": 7},
        "futurePace": {"situation": "Thursday's board pitch"},
        "calibration": {"peak": copy.deepcopy(CAL_PEAK), "contrast": copy.deepcopy(CAL_CONTRAST)},
    }


def demo_profile():
    return {
        "schemaVersion": 2,
        "profileId": PROFILE_ID,
        "displayName": "Ada",
        "createdAt": iso(T0),
        "confirmedAt": iso(T0 + timedelta(seconds=95)),
        "states": [demo_state()],
    }


def three_states_profile():
    """The next-version shape: three states, so 1..3 is exercised now."""
    p = demo_profile()
    p["profileId"] = "profile_demo_three"

    s2 = {
        "id": "playful-with-kids", "label": "playful with my kids", "words": "Silly and light, nothing to prove",
        "memoryCue": "the pillow fort", "leverage": None,
        "strategy": {"steps": [
            {"modality": "auditory", "direction": "external", "content": "their laughing",
             "submodalities": {"core": {"source": "the kids", "volume": "loud", "location": "all-around"}},
             "anchorDetail": {"kind": "song", "title": "Here Comes the Sun", "artist": "The Beatles", "moment": "the first 'little darling'"}},
            {"modality": "kinesthetic", "direction": "internal", "content": "a bounce in my legs",
             "submodalities": {"core": {"bodyLocation": "legs", "intensity": 7, "movement": "moving"}, "extended": {"rhythm": "pulsing"}}},
        ], "fullyInAt": 1, "confirmed": True},
        "anchorStep": 0, "contrast": None, "differences": [], "drivers": [],
        "recode": None, "test": None, "futurePace": None,
        "calibration": {"peak": None, "contrast": None},
    }
    s3 = {
        "id": "confident", "label": "confident", "words": "I already know the answer",
        "strategy": {"steps": [
            {"modality": "kinesthetic", "direction": "internal", "content": "feet planted, chest open",
             "submodalities": {"core": {"bodyLocation": "feet", "intensity": 6, "movement": "still"}},
             "anchorDetail": {"kind": "body", "gesture": "press thumb and forefinger together"}},
            {"modality": "visual", "direction": "internal", "content": "the finish line photo",
             "submodalities": {"core": {"distance": "close", "brightness": "bright"}}},
            {"modality": "other", "direction": "external", "content": "the smell of the track",
             "submodalities": {"words": {"smell": "rubber and cut grass"}}},
        ], "fullyInAt": 2, "confirmed": True},
        "anchorStep": 0, "contrast": None, "differences": [], "drivers": [],
        "recode": None, "test": None, "futurePace": None,
        "calibration": {"peak": None, "contrast": None},
    }
    p["states"] += [s2, s3]
    return p


def draft_profile():
    """Stopped (cancel) after section 1: steps captured, not yet confirmed; later sections null."""
    s = demo_state()
    s["strategy"] = {"steps": copy.deepcopy(STEPS), "fullyInAt": 2, "confirmed": False}
    for k in ("anchorStep", "contrast", "recode", "test", "futurePace"):
        s[k] = None
    s["differences"], s["drivers"] = [], []
    s["calibration"] = {"peak": copy.deepcopy(CAL_PEAK), "contrast": None}
    return {"schemaVersion": 2, "profileId": PROFILE_ID, "displayName": "Ada", "createdAt": iso(T0), "confirmedAt": None, "states": [s]}


# ── frames: peak baseline -> drift toward contrast -> recovery after the rep ──────────────

LIVE0 = T0 + timedelta(minutes=10)
RMSSD_PEAK = math.exp(3.95)  # ~51.9 ms
RMSSD_CONTRAST = math.exp(3.45)  # ~31.5 ms


def lerp(a, b, x):
    return a + (b - a) * x


def frames_drift():
    out = []
    segments = [("baseline", 30), ("drift", 40), ("rep", 32), ("recovery", 38)]
    i = 0
    for label, seconds in segments:
        for k in range(seconds):
            if label == "baseline":
                x = 0.0
            elif label == "drift":
                x = min(1.0, (k + 1) / 30)  # reaches contrast after 30 s, holds
            elif label == "rep":
                x = lerp(1.0, 0.5, k / seconds)
            else:
                x = max(0.0, lerp(0.5, 0.0, k / 20))
            wobble = 0.6 * math.sin(i / 3.0)
            hr = round(lerp(68.2, 79.5, x) + wobble, 1)
            rmssd = lerp(RMSSD_PEAK, RMSSD_CONTRAST, x)
            sign = 1 if i % 2 == 0 else -1
            rr = round(60000 / hr + sign * rmssd / 2, 1)
            out.append({"t": ms(LIVE0) + i * 1000, "source": "simulator", "hr": hr, "rr": [rr], "quality": 1.0 if label != "rep" else 0.9, "label": label})
            i += 1
    return out


DETECT_T = LIVE0 + timedelta(seconds=30 + 26)


def detection_drift():
    return {
        "schemaVersion": 1, "id": "det_demo_001", "t": ms(DETECT_T), "kind": "drift", "stateId": STATE_ID,
        "confidence": 0.83,
        "window": {"seconds": 20, "hrMean": 77.9, "rmssd": 33.8, "hrDelta": 9.7, "rmssdDelta": -18.1, "z": 3.2, "position": 0.86},
        "gate": {"consecutiveWindows": 3, "required": 3, "refractorySeconds": 60, "sham": False},
        "calibrationMode": "contrast",
    }


def detection_manual():
    return {
        "schemaVersion": 1, "id": "det_demo_manual_001", "t": ms(LIVE0 + timedelta(minutes=5)), "kind": "manual", "stateId": STATE_ID,
        "confidence": 1.0, "window": None,
        "gate": {"consecutiveWindows": 0, "required": 3, "refractorySeconds": 60, "sham": False},
        "calibrationMode": "contrast",
    }


# ── reps ─────────────────────────────────────────────────────────────────────────────────

SCRIPT_FULL = "sha256:5f1c0a9e7d3b2a41"
SCRIPT_ANCHOR = "sha256:a03be1d47c9f6e22"


def timed(kind, start, planned_ms, **extra):
    end = None if start is None else start + timedelta(milliseconds=planned_ms or 4000)
    step = {"kind": kind, **extra, "plannedMs": planned_ms,
            "startedAt": None if start is None else iso(start), "endedAt": None if end is None else iso(end), "delivered": start is not None}
    return step, end


def full_steps(start):
    plan = [
        ("rate", None, {}),
        ("strategy-step", 8000, {"stepIndex": 0, "driversSpoken": [2, 3]}),
        ("strategy-step", 6000, {"stepIndex": 1, "driversSpoken": [5]}),
        ("strategy-step", 7000, {"stepIndex": 2, "driversSpoken": []}),
        ("leverage", 4000, {}),
        ("anchor-peak", 7000, {"stepIndex": 0, "driversSpoken": [2, 3]}),
        ("rate", None, {}),
    ]
    steps, t = [], start
    for kind, planned, extra in plan:
        step, t = timed(kind, t, planned, **extra)
        steps.append(step)
    return steps, t


def anchor_steps(start):
    steps, t = [], start
    for kind, planned, extra in [("rate", None, {}), ("anchor", 6000, {"stepIndex": 0}), ("rate", None, {})]:
        step, t = timed(kind, t, planned, **extra)
        steps.append(step)
    return steps, t


def sham_steps(start):
    steps, t = [], start
    for _ in range(2):
        step, t = timed("rate", t, None)
        steps.append(step)
    return steps, t


def session(idx, start, *, kind="full", phase=None, trigger=None, arm="cue", before, after,
            recovery=None, censored=False, source="simulator", ended_by="completed"):
    if arm == "sham":
        steps, end = sham_steps(start)
    elif kind == "anchor-only":
        steps, end = anchor_steps(start)
    else:
        steps, end = full_steps(start)
    paired = arm == "cue" and kind == "full" and phase != "recode" and phase != "test"
    return {
        "schemaVersion": 1, "id": f"rep_demo_{idx:03d}", "profileId": PROFILE_ID, "stateId": STATE_ID, "repIndex": idx,
        "kind": kind, "phase": phase, "trigger": trigger or {"kind": "practice"}, "arm": arm,
        "startedAt": iso(start), "endedAt": iso(end), "steps": steps,
        "intensityBefore": before, "intensityAfter": after,
        "recoverySeconds": recovery, "recoveryCensored": censored, "anchorPaired": paired,
        "signalSource": source, "scriptHash": SCRIPT_ANCHOR if kind == "anchor-only" else SCRIPT_FULL, "endedBy": ended_by,
    }


def rep_log():
    onb = {"kind": "onboarding"}
    t = T0 + timedelta(minutes=2)
    day = timedelta(hours=3)
    log = [
        session(0, t, phase="recode", trigger=onb, before=3, after=6, source="none"),
        session(1, t + timedelta(minutes=1), phase="test", trigger=onb, before=3, after=7, source="none"),
        session(2, t + timedelta(minutes=2), phase="future-pace", trigger=onb, before=5, after=8, source="none"),
        session(3, DETECT_T, trigger={"kind": "detection", "detectionId": "det_demo_001"}, before=4, after=8, recovery=41),
        session(4, DETECT_T + day, trigger={"kind": "detection", "detectionId": "det_demo_002"}, arm="sham", before=4, after=5, recovery=80),
        session(5, DETECT_T + 2 * day, trigger={"kind": "manual", "detectionId": "det_demo_manual_001"}, before=3, after=7, recovery=38),
        session(6, DETECT_T + 3 * day, trigger={"kind": "detection", "detectionId": "det_demo_003"}, before=4, after=8, recovery=35),
        session(7, DETECT_T + 4 * day, trigger={"kind": "detection", "detectionId": "det_demo_004"}, arm="sham", before=4, after=4, recovery=None, censored=True),
        session(8, DETECT_T + 5 * day, before=5, after=8),
        session(9, DETECT_T + 6 * day, kind="anchor-only", before=4, after=7),
        session(10, DETECT_T + 7 * day, kind="anchor-only", before=4, after=8),
    ]
    return log


# ── onboarding: the ~90 s scripted stream (sections 1 and 4 live, 2-3 pre-filled) ─────────

def onboarding_events(profile):
    st = profile["states"][0]
    ev, t = [], ms(T0)

    def add(e, dt=2000):
        nonlocal t
        ev.append({**e, "t": t})
        t += dt

    def guide(text, section):
        add({"type": "guideTurn", "text": text, "section": section}, 3000)

    def user(text):
        add({"type": "userTurn", "text": text, "final": True, "via": "script"}, 2000)

    guide("What state do you want to be able to get back to? Say it in your own words.", "1.1")
    user("Calm before a pitch. Like the room is already mine and there's no rush.")
    add({"type": "stateNamed", "stateId": STATE_ID, "label": st["label"], "words": st["words"]}, 500)
    guide("Can you remember a specific time you were totally calm before a pitch? Step into it. Tell me when you're there.", "1.2")
    user("The Berlin demo. I'm there.")
    guide("What was the very first thing that caused it? Something you saw, heard, or felt?", "1.3")
    user("The first face in the room looking up at me.")
    for i, step in enumerate(st["strategy"]["steps"]):
        if i == 1:
            guide("After that, what was the very next thing? A picture, something you said to yourself, or a feeling?", "1.4")
            user("I said to myself, here we go, slow.")
        if i == 2:
            guide("And the next thing?", "1.5")
            user("Warmth spreading through my chest. That's when I'm fully there.")
        add({"type": "stepCaptured", "stateId": STATE_ID, "stepIndex": i, "step": step, "fullyIn": i == st["strategy"]["fullyInAt"]}, 500)
        for attr, value in step["submodalities"]["core"].items():
            add({"type": "submodalityCaptured", "stateId": STATE_ID, "target": "peak", "stepIndex": i,
                 "modality": step["modality"], "attribute": attr, "value": value}, 1500)
    add({"type": "calibrationCaptured", "stateId": STATE_ID, "summary": st["calibration"]["peak"]}, 500)
    guide("So first you see the first face looking up, then you say 'here we go, slow', then you feel warmth spreading in your chest. Is that the order?", "1.6")
    user("Yes.")
    guide("Which one of these, if I gave it back to you, would bring the state back fastest?", "2")
    user("The face looking up.")
    add({"type": "anchorStepMarked", "stateId": STATE_ID, "stepIndex": st["anchorStep"]}, 500)
    add({"type": "contrastCaptured", "stateId": STATE_ID, "label": st["contrast"]["label"], "prefilled": True}, 500)
    add({"type": "calibrationCaptured", "stateId": STATE_ID, "summary": st["calibration"]["contrast"]}, 500)
    for di in st["drivers"]:
        add({"type": "driverFound", "stateId": STATE_ID, "differenceIndex": di, "difference": st["differences"][di]}, 500)
    guide("For you, closeness, brightness and a quiet voice seem to matter most. Take the stuck time and give it those: the picture close and bright, the voice quiet.", "4.1")
    user("Okay. That's different.")
    guide("Now think of that old situation again. Where are you, 0 to 10?", "4.2")
    user("Seven. It was a three.")
    add({"type": "testRated", "stateId": STATE_ID, "before": 3, "after": 7}, 500)
    guide("Think of a time coming up when you'll want this. Run the steps there.", "4.3")
    user("Thursday's board pitch.")
    guide("First the face, close and bright. Then 'here we go, slow', quietly. Then the warmth in your chest. That's yours.", "4.4")
    ev.append({"type": "confirmed", "t": ms(T0) + 95000, "profile": profile})
    return ev


# ── invalid fixtures: each must fail validateProfile / validateRepSession ─────────────────

def invalid():
    out = {}
    p = demo_profile(); p["states"] = []
    out["profile.zero-states.json"] = p
    p = three_states_profile(); p["states"].append(copy.deepcopy(p["states"][1])); p["states"][3]["id"] = "fourth"
    out["profile.four-states.json"] = p
    p = demo_profile(); p["states"][0]["anchorStep"] = 3
    out["profile.anchor-out-of-range.json"] = p
    p = demo_profile(); p["states"][0]["drivers"] = [2, 9]
    out["profile.driver-names-no-difference.json"] = p
    p = three_states_profile(); p["states"][2]["id"] = p["states"][0]["id"]
    out["profile.duplicate-state-ids.json"] = p
    p = demo_profile(); p["states"][0]["differences"][0]["attribute"] = "loudness"
    out["profile.unknown-attribute.json"] = p
    p = demo_profile(); p["states"][0]["strategy"]["steps"][0]["submodalities"]["core"]["distance"] = "very close"
    out["profile.off-vocabulary-value.json"] = p
    p = demo_profile(); p["states"][0]["strategy"]["confirmed"] = False
    out["profile.confirmed-with-unconfirmed-strategy.json"] = p
    s = rep_log()[3]; s["steps"][3]["stepIndex"] = 7
    out["rep-session.step-past-strategy.json"] = s
    s = rep_log()[4]; s["steps"].insert(1, full_steps(T0)[0][1])
    out["rep-session.sham-with-strategy-step.json"] = s
    return out


TYPED = [
    # (export name, file, TS type)
    ("profileDemo", "profile.demo.json", "ProfileV2"),
    ("profileThreeStates", "profile.three-states.json", "ProfileV2"),
    ("profileDraft", "profile.draft.json", "ProfileV2"),
    ("calibrationPeak", "calibration.peak.json", "CalibrationSummary"),
    ("calibrationContrast", "calibration.contrast.json", "CalibrationSummary"),
    ("framesDrift", "frames.drift.json", "SignalFrame[]"),
    ("detectionDrift", "detection.drift.json", "DetectionEvent"),
    ("detectionManual", "detection.manual.json", "DetectionEvent"),
    ("repSessionFull", "rep-session.full.json", "RepSession"),
    ("repSessionSham", "rep-session.sham.json", "RepSession"),
    ("repSessionAnchorOnly", "rep-session.anchor-only.json", "RepSession"),
    ("repLogDemo", "rep-log.demo.json", "RepSession[]"),
    ("onboardingEventsDemo", "onboarding.events.demo.json", "OnboardingEvent[]"),
]


def write_typed():
    """src/fixtures.ts: the same fixtures as typed constants, so tsc checks every one against its TS type."""
    lines = [
        "// GENERATED by contracts/fixtures/_generate.py. Do not edit.",
        "// The JSON fixtures as typed constants: tsc checks each against its type, and lanes can import them.",
        "",
        'import type { OnboardingEvent } from "./onboarding.ts";',
        'import type { ProfileV2 } from "./profile.ts";',
        'import type { RepSession } from "./reps.ts";',
        'import type { CalibrationSummary, DetectionEvent, SignalFrame } from "./signals.ts";',
        "",
    ]
    for name, file, ts_type in TYPED:
        body = (HERE / file).read_text().rstrip()
        lines.append(f"/** fixtures/{file} */")
        lines.append(f"export const {name}: {ts_type} = {body};")
        lines.append("")
    lines.append("export const fixtures = {")
    for name, _, _ in TYPED:
        lines.append(f"  {name},")
    lines.append("};")
    (HERE.parent / "src" / "fixtures.ts").write_text("\n".join(lines) + "\n")


def main():
    profile = demo_profile()
    write("profile.demo.json", profile)
    write("profile.three-states.json", three_states_profile())
    write("profile.draft.json", draft_profile())
    write("calibration.peak.json", CAL_PEAK)
    write("calibration.contrast.json", CAL_CONTRAST)
    write("frames.drift.json", frames_drift())
    write("detection.drift.json", detection_drift())
    write("detection.manual.json", detection_manual())
    log = rep_log()
    write("rep-session.full.json", log[3])
    write("rep-session.sham.json", log[4])
    write("rep-session.anchor-only.json", log[9])
    write("rep-log.demo.json", log)
    write("onboarding.events.demo.json", onboarding_events(profile))
    for name, data in invalid().items():
        write(f"invalid/{name}", data)
    write_typed()


if __name__ == "__main__":
    main()

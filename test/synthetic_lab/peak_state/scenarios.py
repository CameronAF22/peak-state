"""Reproducible synthetic observations. Intraday HRV is NOT an Oura feed."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SCENARIOS = {
    "recovery": "Baseline → sustained elevation → accepted break → baseline return → feedback",
    "hr_only": "Heart-rate signal without HRV readings",
    "hrv_only": "HRV falls while heart rate remains normal, then HRV returns toward baseline",
    "workout": "Elevated heart rate during exercise and the post-workout buffer; no offer",
    "spike": "A single elevated reading; no offer",
    "missing_data": "A break is accepted, then data disappears; monitoring times out",
    "no_recovery": "Measurements stay elevated; bounded monitoring ends with a check-in",
    "declined": "A signal raises an offer; decline closes it without a suggestion",
    "sleep_hrv": "Sleep-average HRV cannot be compared to a synthetic intraday baseline",
}


def load_profile():
    return json.loads((ROOT / "examples" / "calming-profile.json").read_text(encoding="utf-8"))


def generate(name="recovery", accept=True):
    if name not in SCENARIOS:
        raise ValueError("Unknown scenario")
    start = datetime(2026, 10, 3, 14, tzinfo=timezone.utc)
    values = [(62, 52), (63, 51), (81, 33), (83, 31), (75, 39), (65, 49), (63, 51)]
    if name == "hr_only":
        values = [(hr, None) for hr, _ in values]
    elif name == "hrv_only":
        values = [(62, hrv) for _, hrv in values]
    elif name == "workout":
        values = [(62, 52), (110, 30), (120, 28), (95, 35), (90, 36), (80, 40), (64, 50)]
    elif name == "spike":
        values = [(62, 52), (81, 33), (63, 51), (62, 52)]
    elif name in ("no_recovery", "missing_data"):
        values = [(62, 52), (63, 51), (81, 33), (83, 31)]
        if name == "no_recovery":
            values += [(85, 30), (84, 32), (83, 33), (82, 32), (84, 30)]
    elif name == "sleep_hrv":
        values = [(62, 25), (62, 24), (62, 26)]
    inputs = []
    for index, (hr, hrv) in enumerate(values):
        at = start + timedelta(minutes=5 * index)
        workout = name == "workout" and index in (1, 2)
        inputs.append({"type": "sample", "observed_at": at.isoformat(), "received_at": (at + timedelta(seconds=30)).isoformat(),
                       "hr_bpm": hr, "hrv_ms": hrv, "source": "workout" if workout else "awake",
                       "hrv_context": "sleep_average" if name == "sleep_hrv" else "synthetic_intraday",
                       "activity": "workout" if workout else "post_workout" if name == "workout" and index in (3, 4, 5) else "rest",
                       "quality": "good", "available": True, "provenance": "synthetic"})
    if name in ("recovery", "hr_only", "hrv_only", "no_recovery", "missing_data", "declined"):
        if accept or name == "declined":
            at = start + timedelta(minutes=16)
            inputs.append({"type": "action", "received_at": at.isoformat(), "action": "decline" if name == "declined" else "accept",
                           "provenance": "simulated_user"})
    if name in ("no_recovery", "missing_data") or not accept:
        at = start + timedelta(minutes=45)
        inputs.append({"type": "tick", "received_at": at.isoformat()})
    if name in ("recovery", "hr_only", "hrv_only") and accept:
        at = start + timedelta(minutes=31)
        inputs.append({"type": "action", "received_at": at.isoformat(), "action": "feedback", "helpful": True,
                       "feels_calmer": True, "provenance": "simulated_user"})
    return sorted(inputs, key=lambda item: item["received_at"])


def write_fixtures(directory):
    target = Path(directory)
    target.mkdir(parents=True, exist_ok=True)
    for name in SCENARIOS:
        payload = {"scenario": name, "description": SCENARIOS[name], "synthetic": True,
                   "profile": deepcopy(load_profile()), "inputs": generate(name)}
        (target / f"{name}.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

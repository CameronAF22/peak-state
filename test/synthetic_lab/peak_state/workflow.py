"""Deterministic components behind an explicit, inspectable agent workflow."""

from copy import deepcopy
from datetime import datetime, timedelta
from math import isfinite
from urllib.parse import urlencode


def timestamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamps must include a timezone")
    return result


def number(value, label, low=0, high=1000):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    if not isfinite(value) or not low < value <= high:
        raise ValueError(f"{label} must be greater than {low} and at most {high}")
    return float(value)


DEFAULT_CONFIG = {
    "hr_rise_pct": 20,
    "hrv_drop_pct": 25,
    "trigger_samples": 2,
    "recovery_samples": 2,
    "hr_recovery_pct": 10,
    "hrv_recovery_pct": 15,
    "max_gap_minutes": 6,
    "max_age_minutes": 10,
    "offer_minutes": 10,
    "monitor_minutes": 20,
    "cooldown_minutes": 240,
}

CATALOG = [
    {"id": "gentle-humor", "kind": "funny_video", "title": "A short funny-video break",
     "query": "gentle funny animal videos short no loud sounds", "duration_minutes": 3},
    {"id": "quiet-music", "kind": "meditation_music", "title": "Quiet instrumental music",
     "query": "quiet instrumental meditation music no vocals", "duration_minutes": 5},
    {"id": "guided-pause", "kind": "meditation_video", "title": "A short guided pause",
     "query": "five minute gentle guided meditation", "duration_minutes": 5},
    {"id": "comfortable-breath", "kind": "breathing", "title": "A comfortable breathing pause",
     "instructions": "Sit comfortably. Let your breathing settle at a pace that feels easy. Stop if uncomfortable.",
     "duration_minutes": 2},
    {"id": "soft-color", "kind": "color", "title": "A quiet color screen",
     "color": "#AAC9C3", "duration_minutes": 2},
]


class PreferencePlanner:
    """Ranks a local catalog using declared preferences and explicit feedback."""

    def choose(self, profile):
        preferences = profile.get("preferences", [])
        blocked = profile.get("blocked_kinds", [])
        history = profile.get("feedback", [])
        ranked = []
        for item in CATALOG:
            if item["kind"] not in preferences or item["kind"] in blocked:
                continue
            score = len(preferences) - preferences.index(item["kind"])
            for feedback in history:
                if feedback["intervention_id"] == item["id"]:
                    score += 2 if feedback["helpful"] else -3
            ranked.append((score, item))
        if not ranked:
            return None
        item = deepcopy(max(ranked, key=lambda pair: pair[0])[1])
        item["reason"] = "Selected from this person's declared preferences and explicit helpfulness feedback."
        if "query" in item:
            item["url"] = "https://www.youtube.com/results?" + urlencode({"search_query": item["query"]})
            item["link_type"] = "search_results_not_vetted_video"
        return item


class Workflow:
    """Per-person state machine. Time advances from input, not wall-clock sleeps."""

    def __init__(self, profile, config=None):
        self.profile = deepcopy(profile)
        self.config = DEFAULT_CONFIG | (config or {})
        self._validate()
        self.planner = PreferencePlanner()
        self.state = "idle"
        self.events = []
        self.samples = []
        self.last_input = None
        self.last_sample = None
        self.cooldown_until = None
        self.deadline = None
        self.counts = {"hr": 0, "hrv": 0}
        self.recovery_count = 0
        self.trigger_metrics = []
        self.intervention = None
        self.monitoring_started_at = None
        self.episodes = 0

    def _validate(self):
        if not isinstance(self.profile.get("profile_id"), str) or not self.profile["profile_id"]:
            raise ValueError("profile_id is required")
        for metric in ("hr", "hrv"):
            baseline = self.profile["baseline"][metric]
            number(baseline["value"], f"{metric} baseline")
            count = baseline["sample_count"]
            if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                raise ValueError("Baseline sample_count must be a nonnegative integer")
        known = {item["kind"] for item in CATALOG}
        preferences = self.profile.get("preferences", [])
        if not isinstance(preferences, list) or any(kind not in known for kind in preferences):
            raise ValueError("Unknown calming preference")
        if set(self.config) != set(DEFAULT_CONFIG):
            raise ValueError("Unknown configuration field")
        for key, value in self.config.items():
            number(value, key, high=1440)
        for key in ("trigger_samples", "recovery_samples"):
            if isinstance(self.config[key], bool) or not isinstance(self.config[key], int):
                raise ValueError(f"{key} must be an integer")
        if self.config["hrv_drop_pct"] >= 100:
            raise ValueError("hrv_drop_pct must be less than 100")
        if self.config["hr_recovery_pct"] >= self.config["hr_rise_pct"]:
            raise ValueError("HR recovery band must be below trigger threshold")
        if self.config["hrv_recovery_pct"] >= self.config["hrv_drop_pct"]:
            raise ValueError("HRV recovery band must be below trigger threshold")

    def emit(self, at, component, kind, message, **details):
        self.events.append({"at": at.isoformat(), "component": component, "kind": kind,
                            "state": self.state, "message": message, **details})

    def reset_counts(self):
        self.counts = {"hr": 0, "hrv": 0}
        self.recovery_count = 0

    def close(self, at, outcome):
        self.state = "cooldown"
        self.cooldown_until = at + timedelta(minutes=self.config["cooldown_minutes"])
        self.deadline = None
        self.reset_counts()
        self.emit(at, "orchestrator", outcome, "Episode closed; suggestions pause during cooldown.")

    def advance(self, at):
        if self.last_input is not None and at <= self.last_input:
            raise ValueError("Inputs must have strictly increasing received timestamps")
        self.last_input = at
        if self.state == "cooldown" and at >= self.cooldown_until:
            self.state = "idle"
            self.reset_counts()
        if self.deadline is not None and at >= self.deadline:
            if self.state == "offered":
                self.close(at, "offer_expired")
            elif self.state == "monitoring":
                self.state = "check_in"
                self.deadline = None
                self.emit(at, "recovery_monitor", "monitor_timeout",
                          "Monitoring ended without confirmed baseline return. How do you feel?")

    def consume(self, item):
        received = timestamp(item["received_at"])
        self.advance(received)
        kind = item["type"]
        if kind == "sample":
            self._sample(item, received)
        elif kind == "action":
            self._action(item, received)
        elif kind == "tick":
            self.emit(received, "orchestrator", "clock_tick", "Checked offer and monitoring deadlines.")
        else:
            raise ValueError("Input type must be sample, action, or tick")

    def _sample(self, item, received):
        observed = timestamp(item["observed_at"])
        age = (received - observed).total_seconds() / 60
        hr = item.get("hr_bpm")
        hrv = item.get("hrv_ms")
        if hr is not None:
            number(hr, "hr_bpm", high=300)
        if hrv is not None:
            number(hrv, "hrv_ms", high=1000)
        row = deepcopy(item)
        row["hr_change_pct"] = None if hr is None else (hr / self.profile["baseline"]["hr"]["value"] - 1) * 100
        row["hrv_change_pct"] = None if hrv is None else (hrv / self.profile["baseline"]["hrv"]["value"] - 1) * 100
        self.samples.append(row)
        duplicate = self.last_sample is not None and observed <= self.last_sample
        gap = self.last_sample is not None and observed - self.last_sample > timedelta(minutes=self.config["max_gap_minutes"])
        if gap:
            self.reset_counts()
        if age < 0 or age > self.config["max_age_minutes"] or duplicate:
            self.reset_counts()
            self.emit(received, "context_analyst", "ignored_sample", "Stale, future, duplicate, or out-of-order observation.")
            return
        self.last_sample = observed
        if item.get("quality") != "good" or item.get("source") not in ("awake", "rest") or item.get("activity") != "rest":
            self.reset_counts()
            self.emit(received, "context_analyst", "suppressed_sample", "Activity, source, or quality excludes this reading.")
            return
        if self.profile.get("paused", False) or not item.get("available", True):
            self.reset_counts()
            self.emit(received, "context_analyst", "unavailable", "Person is paused or unavailable.")
            return
        values = {"hr": hr, "hrv": hrv}
        eligible = {}
        for metric, value in values.items():
            baseline = self.profile["baseline"][metric]
            context = item.get("hrv_context") if metric == "hrv" else item.get("source")
            eligible[metric] = value is not None and baseline["sample_count"] >= 30 and context == baseline["context"]
        if self.state == "idle":
            thresholds = {"hr": self.config["hr_rise_pct"], "hrv": self.config["hrv_drop_pct"]}
            changes = {"hr": row["hr_change_pct"], "hrv": None if row["hrv_change_pct"] is None else -row["hrv_change_pct"]}
            for metric in ("hr", "hrv"):
                over = eligible[metric] and changes[metric] >= thresholds[metric] - 1e-9
                self.counts[metric] = self.counts[metric] + 1 if over else 0
            crossed = [metric for metric in self.counts if self.counts[metric] >= self.config["trigger_samples"]]
            if crossed:
                self.trigger_metrics = crossed
                self.episodes += 1
                self.state = "offered"
                self.deadline = received + timedelta(minutes=self.config["offer_minutes"])
                self.emit(received, "signal_detector", "signal", "Sustained deviation from personal baseline; cause unknown.",
                          metrics=crossed, hr_change_pct=row["hr_change_pct"], hrv_change_pct=row["hrv_change_pct"])
                self.emit(received, "orchestrator", "offer", "Want a short calming break? Waiting for acceptance.")
        elif self.state == "monitoring":
            if observed < self.monitoring_started_at:
                self.recovery_count = 0
                self.emit(received, "recovery_monitor", "pre_intervention_sample",
                          "Measurement predates acceptance; it cannot establish subsequent baseline return.")
                return
            bands = {"hr": self.config["hr_recovery_pct"], "hrv": self.config["hrv_recovery_pct"]}
            # Both sides of baseline matter. A large drop/rise is not 'back to normal'.
            within = all(eligible[metric] and abs(values[metric] / self.profile["baseline"][metric]["value"] - 1) * 100 <= bands[metric] + 1e-9
                         for metric in self.trigger_metrics)
            self.recovery_count = self.recovery_count + 1 if within else 0
            if self.recovery_count >= self.config["recovery_samples"]:
                self.state = "check_in"
                self.deadline = None
                self.emit(received, "recovery_monitor", "baseline_return",
                          "Triggering measurements returned near baseline. How do you feel? This does not prove the suggestion caused it.")

    def _action(self, item, at):
        action = item.get("action")
        if action == "accept" and self.state == "offered":
            self.intervention = self.planner.choose(self.profile)
            if self.intervention is None:
                self.close(at, "no_preferences")
                return
            self.state = "monitoring"
            self.monitoring_started_at = at
            self.deadline = at + timedelta(minutes=self.config["monitor_minutes"])
            self.recovery_count = 0
            self.emit(at, "preference_planner", "recommendation", "Suggestion delivered after acceptance.", intervention=self.intervention)
        elif action == "decline" and self.state == "offered":
            self.close(at, "declined")
        elif action == "stop" and self.state in ("offered", "monitoring", "check_in"):
            self.close(at, "stopped")
        elif action == "feedback" and self.state in ("monitoring", "check_in"):
            helpful = item.get("helpful")
            feels_calmer = item.get("feels_calmer")
            if not isinstance(helpful, bool) or not isinstance(feels_calmer, bool):
                raise ValueError("Feedback requires boolean helpful and feels_calmer")
            feedback = {"intervention_id": self.intervention["id"], "helpful": helpful,
                        "feels_calmer": feels_calmer, "at": at.isoformat(), "provenance": item.get("provenance", "user")}
            self.profile.setdefault("feedback", []).append(feedback)
            self.emit(at, "feedback_learner", "feedback", "Saved explicit feedback; biometric changes alone do not teach helpfulness.", feedback=feedback)
            self.close(at, "feedback_received")
        else:
            self.emit(at, "orchestrator", "ignored_action", "Action is not valid in the current state.")

    def result(self):
        return {"mode": "synthetic_offline", "components": "local deterministic policies, no LLM calls",
                "state": self.state, "config": self.config, "profile": self.profile,
                "events": self.events, "samples": self.samples, "episodes": self.episodes}


def run(profile, inputs, config=None):
    workflow = Workflow(profile, config)
    for item in inputs:
        workflow.consume(item)
    return workflow.result()

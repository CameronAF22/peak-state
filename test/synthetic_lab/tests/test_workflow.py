from copy import deepcopy
from datetime import timedelta
import unittest

from peak_state.scenarios import SCENARIOS, generate, load_profile
from peak_state.server import preview
from peak_state.workflow import PreferencePlanner, Workflow, run, timestamp


def kinds(result):
    return [event["kind"] for event in result["events"]]


class WorkflowTests(unittest.TestCase):
    def test_recovery_requires_acceptance_and_feedback(self):
        result = run(load_profile(), generate())
        sequence = kinds(result)
        self.assertLess(sequence.index("offer"), sequence.index("recommendation"))
        self.assertLess(sequence.index("recommendation"), sequence.index("baseline_return"))
        self.assertEqual(result["state"], "cooldown")
        self.assertTrue(result["profile"]["feedback"][0]["helpful"])

    def test_hr_only_and_hrv_only_recover(self):
        for name, metric in (("hr_only", "hr"), ("hrv_only", "hrv")):
            with self.subTest(name=name):
                result = run(load_profile(), generate(name))
                signal = next(e for e in result["events"] if e["kind"] == "signal")
                self.assertEqual(signal["metrics"], [metric])
                self.assertIn("baseline_return", kinds(result))

    def test_noise_exercise_sleep_context_do_not_offer(self):
        for name in ("workout", "spike", "sleep_hrv"):
            with self.subTest(name=name):
                result = run(load_profile(), generate(name))
                self.assertEqual(result["episodes"], 0)
                self.assertNotIn("recommendation", kinds(result))

    def test_hrv_increase_does_not_trigger(self):
        inputs = generate("hrv_only")
        for item in inputs:
            if item["type"] == "sample":
                item["hrv_ms"] = 80
        self.assertEqual(run(load_profile(), inputs)["episodes"], 0)

    def test_missing_or_high_measurements_timeout_without_recovery(self):
        for name in ("missing_data", "no_recovery"):
            result = run(load_profile(), generate(name))
            self.assertEqual(result["state"], "check_in")
            self.assertIn("monitor_timeout", kinds(result))
            self.assertNotIn("baseline_return", kinds(result))
            self.assertEqual(result["profile"]["feedback"], [])

    def test_decline_never_delivers_content(self):
        result = run(load_profile(), generate("declined"))
        self.assertIn("declined", kinds(result))
        self.assertNotIn("recommendation", kinds(result))

    def test_no_acceptance_expires_without_delivery(self):
        result = run(load_profile(), generate(accept=False))
        self.assertIn("offer_expired", kinds(result))
        self.assertNotIn("recommendation", kinds(result))

    def test_baseline_return_without_user_feedback_does_not_learn(self):
        inputs = [item for item in generate() if item.get("action") != "feedback"]
        result = run(load_profile(), inputs)
        self.assertEqual(result["state"], "check_in")
        self.assertEqual(result["profile"]["feedback"], [])

    def test_no_preferences_closes_accepted_offer(self):
        profile = load_profile()
        profile["preferences"] = []
        result = run(profile, generate())
        self.assertIn("no_preferences", kinds(result))
        self.assertNotIn("recommendation", kinds(result))

    def test_explicit_feedback_changes_next_choice(self):
        profile = load_profile()
        planner = PreferencePlanner()
        self.assertEqual(planner.choose(profile)["kind"], "funny_video")
        profile["feedback"] = [{"intervention_id": "gentle-humor", "helpful": False}]
        self.assertEqual(planner.choose(profile)["kind"], "meditation_music")
        profile["blocked_kinds"] = ["meditation_music"]
        self.assertEqual(planner.choose(profile)["kind"], "breathing")

    def test_gap_breaks_trigger_streak(self):
        inputs = [item for item in generate() if item["type"] == "sample"][2:4]
        later = timestamp(inputs[1]["observed_at"]) + timedelta(minutes=20)
        inputs[1]["observed_at"] = later.isoformat()
        inputs[1]["received_at"] = (later + timedelta(seconds=30)).isoformat()
        self.assertEqual(run(load_profile(), inputs)["episodes"], 0)

    def test_stale_and_duplicate_observations_do_not_trigger(self):
        samples = [item for item in generate() if item["type"] == "sample"][2:4]
        for mode in ("stale", "duplicate", "future"):
            inputs = deepcopy(samples)
            if mode == "stale":
                inputs[1]["observed_at"] = (timestamp(inputs[1]["received_at"]) - timedelta(hours=1)).isoformat()
            elif mode == "duplicate":
                inputs[1]["observed_at"] = inputs[0]["observed_at"]
            else:
                inputs[1]["observed_at"] = (timestamp(inputs[1]["received_at"]) + timedelta(hours=1)).isoformat()
            result = run(load_profile(), inputs)
            self.assertEqual(result["episodes"], 0)
            self.assertIn("ignored_sample", kinds(result))

    def test_missing_recovery_metric_cannot_confirm_return(self):
        inputs = [item for item in generate() if item.get("action") != "feedback"]
        for item in inputs:
            if item["type"] == "sample" and item["hr_bpm"] in (65, 63) and timestamp(item["observed_at"]).minute >= 25:
                item["hrv_ms"] = None
        self.assertNotIn("baseline_return", kinds(run(load_profile(), inputs)))

    def test_recovery_requires_consecutive_samples(self):
        inputs = [item for item in generate() if item.get("action") != "feedback"]
        inputs[-1]["hr_bpm"] = 83
        inputs[-1]["hrv_ms"] = 31
        self.assertNotIn("baseline_return", kinds(run(load_profile(), inputs)))

    def test_low_hr_is_not_normalization(self):
        inputs = [item for item in generate() if item.get("action") != "feedback"]
        for item in inputs:
            if item["type"] == "sample" and timestamp(item["observed_at"]).minute >= 20:
                item["hr_bpm"] = 40
                item["hrv_ms"] = 52
        self.assertNotIn("baseline_return", kinds(run(load_profile(), inputs)))

    def test_threshold_boundary_and_personal_baseline(self):
        inputs = [item for item in generate() if item["type"] == "sample"][:2]
        for item in inputs:
            item["hr_bpm"] = 62 * 1.2
            item["hrv_ms"] = None
        self.assertEqual(run(load_profile(), inputs)["episodes"], 1)
        profile = load_profile()
        profile["baseline"]["hr"]["value"] = 80
        self.assertEqual(run(profile, inputs)["episodes"], 0)

    def test_insufficient_baseline_and_pause_disable_triggers(self):
        for pause in (True, False):
            profile = load_profile()
            if pause:
                profile["paused"] = True
            else:
                for baseline in profile["baseline"].values():
                    baseline["sample_count"] = 2
            self.assertEqual(run(profile, generate())["episodes"], 0)

    def test_unavailable_person_and_bad_quality_break_streak(self):
        for key, value in (("available", False), ("quality", "poor")):
            samples = [item for item in generate() if item["type"] == "sample"][2:4]
            samples[1][key] = value
            self.assertEqual(run(load_profile(), samples)["episodes"], 0)

    def test_cooldown_prevents_repeat_offer(self):
        inputs = generate("declined")
        for item in inputs:
            if item["type"] == "sample":
                item["hr_bpm"], item["hrv_ms"] = 83, 31
        self.assertEqual(run(load_profile(), inputs)["episodes"], 1)

    def test_invalid_values_and_timezone_fail_clearly(self):
        for value in (0, -4, float("nan"), float("inf"), True, "fast"):
            item = generate()[0]
            item["hr_bpm"] = value
            with self.assertRaises(ValueError):
                run(load_profile(), [item])
        with self.assertRaises(ValueError):
            timestamp("2026-10-03T10:00:00")
        with self.assertRaises(ValueError):
            Workflow(load_profile(), {"trigger_samples": 1.5})

    def test_input_and_profile_are_not_mutated(self):
        profile, inputs = load_profile(), generate()
        originals = deepcopy((profile, inputs))
        run(profile, inputs)
        self.assertEqual((profile, inputs), originals)

    def test_browser_requires_real_acceptance_and_explicit_feedback(self):
        pending = preview({})
        self.assertEqual(pending["state"], "offered")
        self.assertNotIn("recommendation", kinds(pending))
        accepted = preview({"decision": "accept"})
        self.assertEqual(accepted["state"], "check_in")
        self.assertEqual(accepted["profile"]["feedback"], [])
        feedback = preview({"decision": "accept", "feedback": {"helpful": False, "feels_calmer": True}})
        self.assertFalse(feedback["profile"]["feedback"][0]["helpful"])
        self.assertEqual(feedback["state"], "cooldown")

    def test_browser_decline_expiry_and_each_scenario(self):
        self.assertNotIn("recommendation", kinds(preview({"decision": "decline"})))
        self.assertIn("offer_expired", kinds(preview({"decision": "expire"})))
        for name in SCENARIOS:
            with self.subTest(name=name):
                result = preview({"scenario": name, "decision": "accept"})
                self.assertNotEqual(result["state"], "offered")

    def test_invalid_browser_payloads(self):
        for payload in ({"scenario": "bad"}, {"decision": "bad"}, {"preferences": ["bad"]},
                        {"history": [{"intervention_id": "bad", "helpful": True}]},
                        {"config": {"surprise": True}}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                preview(payload)

    def test_pre_acceptance_measurements_do_not_confirm_recovery(self):
        inputs = generate()[:5]
        for observed, received in (("14:15:35", "14:17:00"), ("14:15:45", "14:18:00")):
            item = deepcopy(inputs[0])
            item["observed_at"] = f"2026-10-03T{observed}+00:00"
            item["received_at"] = f"2026-10-03T{received}+00:00"
            inputs.append(item)
        result = run(load_profile(), inputs)
        self.assertNotIn("baseline_return", kinds(result))
        self.assertEqual(kinds(result).count("pre_intervention_sample"), 2)

    def test_feedback_history_remains_bounded(self):
        history = [{"intervention_id": "gentle-humor", "helpful": True}] * 100
        result = preview({"decision": "accept", "history": history, "feedback": {"helpful": True, "feels_calmer": True}})
        self.assertEqual(len(result["profile"]["feedback"]), 100)
        self.assertEqual(preview({"history": result["profile"]["feedback"]})["state"], "offered")

    def test_feedback_stays_with_accepted_choice_at_history_limit(self):
        history = ([{"intervention_id": "gentle-humor", "helpful": True}]
                   + [{"intervention_id": "soft-color", "helpful": True}] * 98
                   + [{"intervention_id": "gentle-humor", "helpful": False}])
        accepted = preview({"decision": "accept", "history": history})
        result = preview({"decision": "accept", "history": history,
                          "feedback": {"helpful": True, "feels_calmer": True}})
        self.assertEqual(result["profile"]["feedback"][-1]["intervention_id"],
                         next(event["intervention"]["id"] for event in accepted["events"] if event["kind"] == "recommendation"))

    def test_stop_in_each_active_state(self):
        for stage in ("offered", "monitoring", "check_in"):
            workflow = Workflow(load_profile())
            for item in generate():
                if item.get("action") == "feedback":
                    continue
                workflow.consume(item)
                if workflow.state == stage:
                    break
            at = workflow.last_input + timedelta(seconds=1)
            workflow.consume({"type": "action", "action": "stop", "received_at": at.isoformat()})
            self.assertEqual(workflow.state, "cooldown")
            self.assertEqual(workflow.events[-1]["kind"], "stopped")

    def test_exact_offer_and_monitor_deadlines(self):
        for accept in (False, True):
            workflow = Workflow(load_profile())
            for item in generate()[:4]:
                workflow.consume(item)
            if accept:
                workflow.consume(generate()[4])
            at = workflow.deadline
            workflow.consume({"type": "tick", "received_at": at.isoformat()})
            self.assertEqual(workflow.state, "check_in" if accept else "cooldown")

    def test_cooldown_expiry_allows_new_episode(self):
        workflow = Workflow(load_profile())
        for item in generate("declined"):
            workflow.consume(item)
        at = workflow.cooldown_until
        workflow.consume({"type": "tick", "received_at": at.isoformat()})
        self.assertEqual(workflow.state, "idle")
        for index in range(2):
            item = deepcopy(generate()[2])
            at += timedelta(minutes=5)
            item["observed_at"] = at.isoformat()
            item["received_at"] = (at + timedelta(seconds=30)).isoformat()
            workflow.consume(item)
        self.assertEqual(workflow.episodes, 2)

    def test_context_change_breaks_recovery_streak(self):
        inputs = [item for item in generate() if item.get("action") != "feedback"]
        inputs[-1]["hrv_context"] = "sleep_average"
        self.assertNotIn("baseline_return", kinds(run(load_profile(), inputs)))


if __name__ == "__main__":
    unittest.main()

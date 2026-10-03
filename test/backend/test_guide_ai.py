import json
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from guide_ai import GOALS, QUESTION_GOALS, fallback, phrase
from main import app


def response(text):
    return {"status": "completed", "output": [{"type": "message", "content": [
        {"type": "output_text", "text": json.dumps({"text": text})}]}]}


class GuideTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {"OPENAI_API_KEY": "test-key", "OPENAI_MODEL": "test-model"})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.context = {"state": "calm", "moment": "I sat by the lake after a busy day.",
                        "steps": [{"kind": "heard", "text": "I heard the water and stopped thinking about work."}],
                        "step_index": 0}

    def test_grounded_question_uses_responses_schema_and_context(self):
        captured = []
        def transport(payload, key):
            captured.append(payload)
            self.assertEqual(key, "test-key")
            return response("After hearing the water, what happened next inside you?")
        result = phrase("next_step", self.context, transport)
        self.assertEqual(result["source"], "openai")
        self.assertNotIn(self.context["steps"][0]["text"], result["text"])
        self.assertEqual(json.loads(captured[0]["input"])["context"], self.context)
        self.assertFalse(captured[0]["store"])
        self.assertEqual(captured[0]["text"]["format"]["type"], "json_schema")
        self.assertTrue(captured[0]["text"]["format"]["strict"])
        self.assertIn("untrusted", captured[0]["instructions"])
        self.assertEqual(self.context["steps"][0]["text"], "I heard the water and stopped thinking about work.")

    def test_missing_key_does_not_call_provider(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            result = phrase("next_step", self.context, lambda *_: self.fail("Provider called"))
        self.assertEqual(result, {"text": fallback("next_step"), "source": "scripted"})

    def test_transport_errors_fall_back_without_exposing_details(self):
        for error in [TimeoutError("secret"), OSError("secret"), ValueError("secret")]:
            with self.subTest(error=type(error)), patch("guide_ai.request_openai"):
                def fail(*_):
                    raise error
                self.assertEqual(phrase("next_step", self.context, fail)["source"], "scripted")

    def test_invalid_output_refusal_and_incomplete_fall_back(self):
        invalid = [response(""), response("a" * 421), response("Which cue? And what next?"),
                   response("No question here."), response("A line\nWhich cue?"),
                   {"status": "incomplete", "output": []},
                   {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]},
                   {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "garbage"}]}]}]
        for item in invalid:
            with self.subTest(response=item):
                self.assertEqual(phrase("next_step", self.context, lambda *_: item)["source"], "scripted")

    def test_statements_do_not_add_questions(self):
        for goal in set(GOALS) - QUESTION_GOALS:
            self.assertEqual(phrase(goal, self.context, lambda *_: response("Is that right?"))["source"], "scripted")
            self.assertEqual(phrase(goal, self.context, lambda *_: response("Hear the water again, at your own pace."))["source"], "openai")

    def test_check_in_preserves_full_return_question_intent(self):
        result = phrase("check_in", self.context, lambda *_: response("Do you feel closer to calm now?"))
        self.assertEqual(result["source"], "scripted")
        self.assertEqual(result["text"], "Do you feel back in the state you chose now?")
        result = phrase("check_in", self.context, lambda *_: response("Do you feel calm now?"))
        self.assertEqual(result["source"], "openai")

    def test_endpoint_fallback_and_validation(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}), TestClient(app) as client:
            body = {"goal": "next_step", "context": self.context}
            result = client.post("/api/guide/phrase", json=body)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["source"], "scripted")
            for invalid in [{"goal": "invent", "context": self.context},
                            {"goal": "next_step", "context": {"moment": "x" * 6001}},
                            {"goal": "next_step", "context": {"steps": [{"kind": "unknown", "text": "cue"}]}},
                            {"goal": "next_step", "context": {"step_index": -1}}]:
                self.assertEqual(client.post("/api/guide/phrase", json=invalid).status_code, 422)


if __name__ == "__main__":
    unittest.main()

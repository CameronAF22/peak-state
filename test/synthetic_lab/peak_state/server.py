"""Local demo only. Replays synthetic input; does not contact media or Oura."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import timedelta
import json
from pathlib import Path

from .scenarios import SCENARIOS, generate, load_profile
from .workflow import CATALOG, DEFAULT_CONFIG, Workflow


def preview(payload):
    scenario = payload.get("scenario", "recovery")
    decision = payload.get("decision", "pending")
    if decision not in ("pending", "accept", "decline", "expire"):
        raise ValueError("Unknown decision")
    profile = load_profile()
    if "preferences" in payload:
        profile["preferences"] = payload["preferences"]
    history = payload.get("history", [])
    if not isinstance(history, list) or len(history) > 100:
        raise ValueError("Invalid feedback history")
    for entry in history:
        if not isinstance(entry, dict) or entry.get("intervention_id") not in {item["id"] for item in CATALOG} or not isinstance(entry.get("helpful"), bool):
            raise ValueError("Invalid feedback history entry")
    profile["feedback"] = history
    workflow = Workflow(profile, payload.get("config"))
    # Browser decisions replace fixture actions. Simulation timestamps advance
    # instantly, but acceptance and feedback must come from the visitor.
    inputs = [item for item in generate(scenario, accept=False) if item["type"] == "sample"]
    for item in inputs:
        workflow.consume(item)
        if workflow.state == "offered":
            if decision == "pending":
                break
            if decision in ("accept", "decline"):
                workflow.consume({"type": "action", "action": decision,
                                  "received_at": (workflow.last_input + timedelta(seconds=1)).isoformat(), "provenance": "demo_user"})
                if decision == "decline":
                    break
    if workflow.state in ("offered", "monitoring") and decision != "pending":
        workflow.consume({"type": "tick", "received_at": (max(workflow.deadline, workflow.last_input) + timedelta(seconds=1)).isoformat()})
    feedback = payload.get("feedback")
    if feedback is not None:
        if decision != "accept" or not isinstance(feedback, dict):
            raise ValueError("Feedback needs an accepted offer")
        workflow.consume({"type": "action", "action": "feedback", "received_at": (workflow.last_input + timedelta(seconds=1)).isoformat(),
                          "helpful": feedback.get("helpful"), "feels_calmer": feedback.get("feels_calmer"), "provenance": "demo_user"})
    result = workflow.result()
    result["profile"]["feedback"] = result["profile"]["feedback"][-100:]
    return result | {"scenario": scenario, "description": SCENARIOS[scenario]}


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, content, content_type="application/json; charset=utf-8"):
        encoded = content.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/":
            self.respond(200, (Path(__file__).parent / "demo.html").read_text(encoding="utf-8"), "text/html; charset=utf-8")
        elif self.path == "/api/options":
            self.respond(200, json.dumps({"scenarios": SCENARIOS, "config": DEFAULT_CONFIG, "catalog": CATALOG, "profile": load_profile()}))
        else:
            self.respond(404, json.dumps({"error": "Not found"}))

    def do_POST(self):
        if self.path != "/api/run":
            self.respond(404, json.dumps({"error": "Not found"}))
            return
        try:
            # Reject browser requests from external origins; this server is local.
            host = self.headers.get("Host", "")
            if host not in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"):
                raise ValueError("Unexpected host")
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{host}":
                raise ValueError("Unexpected origin")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 262144:
                raise ValueError("Request must be between 1 byte and 256 KiB")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Expected a JSON object")
            result = preview(payload)
            self.respond(200, json.dumps(result))
        except (ValueError, TypeError, KeyError, AttributeError) as error:
            self.respond(400, json.dumps({"error": str(error)}))


def serve(port=8765):
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as server:
        print(f"Peak State synthetic demo: http://127.0.0.1:{port}", flush=True)
        server.serve_forever()

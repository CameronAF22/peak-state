"""Unit tests for tools/coord.py. Run: python3 -m unittest discover -s tools -p 'test_*.py'"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import coord  # noqa: E402

CFG = {
    "generated": ["coord/decisions/", "spec/"],
    "lanes": [
        {"id": "coord", "owns": ["coord/", "docs/", "README.md"]},
        {"id": "contracts", "owns": ["schemas/", "contracts/"]},
        {"id": "sensing", "owns": ["sensing/", "docs/trigger-flow.md"]},
    ],
}


def decision(did, produces, status="accepted", supersedes=()):
    return {"id": did, "lane": did.split("-")[1], "status": status, "produces": list(produces), "supersedes": list(supersedes)}


class OwnershipTests(unittest.TestCase):
    def test_longest_prefix_wins(self):
        self.assertEqual(coord.owner_of("docs/trigger-flow.md", CFG), "sensing")
        self.assertEqual(coord.owner_of("docs/plan.md", CFG), "coord")
        self.assertEqual(coord.owner_of("schemas/profile.json", CFG), "contracts")

    def test_unowned_path(self):
        self.assertIsNone(coord.owner_of("random.txt", CFG))

    def test_generated(self):
        self.assertTrue(coord.is_generated("spec/coord.md", CFG))
        self.assertFalse(coord.is_generated("coord/lanes.json", CFG))

    def test_path_patterns(self):
        self.assertTrue(coord.path_matches("app/src/main.ts", "app/"))
        self.assertTrue(coord.path_matches("schemas/a.schema.json", "schemas/*.schema.json"))
        self.assertTrue(coord.path_matches("README.md", "README.md"))
        self.assertFalse(coord.path_matches("README.md.bak", "README.md"))


class DecisionTests(unittest.TestCase):
    def test_supersede_and_reject(self):
        decisions = {
            "D-coord-001": decision("D-coord-001", ["docs/"]),
            "D-coord-002": decision("D-coord-002", ["docs/"], supersedes=["D-coord-001"]),
            "D-coord-003": decision("D-coord-003", ["README.md"], status="rejected", supersedes=["D-coord-002"]),
        }
        eff = coord.effective_status(decisions)
        self.assertEqual(eff["D-coord-001"], "superseded")
        self.assertEqual(eff["D-coord-002"], "accepted")
        self.assertEqual(eff["D-coord-003"], "rejected")

    def test_coverage_ignores_rejected(self):
        decisions = {"D-coord-001": decision("D-coord-001", ["README.md"], status="rejected")}
        eff = coord.effective_status(decisions)
        self.assertEqual(coord.covering("README.md", decisions, eff), [])

    def test_next_id_is_per_lane(self):
        ids = ["D-coord-001", "D-coord-007", "D-sensing-002"]
        self.assertEqual(coord.next_decision_id("coord", ids), "D-coord-008")
        self.assertEqual(coord.next_decision_id("reps", ids), "D-reps-001")


class PushDetectionTests(unittest.TestCase):
    def test_detects_real_pushes(self):
        for command in (
            "git push -u origin lane/sensing",
            "git add -A && git commit -m x && git push",
            "cd repo; git -C /tmp/x push origin HEAD",
            "GIT_TRACE=1 git push",
        ):
            self.assertTrue(coord.is_push(command), command)

    def test_ignores_text_that_mentions_push(self):
        for command in (
            "cat > ci.yml <<'EOF'\n  run: git push -f origin coord-dashboard\nEOF\necho done",
            'echo "remember to git push later"',
            "git log --grep push",
            "grep -n 'git push' CLAUDE.md",
        ):
            self.assertFalse(coord.is_push(command), command)


class SchemaTests(unittest.TestCase):
    def test_decision_schema_rejects_bad_records(self):
        schema = coord.load_schema("decision")
        self.assertTrue(coord.schema_errors({"id": "nope"}, schema))
        good = {
            "schemaVersion": 1, "id": "D-coord-001", "lane": "coord", "title": "A real title", "status": "accepted",
            "type": "process", "context": "c", "decision": "d", "alternatives": [], "consequences": "",
            "produces": ["docs/"], "dependsOn": [], "supersedes": [], "author": "claude",
            "session": {"id": "s", "url": None, "branch": None}, "createdAt": "2026-10-03T14:00:00Z",
        }
        self.assertEqual(coord.schema_errors(good, schema), [])
        bad = dict(good, status="maybe", extra=True)
        errors = coord.schema_errors(bad, schema)
        self.assertTrue(any("status" in e for e in errors))
        self.assertTrue(any("extra" in e for e in errors))

    def test_all_coord_schemas_parse(self):
        for path in coord.SCHEMAS.glob("*.schema.json"):
            json.loads(path.read_text())


class RepositoryTests(unittest.TestCase):
    def test_lanes_file_is_valid(self):
        cfg = coord.load_lanes()
        self.assertEqual(coord.schema_errors(cfg, coord.load_schema("lanes")), [])

    def test_build_is_deterministic(self):
        self.assertEqual(coord.build_outputs(), coord.build_outputs())


if __name__ == "__main__":
    unittest.main()

"""Exercise the local workflow in disposable directories, never real task state."""

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/worklog.py"
SPEC = importlib.util.spec_from_file_location("worklog", SCRIPT)
WORKLOG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKLOG)


class WorklogTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "docs/work").mkdir(parents=True)
        (self.root / "docs/work/tasks.md").write_text(
            "| ID | Task | Status | Run | Updated |\n"
            "| --- | --- | --- | --- | --- |\n"
            "| FP-01 | Bootstrap | planned | — | — |\n"
        )
        (self.root / "artifacts/templates").mkdir(parents=True)
        (self.root / "artifacts/templates/report.md").write_text("# TASK-ID\n")

    def call(self, *arguments):
        output = io.StringIO()
        with redirect_stdout(output):
            WORKLOG.execute(WORKLOG.parser().parse_args(arguments), self.root)
        return output.getvalue()

    def start(self):
        return self.call("start", "FP-01", "--summary", "Fixture run").splitlines()[0]

    def manifest(self, run):
        return json.loads((self.root / "artifacts/runs" / run / "manifest.json").read_text())

    def check(self, run, outcome="pass", *extra):
        return self.call("check", run, "--name", "Check", "--command", "manual fixture",
                         "--outcome", outcome, "--summary", "Safe result", *extra)

    def test_valid_lifecycle_and_closed_history(self):
        run = self.start()
        self.assertIn("in_progress", self.call("status"))
        file = self.root / "artifacts/runs" / run / "evidence/check.txt"
        file.write_text("Synthetic evidence\n")
        self.check(run, "pass", "--gate", "Q01", "--evidence", "evidence/check.txt")
        self.call("finish", run, "--status", "verified", "--dod-confirmed", "--summary", "DoD checked")
        self.assertIn("verified", self.call("status"))
        self.assertEqual(self.manifest(run)["checks"][0]["evidence"], "evidence/check.txt")
        with self.assertRaises(ValueError):
            self.call("note", run, "--summary", "Closed run mutation")
        entries = list((self.root / "docs/work/journal").glob("*.md"))
        self.assertEqual(len(entries), 1)
        self.assertIn("verified", entries[0].read_text())

    def test_verified_requires_dod_and_passed_checks(self):
        run = self.start()
        with self.assertRaises(ValueError):
            self.call("finish", run, "--status", "verified", "--dod-confirmed", "--summary", "Missing checks")
        self.check(run)
        with self.assertRaises(ValueError):
            self.call("finish", run, "--status", "verified", "--summary", "Missing DoD")
        self.assertEqual(self.manifest(run)["status"], "in_progress")

    def test_failure_and_not_run_cannot_be_verified(self):
        for outcome in ("fail", "not_run"):
            with self.subTest(outcome=outcome):
                run = self.start()
                self.check(run, outcome)
                with self.assertRaises(ValueError):
                    self.call("finish", run, "--status", "verified", "--dod-confirmed", "--summary", "False pass")
                self.call("finish", run, "--status", "blocked", "--summary", "Needs work")

    def test_unknown_task_and_duplicate_start(self):
        with self.assertRaises(ValueError):
            self.call("start", "FP-99", "--summary", "Unknown task")
        run = self.start()
        with self.assertRaises(ValueError):
            self.start()
        self.assertEqual(self.manifest(run)["status"], "in_progress")

    def test_evidence_cannot_escape_run(self):
        run = self.start()
        external = self.root / "outside.txt"
        external.write_text("Outside\n")
        (self.root / "artifacts/runs" / run / "evidence/link.txt").symlink_to(external)
        for evidence in ("../../../outside.txt", str(external), "evidence/link.txt", "missing.txt"):
            with self.subTest(evidence=evidence), self.assertRaises(ValueError):
                self.check(run, "pass", "--evidence", evidence)
        self.assertEqual(self.manifest(run)["checks"], [])

    def test_run_id_and_multiline_input_rejected(self):
        with self.assertRaises(ValueError):
            self.call("note", "../outside", "--summary", "Bad path")
        with self.assertRaises(ValueError):
            self.call("start", "FP-01", "--summary", "first\nsecond")
        self.assertIn("planned", self.call("status"))


if __name__ == "__main__":
    unittest.main()

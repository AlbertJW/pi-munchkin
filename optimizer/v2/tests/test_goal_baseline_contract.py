"""Counterfactuals for evidence that used to be accepted by the reducer."""
import unittest

from optimizer.v2.real_baseline import ingest_gate_baseline, _row_digest, validate_real_report, RealBaselineError
from optimizer.v2.tests.test_g03_real_baseline import PACK, PREREG, REPO, CASE_TASKS, complete_rows


class BaselineExecutionContract(unittest.TestCase):
    def report(self, rows, validity):
        return ingest_gate_baseline(PACK, PREREG, REPO, rows, validity,
            case_tasks=CASE_TASKS, run_id="g03-real-run",
            resolved_model={"provider": "llama", "model": "qwen36-35b-iq3s"})

    def test_exceeded_or_missing_resource_counts_cannot_be_quality_evidence(self):
        for field, value in (("tool_calls", 81), ("tool_calls", None), ("retried", 9),
                             ("wall_ms", 900001), ("out_bytes", 65537)):
            rows, validity = complete_rows()
            target = rows[0]["trajectory"] if field == "tool_calls" else rows[0]
            target[field] = value
            validity[0]["row_sha256"] = _row_digest(rows[0])
            with self.subTest(field=field, value=value):
                self.assertFalse(self.report(rows, validity)["model_quality_evidence"])

    def test_boolean_score_is_not_a_binary_measurement(self):
        rows, validity = complete_rows()
        rows[0]["score"] = True
        validity[0]["row_sha256"] = _row_digest(rows[0])
        self.assertFalse(self.report(rows, validity)["model_quality_evidence"])

    def test_repetition_is_not_proof_of_inference_seed(self):
        rows, validity = complete_rows()
        rows[0]["context"].pop("request_seed", None)
        validity[0]["row_sha256"] = _row_digest(rows[0])
        self.assertFalse(self.report(rows, validity)["model_quality_evidence"])

    def test_wrong_actual_arm_order_is_rejected(self):
        rows, validity = complete_rows()
        rows[0], rows[1] = rows[1], rows[0]
        self.assertFalse(self.report(rows, validity)["model_quality_evidence"])

    def test_legacy_report_is_not_a_new_execution_qualification(self):
        rows, validity = complete_rows()
        report = self.report(rows, validity)
        report["schema"] = "pi.optimizer-real-baseline-report/v1"
        report["report_sha256"] = _row_digest({key: value for key, value in report.items() if key != "report_sha256"})
        with self.assertRaises(RealBaselineError):
            validate_real_report(report, PACK, PREREG)


if __name__ == "__main__": unittest.main()

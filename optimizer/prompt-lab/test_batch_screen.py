import importlib.util
from pathlib import Path
import unittest


MODULE = Path(__file__).with_name("batch_screen.py")
SPEC = importlib.util.spec_from_file_location("batch_screen", MODULE)
batch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(batch)


def row(score=0, status="targeted", exact=True, counts=None):
    return {"score": score, "usage": {"exact": exact},
            "exposure": {"status": status, "counts": counts or {}}}


class BatchScreenTests(unittest.TestCase):
    def test_manifest_and_strict_band(self):
        manifest = batch.load_manifest(batch.DEFAULT_MANIFEST)
        self.assertEqual(manifest["eligible_passes"], [2, 3, 4])
        self.assertEqual(batch.eligible_tasks(manifest, {"parens": 2 / 6, "qs-error-swallow": 5 / 6}, "c7"), ["parens"])

    def test_dispositions_require_exact_usage_and_exposure(self):
        base = [row(0) for _ in range(6)]
        cand = [row(1) for _ in range(6)]
        self.assertEqual(batch.screen_disposition("c7", base, cand), "PROMOTE_TO_LOCAL_CONFIRMATION")
        self.assertEqual(batch.screen_disposition("c7", base, [row(1, status="unexposed") for _ in range(6)]), "UNEXPOSED")
        self.assertEqual(batch.screen_disposition("c7", base, [row(1, exact=False) for _ in range(6)]), "INCOMPLETE_COST")
        self.assertEqual(batch.screen_disposition("c7", base, [row(0, counts={"verify-gate/unverified-end": 1}) for _ in range(6)]), "SAFETY_HOLD")

    def test_resume_cell_validation_rejects_partial_and_unsafe_names(self):
        self.assertFalse(batch.complete(Path("/tmp/does-not-exist.jsonl"), "base", "parens", 6))
        with self.assertRaises(batch.BatchError):
            batch.result_file("../escape")


if __name__ == "__main__":
    unittest.main()

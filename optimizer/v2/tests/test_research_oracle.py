import json
import pathlib
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ORACLE = ROOT / "research-fixtures/oracles/research_shape.py"


class ResearchOracleTests(unittest.TestCase):
    def run_oracle(self, payload):
        return subprocess.run([sys.executable, str(ORACLE)], input=json.dumps(payload), text=True, capture_output=True)

    def payload(self):
        return {
            "required_claims": [
                {"id": "json", "evidence_family": "json-family"},
                {"id": "yaml", "evidence_family": "yaml-family"},
            ],
            "evidence_families": [
                {"id": "json-family", "source_refs": [{"url": "https://json.example/spec"}]},
                {"id": "yaml-family", "source_refs": [{"url": "https://yaml.example/spec"}]},
            ],
        }

    def test_requires_parent_validated_original_source_citations(self):
        payload = self.payload()
        payload["citations"] = [
            {"claim_id": "json", "url": "https://json.example/spec", "parent_validated": True},
            {"claim_id": "yaml", "url": "https://r.jina.ai/https://yaml.example/spec", "parent_validated": True},
        ]
        result = self.run_oracle(payload)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["missing"], ["yaml"])

    def test_complete_coverage_is_deterministic_and_payload_free(self):
        payload = self.payload()
        payload["citations"] = [
            {"claim_id": "yaml", "url": "https://yaml.example/spec", "parent_validated": True},
            {"claim_id": "json", "url": "https://json.example/spec", "parent_validated": True},
        ]
        result = self.run_oracle(payload)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout), {"schema": "pi.research-oracle/v2", "required": 2, "covered": 2, "missing": []})

    def test_equivalent_original_url_forms_are_canonicalized(self):
        payload = self.payload()
        payload["citations"] = [
            {"claim_id": "json", "url": "https://json.example/spec/", "parent_validated": True},
            {"claim_id": "yaml", "url": "https://yaml.example/spec/index.html#section", "parent_validated": True},
        ]
        result = self.run_oracle(payload)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(json.loads(result.stdout)["missing"], [])


if __name__ == "__main__":
    unittest.main()

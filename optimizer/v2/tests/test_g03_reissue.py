from __future__ import annotations

import json
import pathlib
import tempfile
import unittest

from optimizer.v2.baseline import BaselinePreregistration
from optimizer.v2.benchmark import BenchmarkPack
from optimizer.v2.g03_reissue import reissue


ROOT = pathlib.Path(__file__).resolve().parents[2]
REPO = ROOT.parent
PACK_PATH = ROOT / "v2/benchmarks/g03-representative-pilot-v1.json"
PREREG_PATH = ROOT / "v2/examples/g03-baseline-preregistration.json"


class G03ReissueTests(unittest.TestCase):
    def test_reissue_updates_runtime_identities_and_rehashes_without_mutating_frozen_inputs(self) -> None:
        original_pack = PACK_PATH.read_bytes()
        original_prereg = PREREG_PATH.read_bytes()
        with tempfile.TemporaryDirectory(dir=REPO) as directory:
            output = pathlib.Path(directory)
            pack_out = output / "g03-pack-r2.json"
            prereg_out = output / "g03-prereg-r2.json"
            result = reissue(
                pack_path=PACK_PATH, preregistration_path=PREREG_PATH,
                output_pack=pack_out, output_preregistration=prereg_out,
                repository_root=REPO, source_sha256="a" * 64, surface_sha256="b" * 64,
                revision="2026-09-07.r2",
            )
            self.assertEqual(PACK_PATH.read_bytes(), original_pack)
            self.assertEqual(PREREG_PATH.read_bytes(), original_prereg)
            pack = json.loads(pack_out.read_text(encoding="utf-8"))
            prereg = json.loads(prereg_out.read_text(encoding="utf-8"))
            self.assertEqual(pack["revision"], "2026-09-07.r2")
            self.assertEqual(pack["provenance"]["source_surface_sha256"], "a" * 64)
            self.assertEqual(prereg["surface_identity"]["source_sha256"], "a" * 64)
            self.assertEqual(prereg["surface_identity"]["surface_sha256"], "b" * 64)
            self.assertEqual(prereg["arms"]["baseline"]["surface_sha256"], "b" * 64)
            self.assertEqual(prereg["benchmark_pack"]["sha256"], result["benchmark_pack_file_sha256"])
            self.assertEqual(prereg["benchmark_pack"]["path"], str(pack_out.relative_to(REPO)))
            self.assertEqual(BenchmarkPack.load(pack_out).revision, "2026-09-07.r2")
            self.assertEqual(BaselinePreregistration.load(prereg_out).raw["benchmark_pack"]["revision"], "2026-09-07.r2")

    def test_reissue_rejects_bad_identity_or_output_escape(self) -> None:
        with tempfile.TemporaryDirectory(dir=REPO) as directory:
            output = pathlib.Path(directory)
            kwargs = dict(
                pack_path=PACK_PATH, preregistration_path=PREREG_PATH,
                output_pack=output / "pack.json", output_preregistration=output / "prereg.json",
                repository_root=REPO, source_sha256="not-a-hash", surface_sha256="b" * 64,
                revision="2026-09-07.r2",
            )
            with self.assertRaisesRegex(ValueError, "source_sha256"):
                reissue(**kwargs)
            kwargs["source_sha256"] = "a" * 64
            kwargs["output_pack"] = REPO.parent / "outside-pack.json"
            with self.assertRaisesRegex(ValueError, "repository"):
                reissue(**kwargs)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import hashlib
import importlib.util
import json
import pathlib
import subprocess
import os
import re
import signal
import tempfile
import time

from .candidates import Candidate
from .manifest import canonical_json


class PiGateEvidenceError(ValueError):
    pass


def _row_digest(row: dict) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _row_key(row: dict) -> str:
    variant = ((row.get("prompt") or {}).get("variant")) or "canonical"
    return ":".join(str(row.get(field)) for field in ("run", "model", "split", "task")) + \
        f":{row.get('pattern') or row.get('arm')}:{row.get('rep')}:{re.sub(r'[^A-Za-z0-9._-]', '-', variant)}"


def validate_gate_evidence(rows: list[dict], validity_records: list[dict], *, campaign_sha256: str,
                           config_sha256: str | dict[str, str], surface_sha256: str,
                           experiment_cells: dict[str, str] | None = None,
                           model: dict | None = None, model_registry_sha256: str | None = None) -> list[dict]:
    verdicts = {record.get("row_key"): record for record in validity_records if isinstance(record, dict)}
    if not rows:
        raise PiGateEvidenceError("Pi gate produced no rows")
    if len(verdicts) != len(validity_records) or len(validity_records) != len(rows):
        raise PiGateEvidenceError("trial-validity sidecar is incomplete or contains duplicate/extra rows")
    accepted = []
    sessions = set(); runs = set(); serving_hashes = set()
    for index, row in enumerate(rows):
        errors = []
        if row.get("schema") != "pi.eval-row/v4": errors.append("schema")
        if row.get("authoritative") is not True or row.get("status") != "complete": errors.append("row-authority")
        execution = row.get("execution") or {}
        if execution.get("authoritative") is not True: errors.append("execution-authority")
        if model is not None and (row.get("model") != model.get("model") or execution.get("provider") != model.get("provider")):
            errors.append("model-binding")
        if model_registry_sha256 is not None and execution.get("agent_models_sha256") != model_registry_sha256:
            errors.append("model-registry-binding")
        if (row.get("harness") or {}).get("surface_sha256") != surface_sha256: errors.append("surface-binding")
        arm = row.get("arm") or row.get("pattern")
        expected_config = config_sha256.get(arm) if isinstance(config_sha256, dict) else config_sha256
        if not expected_config or (row.get("config") or {}).get("sha256") != expected_config: errors.append("config-binding")
        if (row.get("experiment") or {}).get("manifest_sha256") != campaign_sha256: errors.append("campaign-binding")
        if experiment_cells is not None and (row.get("experiment") or {}).get("cell") != experiment_cells.get(arm):
            errors.append("campaign-cell-binding")
        serving = row.get("serving") or {}; pre = serving.get("pre") or {}; post = serving.get("post") or {}
        if serving.get("stable") is not True or pre.get("status") != "complete" or post.get("status") != "complete" or pre.get("full_sha256") != post.get("full_sha256"):
            errors.append("serving-identity")
        elif not isinstance(pre.get("full_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", pre["full_sha256"]):
            errors.append("serving-identity")
        else:
            serving_hashes.add(pre["full_sha256"])
        context = row.get("context") or {}
        if context.get("schema") != "pi.context-telemetry/v4" or context.get("authenticated") is not True: errors.append("telemetry-authentication")
        if (row.get("exposure") or {}).get("status") not in ("control", "targeted", "engaged_only", "unexposed"):
            errors.append("exposure")
        key = _row_key(row)
        verdict = verdicts.get(key)
        if verdict is None or verdict.get("row_sha256") != _row_digest(row) or verdict.get("void") is not False:
            errors.append("trial-validity")
        session = row.get("gate_session_id")
        if not isinstance(session, str) or not session: errors.append("gate-session")
        elif session in sessions: errors.append("duplicate-gate-session")
        else: sessions.add(session)
        run = row.get("run")
        if not isinstance(run, str) or not run: errors.append("gate-run")
        else: runs.add(run)
        if errors:
            raise PiGateEvidenceError(f"gate row {index} is non-authoritative: {', '.join(errors)}")
        accepted.append(row)
    if len(runs) != 1:
        raise PiGateEvidenceError("gate rows span multiple invocations")
    if len(serving_hashes) != 1:
        raise PiGateEvidenceError("gate rows span multiple serving identities")
    return accepted


def load_fresh_gate_evidence(results_path: pathlib.Path, *, not_before_ns: int) -> tuple[list[dict], list[dict]]:
    results_path = pathlib.Path(results_path)
    if results_path.is_symlink():
        raise PiGateEvidenceError(f"gate evidence is not a file: {results_path.name}")
    results_path = results_path.resolve()
    sidecar = pathlib.Path(str(results_path) + ".validity.jsonl")
    for path in (results_path, sidecar):
        try:
            stat = path.stat()
        except OSError as exc:
            raise PiGateEvidenceError(f"missing gate evidence: {path.name}") from exc
        if stat.st_mtime_ns < not_before_ns:
            raise PiGateEvidenceError(f"stale gate evidence: {path.name}")
        if path.is_symlink() or not path.is_file():
            raise PiGateEvidenceError(f"gate evidence is not a file: {path.name}")
    def read_jsonl(path: pathlib.Path) -> list[dict]:
        records = []
        try:
            with path.open(encoding="utf-8") as fh:
                for number, line in enumerate(fh, 1):
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError("record is not an object")
                    records.append(value)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise PiGateEvidenceError(f"invalid {path.name}: {exc}") from exc
        return records
    return read_jsonl(results_path), read_jsonl(sidecar)


class PiGateScenario:
    """Initial V2 bridge to the trusted Bash evaluator.

    Actual execution is intentionally explicit. Offline verification calls only
    :meth:`dry`, while campaigns call :meth:`run_gate` after approval.
    """

    plugin_name = "pi-gate"

    def __init__(self, optimizer_root: pathlib.Path, benchmark, surface, run_root: pathlib.Path,
                 adapter_config: dict, campaign):
        self.optimizer_root = optimizer_root.resolve()
        self.real_gate = self.optimizer_root / "real_gate.sh"
        self.benchmark = benchmark
        self.surface = surface
        self.campaign = campaign
        self.run_root = run_root.resolve()
        self.evidence_root = self.run_root / "gate-evidence"
        self.evidence_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.evidence_root, 0o700)
        required = {"case_tasks", "model_control", "gate_network", "llama_endpoint", "model_registry_sha256"}
        optional = {"pi_timeout_seconds", "calibration_repetitions"}
        if not isinstance(adapter_config, dict) or set(adapter_config) - required - optional or required - set(adapter_config):
            raise ValueError("pi-gate adapter_config has missing or unknown fields")
        case_ids = {case.case_id for split in benchmark.splits.values() for case in split}
        case_tasks = adapter_config["case_tasks"]
        if not isinstance(case_tasks, dict) or set(case_tasks) != case_ids or any(not isinstance(value, str) or not value for value in case_tasks.values()):
            raise ValueError("pi-gate case_tasks must map every benchmark case exactly once")
        if adapter_config["model_control"] not in ("llama", "pi-native") or adapter_config["gate_network"] not in ("endpoint", "open"):
            raise ValueError("pi-gate model_control or gate_network is invalid")
        endpoint = adapter_config["llama_endpoint"]
        if not isinstance(endpoint, dict) or set(endpoint) != {"scheme", "host", "port"} or endpoint.get("scheme") != "http" or endpoint.get("host") != "loopback" or not isinstance(endpoint.get("port"), int) or isinstance(endpoint.get("port"), bool) or not 1 <= endpoint["port"] <= 65535:
            raise ValueError("pi-gate llama_endpoint must be a valid loopback HTTP endpoint")
        if not isinstance(adapter_config["model_registry_sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", adapter_config["model_registry_sha256"]):
            raise ValueError("pi-gate model_registry_sha256 must be resolved")
        self.config = dict(adapter_config)
        self.calibrated_cases: dict[str, set[str]] = {}

    @staticmethod
    def _model_key(model: dict) -> str:
        return json.dumps(model, sort_keys=True, separators=(",", ":"))

    def set_calibrated_cases(self, model: dict, selected: set[str]) -> None:
        self.calibrated_cases[self._model_key(model)] = set(selected)

    def _bind_serving_identity(self, model: dict, full_sha256: str) -> None:
        path = self.run_root / "serving-contract.json"
        if path.is_symlink():
            raise PiGateEvidenceError("serving contract must not be a symlink")
        model_key = hashlib.sha256(self._model_key(model).encode()).hexdigest()
        if path.exists():
            try: contract = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc: raise PiGateEvidenceError("serving contract is malformed") from exc
            if not isinstance(contract, dict) or contract.get("schema") != "pi.optimizer-serving-contract/v1" or not isinstance(contract.get("models"), dict):
                raise PiGateEvidenceError("serving contract is malformed")
        else:
            contract = {"schema": "pi.optimizer-serving-contract/v1", "models": {}}
        prior = contract["models"].get(model_key)
        binding = {"model": model, "full_sha256": full_sha256}
        if prior is not None and prior != binding:
            raise PiGateEvidenceError("serving identity changed across campaign operations")
        if prior is not None:
            return
        contract["models"][model_key] = binding
        data = json.dumps(contract, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        fd, temporary = tempfile.mkstemp(prefix=".serving-contract.", dir=self.run_root)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data); fh.flush(); os.fsync(fh.fileno())
            os.replace(temporary, path); os.chmod(path, 0o600)
            directory_fd = os.open(self.run_root, os.O_RDONLY)
            try: os.fsync(directory_fd)
            finally: os.close(directory_fd)
        except Exception:
            try: os.unlink(temporary)
            except OSError: pass
            raise

    def dry(self) -> str:
        completed = subprocess.run([str(self.real_gate), "--dry"], cwd=self.optimizer_root, check=True, capture_output=True, text=True)
        return completed.stdout

    def run_gate(self, arguments: list[str], *, timeout_seconds: int, stdin=None) -> subprocess.CompletedProcess:
        return subprocess.run([str(self.real_gate), *arguments], cwd=self.optimizer_root, stdin=stdin, check=False, capture_output=True, text=True, timeout=timeout_seconds)

    def _manifest_path(self, campaign) -> pathlib.Path:
        path = self.run_root / "resolved-campaign.json"
        data = canonical_json(campaign.raw)
        if hashlib.sha256(data).hexdigest() != campaign.sha256:
            raise PiGateEvidenceError("resolved campaign bytes do not match campaign identity")
        if path.is_symlink():
            raise PiGateEvidenceError("resolved campaign artifact must not be a symlink")
        if path.exists() and path.read_bytes() != data:
            raise PiGateEvidenceError("resolved campaign artifact changed")
        if not path.exists():
            fd, temporary = tempfile.mkstemp(prefix=".campaign.", dir=self.run_root)
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, "wb") as fh:
                    fh.write(data); fh.flush(); os.fsync(fh.fileno())
                os.replace(temporary, path); os.chmod(path, 0o600)
                directory_fd = os.open(self.run_root, os.O_RDONLY)
                try: os.fsync(directory_fd)
                finally: os.close(directory_fd)
            except Exception:
                try: os.unlink(temporary)
                except OSError: pass
                raise
        return path

    def _case_map(self, split: str, model: dict) -> tuple[dict[str, str], list[str]]:
        if split == "test":
            raise ValueError("opaque test split cannot be evaluated during optimization")
        selected = self.calibrated_cases.get(self._model_key(model))
        cases = [case for case in self.benchmark.splits[split] if selected is None or case.case_id in selected]
        mapping = {self.config["case_tasks"][case.case_id]: case.case_id for case in cases}
        if len(mapping) != len(cases) or not mapping:
            raise ValueError(f"pi-gate {split} cases must resolve to distinct gate tasks")
        return mapping, sorted(mapping)

    def _invoke(self, campaign, *, parent: Candidate, candidate: Candidate | None, split: str,
                model: dict, seeds: tuple[int, ...], operation_id: str) -> tuple[list[dict], list[dict]]:
        task_to_case, tasks = self._case_map(split, model)
        operation_key = hashlib.sha256(operation_id.encode()).hexdigest()[:16]
        evidence_dir = self.evidence_root / operation_key
        evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700); os.chmod(evidence_dir, 0o700)
        results = evidence_dir / "rows.jsonl"
        manifest_path = self._manifest_path(campaign)
        base_path = self.surface.materialize(parent)
        cand_path = self.surface.materialize(candidate) if candidate is not None else base_path
        arm = "both" if candidate is not None else ("base" if parent.mutation_family == "seed" else "cand")
        expected_configs = {
            "base": parent.provenance["materialized_config_sha256"],
            "cand": (candidate or parent).provenance["materialized_config_sha256"],
        }
        cells = {"base": parent.candidate_id, "cand": (candidate or parent).candidate_id}
        expected_arms = {"base", "cand"} if candidate is not None else {arm}
        expected_cells = {(task, rep, expected_arm) for task in tasks for rep in range(1, len(seeds) + 1) for expected_arm in expected_arms}

        def load_validated(not_before_ns: int) -> list[dict]:
            rows, validity = load_fresh_gate_evidence(results, not_before_ns=not_before_ns)
            accepted = validate_gate_evidence(
                rows, validity, campaign_sha256=campaign.sha256,
                config_sha256=expected_configs, surface_sha256=campaign.provenance["surface_sha256"],
                experiment_cells=cells, model=model,
                model_registry_sha256=self.config["model_registry_sha256"],
            )
            actual_cells = {(row["task"], row["rep"], row["arm"]) for row in accepted}
            if actual_cells != expected_cells:
                raise PiGateEvidenceError("Pi gate result cells are incomplete or duplicated")
            self._bind_serving_identity(model, (accepted[0]["serving"]["pre"])["full_sha256"])
            return accepted

        sidecar = pathlib.Path(str(results) + ".validity.jsonl")
        attempt_marker = evidence_dir / "attempt.started"
        if results.exists() or sidecar.exists() or attempt_marker.exists():
            if results.is_file() and sidecar.is_file():
                return load_validated(0), [{"task": task, "case_id": task_to_case[task]} for task in tasks]
            raise PiGateEvidenceError("prior Pi gate attempt is incomplete; refusing duplicate model sessions")
        environment = dict(os.environ)
        environment.update({
            "GEN": f"optimizer-v2-{operation_key}", "BASE": str(base_path), "CAND": str(cand_path),
            "N": str(len(seeds)), "ARM": arm, "RESULTS": str(results), "RESULTS_MODE": "truncate",
            "REAL_GATE_RUNS": str(evidence_dir / "workspaces"), "PI_TIMEOUT": str(self.config.get("pi_timeout_seconds", campaign.limits["case_timeout_seconds"])),
            "PI_PROVIDER": model["provider"], "PI_MODEL": model["model"],
            "MODEL_CONTROL": self.config["model_control"], "GATE_NETWORK": self.config["gate_network"],
            "LLAMA_URL": f"{self.config['llama_endpoint']['scheme']}://127.0.0.1:{self.config['llama_endpoint']['port']}", "INTERLEAVE": "on",
            "AGENT_MODELS_SHA256": self.config["model_registry_sha256"],
            "EXPERIMENT_MANIFEST": str(manifest_path), "EXPERIMENT_MANIFEST_SHA256": campaign.sha256,
            "EXPERIMENT_BASE_CELL": cells["base"], "EXPERIMENT_CAND_CELL": cells["cand"],
        })
        with attempt_marker.open("x", encoding="utf-8") as marker:
            os.chmod(attempt_marker, 0o600)
            marker.write(json.dumps({"operation_sha256": hashlib.sha256(operation_id.encode()).hexdigest()}) + "\n")
            marker.flush(); os.fsync(marker.fileno())
        directory_fd = os.open(evidence_dir, os.O_RDONLY)
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
        started = time.time_ns()
        process = subprocess.Popen(
            [str(self.real_gate), *tasks], cwd=self.optimizer_root, env=environment,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True,
        )
        try:
            stdout, stderr = process.communicate(timeout=campaign.limits["wall_seconds"])
        except subprocess.TimeoutExpired as exc:
            os.killpg(process.pid, signal.SIGTERM)
            try: stdout, stderr = process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); stdout, stderr = process.communicate()
            raise PiGateEvidenceError("Pi gate execution exceeded campaign wall-clock bound") from exc
        for name, value in (("stdout.log", stdout), ("stderr.log", stderr)):
            path = evidence_dir / name; path.write_text(value, encoding="utf-8"); os.chmod(path, 0o600)
        if process.returncode:
            raise PiGateEvidenceError(f"Pi gate execution failed with exit status {process.returncode}")
        accepted = load_validated(started)
        return accepted, [{"task": task, "case_id": task_to_case[task]} for task in tasks]

    @staticmethod
    def _evaluation(candidate: Candidate, rows: list[dict], case_map: list[dict], *, split: str,
                    model: dict, seeds: tuple[int, ...], arm: str) -> dict:
        by_task = {value["task"]: value["case_id"] for value in case_map}
        observations = []
        for row in rows:
            if row["arm"] != arm:
                continue
            rep = int(row["rep"])
            observations.append({
                "case_id": by_task[row["task"]], "seed": seeds[rep - 1], "repetition": 0,
                "score": int(row["score"]), "outcome": "success" if row["score"] else "failure",
                "trace_index_sha256": _row_digest(row),
                "summary": {
                    "subscores": {key: (row.get("subscores") or {}).get(key) for key in ("fixed", "total")},
                    "trajectory": {key: (row.get("trajectory") or {}).get(key) for key in (
                        "turns", "tool_calls", "tool_errors", "reads", "unique_reads",
                        "repeat_calls", "first_mutation_turn", "compactions", "subagent_calls",
                    )},
                    "retried": int(row.get("retried", 0)),
                },
            })
        return {
            "schema": "pi.optimizer-evaluation/v1", "split": split,
            "candidate_id": candidate.candidate_id, "model": model,
            "observations": observations, "guards": {"security_failures": 0},
            "mechanism_exposed": arm == "cand" and all((row.get("exposure") or {}).get("status") == "targeted" for row in rows if row["arm"] == arm),
            "serving_identity_stable": all((row.get("serving") or {}).get("stable") is True for row in rows),
        }

    def calibrate(self, campaign, *, model: dict) -> dict:
        seed = self.surface.seed_candidate(campaign)
        selected = []
        selected_rates = []
        admission_records = {}
        repetitions = int(self.config.get("calibration_repetitions", len(campaign.seeds)))
        calibration_seeds = tuple(range(repetitions))
        rule_path = self.optimizer_root / "prompt-lab" / "admission_rule.py"
        spec = importlib.util.spec_from_file_location("pi_optimizer_admission_rule", rule_path)
        rule = importlib.util.module_from_spec(spec); spec.loader.exec_module(rule)
        for split in ("train", "development"):
            rows, case_map = self._invoke(campaign, parent=seed, candidate=None, split=split, model=model, seeds=calibration_seeds, operation_id=f"calibration:{model['provider']}:{model['model']}:{split}")
            by_task = {value["task"]: value["case_id"] for value in case_map}
            grouped: dict[str, list[dict]] = {}
            for row in rows:
                grouped.setdefault(by_task[row["task"]], []).append(row)
            for case_id, sample in grouped.items():
                verdict = rule.core_admission(sample)
                admission_records[case_id] = verdict
                if verdict["verdict"] == "ADMITTED":
                    selected.append(case_id)
                    selected_rates.append(verdict.get("mean", verdict.get("correct", 0) / repetitions))
        return {"status": "informative" if selected else "uninformative", "model": model, "selected_case_ids": selected, "observed_rate": sum(selected_rates) / len(selected_rates) if selected_rates else 0, "band": campaign.benchmark["discrimination_band"], "admission": admission_records}

    def evaluate(self, candidate: Candidate, *, split: str, model: dict, seeds: tuple[int, ...], operation_id: str) -> dict:
        rows, case_map = self._invoke(self.campaign, parent=candidate, candidate=None, split=split, model=model, seeds=seeds, operation_id=operation_id)
        return self._evaluation(candidate, rows, case_map, split=split, model=model, seeds=seeds, arm="base" if candidate.mutation_family == "seed" else "cand")

    def evaluate_pair(self, parent: Candidate, candidate: Candidate, *, model: dict, seeds: tuple[int, ...], operation_id: str) -> dict:
        rows, case_map = self._invoke(self.campaign, parent=parent, candidate=candidate, split="train", model=model, seeds=seeds, operation_id=operation_id)
        parent_eval = self._evaluation(parent, rows, case_map, split="train", model=model, seeds=seeds, arm="base")
        candidate_eval = self._evaluation(candidate, rows, case_map, split="train", model=model, seeds=seeds, arm="cand")
        order = {}
        for index, row in enumerate(rows):
            key = (row["task"], row["rep"]); order.setdefault(key, []).append((index, row["arm"]))
        by_task = {value["task"]: value["case_id"] for value in case_map}
        arm_order = [{"case_id": by_task[task], "seed": seeds[rep - 1], "repetition": 0, "order": [arm for _, arm in sorted(values)]} for (task, rep), values in sorted(order.items())]
        return {"schema": "pi.optimizer-paired-evaluation/v1", "parent": parent_eval, "candidate": candidate_eval, "arm_order": arm_order}

    def diagnosis_evidence(self, parent: dict, candidate: dict | None = None) -> dict:
        def bounded(value: dict) -> list[dict]:
            return [{"case_id": row["case_id"], "outcome": row["outcome"], "summary": row.get("summary") or {}, "trace_index_sha256": row["trace_index_sha256"]} for row in value["observations"]]
        result = {"schema": "pi.optimizer-diagnosis-evidence/v1", "split": "train", "parent": bounded(parent)}
        if candidate is not None: result["candidate"] = bounded(candidate)
        return result

# Benchmark integrity operations

`real_gate.sh` now consumes `pi.fixture/v1` manifests from
`real-gate-fixtures/manifests/` and writes `pi.eval-row/v3` rows. V3 binds the
authenticated semantic-episode settlement and provider timing aggregates; v2
remains historical and is not eligible for powered episode studies. A fixture is
authoritative only when triple-run admission passes, artifact hashes match, the
90-day expiry has not elapsed, and a named human reviewer has approved it —
approved *this* manifest, pinned by `admission.manifest_sha256`.

```sh
# Read-only health check: runs all automated fixture checks and changes no files.
python3 prompt-lab/fixture_admission.py verify t1
python3 prompt-lab/fixture_admission.py verify --all

# Admission operation: records fresh automated evidence in each manifest.
python3 prompt-lab/fixture_admission.py check t1
python3 prompt-lab/fixture_admission.py check --all
python3 prompt-lab/fixture_admission.py review-packet t1
python3 prompt-lab/fixture_admission.py approve t1 --reviewer "Name"
```

`verify` and `check` execute the same artifact-drift, pristine, gold-patch, and
shortcut-mutant checks. `verify` is strictly read-only: it does not update the
manifest's automated-admission evidence or create a review packet. `check` is
the evidence-recording admission operation to run before human review and
approval.

Approval also approves the three reviewed semantic prompt perturbations and
sets expiry to 90 days from review. It records `manifest_sha256` over the whole
manifest except the `admission` block, so editing any field that defines the
test — `tests.*.command`, `overlays`, `timeout_seconds`, `grade_artifact`,
prompts, expiry — makes the fixture non-authoritative until it is re-approved.
`check`/`verify` report the mismatch but still run and record evidence, which is
what makes edit → `check` → `approve` the repair path. Expired fixtures cannot be reactivated; make
a new version/cohort instead. Incident lifecycle commands are:

```sh
python3 prompt-lab/incident_corpus.py intake ID --source SOURCE --summary TEXT
python3 prompt-lab/incident_corpus.py promote ID --manifest PATH
python3 prompt-lab/incident_corpus.py expire ID --reason TEXT
```

Normal runs reject non-authoritative fixtures. `--exploratory` is an explicit
override, but those rows are marked non-authoritative and every adoption report
returns `INCOMPLETE`. `--robustness` adds the three reviewed prompt forms and a
single-request, tool-free one-shot control for context packs no larger than 48
KiB. Only canonical `val` rows contribute to adoption statistics.

The default reusable fixture is the repository's `pi-test/`. Set
`PI_TEST_FIXTURE=/absolute/path/to/fixture` only when intentionally evaluating
another compatible checkout; no private home-directory checkout is assumed.

```sh
./real_gate.sh --robustness t1 t2
./real_gate.sh --exploratory --robustness t1
```

Interactive Pi is not wrapped by the benchmark Seatbelt profile and retains its
normal network access. `real_gate.sh` has two explicit egress modes:

```sh
# Default: DNS, HTTPS, native cloud providers, and network tools are available.
# Filesystem/read isolation remains active, but rows are exploratory.
GATE_NETWORK=open MODEL_CONTROL=pi-native \
  PI_MODEL=openai/gpt-5 ./real_gate.sh parens

# OpenAI-compatible llama.cpp/router control plane.
GATE_NETWORK=open MODEL_CONTROL=llama \
  LLAMA_URL=http://box:8080 PI_MODEL=remote-llamacpp/model ./real_gate.sh parens

# Contamination-resistant authoritative transport requires loopback.
GATE_NETWORK=endpoint MODEL_CONTROL=llama \
  LLAMA_URL=http://127.0.0.1:8080 PI_MODEL=model ./real_gate.sh parens
```

`GATE_NETWORK=endpoint` is the default and denies all egress except the rendered
loopback model endpoint. `GATE_NETWORK=open` is an explicit override that retains
the filesystem jail but always produces non-authoritative rows.
Seatbelt cannot pin a raw remote IP, so a remote endpoint uses a port-scoped
wildcard and is also non-authoritative. Only an endpoint-restricted loopback or
localhost tunnel can produce authoritative rows.

On macOS, `SANDBOX=on` uses `sandbox-exec` for filesystem read/write isolation.
If Seatbelt is unavailable or `SANDBOX=off` is selected, public tasks may still
run but are prominently warned and forced to exploratory status. Hidden tasks
are refused outright without read isolation. `GATE_MIRROR_DENY` may name an
additional fixture mirror whose graders must also be unreadable.

`MODEL_CONTROL=llama` retains `/health`, `/v1/models`, warm-up, and serving
fingerprint behaviour. `MODEL_CONTROL=pi-native` requires `PI_MODEL`, accepts an
optional `PI_PROVIDER`, passes provider selection directly to Pi, and skips all
llama-specific control-plane calls. A provider-qualified model such as
`anthropic/claude-sonnet-4-5` is preferred. Native-provider one-shot controls are
recorded as ineligible because that arm must make a direct API request without Pi.

Serving fingerprints are captured before and after every row. The current
`pi.serving-fingerprint/v2` contract separates a semantic identity (model
bytes, runtime build, template, context/token ceilings, reasoning/decoding,
cache, speculation, and normalized launch flags) from a performance identity
(threads, batches, parallel slots, accelerator placement, split mode, and
tensor split). It also hashes the canonical union. Any missing field, within-row
change in any of the three hashes, or within-stage serving mismatch makes a
failure-episode study incomplete.

For a remote loopback tunnel, set `SERVING_FINGERPRINT_HELPER` to an absolute,
private executable. The parent invokes it with only `--model ID`, a fixed
environment allowlist, discarded stderr, a 20-second deadline, and a 64 KiB
output cap. It must print exactly one validated v2 JSON object. SSH aliases,
commands, endpoints, paths, and credentials stay in that private helper; none
are copied into the repository, evaluated child, manifest, or result row.
`SERVING_FINGERPRINT_FILE` and `SERVING_FINGERPRINT_URL` remain compatibility
inputs for generic exploratory runs, but the powered Ling runner requires the
helper and refuses inherited HTTP credentials.

`failure_episode_trial.py` is the only supported scheduler for the semantic
trial. Its commands are deliberately separate:

```sh
python3 prompt-lab/failure_episode_trial.py preflight PRIVATE_MANIFEST.json
python3 prompt-lab/failure_episode_trial.py calibrate PRIVATE_MANIFEST.json --execute
python3 prompt-lab/failure_episode_trial.py power PRIVATE_MANIFEST.json
python3 prompt-lab/failure_episode_trial.py primary PRIVATE_MANIFEST.json --execute
python3 prompt-lab/failure_episode_trial.py primary-report PRIVATE_MANIFEST.json
python3 prompt-lab/failure_episode_trial.py replication PRIVATE_MANIFEST.json --execute
python3 prompt-lab/failure_episode_trial.py final-report PRIVATE_MANIFEST.json
```

No command launches the next stage. The manifest contains only bounded public
identifiers and frozen hashes. Resumable rows, run worktrees, state, and reports
live under the private agent artifact directory with private permissions. The
runner refuses calibration until active-only prompts and enforced arbitration
are the deployed defaults, the endpoint is a credential-free loopback tunnel,
the private helper is valid, fixtures are approved, and registry/config hashes
match. Mac and network-box runs therefore become separate serving blocks even
when their semantic hashes happen to match; their rows are compared, never
pooled.

Character counts live only in `usage.output_chars` with
`usage.source=char_proxy`. Cost comparisons require exact input and output token
counts on every compared row.

Keep provider credentials in environment variables, the Pi auth store, or an OS
keychain. Do not paste bearer tokens into shell command text, process arguments,
logs, manifests, or result rows. Rotate any credential previously exposed that
way before relying on it again.

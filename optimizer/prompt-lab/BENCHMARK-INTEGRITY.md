# Benchmark integrity operations

`real_gate.sh` now consumes `pi.fixture/v1` manifests from
`real-gate-fixtures/manifests/` and writes `pi.eval-row/v2` rows. A fixture is
authoritative only when triple-run admission passes, artifact hashes match, the
90-day expiry has not elapsed, and a named human reviewer has approved it.

```sh
python3 prompt-lab/fixture_admission.py check t1
python3 prompt-lab/fixture_admission.py check --all
python3 prompt-lab/fixture_admission.py review-packet t1
python3 prompt-lab/fixture_admission.py approve t1 --reviewer "Name"
```

Approval also approves the three reviewed semantic prompt perturbations and
sets expiry to 90 days from review. Expired fixtures cannot be reactivated; make
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

`GATE_NETWORK=open` is the default and leaves network operations allowed while
retaining the filesystem jail. Such rows are always marked non-authoritative.
`GATE_NETWORK=endpoint` denies all egress except the rendered model endpoint.
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

Serving fingerprints are captured before and after every row. Any missing
field, backend hot-swap, or paired-arm mismatch makes comparison reports
`INCOMPLETE`. Remote servers may supply an equivalent document using
`SERVING_FINGERPRINT_FILE` or `SERVING_FINGERPRINT_URL`.

Character counts live only in `usage.output_chars` with
`usage.source=char_proxy`. Cost comparisons require exact input and output token
counts on every compared row.

Keep provider credentials in environment variables, the Pi auth store, or an OS
keychain. Do not paste bearer tokens into shell command text, process arguments,
logs, manifests, or result rows. Rotate any credential previously exposed that
way before relying on it again.

# Truth-and-coherence hardening QA

This is a bounded, non-secret record of the regression counterfactuals for the
three-PR series. It records commands and test names only; it contains no matched
secret text, tool arguments, provider endpoints, or private paths.

## PR 1 — runtime topology and mirror truth

Counterfactual: the ordered-entry prelude was temporarily removed from
`hashSurface`, restoring the legacy set-only digest. The command
`node --test --experimental-strip-types --test-name-pattern='extension order as causal topology' harness/tests/surface-walk.test.ts`
failed at `hashSurface treats extension order as causal topology`, with the
forward and reverse manifests producing the same digest. Restoring the topology
prelude made the focused suite green.

Independent gates: `npm run verify` passed 551 tests plus typecheck, health,
deterministic package smoke, and optimizer verification. Peer-boundary smoke,
diff check, and diff secret scan passed. Isolated packed consumers for Pi 0.80,
0.81, 0.82, 0.83, and 0.84 each typechecked and loaded 31 extensions and two
skills. No `context-pressure*` file changed and no live agent directory was used.

## PR 2 — session identity and analysis populations

Three counterfactuals were exercised. Restoring `beginSession()` in
`runtime-truth` made `manifest-first bootstrap gives every session_start row one
identity and non-null surface` fail with two identities. Replacing transitive
root resolution with the former one-hop `sp` grouping made
`shadow_report.py --selftest` fail at the root→child→grandchild assertion.
Classifying the post-`plan_go`-hold active surface instead of the bootstrap
baseline made `bootstrap baseline prevents plan_go's internal review hold from
looking like --tools` fail because dynamic tools were no longer deferred.

After restoration, `npm run verify` passed 557 tests plus typecheck, health,
deterministic package smoke, and optimizer verification. The diff secret scan
and diff check passed. Isolated packed consumers for Pi 0.80–0.84 each
typechecked and loaded 32 extensions and two skills. A temporary agent-dir
mirror wrote and checked 111 artifacts with zero drift; the live agent was not
modified.

## PR 3 — model-input trust and one-voice control

Five counterfactuals were exercised. Restoring raw live error prose in the
blackboard made `hostile live failure prose reaches no snapshot, cockpit,
telemetry, notification, or lens` fail. Restoring the single integer validator
for context fields made `restored percentages and ratios preserve their domains
and fractions` fail. Disabling enforce-mode lens merging made `enforce merges
the lens before one correction and reserves the intact tail` fail. Restoring
the vendored subagent's ambient manual in active-only mode made `inactive tools
contribute no schema, snippet, guideline, or ambient prompt bytes` fail.
Restoring the old payload-audit lens marker made `thinking replay and lens
position are detected` fail.

After restoration, `npm run verify` passed 567 tests plus typecheck, health,
deterministic package smoke, and optimizer verification. The packed artifact
contained 141 files and loaded 32 extensions plus two skills. Peer-boundary
checks rejected both unsupported edges and accepted both supported edges.
Isolated packed consumers for Pi 0.80, 0.81, 0.82, 0.83, and 0.84 each
typechecked and loaded all 32 extensions and both skills. A temporary agent-dir
mirror wrote and checked 111 artifacts with zero drift, and Pi's loader returned
all 32 entries in manifest order. The live agent directory was not modified.

The final diff check and non-echoing secret scan passed. The package and mirror
manifests cover every changed first-party runtime file. No `context-pressure*`
file changed. The source surface hash is
`9a5a99dcf66ae8e44eb2e2831ac4a03e8c025f6582380d0a868ae3d7afa881eb`.

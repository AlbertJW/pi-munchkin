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

Pending.

## PR 3 — model-input trust and one-voice control

Pending.

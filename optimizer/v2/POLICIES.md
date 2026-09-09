# Decision policies: new contracts and legacy interpretation

New campaigns should use a versioned policy. Existing approved manifests and
stored events are not rewritten. A manifest change requires a new approval SHA.

| Policy | Required fields besides name | Meaning |
|---|---|---|
| `net-case-wins/v1` | `minimum_cases`, `minimum_net_wins` | Engineering threshold, not a significance test |
| `case-sign/v1` | `minimum_cases`, `alpha` | Exact one-sided sign test over independent case-level changes |
| `case-permutation/v1` | `minimum_cases`, `alpha`, `max_exact_cases` | Exact one-sided paired sign-flip test over case-level mean differences |

All fields are mandatory; unknown fields, booleans-as-numbers, nonfinite values,
alpha outside (0,1), and incompatible metric kinds fail at manifest loading.
Case counts are positive integers. The exact permutation ceiling is 20 cases;
there is no sampled permutation mode, ignored sampling seed, or early stopping.

For each paired cell, subtract parent score from candidate score and reverse
the sign when minimizing. Average those differences within each case. Seeds
and repetitions do not create independent cases. The engine requires all
declared seeds for each selected training case, and every calibrated development
case for every model. Arbitrary missing/duplicate cells or wrong model identities
fail before provider evolution. Train cases cannot come from development/test.

Case differences within 1e-12 of zero are ties for sign/threshold policies.
Ties count toward minimum case coverage but not the sign-test denominator.
With w wins and l losses the exact sign p-value is
sum(C(w+l,k), k=w..w+l) / 2^(w+l). Five independent wins give 1/32;
five repeated wins on one case give 1/2 and only one independent case.
Permutation evaluates every sign assignment, uses a 1e-12 comparison tolerance,
and requires a positive mean difference as well as p <= alpha. Its case limit
includes ties. Equality at alpha passes. An all-tie comparison never improves.

Binary reflection uses task outcome labels, respecting metric direction.
Continuous reflection uses only improved/regressed/unchanged; a score change is
not evidence of task completion. Classification counts remain cell counts for
diagnosis; statistical policy reports separately identify the case sampling unit.

All acceptance still requires exposure and hard guards. Development primary
regressions against the chosen parent reject the change. Every guard model has
a baseline measurement and must not regress below that baseline or fail a hard
guard. Rejected changes cannot supply positive lessons. Development payloads and
traces remain quarantined; aggregate development feedback does guide search.
Consequently p-values are per-comparison diagnostics, not campaign-wide error
control or a claim of independent held-out generalization after adaptive search.
Final selection remains development score, guard margin, diff size, stable ID.

## Legacy contracts

`exact-sign` historically means net cell fixes >= `minimum_net_fixes`; it is not
an exact statistical test. Its optional `max_exact_cells` was validated but not
used. `paired-permutation` historically enumerates cell-level sign flips (maximum
20 nonzero cells); its `permutations` field was validated but not used. These
legacy interpretations remain for old manifests, not as recommended new policy.
Previously recorded decisions are immutable. No historical result is promoted.

`examples/campaign-qualified.json` is a **fake-only** one-family, one-iteration
preparation example. It does not qualify Ling, Qwen, or a real benchmark pack.
Use `python3 -m optimizer.v2.cli prepare --manifest
optimizer/v2/examples/campaign-qualified.json` to inspect its approval identity.
Real G05-F preparation remains pending the G03 execution adapter and a newly
bound source/config/surface manifest. No deployment is authorized by a decision.

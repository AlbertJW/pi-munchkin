# Small-model harness improvement roadmap

This is the current research-to-experiment queue for pi-munchkin. It is deliberately a measurement plan, not a list of prompt opinions: every behavioral change needs a paired target-model result, a mechanism metric that moves in the predicted direction, and a rollback condition.

## Evidence baseline

A read-only scan of the live Pi history on 2026-07-19 found 1,709 sessions, 35,442 assistant turns, and 34,065 tool calls. The coarse historical totals were:

- 23.0% exact repeated tool calls and 25.3% exact repeated reads;
- 29.5% tool results marked as errors (mixed task/test/error classes; not yet a causal rate);
- 3.7 turns to first mutation among sessions that mutated;
- 25.9 million model-visible tool-result characters;
- 155 compaction entries.

Telemetry contained 1,124 verify-gate steers, 850 unverified endings, 651 outcome-loop steers, and only 51 micro-gate fires. These are mixed historical populations: they identify experiment targets but cannot justify a live policy change until provenance and per-session joins are complete.

The live and published harnesses also differ in three matching extensions (`git-guard`, `ketch`, and `plan-runner`), while the live tree lacks the published shared gate/URL policy modules. Establish deployment parity before attributing an A/B result to the published harness.

## Research principles

1. **Optimize the interface and state machine before adding prose.** SWE-agent shows that agent-computer interface design materially changes coding performance with the same underlying model. Anthropic likewise recommends simple, composable workflows and clear tool interfaces.
2. **Treat context as a finite, noisy working set.** Use bounded retrieval, progressive disclosure, high-recall compaction, structured durable state, and clearing of stale raw tool results.
3. **Grade outcomes and trajectories separately.** The final filesystem/test state is authoritative; process metrics explain why it changed and guard against accidental wins.
4. **Measure reliability, not only mean accuracy.** Report ordinary pass rate plus task-stratified all-*k* reliability across repeated trials. A candidate that wins once but fails intermittently is not a small-model improvement.
5. **Keep safety deterministic.** Network, filesystem, destructive-command, credential, and verification-command policy belongs outside the model loop.

Primary references:

- Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Anthropic, [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- Anthropic, [Agent Skills and progressive disclosure](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- Yang et al., [SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering](https://arxiv.org/abs/2405.15793)
- Li et al., [ContextBench](https://arxiv.org/abs/2602.05892)
- Kang et al., [ACON](https://arxiv.org/abs/2510.00615)

## Experiment queue

### P0 — trust the measurement system

1. **Deployment parity and safety contract**
   - Hash the loaded live extensions and the packaged manifest at startup/health check.
   - Remove the live YOLO instruction that says destructive work may proceed directly; autonomy can remove routine check-ins, never safety approval.
   - Acceptance: zero unexplained live/package hash drift and 100% approval behavior across destructive Git, deployment, restart, credential, and external-side-effect scenarios.

2. **Telemetry provenance**
   - Add harness version/hash, model/provider, run/session ID, config hash, and `interactive|gate|test` source.
   - Tests must write only to a temporary telemetry file.
   - Acceptance: the test suite changes live telemetry by zero bytes; every gate row has an exact event join.

3. **Authoritative optimizer defaults**
   - Default optimization tasks must be an approved, root-disjoint suite; `t1,t2,t3` are currently non-authoritative.
   - Make held-out roots mandatory for promotion and persist compact run manifests with hashes/fingerprints.
   - Acceptance: a default run can produce a promotable verdict without an exploratory override.

### P1 — highest-value small-model experiments

4. **Context/output budget factorial**
   - RTK output limit: off / 8K / 12K characters.
   - Span tools: off / on.
   - Context watcher: 60 / 70 / 80%.
   - Observational memory: live-aligned arm versus gate-passive arm.
   - Tasks: `bigdata` plus a long, independently rooted multi-file task.
   - Measure: pass rate, all-*k* reliability, overflow, compaction requester and compression ratio, rereads, returned characters, wall time, and lost-evidence failures.
   - Watcher requester/threshold telemetry is now captured per gate workdir and joined by the
     exact session key, including watcher-disabled native compactions and pre/post estimates.
     The factorial remains blocked on an approved context-pressure fixture; `bigdata` is not
     evidence for watcher behavior (historical bigdata span exposure was 0/181 sessions).
   - Valid precursor: [`span-screen.json`](../prompt-lab/configs/span-screen.json) and
     [`span_screen.py`](../prompt-lab/span_screen.py) run one span-tools off/on A/B on approved
     `bigdata` (n=6, α=0.05). Receipt-backed treatment compliance is mandatory and diagnostic-only;
     zero candidate exposure, missing exhaustive receipts, provenance drift, or baseline exposure
     makes the screen `INELIGIBLE` rather than changing task scores. Because Pi does not expose the
     actually loaded extension/lib set, `ELIGIBLE` means same-run screen only; require a fresh
     confirmation after live/package parity and loaded-surface identity are proven.
     The screen binds the fleet report's daily-driver gate to the single model
     proven by its result rows, so endpoint-resolved small models cannot inherit
     the historical qwen36 fallback and receive a false rejection.

5. **Skill disclosure and distractor load**
   - Compare a five-skill shortlist with the full visible global inventory.
   - Include matched skill tasks and distractor tasks.
   - Measure: trigger precision/recall, prompt tokens before first action, irrelevant skill reads, task success, and latency.

6. **Verification policy factorial**
   - Verify gate: off / one steer plus enforced safe gate / current bounded steers.
   - Micro-gate: off / on.
   - Include syntax errors, stale tags, no-op edits, mutating-linter lookalikes, and false completion claims.
   - Measure: unverified endings, steer-to-green conversion, injected characters, wall time, false blocks, and task success.

7. **Outcome-defined progress and retry policy**
   - A mutation counts as progress only after a successful result and observable state change.
   - Compare repeat thresholds 2/3, outcome thresholds 2/3, abort/block, and fresh/locality retry.
   - Measure: false resets, false aborts, turns to recovery, repeated failing outcomes, tokens, and task success.

8. **Tool ACI sweep**
   - Compare the current palette with a smaller task-oriented palette using strict schemas and compact receipts.
   - Vary tool description/name/result format independently.
   - Measure: correct-tool selection, valid arguments, recovery after errors, calls/returned bytes per pass, and stale-observation failures.

### P2 — promotion quality and efficiency

9. **Paired inference and adaptive sampling**
   - Compare independent Fisher decisions with an exact paired test over matched baseline/candidate cells.
   - Cluster by semantic root; add repetitions only for discordant/borderline cells under a fixed alpha-spending plan.
   - Acceptance: bounded synthetic-null Type-I error with lower median session cost.

10. **Successive-halving candidate screen**
    - Screen on the actual target model using several calibrated, root-disjoint tasks instead of one task on a transfer model.
    - Measure recall of the eventual full-gate winner, reversal rate, and screening cost.

11. **Promotion/canary/rollback record**
    - Require single-candidate confirmation, untouched held-out roots, a small live canary, hashes/fingerprints, and atomic rollback material.
    - Roll back on correctness regression, cost breach, increased unverified endings, or increased false aborts.

## Result-row surface

New gate rows retain a `trajectory` object alongside outcome and usage:

`turns`, `tool_calls`, `tool_errors`, `reads`, `unique_reads`, `repeat_calls`, `repeat_reads`, `tool_result_chars`, `first_mutation_turn`, and `compactions`.

The original TSV metric positions remain stable for compatibility. Fleet reports now add descriptive task-stratified all-*k* reliability; Fisher-based adoption logic remains unchanged until the paired-inference experiment proves a replacement.

Rows may also carry authenticated `context` (`pi.context-telemetry/v1`): the exact
workdir/session key, content SHA-256, watcher configuration, requester/reason compaction
counts, and watcher request completion/failure estimates. Gate telemetry travels over an
unlinked inherited descriptor and every event is HMAC-verified; evaluated tools cannot
write that descriptor. The field is optional so historical v2 rows remain valid.

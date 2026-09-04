# Qwen 35B planner completion mechanism smoke v9 — audit (2026-09-04)

**MECHANISM LIFECYCLE PASS; NOT EFFICACY EVIDENCE.** This is an explicitly
approved continuation smoke after the incomplete v8 screen. It exercised the
current branch-report protocol and its parent-owned graph on Qwen 35B, then ran
the matching lightweight negative control. It was not a powered quality study,
and it does not authorize planner defaults, adoption, mirroring, or optimizer
use. The run used `VERIFY_GATE=off` to keep an unrelated no-project-gate
intervention from competing with the research lifecycle; that deviation is why
this receipt remains mechanism-only rather than a preregistered efficacy row.

## Bound identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Loaded surface SHA-256: `184c9178950c38c2caf469f68bfee242bddbbf24af299172bd3a91d68511417a`.
- Candidate configuration SHA-256:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`.
- Control configuration SHA-256:
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.
- Fixture: `compare-json-yaml-config`, manifest SHA-256
  `c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646`.

## Safe receipts

The candidate completed in 509.550 seconds with exit code 0, zero stderr, and
1,656,197 captured stdout bytes. It recorded exactly one graph start and two
validated branch merges, with no branch failures. Both roots reached terminal
`deferred` status with bounded evidence gaps and no depth-two children; the
parent reread delegated leads, retried settlement twice after strict provenance
rejections, and then recorded one successful terminal settlement. The persisted
state is schema v5, contains two roots, and has no open or blocked nodes.

The control completed in 42.870 seconds with exit code 0, zero stderr, and
115,122 captured stdout bytes. It recorded zero graph starts, zero branch
merges, and zero graph settlements. Its two generic `settled` lifecycle rows
are ordinary agent settlement events, not planner events. No plan state was
created by the control.

Raw prompts, responses, queries, URLs, quotes, answers, and tool arguments stay
in the private run roots and are not evidence in this repository.

## Interpretation and next step

The repaired protocol now demonstrates bounded graph operability on this
subject: a child cannot falsely complete an incomplete retrieval, partial
evidence is preserved as an explicit deferral, parent validation remains
mandatory, and the control stays dormant. This does not establish answer
quality, research benefit, cost, or generalization. Keep
`PLAN_GRAPH=off` and `DEEP_RESEARCH_PLANNING=off` in live defaults. The next
authorized step is a newly prepared, preregistered multi-fixture candidate /
control screen under the current source and loaded-surface hashes, followed by
separate review before any rollout decision.

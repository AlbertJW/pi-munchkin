# Qwen 35B planner mechanism v6 — audit (2026-09-03)

## Verdict

**INCOMPLETE MECHANISM OBSERVATION — NO QUALIFYING SCREEN.** The single
preregistered diagnostic used the repaired tool contract and the exact loaded
surface, but it reached the bounded output cap with one open graph item and no
branch merge or parent settlement. It shows reachability and actionable error
guidance only; planner defaults remain dark.

## Frozen identity and bounded run

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source surface:
  `0d3c7871a22d210ba52cf2f3117a5da9cef087fb4caee4e6c46c3601224a88e6`.
- Loaded surface:
  `12fbe4cd2f6555f24810af69d914037d0d20d9a1c3c930f47e2a8c4b52ab27e9`.
- Arm: candidate; config:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c5f5fd1e`.
- Bound: 180-second wall and 350,000 combined stdout/stderr bytes.

The launcher verified the arm config and loaded hash before starting Pi. The
run exited 143 at the output cap after 60.514 seconds, with 350,000 stdout
bytes and zero stderr. Telemetry contained 113 authenticated rows; all rows
were source-bound to the loaded hash and a structural scan found no raw prompt,
query, URL, quote, content, answer, transcript, argument, or tool-input keys.
Safe stream digests are stdout
`37835ceaf77080079b5dbadf1e986c49683fc3425a35118a87db5869a0f94be8` and
telemetry `4099b1a7abaa9568fe1034bb2f86c66adda7201ca931b19f0c56cc3215f1caf8`;
raw streams remain private in the temporary run root.

## Structural outcome

The model emitted one `research-start`, nine successful source receipts, and
no branch merge or parent settlement. The graph remained open with one item.
The repaired actionable envelope appeared four times in the bounded model
output, while the old generic error appeared zero times. This confirms that
the model received the correction affordance; it does not establish that the
planner improves answers or completes research within the bound.

## Interpretation and next action

V6 closes a real tool-contract usability gap exposed by v5, but the diagnostic
is still incomplete. Do not pool it with v2–v5 and do not treat it as a
quality, efficacy, adoption, or default decision. A future multi-session screen
must be freshly preregistered with a completion-shaped fixture and explicit
success criteria for branch merge, evidence reread, and parent settlement.
`PLAN_GRAPH` and `DEEP_RESEARCH_PLANNING` remain off by default.

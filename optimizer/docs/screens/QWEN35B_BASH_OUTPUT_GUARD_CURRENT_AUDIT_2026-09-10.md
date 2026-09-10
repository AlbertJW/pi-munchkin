# Audit: current-source Qwen bash-output guard value screen (2026-09-10)

## Result

This frozen four-case screen is **incomplete and unresolved**. It must not be
retried under its existing manifest. The result artifact is private, mode 0600,
and is identified publicly only by its SHA-256:
`e18795288b69d4340abd3c5f19c62a1f9849a7ff32bfd076c63c1a837a55d7f2`.

The run was `decead54-1590-4395-bf97-92927a2f6265`, bound to preregistration
approval `1a3f1f0425ce5b6bad7cbd28ca08aa521416771b8fbfb374dce9058f36846813`.
All four fresh Pi subprocesses exited successfully and reached their fixed
final-answer oracles within their four-request caps. This does not satisfy the
screen's completion rule, which also required exactly one Bash execution per
case and its declared exposure.

## Observations

The ordinary control and ordinary treatment each performed one Bash execution,
had no guard error or withholding, and retained 20 visible Bash characters.
The noisy control performed the requested noisy Bash call twice, had no guard
withholding, and retained 12,001 visible Bash characters. The noisy treatment
also performed the call twice: the guard withheld both oversized results,
reported two tool errors, and retained 244 visible Bash characters. Both noisy
cases used two provider requests.

So the guard mechanism was exposed and substantially reduced the visible noisy
tool result without a false positive on the ordinary case. However, the model's
duplicate noisy command caused treatment to withhold twice rather than exactly
once, failing the preregistered recovery/exposure rule. A mechanism observation
is not a quality result, and the candidate stays dark.

## Decision

`BASH_OUTPUT_GUARD=on` remains **unresolved** and default-off. A later screen
would need a new diagnosis and preregistration aimed at duplicate-command
recovery, with an independent correctness and recovery-cost measure. This
screen neither adopts nor retires the guard; it changes no defaults, mirror, or
live deployment.

# Preregistration: aggregate context admission model-switch smoke (2026-09-07)

## Status and scope

**EXECUTED — clean mechanism receipt recorded 2026-09-07.** This screen
exercises the opt-in aggregate admission observer on one Qwen turn, switches
the same RPC session to Ling, and exercises one Ling turn. It is a protocol and
identity screen, not a capacity benchmark, quality comparison, gate row, or
adoption decision.

## Frozen identity

- Source/runtime commit: `41d4c4c`
- Package-source surface SHA-256:
  `2ea73f29383607cbef5473e0edf1b620f13f3e70602c95c05ec018a946e45d96`
- Loaded Pi agent surface SHA-256:
  `5d7216b4e209c40033ec84b5929d68e7678e4a95046280f7c2c914a1ff061025`
- Pi runtime: `0.85.1`
- Initial model: `local-llamacpp/qwen36-35b-iq3s`
- Destination model: `local-llamacpp/ling3-tiny-fast`
- Flags: `CONTEXT_ADMISSION=on`, `CONTEXT_HANDOFF=off`,
  `CONTEXT_DISCOVERY=off`, `GOALS=off`, `PLAN_GRAPH=off`,
  `DEEP_RESEARCH_PLANNING=off`, `RESEARCH_LEDGER=off`

## Fixture and sequence

1. Start one disposable RPC session pinned to Qwen and issue one short prompt.
2. Wait for the first provider timing to settle with a successful status.
3. Issue `set_model` to the registered Ling fast model.
4. Wait for the second provider timing to settle, issue one short Ling prompt,
   then shut down the session.
5. Inspect only safe telemetry fields: session identity, loaded surface hash,
   model/epoch, admission outcome, token counts, and provider status.

The driver uses a 600-second process-group wall bound and retains no model
text, prompts, tool arguments, URLs, endpoints, or source contents. Handoff is
explicitly off so this screen isolates epoch rebinding; the existing handoff
receipts remain the evidence for compaction behavior.

## Acceptance

Accept only if the process exits zero with zero stderr, there is one session
identity and exactly one loaded surface hash on every row, epochs `0` and `1`
are Qwen and Ling respectively, both provider timings are status `200`, and
both aggregate-admission rows are admitted. Any mixed identity, missing epoch,
raw endpoint, failed response, timeout, or stderr invalidates the screen.

## Execution receipt

- Exit `0`; stderr `0` bytes; two settled provider turns; one session identity.
- Exactly two context profiles: epoch `0` Qwen and epoch `1` Ling. Both expose
  declared context `61,440` and safe input `52,224` tokens.
- Exactly two aggregate-admission rows, epochs `0` and `1`, both
  `outcome=admitted`; observed payloads were conservatively counted and no
  reservations were outstanding.
- Both provider-timing rows returned status `200`.
- All 43 telemetry rows carried the loaded hash above and the same session
  identity; every row used `source=interactive`.
- No handoff was requested (`CONTEXT_HANDOFF=off`); no raw endpoint, prompt,
  response, tool argument, URL, or source content appeared in telemetry.

This receipt qualifies the current harness protocol and epoch binding only. It
does not qualify model task performance or justify enabling admission by
default; `CONTEXT_ADMISSION` remains opt-in pending a separate value/safety
decision.

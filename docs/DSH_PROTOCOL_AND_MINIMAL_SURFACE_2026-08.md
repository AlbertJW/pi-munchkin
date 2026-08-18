# DeepSeek-inspired diagnostics and minimal surface

This document records a small, reversible comparison inspired by the public
DeepSeek Harness documentation. It is an engineering diagnostic, not a claim
that the DeepSeek defaults improve Ling Tiny.

The runtime now exposes two dark pieces. `/munchkin-doctor` reports a redacted
protocol-parity line: Pi's API, declared reasoning state, an allow-listed
thinking format, the number of declared thinking levels, constrained-sampling
capability, and the observed stream shape. The settlement telemetry row carries
the same enums and counters for each settled agent run. Unknown custom API
identifiers collapse to the fixed `custom` family rather than being echoed. No
prompt, request body, thinking text, tool arguments, URL, endpoint, or provider
secret is retained.

`MUNCHKIN_TOOL_SURFACE=minimal` is an opt-in surface candidate. With a complete
Pi registry and no narrowed explicit selection, it leaves only `read`, `bash`,
`edit`, and `write` active. It does not replace Pi's tool definitions, add a
code runtime, or activate `subagent` or `compact_context` later. An incomplete
registry or explicit `--tools` selection is preserved unchanged. The default is
`default`, so this candidate changes no ordinary session.

The reduced surface also derives active-only prompt behavior, even if dynamic
activation itself is set to `ambient`, so absent tools do not leave ambient
manuals or examples behind. `ACTIVE_TOOL_PROMPTS=ambient` remains the explicit
prompt rollback.

The run kernel also performs a shadow compaction projection check. It verifies
that identity, surface, plan, mutation, failure, and context-generation facts
survive the event projection. A failed check records only a fixed reason enum;
it never steers, blocks, retries, or changes the run.

These mechanisms exist to answer three cheap questions before an A/B round:
whether the model is receiving the protocol shape we think it is, whether a
lean surface is actually present when selected, and whether compaction preserves
the facts used for later measurement. They remain observational and reversible.

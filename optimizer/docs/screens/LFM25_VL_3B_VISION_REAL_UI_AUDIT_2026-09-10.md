# Audit: LFM 2.5 VL 3B real-UI vision qualification V1 (2026-09-10)

## Invalid diagnostic

V1 sent one request to `local-llamacpp/lfm25-vl-3b`, received HTTP 200, and
matched the `GREEN` oracle. Its private receipt is mode 0600 and has digest
`706e2e470384c4940abc18fe8033f19376c3047848e2a6cf599306bdfaf0b4a0`.

This is not qualifying evidence. The runner bound fixture, renderer, image,
and model identity, but did not bind its own source digest into V1's approval
input. The source-binding fault was caught before this result was entered as a
candidate receipt, repaired with a targeted failing regression, and followed
by separately preregistered V2. V1 is retained as an invalid diagnostic only;
it establishes no model capability or adoption conclusion.

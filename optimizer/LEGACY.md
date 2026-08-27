# Legacy optimizer freeze

Everything in `optimizer/` except `optimizer/v2/`, this marker, and verification
wiring is the frozen historical optimizer and measurement programme. Its scripts,
raw rows, preregistrations, journals, and reports remain in place so prior claims
can be audited. They are unsupported for new campaigns.

Historical evidence is external context only. It is never translated into V2
events, never creates a V2 candidate, and never satisfies a V2 acceptance gate.
New work starts from a freshly prepared `pi.optimizer-campaign/v2` manifest.


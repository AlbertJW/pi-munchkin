# Research hardening QA — 2026-08-10

This records mechanism checks for the review-only `RESEARCH_LEDGER` hardening change. It is not an
efficacy result and must not be pooled with measurements from another harness surface hash.

## Counterfactuals

| Defect | Counterfactual | Targeted result |
|---|---|---|
| Pi error contract | Temporarily restored `research_note` returning an `isError` property instead of throwing. | `research_note refusal is a real Pi error and a verification episode` failed because Pi reported `isError=false`. The throwing implementation was restored before the suite reran. |
| Delegated proof | Exercised the former child-citation wording as an isolated legacy fixture. The repository safety guard prohibited temporarily weakening the executable skill. | The fixture contains no parent `web_read` requirement; the production skill contract and child-lead→parent-read integration test reject that behavior. |
| Markdown ledger injection | Exercised the fixed triple-backtick renderer as an isolated legacy fixture with a fence-closing page quote. | The legacy output creates a forged Markdown section; v2 serialization keeps the same payload in one parseable JSON record. |

## Acceptance evidence

- The targeted research-ledger suite covers genuine Pi errors, parent-owned proof, private
  permissions, query removal, capacity bounds, bounded recall, malformed tails, injection payloads,
  dark tool omission, and absence of project-local artifacts.
- Full verification, package smoke, peer boundaries, Pi 0.80–0.83 isolated consumers, and the
  non-echoing diff secret scan are required before the PR is offered for review.
- No live mirror, default change, adoption, or gate round is authorized by this record.

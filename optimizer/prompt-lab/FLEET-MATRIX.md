# FLEET-MATRIX — standing instrument registry (2026-07-13)

Sweep: n=2 micro-gate classifier (+2B equil confirmed to n=5), 900s cap, minimal governor
baseline, both llama-swap routers. Selection constraint (user): no large models, box preferred.

## Selected instrument set

| member | router | tasks in band | est. rate | speed | role |
|---|---|---|---|---|---|
| **qwopus35-4b-mtp** | box | parens, equil, bigdata | ~40–55% | 57 t/s, ~3–5 min/session | all-round anchor (2 weeks of history) |
| **qwen35-2b-opus-reasoning** | box | equil only | 40% (2/5) | thinking-heavy, 900s cap advised | narrow instrument + overthinking diagnostics |

## Excluded, with reasons

| member | router | verdict |
|---|---|---|
| granite-4.0-h-tiny | box | floored 0/6 despite 82 t/s — speed without gradient is worthless |
| lfm25-8b-a1b-apex | box | floored 0/6 — APEX quant tool-call weakness now has 2 strikes (35B demotion + this) |
| marco-nano | box (removed) | no structured tool calls |
| gemma4-26b-hauhau | mac | 16.8GB — excluded per no-large-models rule (parens 0/1 partial, unmeasured otherwise) |
| qwen36-35b-iq3s (DD) | mac | large + workstation rule; its band is known separately (roman/titlecase/bigdata) |
| mellum2-12b-thinking | mac | gradient on parens 1/2 + bigdata 1/2 (!), but 13GB + mac-hosted; **best future addition** if a granted window appears — only non-Qwen family with measured gradient |
| grug-v2-9b | mac | unmeasured (sweep crash); 7GB — eligible for a future small-model mac block |
| qwopus35-9b-coder | mac | unmeasured (sweep crash); known overthinker on hard tasks (cal9h partial) |

## Honest limitation
The selected set is 2 members from 1 family (both Jackrong Qwen). Fleet verdicts read
"consistent across two Qwen tiers", NOT "cross-family general". Mellum (or grug) added later
upgrades that claim; recorded, not blocking.

## Speed notes
grug's 15.7 t/s is serving config (no MTP), not model quality — annotate, don't penalize.
2B/9B/mellum thinking blowouts are real: 900s cap is the fleet standard now.

# Preregistration: current-source Qwen native grep/find mechanism screen (2026-09-10)

## Scope

This supersedes the older prepared 4B study for a bounded Qwen 35B mechanism
qualification. It does not claim a task-quality winner or authorise adoption.
Two fresh, isolated Pi runs receive the same temporary project, in the fixed
order control then treatment. The hidden token is in an unknown nested file;
the model must find `MUNCHKIN_SEARCH_TOKEN` and answer only its value.

## Frozen arms and limits

The fixture is `harness/tests/fixtures/grep-find-qwen-v1.json`, bound to
requested/served model `local-llamacpp/qwen36-35b-iq3s` /
`qwen36-35b-iq3s`. The control sets `GREP_FIND_TOOLS=off`; treatment sets it
to `on`. Both use the normal core profile—there is no explicit Pi `--tools`
allowlist, which would override the feature being measured. Each process has a
private model catalog, a 32,768-token declared window, a 128-token completion
cap, a 180-second wall, and no more than four forwarded provider requests.

The frozen manifest SHA-256 is
`f53dc548ebaa11e416a24e5c87489ab8b2039f018392fa0fcdf751275a78589a`; the
run must use approval SHA-256
`97a3a6431500d9443ac5ccc8e828f0070ba95afff2ad4da99f422dc600002432`.
That approval includes the probe, activation extension, safe Pi JSON collector,
and local proxy route digests.

The task asks for non-mutating discovery and explicitly prohibits Bash, but the
collector records rather than assumes compliance. It retains only process
outcome, request count, safe builtin-tool counts (`read`, `bash`, `grep`,
`find`, `edit`, `write`), final-answer hash comparison, and source/configuration
digests. It never retains prompts, paths, project contents, tool output, model
text, or endpoint.

## Hypothesis and decision rule

The treatment should complete the answer oracle and invoke both Pi-native
`find` and `grep`; the control should complete without either native call. A
clean mechanism receipt requires both arms to complete within their caps,
zero native calls in control, and both native calls in treatment. Any other
outcome is an incomplete or negative mechanism result and is not retried under
this manifest.

Even a clean result proves only availability and use. It cannot establish a
quality, context-cost, or default-adoption benefit; a separate fixed
search-heavy comparison against the existing search path would still be needed.
No default, mirror, deployment, or adoption change is in scope.

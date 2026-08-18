// Runner-owned preload for the GRADED re-run (real_gate.sh). The hidden grader must
// import model-authored `src/` in its own process, so that src runs BEFORE the
// assertions do and can simply neuter them:
//
//   for (const k of Object.getOwnPropertyNames(assert)) assert[k] = () => {};
//
// Verified 2026-08-18: that six-line prelude turned an honest 0/5 into a forged 5/5
// with the REAL case names, defeating the admitted case pin (which can only see
// names, not whether an assertion actually ran).
//
// This module is loaded with `--import` from a path outside the workdir, so it runs
// before any fixture or model module, and freezes the assertion surfaces. A later
// assignment then throws (ESM/strict) or is silently ignored, and the real
// assertions still fire.
//
// This does NOT make grading adversary-proof — see SECURITY_BOUNDARY.md: model code
// still shares the process, can read the row-context sibling, and can rewrite the
// reporter output after node exits. Full closure needs the out-of-process verifier.
import assert from "node:assert";
import strict from "node:assert/strict";

for (const target of [assert, strict]) {
  for (const key of Object.getOwnPropertyNames(target)) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor && descriptor.configurable && "value" in descriptor) {
      Object.defineProperty(target, key, { ...descriptor, writable: false, configurable: false });
    }
  }
  Object.freeze(target);
}

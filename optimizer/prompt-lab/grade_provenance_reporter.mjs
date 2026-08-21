// Runner-owned SECOND reporter for the GRADED re-run (real_gate.sh), alongside the
// TAP reporter. It records WHERE each top-level test was registered, so an injected
// test is visible even when its NAME is one the admitted case pin expects.
//
// Why a reporter and not a preload wrapper: `node --test <file>` executes each test
// file in a CHILD process and streams events to the runner PARENT, where reporters
// run. The parent never loads model-authored `src/`, so this module cannot be
// monkey-patched by the code it is reporting on — unlike grade_preload.mjs, which
// shares the child with src and only survives by freezing itself first.
//
// Measured on node v26.5.0 (2026-08-21): `data.file` is the CALL SITE of `test()`,
// not the test file that was launched. A `test()` called from an imported
// `src/evil.js` reports `file: .../src/evil.js` while the grader's own tests report
// the grader path — which is exactly the discrimination grade_reporter.check_
// provenance needs.
//
// HONEST LIMIT: the event data is produced in the CHILD, where model code runs.
// `vm.runInThisContext(code, { filename })` forges `file` (measured: a spoofed
// registration reported the grader's own path). `lineOffset` shifts `line` with it,
// which is why the line is range-checked against the installed grader; a spoof that
// also lands in range is not detected here. This layer RAISES the bar; the layer
// that removes the attack is eval_fixture.grading_secrets (the pin is no longer on
// disk at all), and full closure is the out-of-process verifier in
// SECURITY_BOUNDARY.md.
export default async function* provenanceReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const data = event.data ?? {};
    // Top level only — grade_reporter grades top-level TAP results, so the two
    // channels must describe the same population or the count check is meaningless.
    if (data.nesting !== 0) continue;
    // Skip/todo are excluded from grading, so exclude them here too.
    if (data.skip || data.todo) continue;
    yield `${JSON.stringify({
      name: typeof data.name === "string" ? data.name.slice(0, 200) : "",
      file: typeof data.file === "string" ? data.file : "",
      line: Number.isInteger(data.line) ? data.line : 0,
      column: Number.isInteger(data.column) ? data.column : 0,
      pass: event.type === "test:pass",
    })}\n`;
  }
}

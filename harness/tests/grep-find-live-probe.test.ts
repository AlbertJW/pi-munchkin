import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/grep-find-live-probe.mjs", import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });

test("grep/find probe freezes matched arms without model execution", () => {
  const first = JSON.parse(run("--dry")); const second = JSON.parse(run("--prepare"));
  assert.deepEqual(first, second);
  assert.equal(first.inference, false);
  assert.deepEqual(first.case_order, ["control", "treatment"]);
  assert.match(first.source.probe_sha256, /^[0-9a-f]{64}$/);
  assert.match(first.task_sha256, /^[0-9a-f]{64}$/);
});

test("grep/find probe refuses a model run without its exact approval", () => {
  assert.throws(() => run("--run", "--model", "local-llamacpp/qwen36-35b-iq3s"), /approval, model, fixture, or source binding mismatch/);
});

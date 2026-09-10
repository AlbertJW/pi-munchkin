import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/context-admission-live-probe.mjs", import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });

test("context-admission probe dry mode freezes fixture and source inputs without model execution", () => {
	const first = JSON.parse(run("--dry"));
	const second = JSON.parse(run("--dry"));
	assert.deepEqual(first, second);
	assert.equal(first.inference, false);
	assert.equal(first.model, "local-llamacpp/qwen36-35b-iq3s");
	assert.match(first.approval_sha256, /^[0-9a-f]{64}$/);
	assert.match(first.source.context_admission_sha256, /^[0-9a-f]{64}$/);
	assert.match(first.source.probe_sha256, /^[0-9a-f]{64}$/, "the runnable probe itself must be approval-bound");
	assert.match(first.source.local_proxy_route_sha256, /^[0-9a-f]{64}$/, "the forwarding route policy must be approval-bound");
});

test("context-admission probe refuses a model run without the frozen approval", () => {
	assert.throws(() => run("--run", "--model", "local-llamacpp/qwen36-35b-iq3s"), /approval, model, fixture, or source binding mismatch/);
});

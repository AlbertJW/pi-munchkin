import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/vision-quality-probe.mjs", import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });

test("vision quality probe prepares a deterministic frame and approval digest offline", () => {
	const first = JSON.parse(run("--prepare"));
	const second = JSON.parse(run("--prepare"));
	assert.equal(first.inference, false);
	assert.deepEqual(first, second);
	assert.match(first.frame_sha256, /^[0-9a-f]{64}$/);
	assert.match(first.manifest_sha256, /^[0-9a-f]{64}$/);
});

test("vision quality probe dry mode never executes a model", () => {
	const output = JSON.parse(run("--dry"));
	assert.equal(output.inference, false);
	assert.equal(output.quality_model, "local-llamacpp/qwen36-35b-iq3s-vision");
});

test("vision quality probe rejects missing approval before any provider call", () => {
	assert.throws(() => run("--run", "--approve-sha", "0".repeat(64), "--model", "local-llamacpp/qwen36-35b-iq3s-vision"), /vision quality probe requires/);
});

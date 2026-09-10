import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/vision-real-ui-probe.mjs", import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });

test("real-UI probe dry mode binds the browser fixture without launching a renderer or model", () => {
	const first = JSON.parse(run("--dry"));
	const second = JSON.parse(run("--dry"));
	assert.deepEqual(first, second);
	assert.equal(first.inference, false);
	assert.equal(first.quality_model, "local-llamacpp/qwen36-35b-iq3s-vision");
	assert.match(first.fixture_html_sha256, /^[0-9a-f]{64}$/);
	assert.match(first.manifest_sha256, /^[0-9a-f]{64}$/);
	assert.match(first.source.probe_sha256, /^[0-9a-f]{64}$/, "the runnable probe itself must be approval-bound");
});

test("real-UI probe refuses model mode before renderer execution when approval inputs are absent", () => {
	assert.throws(() => run("--run"), /requires --chrome/);
});

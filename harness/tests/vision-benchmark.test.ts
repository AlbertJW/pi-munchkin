import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const script = join(process.cwd(), "harness", "scripts", "vision-benchmark.mjs");
const qwenVisionManifest = join(process.cwd(), "harness", "tests", "fixtures", "vision-contract-qwen36-35b-vision-v1.json");
const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8", env: { ...process.env, TELEMETRY: "off" } });

test("vision benchmark selftest and dry modes are deterministic and offline", () => {
	const selftest = run("--selftest");
	assert.equal(selftest.status, 0);
	const manifest = JSON.parse(selftest.stdout);
	assert.equal(manifest.inference, false);
	assert.equal(manifest.cases, 5);
	const dry = run("--dry");
	assert.equal(dry.status, 0);
	const prepared = JSON.parse(dry.stdout);
	assert.equal(prepared.manifest_sha256, manifest.manifest_sha256);
	assert.equal(prepared.inference, false);
});

test("vision benchmark approval and model binding fail closed", () => {
	const dry = JSON.parse(run("--dry").stdout);
	const mismatch = run("--run", "--approve-sha", "0".repeat(64), "--model", dry.protocol_model);
	assert.equal(mismatch.status, 3);
	const unknown = run("--run", "--approve-sha", dry.manifest_sha256, "--model", "unknown-model");
	assert.equal(unknown.status, 3);
	const result = run("--run", "--approve-sha", dry.manifest_sha256, "--model", dry.protocol_model);
	assert.equal(result.status, 0);
	const measured = JSON.parse(result.stdout);
	assert.equal(measured.inference, false);
	assert.deepEqual(measured.arms.map((arm: { arm: string }) => arm.arm), ["uncached", "exact_cache", "near_cache", "sam_assisted"]);
	assert.equal(measured.arms.find((arm: { arm: string }) => arm.arm === "near_cache").missed_changes, 2);
});

test("vision benchmark binds a newly prepared manifest and its registered vision model", () => {
	const dry = run("--dry", "--manifest", qwenVisionManifest);
	assert.equal(dry.status, 0);
	const prepared = JSON.parse(dry.stdout);
	assert.equal(prepared.quality_model, "local-llamacpp/qwen36-35b-iq3s-vision");
	const result = run("--run", "--manifest", qwenVisionManifest, "--approve-sha", prepared.manifest_sha256, "--model", prepared.quality_model);
	assert.equal(result.status, 0);
	assert.equal(JSON.parse(result.stdout).model, prepared.quality_model);
});

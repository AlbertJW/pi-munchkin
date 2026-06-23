import assert from "node:assert/strict";
import test from "node:test";
import { assertVerifyGateAllowed, classifyBashCommand, discardsUncommittedWork, isBashMutation, isSourceMutation, looksFailingOutput } from "../lib/command-policy.ts";

test("isSourceMutation: ops/infra churn does NOT arm the verify gate", () => {
	// ops/infra — change deps/containers/VCS/env, not source → must not arm
	for (const c of [
		"pnpm install --frozen-lockfile",
		"pip3 install -r requirements.txt",
		"poetry install --with dev --no-interaction",
		"npm ci",
		"docker compose up -d --build",
		"docker compose down",
		"git commit -m 'wip'",
		"git checkout master",
		"python3.12 -m venv .venv",
		"brew install jq",
	]) {
		assert.equal(isSourceMutation(c), false, `should not arm: ${c}`);
	}
});

test("isSourceMutation: real source edits DO arm (incl. ops+edit compounds)", () => {
	for (const c of [
		"sed -i '' s/a/b/ src/app.py",
		"echo 'x' > src/config.ts",
		"cat tmpl > main.go",
		"git commit -m x && sed -i s/a/b/ src/x.py", // compound: still touches source
	]) {
		assert.equal(isSourceMutation(c), true, `should arm: ${c}`);
	}
	// non-mutations never arm
	assert.equal(isSourceMutation("pytest -q"), false);
	assert.equal(isSourceMutation("git status"), false);
});

test("classifies read-only commands", () => {
	assert.deepEqual(classifyBashCommand("rg TODO src").risk, "read_only");
	assert.equal(isBashMutation("grep -R foo . > /dev/null"), false);
});

test("classifies normal file mutations", () => {
	assert.equal(classifyBashCommand("sed -i '' s/a/b/ file.txt").risk, "mutating");
	assert.equal(classifyBashCommand("python3 -c \"open('x','w').write('y')\"").mutates, true);
	assert.equal(isBashMutation("echo hello > out.txt"), true);
});

test("classifies destructive/high-risk commands", () => {
	assert.equal(classifyBashCommand("rm -rf build").risk, "destructive");
	assert.equal(classifyBashCommand("git reset --hard HEAD").destructive, true);
	assert.equal(classifyBashCommand("docker compose down").destructive, true);
});

test("recognizes verify-like commands", () => {
	assert.equal(classifyBashCommand("npm test").risk, "verify");
	assert.equal(classifyBashCommand("tsc --noEmit").verifyLike, true);
	assert.equal(classifyBashCommand("just verify").verifyLike, true);
	assert.equal(classifyBashCommand("custom verify", ["custom verify"]).verifyLike, true);
});

test("plan gates allow verify commands only", () => {
	assert.deepEqual(assertVerifyGateAllowed("npm test"), { ok: true });
	assert.equal(assertVerifyGateAllowed("echo ok").ok, false);
	assert.equal(assertVerifyGateAllowed("touch sentinel").ok, false);
	assert.equal(assertVerifyGateAllowed("rm -rf tmp").ok, false);
});

test("detects textual failures even when exit status is zero", () => {
	assert.equal(looksFailingOutput("PASS: 0 passed FAIL: 1 failed", false), true);
	assert.equal(looksFailingOutput("0 failed, 12 passed", false), false);
	assert.equal(looksFailingOutput("everything ok", true), true);
});

test("discardsUncommittedWork: flags only working-tree-destroying git", () => {
	// destroys uncommitted work → true
	for (const c of [
		"git reset --hard",
		"git reset --hard HEAD~1",
		"git checkout -- src/app.ts",
		"git checkout .",
		"git checkout -f",
		"git restore src/app.ts",
		"git clean -fd",
		"git clean -fdx",
		"git clean --force",
	]) assert.equal(discardsUncommittedWork(c), true, `should flag: ${c}`);

	// safe → false
	for (const c of [
		"git reset --soft HEAD~1",
		"git reset --mixed",
		"git reset HEAD file.txt",
		"git checkout main",
		"git checkout -b feature",
		"git restore --staged file.txt",
		"git clean -n",
		"git status",
		"git add -A",
		"git commit -m x",
		"git stash",
		"npm install",
		"rm -rf build",
	]) assert.equal(discardsUncommittedWork(c), false, `should NOT flag: ${c}`);
});

test("inline interpreters: read-only payloads are not mutations, writes are", () => {
	// read-only python/node one-liners (the manifest pre-flight pattern) → read_only
	for (const c of [
		`python3 -c "import json; print(json.load(open('m.json'))['status'])"`,
		`python3 -c 'import sys; [print(p) for p in sys.argv]'`,
		`node -e "console.log(require('./pkg.json').version)"`,
	]) {
		assert.equal(isBashMutation(c), false, `should be read-only: ${c}`);
		assert.equal(classifyBashCommand(c).risk, "read_only", `should classify read_only: ${c}`);
	}

	// payloads that actually write → mutating
	for (const c of [
		`python3 -c "open('x','w').write('y')"`,
		`python3 -c "import os; os.remove('x')"`,
		`python3 -c "import json; json.dump(d, open('o.json','w'))"`,
		`node -e "require('fs').writeFileSync('x','y')"`,
		`node --eval "require('child_process').execSync('rm x')"`,
	]) assert.equal(isBashMutation(c), true, `should be mutating: ${c}`);
});

test("verify-gate recognizes JS test runners, rejects non-verify gates", () => {
	for (const c of [
		"npx -y tsx --test tests/*.test.ts",
		"npx tsx --test",
		"tsx --test",
		"node --test",
	]) assert.equal(assertVerifyGateAllowed(c).ok, true, `should allow gate: ${c}`);

	for (const c of [
		"git diff --quiet",
		"git status",
		"ls ~/.pi/agent/skills",
	]) assert.equal(assertVerifyGateAllowed(c).ok, false, `should reject gate: ${c}`);
});

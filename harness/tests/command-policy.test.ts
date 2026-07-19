import assert from "node:assert/strict";
import test from "node:test";
import { assertVerifyGateAllowed, classifyBashCommand, discardGitTargets, discardWorkdir, discardsUncommittedWork, isBashMutation, isSourceMutation, looksFailingOutput } from "../lib/command-policy.ts";

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

test("unknown shell executables fail closed instead of bypassing mutation guards", () => {
	for (const c of ["./script.sh", "bash script.sh", "sh -c do-stuff", "curl https://example.com", "ruby -e do_stuff", "source ./env.sh", "my-project-tool run", "npm run dev", "make deploy", "npx arbitrary-tool", "find . -exec ./mutator {} ;"]) {
		assert.equal(classifyBashCommand(c).mutates, true, `unknown command must fail closed: ${c}`);
	}
	for (const c of ["cat file", "rg TODO src", "git status", "node -e \"console.log(1)\"", "python3 -c \"print(1)\""]) {
		assert.equal(classifyBashCommand(c).mutates, false, `known inspection remains read-only: ${c}`);
	}
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
	assert.equal(assertVerifyGateAllowed("tsc").ok, false, "emitting tsc is not a read-only gate");
	assert.equal(assertVerifyGateAllowed("eslint --fix src").ok, false);
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

// --- review regressions: dangerous-command matrix + command-position anchoring ---

test("classify: verify tokens only count at COMMAND POSITION (no silent gate-disarm)", () => {
	// these mention a test/verify word but are NOT verify commands — must be read-only
	for (const c of ["cat tests/test_foo.py", "ls tests/", "rg pytest src/", "echo pytest passed", "npm run dev", "grep -r 'go test' ."]) {
		assert.equal(classifyBashCommand(c).verifyLike, false, `must NOT be verify: ${c}`);
	}
	// real verify invocations, incl. after a prefix
	for (const c of ["pytest tests/", "cd sub && npm test", "python3 -m pytest", "node --test", "timeout 60 pytest"]) {
		assert.equal(classifyBashCommand(c).verifyLike, true, `must be verify: ${c}`);
	}
});

test("classify: dangerous commands are not misclassified as read_only", () => {
	const destructive = ["git push --force", "git push -f origin main", "find . -name '*.tmp' -delete", "rm -rf build"];
	for (const c of destructive) assert.equal(classifyBashCommand(c).risk, "destructive", `destructive: ${c}`);
	const mutating = ["truncate -s 0 f.log", "perl -pi -e 's/a/b/' f", "chmod -R 755 .", "cp a b", "FOO=1 git add ."];
	for (const c of mutating) assert.equal(classifyBashCommand(c).mutates, true, `mutates: ${c}`);
	// bare words inside a read-only command must NOT count as mutations ("progress")
	for (const c of ["grep cp file", "man mv", "echo rm -rf /", "git push origin main"]) {
		assert.equal(isBashMutation(c), false, `read-only: ${c}`);
	}
});

test("discardsUncommittedWork: covers the bypass forms the review found", () => {
	for (const c of [
		"git reset --hard",
		"git -C /tmp/repo reset --hard",
		`git -C "repo one" reset --hard`,
		"git -c core.editor=true checkout -- .",
		"git checkout HEAD -- .",
		"git checkout main --force",
		"git switch -f other",
		"git switch --discard-changes main",
		"git checkout .",
		"git restore src/app.ts",
		"git clean -fd",
	]) assert.equal(discardsUncommittedWork(c), true, `should guard: ${c}`);

	for (const c of [
		"git checkout main",
		"git checkout -b feature",
		"git checkout --track origin/x",
		"git reset --soft HEAD~1",
		"git restore --staged f",
		"git clean -n",
		"git status",
	]) assert.equal(discardsUncommittedWork(c), false, `should NOT guard: ${c}`);
});

test("discardWorkdir: dirty check targets the repo the command actually hits", () => {
	const cwd = "/work/here";
	const home = "/Users/me";
	// plain command → ctx.cwd
	assert.equal(discardWorkdir("git reset --hard", cwd, home), cwd);
	// cd prefix (&& and ;) → that dir
	assert.equal(discardWorkdir("cd /other/repo && git reset --hard", cwd, home), "/other/repo");
	assert.equal(discardWorkdir("cd sub/dir; git checkout -- .", cwd, home), "/work/here/sub/dir");
	// last cd before the git wins
	assert.equal(discardWorkdir("cd /a && cd /b && git reset --hard", cwd, home), "/b");
	// git -C wins
	assert.equal(discardWorkdir("git -C /repo2 reset --hard", cwd, home), "/repo2");
	// ~ expansion
	assert.equal(discardWorkdir("cd ~/proj && git clean -fd", cwd, home), "/Users/me/proj");
	assert.equal(discardWorkdir("git -C ~ reset --hard", cwd, home), "/Users/me");
});

test("discardGitTargets: preserves quoted globals, all targets, and rejects dynamic targets", () => {
	const a = discardGitTargets(`cd "/repo one" && git -c core.editor=true reset --hard; git -C '../repo two' clean -fd`, "/work", "/home/me");
	assert.equal(a.ok, true);
	if (a.ok) {
		assert.deepEqual(a.targets, [
			{ cwd: "/repo one", gitGlobals: ["-c", "core.editor=true"] },
			{ cwd: "/repo one", gitGlobals: ["-C", "../repo two"] },
		]);
	}
	const dynamic = discardGitTargets("git -C $TARGET reset --hard", "/work", "/home/me");
	assert.equal(dynamic.ok, false, "dynamic target must block rather than inspect the wrong repo");
});

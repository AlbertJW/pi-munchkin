import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentDir } from "../lib/agent-dir.ts";

test("agentDir preserves the live default when unset", () => {
	assert.equal(agentDir({}), join(homedir(), ".pi", "agent"));
});

test("agentDir honours a run-private override", () => {
	assert.equal(agentDir({ PI_CODING_AGENT_DIR: "/tmp/pi-overlay" }), "/tmp/pi-overlay");
	assert.equal(agentDir({ PI_CODING_AGENT_DIR: "   " }), join(homedir(), ".pi", "agent"));
});

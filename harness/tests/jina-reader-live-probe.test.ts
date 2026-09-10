import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/jina-reader-live-probe.mjs", import.meta.url));
const run = (...args: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });

test("Jina Reader probe freezes public source identities and source bindings without network", () => {
  const first = JSON.parse(run("--dry")); const second = JSON.parse(run("--prepare"));
  assert.deepEqual(first, second);
  assert.equal(first.inference, false);
  assert.deepEqual(first.source_ids, ["reader-readme", "rfc-2606"]);
  assert.equal(first.source_url_sha256.length, 2);
  assert.match(first.source.probe_sha256, /^[0-9a-f]{64}$/);
});

test("Jina Reader probe refuses network mode without its exact approval", () => {
  assert.throws(() => run("--run"), /approval, manifest, or source binding mismatch/);
});

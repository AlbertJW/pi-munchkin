import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-ignore Operator tool is JavaScript and has no runtime declaration surface.
import { destinations, assertNoPiWriters } from "../scripts/deploy-harness-ownership.mjs";
test("ownership deployment uses a reviewed exact code allowlist and preserves live manifest/configuration/data", () => {
 const baseline = JSON.parse(readFileSync(new URL("../deployment/ownership-baseline.json", import.meta.url), "utf8"));
 assert.deepEqual(Object.keys(baseline.files), destinations); assert.equal(destinations.length, 31);
 assert.equal(Object.isFrozen(destinations), true);
 for (const path of destinations) assert.match(path, /^extensions\/pi-munchkin\/(?:extensions|lib|vendor)\/[a-zA-Z0-9./_-]+\.(?:ts|js)$/);
 assert.ok(!destinations.some((path: string) => /package\.json|settings|artifacts|goals\.json/.test(path)));
 assert.throws(() => assertNoPiWriters("")); assert.throws(() => assertNoPiWriters("7562 pi pi"), /stop Pi/);
});

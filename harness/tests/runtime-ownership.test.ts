import assert from "node:assert/strict";
import test from "node:test";
import { beginRuntimeGeneration, runtimeValue, runtimeIdentity, invalidateRuntimeBranch } from "../lib/runtime-ownership.ts";
import { captureInitialToolSurface, initialToolSurface } from "../lib/session-bootstrap.ts";
import { makeFakePi } from "./integration-harness.ts";
test("reload preserves bus/session fields; replacement and branch navigation clear only their fields", async () => {
 const bus = {}; const field = (lifetime: "event-bus" | "session" | "branch" | "generation") => ({ key: lifetime, lifetime, create: () => ({}) });
 beginRuntimeGeneration(bus, "a");
 const old = ["event-bus", "session", "branch", "generation"].map(life => runtimeValue(bus, field(life as any)));
 const fresh = await import(`../lib/runtime-ownership.ts?reload=${Date.now()}`);
 fresh.beginRuntimeGeneration(bus, "a");
 assert.equal(runtimeValue(bus, field("session")), old[1]); assert.notEqual(runtimeValue(bus, field("generation")), old[3]);
 invalidateRuntimeBranch(bus); assert.notEqual(runtimeValue(bus, field("branch")), old[2]);
 beginRuntimeGeneration(bus, "b"); assert.equal(runtimeValue(bus, field("event-bus")), old[0]); assert.notEqual(runtimeValue(bus, field("session")), old[1]);
 assert.deepEqual(runtimeIdentity(bus), { sessionId: "b", generation: 3 });
 assert.notEqual(runtimeValue({}, field("event-bus")), old[0]);
});
test("initial tool selection is per bus and reload cannot reinterpret harness narrowing", () => {
 const a = makeFakePi(), b = makeFakePi();
 (a.pi as any).getActiveTools = () => ["read"]; (a.pi as any).getAllTools = () => [{ name: "read" }];
 (b.pi as any).getActiveTools = () => ["bash"]; (b.pi as any).getAllTools = () => [{ name: "bash" }];
 captureInitialToolSurface(a.pi as never); captureInitialToolSurface(b.pi as never);
 (a.pi as any).getActiveTools = () => [];
 assert.deepEqual(captureInitialToolSurface(a.pi as never).active, ["read"]);
 assert.deepEqual(initialToolSurface(b.pi.events)!.active, ["bash"]);
});

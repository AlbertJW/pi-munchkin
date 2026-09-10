import assert from "node:assert/strict";
import test from "node:test";
import { localProxyTarget } from "../lib/local-proxy-route.ts";

test("a request that already includes the base API path is not version-prefixed twice", () => {
	assert.equal(localProxyTarget("http://127.0.0.1:8080/v1", "/v1/chat/completions"), "http://127.0.0.1:8080/v1/chat/completions");
});

test("a request relative to the base API path is prefixed exactly once", () => {
	assert.equal(localProxyTarget("http://127.0.0.1:8080/v1", "/chat/completions"), "http://127.0.0.1:8080/v1/chat/completions");
});

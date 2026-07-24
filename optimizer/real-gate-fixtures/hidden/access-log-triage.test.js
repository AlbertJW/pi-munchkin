import { parseRecord } from "../src/parseLog.js";
import { summarizeAccessLog } from "../src/report.js";
import test from "node:test";
import assert from "node:assert/strict";

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reference(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return { ok: false, reason: "invalid-json" }; }
  if (typeof obj.status !== "number" || !Number.isInteger(obj.status) || obj.status < 100 || obj.status > 599) return { ok: false, reason: "bad-status" };
  if (typeof obj.bytes !== "number" || !Number.isInteger(obj.bytes) || obj.bytes < 0) return { ok: false, reason: "bad-bytes" };
  return { ok: true, ts: obj.ts, method: obj.method, path: obj.path, status: obj.status, bytes: obj.bytes };
}

test("parseRecord: malformed JSON is reported as invalid-json, not thrown", () => {
  const lines = [
    '{"ts":"t","method":"GET","path":"/a","status":200,"bytes":1}',
    '{bad json',
    '{"ts":"t","status":200,"bytes":2',
    "{'ts':'t'}",
    '',
  ];
  for (const line of lines) {
    const truth = reference(line);
    const got = parseRecord(line);
    assert.equal(got.ok, truth.ok, `line ${JSON.stringify(line)}`);
    if (!truth.ok) assert.equal(got.reason, truth.reason, `line ${JSON.stringify(line)}`);
  }
});

test("parseRecord: seeded fuzz of truncated JSON is always invalid-json", () => {
  const rnd = mulberry32(0xC0FFEE);
  for (let i = 0; i < 40; i++) {
    const full = `{"ts":"t${i}","method":"GET","path":"/p${i}","status":200,"bytes":${i}}`;
    const cut = 1 + Math.floor(rnd() * (full.length - 2));
    const got = parseRecord(full.slice(0, cut));
    assert.equal(got.ok, false, `fuzz ${i}`);
    assert.equal(got.reason, "invalid-json", `fuzz ${i}`);
  }
});

test("summarizeAccessLog: every line accounted for exactly once, malformed broken out per reason code", () => {
  const lines = [
    '{"ts":"t","method":"GET","path":"/a","status":200,"bytes":10}',
    '{"ts":"t","method":"GET","path":"/b","status":999,"bytes":10}',
    '{"ts":"t","method":"GET","path":"/c","status":200,"bytes":-1}',
    '{bad json',
    '{"ts":"t","method":"POST","path":"/d","status":201,"bytes":0}',
  ];
  const report = summarizeAccessLog(lines);
  assert.equal(report.total, lines.length);
  assert.equal(report.ok.length + Object.values(report.malformed).reduce((a, b) => a + b, 0), lines.length);
  assert.equal(report.malformed["bad-status"], 1);
  assert.equal(report.malformed["bad-bytes"], 1);
  assert.equal(report.malformed["invalid-json"], 1);
});

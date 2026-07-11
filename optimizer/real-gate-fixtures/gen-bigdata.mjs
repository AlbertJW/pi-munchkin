// Deterministic generator for the bigdata fixture's data/events.jsonl.
// Seeded PRNG so every run yields byte-identical data — the hidden grader
// recomputes the expected answer from the file, so fixture and grader can
// never drift apart. Rerun after any change: node gen-bigdata.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// mulberry32 — tiny seeded PRNG, good enough for fixture data
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const rand = rng(20260711);
const USERS = Array.from({ length: 40 }, (_, i) => `user_${String(i + 1).padStart(2, "0")}`);
const STATUS = ["ok", "ok", "ok", "failed", "pending"]; // ~60% ok

const lines = [];
for (let i = 0; i < 4000; i++) {
	lines.push(
		JSON.stringify({
			id: i + 1,
			user: USERS[Math.floor(rand() * USERS.length)],
			amount: Math.round(rand() * 500 * 100) / 100,
			status: STATUS[Math.floor(rand() * STATUS.length)],
			ts: 1780000000 + Math.floor(rand() * 5_000_000),
		}),
	);
}

const out = join(dirname(fileURLToPath(import.meta.url)), "bigdata", "data", "events.jsonl");
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} records to ${out}`);

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const facts = [
	["PROJECT_CODE", "KITE-731"],
	["OWNER_ALIAS", "north-star"],
	["CHECKPOINT", "quartz-19"],
	["OUTPUT_MODE", "strict-json"],
	["ROLLBACK_TOKEN", "amber-44"],
	["FINAL_STATE", "ready-for-canary"],
	["INVARIANT", "preserve-leading-zeroes"],
	["NEXT_ACTION", "run-readonly-canary"],
];
const dir = join(process.cwd(), "evidence");
mkdirSync(dir, { recursive: true });
for (let index = 0; index < facts.length; index += 1) {
	const [key, value] = facts[index];
	const filler = Array.from({ length: 420 }, (_, line) =>
		`section-${index + 1}.${String(line + 1).padStart(3, "0")}: historical observation ${((index + 3) * (line + 11)) % 997}; retain only evidence linked to the active contract.`,
	);
	filler.splice(70 + index * 31, 0, `AUTHORITATIVE ${key}=${value}`);
	writeFileSync(join(dir, `part-${index + 1}.txt`), `${filler.join("\n")}\n`);
}

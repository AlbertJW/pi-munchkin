#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { prepareStudy, summarizeOutcomes } from "../lib/acceptance-suite.ts";
const [command, input, output] = process.argv.slice(2);
if (command === "prepare" && input && output) {
 const bank = JSON.parse(await readFile(new URL("../acceptance/tasks-v1.json", import.meta.url), "utf8"));
 const manifest = JSON.parse(await readFile(input, "utf8")); const study = prepareStudy(bank, manifest);
 const dir = resolve(output); await mkdir(dir, { recursive: false });
 for (const task of bank.tasks) { const fixture = join(dir, task.id); await mkdir(fixture);
  for (const [name, content] of Object.entries(task.files)) await writeFile(join(fixture, name), content, { flag: "wx" });
  await writeFile(join(fixture, "TASK.md"), task.prompt, { flag: "wx" });
 }
 await writeFile(join(dir, "study.json"), JSON.stringify(study, null, 2)+"\n", { flag: "wx" });
 console.log(JSON.stringify({ prepared: true, taskRuns: study.taskRuns, inferenceAuthorized: false }));
} else if (command === "summarize" && input && !output) {
 console.log(JSON.stringify(summarizeOutcomes(JSON.parse(await readFile(input, "utf8"))), null, 2));
} else {
 console.error("Only offline prepare <manifest.json> <new-output-dir> and summarize <outcomes.json> are supported. Model execution is unavailable; the optimizer remains mothballed."); process.exitCode = 78;
}

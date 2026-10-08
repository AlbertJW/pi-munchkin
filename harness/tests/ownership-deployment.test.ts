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

test("a staged qualification failure rolls back every code byte and mode while preserving goal data", async () => {
 const { mkdtemp, mkdir, writeFile, readFile, chmod, stat, rm, copyFile } = await import("node:fs/promises");
 const { tmpdir } = await import("node:os"); const { join, dirname } = await import("node:path");
 const { createHash } = await import("node:crypto"); const { spawnSync } = await import("node:child_process");
 const fixture=await mkdtemp(join(tmpdir(),"ownership-rollback-test-"));
 try {
  const agent=join(fixture,"agent"), bin=join(fixture,"bin"), backup=join(fixture,"backup");
  await mkdir(bin); await mkdir(join(fixture,"harness/scripts"),{recursive:true}); await mkdir(join(fixture,"harness/deployment"));
  const baseline: Record<string, {sha256:string;mode:number}|null>={};
  for(let i=0;i<destinations.length;i++){
   const path=destinations[i], target=join(agent,path), source=join(fixture,"harness",path.slice("extensions/pi-munchkin/".length));
   await mkdir(dirname(target),{recursive:true});await mkdir(dirname(source),{recursive:true});await writeFile(source,`after ${i}`);
   if(i%2){baseline[path]=null;}else{const before=`original ${i}`;const mode=0o640;await writeFile(target,before);await chmod(target,mode);baseline[path]={sha256:createHash("sha256").update(before).digest("hex"),mode};}
  }
  await writeFile(join(fixture,"harness/deployment/ownership-baseline.json"),JSON.stringify({files:baseline}));
  await writeFile(join(agent,"settings.json"),"{\"fixture\":true}"); await mkdir(join(agent,"artifacts/goals"),{recursive:true});
  const goal=join(agent,"artifacts/goals/authority.json");await writeFile(goal,"fixture goal authority remains untouched");
  for(const name of ["deploy-harness-ownership.mjs","qualify-harness-ownership.mjs"])await copyFile(new URL(`../scripts/${name}`,import.meta.url),join(fixture,"harness/scripts",name));
  // Only this temporary source/agent tree sees simulated external publication/process inventories.
  await writeFile(join(bin,"git"),`#!/usr/bin/env node\nconst a=process.argv.slice(2);if(a[0]==='status'){}else if(a[0]==='branch')console.log('codex/harness-ownership-consolidation-fixture');else if(a[0]==='show')process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(fixture,"harness/deployment/ownership-baseline.json"))}));else console.log('${"a".repeat(40)}');\n`);
  await writeFile(join(bin,"ps"),"#!/usr/bin/env node\nconsole.log('1 launchd launchd');\n");await chmod(join(bin,"git"),0o755);await chmod(join(bin,"ps"),0o755);
  const script=join(fixture,"harness/scripts/deploy-harness-ownership.mjs"), env={...process.env,PATH:`${bin}:${process.env.PATH}`};
  const prepared=spawnSync(process.execPath,[script,"prepare",agent,backup,"harness/deployment/ownership-baseline.json"],{env,encoding:"utf8"});assert.equal(prepared.status,0,prepared.stderr);
  // Deliberately omit the fixture live package manifest: post-rename host qualification fails.
  const applied=spawnSync(process.execPath,[script,"apply",join(backup,"receipt.json")],{env,encoding:"utf8",timeout:30000});assert.equal(applied.status,1);assert.match(applied.stderr,/deployment refused\/failed/);
  for(let i=0;i<destinations.length;i++){const target=join(agent,destinations[i]);if(baseline[destinations[i]]){assert.equal(await readFile(target,"utf8"),`original ${i}`);assert.equal((await stat(target)).mode&0o777,0o640);}else await assert.rejects(()=>stat(target),{code:"ENOENT"});}
  assert.equal(await readFile(goal,"utf8"),"fixture goal authority remains untouched");assert.equal(await readFile(join(agent,"settings.json"),"utf8"),"{\"fixture\":true}");
 }finally{await rm(fixture,{recursive:true,force:true});}
});

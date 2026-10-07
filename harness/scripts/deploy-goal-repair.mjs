#!/usr/bin/env node
// A repair-only deployment: never mirrors the rest of the checkout.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
export const destinations = Object.freeze([
  'extensions/pi-munchkin/lib/goal-state.ts',
  'extensions/pi-munchkin/extensions/plan-runner.ts',
  'extensions/pi-munchkin/lib/private-state-lock.ts',
]);
const sources = destinations.map(path => `harness/${path.slice('extensions/pi-munchkin/'.length)}`);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
async function state(path) {
  try {
    const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `not a regular file: ${path}`);
    return { sha256: sha(await readFile(path)), mode: stat.mode & 0o777 };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function assertNoPiWriters(output) {
  assert.ok(output.trim(), 'process inspection returned no process inventory');
  let inspected = 0;
  const running = output.split('\n').filter(line => {
    const match = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) return false;
    inspected++;
    if (Number(match[1]) === process.pid) return false;
    return basename(match[2]) === 'pi' || /(?:^|\s|\/)pi-coding-agent\/dist\/(?:bundle\/)?(?:cli|rpc-entry)\.js(?:\s|$)/.test(match[3]) ||
      /(?:^|\s)(?:\S*\/)?pi(?:\s|$)/.test(match[3]);
  });
  assert.ok(inspected > 0, 'process inspection output is not a valid inventory');
  assert.equal(running.length, 0, `stop Pi writers before deployment (${running.length} found)`);
}
function stopped() {
  // Inspection failure is an error, never interpreted as an empty process list.
  assertNoPiWriters(execFileSync('ps', ['-axo', 'pid=,comm=,args='], { encoding: 'utf8' }));
}
function published(commit) {
  assert.equal(git('status', '--porcelain'), '', 'release source must be clean');
  assert.equal(git('rev-parse', 'HEAD'), commit, 'release source changed');
  const branch = git('branch', '--show-current');
  assert.ok(branch.startsWith('codex/goal-authority-repair'), 'unexpected release branch');
  const remote = git('ls-remote', 'origin', `refs/heads/${branch}`).split(/\s/)[0];
  assert.equal(remote, commit, 'release commit must be published');
}
async function safeParents(agent, relative) {
  let parent = dirname(resolve(agent, relative));
  while (true) {
    const stat = await lstat(parent);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `unsafe target directory: ${parent}`);
    if (parent === agent) break;
    assert.ok(parent.startsWith(`${agent}/`), 'target escaped agent directory');
    parent = dirname(parent);
  }
}
async function inventory(agent) {
  const result = {};
  async function walk(relative) {
    const path = resolve(agent, relative);
    let stat;
    try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) result[relative] = { link: await readlink(path), mode: stat.mode & 0o777 };
    else if (stat.isDirectory()) for (const name of (await readdir(path)).sort()) await walk(`${relative}/${name}`);
    else if (stat.isFile()) result[relative] = await state(path);
    else throw new Error(`unexpected special file: ${relative}`);
  }
  for (const relative of ['extensions', 'lib', 'vendor', 'agents', 'skills', 'settings.json', 'models.json', 'auth.json', 'APPEND_SYSTEM.md', 'artifacts/goals']) await walk(relative);
  return result;
}
function unaffected(value) {
  return Object.fromEntries(Object.entries(value).filter(([path]) => !destinations.includes(path)));
}
async function verifyReceipt(receipt) {
  assert.equal(receipt.schema, 'pi.goal-repair-deployment/v1');
  assert.deepEqual(receipt.files.map(file => file.destination), destinations);
  assert.equal(receipt.files.length, 3);
  for (let i = 0; i < 3; i++) {
    const file = receipt.files[i];
    assert.equal(file.source, sources[i]);
    const before = i === 2 ? null : sha(execFileSync('git', ['show', `${receipt.baseline}:${sources[i]}`], { cwd: root }));
    assert.equal(file.before?.sha256 ?? null, before, 'unexpected baseline');
    assert.equal(sha(await readFile(resolve(root, sources[i]))), file.after.sha256, 'source hash changed');
  }
}
async function prepare(agent, backup, baseline) {
  const commit = git('rev-parse', 'HEAD'); published(commit); stopped();
  baseline = git('rev-parse', `${baseline}^{commit}`);
  const beforeInventory = await inventory(agent);
  const files = [];
  for (let i = 0; i < 3; i++) {
    await safeParents(agent, destinations[i]);
    const before = await state(resolve(agent, destinations[i]));
    const expected = i === 2 ? null : sha(execFileSync('git', ['show', `${baseline}:${sources[i]}`], { cwd: root }));
    assert.equal(before?.sha256 ?? null, expected, `live baseline mismatch: ${destinations[i]}`);
    files.push({ source: sources[i], destination: destinations[i], before,
      after: { sha256: sha(await readFile(resolve(root, sources[i]))), mode: before?.mode ?? 0o600 } });
  }
  assert.ok(!backup.startsWith(`${agent}/`) && backup !== agent, 'backup must be outside agent directory');
  await mkdir(backup, { mode: 0o700 });
  for (let i = 0; i < 3; i++) if (files[i].before) {
    await copyFile(resolve(agent, destinations[i]), resolve(backup, `${i}.original`));
    await chmod(resolve(backup, `${i}.original`), files[i].before.mode);
  }
  const receipt = { schema: 'pi.goal-repair-deployment/v1', commit, baseline, agent, files, beforeInventory, created_at: new Date().toISOString() };
  await writeFile(resolve(backup, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Prepared ${resolve(backup, 'receipt.json')}; ${files.length} destinations; commit ${commit}`);
}
async function restore(receipt, backup) {
  stopped();
  for (let i = 0; i < 3; i++) {
    const file = receipt.files[i], target = resolve(receipt.agent, destinations[i]);
    await safeParents(receipt.agent, destinations[i]);
    const current = await state(target);
    assert.ok(current?.sha256 === file.after.sha256 || current?.sha256 === file.before?.sha256 || (!current && !file.before), `rollback refuses unknown replacement: ${destinations[i]}`);
    if (file.before) {
      assert.equal(sha(await readFile(resolve(backup, `${i}.original`))), file.before.sha256, 'backup changed');
      const staging = `${target}.goal-repair-${process.pid}`;
      await copyFile(resolve(backup, `${i}.original`), staging);
      await chmod(staging, file.before.mode); await rename(staging, target);
    } else if (current) await unlink(target);
    assert.deepEqual(await state(target), file.before);
  }
  assert.deepEqual(await inventory(receipt.agent), receipt.beforeInventory, 'rollback inventory differs');
}
async function run(action, receiptPath) {
  const backup = dirname(receiptPath), receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  await verifyReceipt(receipt);
  if (action === 'rollback') { await restore(receipt, backup); console.log('Rollback verified; goal state preserved'); return; }
  published(receipt.commit); stopped();
  if (action === 'apply') {
    assert.deepEqual(await inventory(receipt.agent), receipt.beforeInventory, 'live inventory changed since prepare');
    const staged = [];
    let touched = false;
    try {
      for (let i = 0; i < 3; i++) {
        await safeParents(receipt.agent, destinations[i]);
        const target = resolve(receipt.agent, destinations[i]), temporary = `${target}.goal-repair-${process.pid}`;
        await writeFile(temporary, await readFile(resolve(root, sources[i])), { flag: 'wx', mode: receipt.files[i].after.mode });
        staged.push({ temporary, target });
      }
      stopped();
      for (const file of staged) { await rename(file.temporary, file.target); touched = true; }
      await check(receipt);
    } catch (error) {
      for (const file of staged) await unlink(file.temporary).catch(() => {});
      if (touched) await restore(receipt, backup);
      throw error;
    }
  } else assert.equal(action, 'check');
  await check(receipt);
  await writeFile(resolve(backup, 'verified.json'), JSON.stringify({ commit: receipt.commit, verified_at: new Date().toISOString(), files: receipt.files.map(file => ({ destination: file.destination, ...file.after })) }, null, 2), { mode: 0o600 });
  console.log(`${action}: three repair files verified; surrounding code, configuration, and goal ledgers unchanged`);
}
async function check(receipt) {
  for (const file of receipt.files) assert.deepEqual(await state(resolve(receipt.agent, file.destination)), file.after);
  assert.deepEqual(unaffected(await inventory(receipt.agent)), unaffected(receipt.beforeInventory), 'unrelated live files changed');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  try {
    if (action === 'prepare') {
      assert.equal(args.length, 3, 'prepare <agent-dir> <new-backup-dir> <baseline-commit>');
      await prepare(resolve(args[0]), resolve(args[1]), args[2]);
    } else {
      assert.ok(['apply', 'check', 'rollback'].includes(action), 'use prepare, apply, check, or rollback');
      assert.equal(args.length, 1, `${action} <receipt.json>`); await run(action, resolve(args[0]));
    }
  } catch (error) { console.error(`goal repair deployment refused/failed: ${error.message}`); process.exitCode = 1; }
}

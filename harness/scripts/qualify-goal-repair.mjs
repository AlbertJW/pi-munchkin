#!/usr/bin/env node
// Qualification uses only a synthetic provider and temporary agent state.
import assert from 'node:assert/strict';
import { access, cp, copyFile, mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { destinations } from './deploy-goal-repair.mjs';
const [agentPath, piPath, mode] = process.argv.slice(2);
assert.ok(mode === undefined || mode === '--deployed', 'unknown qualification mode');
assert.ok(agentPath && piPath, 'qualify-goal-repair <agent-dir> <installed-pi-package-dir> [--deployed]');
const root = resolve(import.meta.dirname, '../..'), agent = resolve(agentPath), piRoot = resolve(piPath);
const fixture = await mkdtemp(resolve(tmpdir(), 'goal-repair-live-'));
process.env.PI_CODING_AGENT_DIR = fixture;
process.env.TELEMETRY = 'off';
process.env.PLAN_STORAGE = 'project';
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('network forbidden in qualification'); };
net.Socket.prototype.connect = function () { networkRequests++; throw new Error('network forbidden in qualification'); };
for (const dir of ['extensions', 'lib', 'vendor', 'agents', 'skills']) {
  try { await cp(resolve(agent, dir), resolve(fixture, dir), { recursive: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'));
if (mode !== '--deployed') for (const destination of destinations) {
  const target = resolve(fixture, destination); await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, `harness/${destination.slice('extensions/pi-munchkin/'.length)}`), target);
}
const requirePi = createRequire(resolve(piRoot, 'package.json'));
const sdk = await import(pathToFileURL(resolve(piRoot, 'dist/index.js')));
const internal = await import(pathToFileURL(resolve(piRoot, 'dist/core/extensions/index.js')));
async function entry(name) {
  const nested = resolve(piRoot, `node_modules/@earendil-works/${name}/dist/index.js`);
  try { await access(nested); return nested; } catch { return resolve(piRoot, `../${name}/dist/index.js`); }
}
const core = await import(pathToFileURL(await entry('pi-agent-core')));
const ai = await import(pathToFileURL(await entry('pi-ai')));
const { createJiti } = requirePi('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@earendil-works/pi-coding-agent': resolve(piRoot, 'dist/index.js') } });
const goal = await jiti.import(resolve(fixture, 'extensions/pi-munchkin/lib/goal-state.ts'));
const manifest = JSON.parse(await readFile(resolve(fixture, 'extensions/pi-munchkin/package.json'), 'utf8'));
const cwd = resolve(fixture, 'worktree'); await mkdir(cwd);
const loaded = await sdk.discoverAndLoadExtensions(manifest.pi.extensions.map(entry => resolve(fixture, 'extensions/pi-munchkin', entry)), cwd, fixture);
assert.deepEqual(loaded.errors, [], 'installed Pi must load every live extension');
assert.ok(loaded.extensions.length >= manifest.pi.extensions.length);
// The full live set is loaded above. Run goal lifecycle cases with the real
// planner and arbiter, isolating unrelated external services from this fixture.
const plan = loaded.extensions.find(extension => extension.path.endsWith('/plan-runner.ts'));
const arbiter = loaded.extensions.find(extension => extension.path.endsWith('/control-arbiter.ts'));
assert.ok(plan && arbiter);
const model = { id: 'repair-scripted', name: 'repair-scripted', type: 'chat', api: 'repair-scripted', provider: 'repair-test',
  baseUrl: 'http://127.0.0.1:1', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 1024 };
const cases = [];
for (const outcome of ['paused', 'blocked', 'cancelled', 'complete', 'accepted_80_20']) {
  const caseCwd = resolve(fixture, outcome); await mkdir(caseCwd);
  const initial = goal.createGoal({ cwd: caseCwd, objective: `Do not restart ${outcome}`, criteria: [{ text: 'Verified outcome' }] });
  await goal.writeGoal(initial, caseCwd);
  const runtime = internal.createExtensionRuntime(), bus = sdk.createEventBus();
  let requests = 0;
  const response = () => ({ role: 'assistant', content: [{ type: 'text', text: 'scripted qualification complete' }],
    api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const streamFn = () => {
    requests++;
    const stream = ai.createAssistantMessageEventStream(), message = response();
    stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: 'stop', message }); return stream;
  };
  const lifecycle = await internal.loadExtensionFromFactory(pi => pi.on('agent_end', async () => {
    await goal.mutateGoal(caseCwd, current => {
      let next;
      if (outcome === 'paused') next = goal.pauseGoal(current);
      else if (outcome === 'blocked') next = goal.blockGoal(current, { reason: 'needs input', evidence: ['fixture observation'], unblockCondition: 'user supplies input' });
      else if (outcome === 'cancelled') next = goal.cancelGoal(current);
      else {
        const met = goal.updateGoal(current, { criteria: [{ id: current.criteria[0].id, status: 'met', evidence: ['fixture verification'] }] });
        next = goal.settleGoal(met, { outcome, deliveredValue: 'verified fixture result', confidence: 1, residualRisks: [], evidence: ['fixture verification'] });
      }
      return { goal: next, result: null };
    });
  }), caseCwd, bus, runtime, `repair-${outcome}`);
  // Load fresh planner/arbiter factories for each case so their bus, lifecycle,
  // and continuation state belong to this session, not the full-load probe.
  const plannerFactory = await jiti.import(resolve(fixture, 'extensions/pi-munchkin/extensions/plan-runner.ts'), { default: true });
  const arbiterFactory = await jiti.import(resolve(fixture, 'extensions/pi-munchkin/extensions/control-arbiter.ts'), { default: true });
  const extensions = [await internal.loadExtensionFromFactory(plannerFactory, caseCwd, bus, runtime, 'repair-planner'),
    await internal.loadExtensionFromFactory(arbiterFactory, caseCwd, bus, runtime, 'repair-arbiter'), lifecycle];
  const resourceLoader = {
    getExtensions: () => ({ extensions, errors: [], runtime }), getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => undefined, getAppendSystemPrompt: () => [], extendResources: () => {}, reload: async () => {},
  };
  const config = { agent: new core.Agent({ initialState: { systemPrompt: '', model, thinkingLevel: 'off', tools: [] }, convertToLlm: sdk.convertToLlm, streamFn }),
    cwd: caseCwd, sessionManager: sdk.SessionManager.inMemory(caseCwd), settingsManager: sdk.SettingsManager.inMemory({}), resourceLoader, initialActiveToolNames: [], baseToolsOverride: {} };
  if (sdk.ModelRuntime) {
    config.modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false,
      modelsStorePath: resolve(fixture, 'models-cache.json') });
    config.modelRuntime.registerProvider(model.provider, { api: model.api, apiKey: 'scripted-no-network', baseUrl: model.baseUrl, models: [model], streamSimple: streamFn });
  } else {
    config.authStorage = sdk.AuthStorage.inMemory({ [model.provider]: { type: 'api_key', key: 'scripted-no-network' } });
    config.modelRegistry = sdk.ModelRegistry.inMemory(config.authStorage);
  }
  const session = new sdk.AgentSession(config);
  await session.bindExtensions({ onError: error => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`) });
  await session.sendUserMessage('perform one qualification turn'); await session.waitForIdle();
  assert.equal(requests, 1, `${outcome} must reject a stale continuation`);
  const stored = await goal.loadGoalLedger(caseCwd);
  assert.equal(stored.kind, 'valid'); assert.equal(stored.ledger.goals[0].status, outcome);
  assert.equal(session.getFollowUpMessages().length, 0);
  session.dispose(); cases.push({ outcome, scripted_requests: requests });
}
assert.equal(networkRequests, 0);
console.log(JSON.stringify({ pi_version: JSON.parse(await readFile(resolve(piRoot, 'package.json'), 'utf8')).version,
  mode: mode === '--deployed' ? 'deployed-copy' : 'staged-copy', extensions_loaded: loaded.extensions.length, cases, network_requests: networkRequests, fixture }, null, 2));

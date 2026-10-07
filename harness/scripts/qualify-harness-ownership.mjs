#!/usr/bin/env node
// Real Pi host qualification, temporary data, synthetic provider, no network.
import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { destinations } from './deploy-harness-ownership.mjs';
const [piPath, liveAgentPath, receiptPath, mode] = process.argv.slice(2);
assert.ok(mode === undefined || mode === "--live-copy", "unknown qualification mode");
assert.ok(piPath && liveAgentPath, 'qualify-harness-ownership <pi-package-dir> <live-agent-dir> [receipt.json]');
const root = resolve(import.meta.dirname, '../..'), piRoot = resolve(piPath), liveAgent = resolve(liveAgentPath);
const fixture = await mkdtemp(resolve(tmpdir(), 'munchkin-ownership-host-'));
process.env.PI_CODING_AGENT_DIR = fixture; process.env.TELEMETRY = 'off'; process.env.PLAN_STORAGE = 'project';
// Third-party extensions may consult homedir instead of Pi's agent-dir setting.
process.env.HOME = join(fixture, 'home'); await mkdir(process.env.HOME);
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('network forbidden in qualification'); };
net.Socket.prototype.connect = function () { networkRequests++; throw new Error('network forbidden in qualification'); };
const candidate = join(fixture, 'extensions/pi-munchkin'); await mkdir(candidate, {recursive:true});
for (const dir of ['extensions','lib','vendor']) await cp(join(liveAgent,'extensions/pi-munchkin',dir),join(candidate,dir),{recursive:true});
const manifest = JSON.parse(await readFile(join(liveAgent,'extensions/pi-munchkin/package.json'),'utf8'));
await writeFile(join(candidate,'package.json'),JSON.stringify(manifest));
if(mode !== '--live-copy') for(const destination of destinations){
 const target=join(fixture,destination);await mkdir(dirname(target),{recursive:true});
 await cp(join(root,'harness',destination.slice('extensions/pi-munchkin/'.length)),target);
}
// Resolve imports from the Pi version under test, not the pinned development SDK.
await mkdir(join(fixture,'node_modules/@earendil-works'),{recursive:true});
await symlink(piRoot,join(fixture,'node_modules/@earendil-works/pi-coding-agent'));
const requirePi = createRequire(join(piRoot,'package.json'));
for (const name of ['typebox','jiti']) {
 let packageRoot = dirname(requirePi.resolve(name));
 while (true) { try { const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')); if (manifest.name === name) break; } catch {} const parent = dirname(packageRoot); assert.notEqual(parent, packageRoot); packageRoot = parent; }
 await symlink(packageRoot,join(fixture,'node_modules',name));
}
const sdk = await import(pathToFileURL(join(piRoot,'dist/index.js')));
const internal = await import(pathToFileURL(join(piRoot,'dist/core/extensions/index.js')));
async function entry(name) {
 const nested=join(piRoot,`node_modules/@earendil-works/${name}/dist/index.js`);
 try {await access(nested);return nested;} catch{return resolve(piRoot,`../${name}/dist/index.js`);}
}
const core=await import(pathToFileURL(await entry('pi-agent-core'))), ai=await import(pathToFileURL(await entry('pi-ai')));
const {createJiti}=requirePi('jiti'); const jiti=createJiti(import.meta.url,{alias:{'@earendil-works/pi-coding-agent':join(piRoot,'dist/index.js')}});
const goal=await jiti.import(join(candidate,'lib/goal-state.ts'));
const receiptLib=await jiti.import(join(candidate,'lib/runtime-receipt.ts'));
const compatibility=await jiti.import(join(candidate,'lib/pi-compatibility.ts'));
const version=JSON.parse(await readFile(join(piRoot,'package.json'),'utf8')).version;
assert.equal(compatibility.piCompatibility().version,version,'candidate must import the tested host SDK');
const cwd=join(fixture,'project');await mkdir(cwd);
const paths=manifest.pi.extensions.map(path=>join(candidate,path));
const external=[];
for (const spec of JSON.parse(await readFile(join(liveAgent,'settings.json'),'utf8')).packages ?? []) {
 const source=typeof spec==='string'?spec:spec.source;
 assert.equal(typeof source,'string','package setting must have a source');
 const packageDir=source.startsWith('npm:') ? join(liveAgent,'npm/node_modules',source.slice(4).replace(/@[^@]+$/,'')) : resolve(liveAgent,source);
 const pkg=JSON.parse(await readFile(join(packageDir,'package.json'),'utf8'));
 for (const path of pkg.pi?.extensions ?? []) external.push(resolve(packageDir,path));
}
await writeFile(join(fixture,'sol-pi.json'),JSON.stringify({version:1,actionFusion:false,observationPack:true,evidencePreservingReducer:false,onlineContextCompact:false,cacheWriteReadRatio:12.5}));
const loaded=await sdk.discoverAndLoadExtensions([...paths,...external],cwd,fixture);
assert.deepEqual(loaded.errors,[],'full combined stack loads');
const model={id:'ownership-scripted',name:'ownership-scripted',type:'chat',api:'ownership-scripted',provider:'ownership-test',baseUrl:'http://127.0.0.1:1',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:1024};
async function makeSession(caseCwd, extensions, runtime, streamFn, manager=sdk.SessionManager.inMemory(caseCwd), onReload) {
 let loadedExtensions=extensions, loadedRuntime=runtime;
 const loader={getExtensions:()=>({extensions:loadedExtensions,errors:[],runtime:loadedRuntime}),getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),getSystemPrompt:()=>undefined,getAppendSystemPrompt:()=>[],extendResources:()=>{},reload:async()=>{if(onReload){const next=await onReload();loadedExtensions=next.extensions;loadedRuntime=next.runtime;}}};
 const config={agent:new core.Agent({initialState:{systemPrompt:'',model,thinkingLevel:'off',tools:[]},convertToLlm:sdk.convertToLlm,streamFn}),cwd:caseCwd,sessionManager:manager,settingsManager:sdk.SettingsManager.inMemory({}),resourceLoader:loader,initialActiveToolNames:[],baseToolsOverride:{}};
 if(sdk.ModelRuntime){config.modelRuntime=await sdk.ModelRuntime.create({credentials:new ai.InMemoryCredentialStore(),modelsPath:null,refreshOnCreate:false,allowModelNetwork:false,modelsStorePath:join(fixture,'models-cache.json')});config.modelRuntime.registerProvider(model.provider,{api:model.api,apiKey:'scripted-no-network',baseUrl:model.baseUrl,models:[model],streamSimple:streamFn});}
 else{config.authStorage=sdk.AuthStorage.inMemory({[model.provider]:{type:'api_key',key:'scripted-no-network'}});config.modelRegistry=sdk.ModelRegistry.inMemory(config.authStorage);}
 const session=new sdk.AgentSession(config);await session.bindExtensions({mode:'rpc',onError:error=>assert.fail(`${error.extensionPath}:${error.event}:${error.error}`)});return session;
}
const response=()=>({role:'assistant',content:[{type:'text',text:'scripted qualification'}],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:Date.now(),usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}});
const cases=[];
for(const outcome of ['active','paused','blocked','cancelled','complete','accepted_80_20']){
 const caseCwd=join(fixture,outcome);await mkdir(caseCwd);
 await goal.writeGoal(goal.createGoal({cwd:caseCwd,objective:`Qualification ${outcome}`,criteria:[{text:'Verified result'}]}),caseCwd);
 const runtime=internal.createExtensionRuntime(),bus=sdk.createEventBus();let requests=0,ends=0,boundaries=0;
 const streamFn=()=>{requests++;assert.ok(requests<=2,'bounded continuation');const stream=ai.createAssistantMessageEventStream(),message=response();stream.push({type:'start',partial:message});stream.push({type:'done',reason:'stop',message});return stream;};
 const planner=await jiti.import(join(candidate,'extensions/plan-runner.ts'),{default:true}),arbiter=await jiti.import(join(candidate,'extensions/control-arbiter.ts'),{default:true});
 const lifecycle=await internal.loadExtensionFromFactory(pi=>{
  if(compatibility.piCompatibility().actionableSettlement)pi.on('agent_before_settle',()=>{boundaries++;});
  pi.on('agent_end',async()=>{ends++;if(outcome==='active' && ends===1)return;
   await goal.mutateGoal(caseCwd,current=>{
    let next;if(outcome==='active'||outcome==='paused')next=goal.pauseGoal(current);
    else if(outcome==='cancelled')next=goal.cancelGoal(current);
    else if(outcome==='blocked')next=goal.blockGoal(current,{reason:'fixture',evidence:['observation'],unblockCondition:'user input'});
    else next=goal.settleGoal(goal.updateGoal(current,{criteria:[{id:current.criteria[0].id,status:'met',evidence:['verified']}]}),{outcome,deliveredValue:'verified',confidence:1,residualRisks:[],evidence:['verified']});
    return {goal:next,result:null};
   });
  });
 },caseCwd,bus,runtime,'lifecycle');
 const extensions=[await internal.loadExtensionFromFactory(planner,caseCwd,bus,runtime,'planner'),await internal.loadExtensionFromFactory(arbiter,caseCwd,bus,runtime,'arbiter'),lifecycle];
 const session=await makeSession(caseCwd,extensions,runtime,streamFn);
 try{await session.sendUserMessage('one bounded qualification');await session.waitForIdle();if(outcome==='active'){const deadline=Date.now()+5000;while(requests<2 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));await session.waitForIdle();}assert.equal(requests,outcome==='active'?2:1);assert.equal(session.getFollowUpMessages().length,0);if(compatibility.piCompatibility().actionableSettlement)assert.ok(boundaries>0);}
 finally{session.dispose();}
 cases.push({outcome,scriptedRequests:requests,actionableBoundaries:boundaries});
}
// Two actual AgentSessions retain independent signal subscribers over repeated real reloads.
const lifecycleLib=await jiti.import(join(candidate,'lib/extension-lifecycle.ts'));
const signals=await jiti.import(join(candidate,'lib/harness-signals.ts'));
const isolation=[];
for(let index=0;index<2;index++){
 const bus=sdk.createEventBus();let calls=0;
 const factory=pi=>{lifecycleLib.subscribeOnce(pi.events,'qualification:signal',()=>signals.onHarnessSignal(pi.events,()=>{calls++;}));};
 const fresh=async()=>{const runtime=internal.createExtensionRuntime();return{runtime,extensions:[await internal.loadExtensionFromFactory(factory,cwd,bus,runtime,'ownership-probe')]};};
 const first=await fresh();const session=await makeSession(cwd,first.extensions,first.runtime,()=>assert.fail('isolation must not call provider'),undefined,fresh);
 isolation.push({bus,session,calls:()=>calls});
}
try{
 for(let generation=0;generation<4;generation++){
  if(generation)await isolation[0].session.reload();
  for(const item of isolation)signals.emitHarnessSignal(item.bus,{v:1,type:'goal/state',status:'active'});
  assert.equal(isolation[0].calls(),generation+1);assert.equal(isolation[1].calls(),generation+1);
 }
}finally{for(const item of isolation)item.session.dispose();}

// Combined packages run their actual registered context handlers, with no model call.
await mkdir(join(fixture,'sessions'));
const stackManager=sdk.SessionManager.create(cwd,join(fixture,'sessions'));
let compactionEvents=0;
const compactFactory=pi=>{
 pi.on('session_before_compact',event=>({compaction:{summary:'scripted recall capsule: retained branch and fixture evidence',firstKeptEntryId:event.preparation.firstKeptEntryId,tokensBefore:event.preparation.tokensBefore}}));
 pi.on('session_compact',event=>{assert.equal(event.fromExtension,true);compactionEvents++;});
};
const compactPath=join(fixture,'scripted-compaction-owner.ts');await writeFile(compactPath,`import assert from 'node:assert/strict';\nexport default ${compactFactory.toString()};\n`);
const compactFixture=await internal.loadExtensionFromFactory(compactFactory,cwd,sdk.createEventBus(),loaded.runtime,compactPath);
const stack=await makeSession(cwd,[...loaded.extensions,compactFixture],loaded.runtime,()=>assert.fail('combined context probe must not invoke a provider'),stackManager);
let runtimeReceipt,pipeline;
try{
 const runner=stack.extensionRunner;assert.ok(runner);const actualPaths=runner.getExtensionPaths();
 const packIndex=actualPaths.findIndex(path=>path.endsWith('/src/sol-pi/index.ts')),dedupIndex=actualPaths.findIndex(path=>path.endsWith('/extensions/context-dedup.ts'));
 assert.ok(packIndex>dedupIndex && dedupIndex>=0,'actual combined load order preserves dedup before packing');
 await new Promise(resolve=>setImmediate(resolve));
 const tools=runner.getAllRegisteredTools().map(tool=>tool.definition.name),active=stack.getActiveToolNames();
 assert.ok(active.includes('obs_recall'),'late recall activation');
 const body=Array.from({length:1600},(_,i)=>`source ${i} café 漢字`).join('\n');
 const messages=[{role:'toolResult',toolName:'fixture',toolCallId:'read-fixture',content:[{type:'text',text:body}],isError:false,timestamp:Date.now()}];
 await runner.emitContext(messages);await runner.emitContext(messages);const packed=await runner.emitContext(messages);
 const stub=packed[0].content[0].text;assert.notEqual(stub,body,'observation packing occurs');
 const id=stub.match(/id: (obs_[a-f0-9]{24})/)?.[1];assert.ok(id);
 const recall=runner.getToolDefinition('obs_recall');assert.ok(recall);
 let offset=0,reconstructed='',pages=0;
 while(true){const result=await recall.execute('fixture-recall',{id,offset},undefined,undefined,runner.createContext());
  const text=result.content.find(block=>block.type==='text').text;reconstructed+=text.split('\n').slice(2).join('\n');pages++;
  assert.ok(result.details.eof||result.details.nextOffset>offset);offset=result.details.nextOffset;if(result.details.eof)break;}
 assert.equal(reconstructed,body,'all UTF-8 bytes are recoverable');
 const storage=join(stackManager.getSessionDir(),'sol-pi',stackManager.getSessionId(),'observation-pack','objects',`${id}.txt`);
 const original=await readFile(storage);const damaged=Buffer.from(original);damaged[0]^=1;await writeFile(storage,damaged);
 await assert.rejects(()=>recall.execute('fixture-corrupt',{id},undefined,undefined,runner.createContext()),/hash mismatch/);
 await writeFile(storage,original);
 const answerId=stackManager.appendMessage({role:'assistant',content:[{type:'text',text:'retained branch'}],...response(),content:[{type:'text',text:'retained branch'}]});
 stackManager.appendMessage({role:'user',content:'abandoned branch',timestamp:Date.now()});
 const navigation=await stack.navigateTree(answerId,{summarize:false});assert.equal(navigation.cancelled,false);
 const afterTree=await runner.emitContext(messages);assert.equal(afterTree[0].content[0].text,body,'tree reset retains recoverable originals');
 stackManager.appendMessage({...response(),content:[{type:'text',text:'persist selected leaf'}]});
 const reopened=sdk.SessionManager.open(stackManager.getSessionFile());
 assert.equal(reopened.getSessionId(),stackManager.getSessionId());assert.equal(JSON.stringify(reopened.getBranch()).includes('abandoned branch'),false);
 // The context contract itself guards unavailable recall; qualification also verifies explicit exclusion.
 stack.setActiveToolsByName(['read','bash']);const excluded=await runner.emitContext(messages);assert.equal(excluded[0].content[0].text,body);
 stack.setActiveToolsByName(active);
 const repeated=[{...response(),content:[{type:'toolCall',id:'a',name:'read',arguments:{path:'fixture.txt'}}]},
  {...messages[0],toolName:'read',toolCallId:'a'},
  {...response(),content:[{type:'toolCall',id:'b',name:'read',arguments:{path:'fixture.txt'}}]},
  {...messages[0],toolName:'read',toolCallId:'b'}];
 await runner.emitContext(repeated);await runner.emitContext(repeated);const combined=await runner.emitContext(repeated);
 assert.match(combined[1].content[0].text,/id: obs_/);assert.match(combined[3].content[0].text,/message #1|message 1|#1/);
 const p=await jiti.import(join(candidate,'lib/context-pipeline.ts'));
 const stage=p.measureContextStage({name:'combined-installed-stack',boundary:'context',recovery:'tool',requiredTool:'obs_recall'},messages,packed,active);
 assert.equal(stage.recoverable,true);pipeline={stage,actualPaths,packingObserved:true,exclusionPreservesSource:true,exactRecallPages:pages,corruptionRejected:true,treeNavigation:true,transcriptReopened:true,dedupThenPacking:true};
 for(let i=0;i<8;i++){stackManager.appendMessage({role:'user',content:`compaction fixture ${i} `+'evidence '.repeat(4000),timestamp:Date.now()});stackManager.appendMessage(response());}
 const compacted=await stack.compact('Retain fixture evidence');assert.match(compacted.summary,/scripted recall capsule/);assert.equal(compactionEvents,1);assert.equal(stackManager.getEntries().filter(entry=>entry.type==='compaction').length,1);pipeline.nativeCompaction={owners:1,events:compactionEvents,providerRequests:0};
 runtimeReceipt=await receiptLib.buildRuntimeReceipt({piVersion:version,baseDir:fixture,entryPoints:actualPaths,evidence:'loaded',registeredTools:tools,activeTools:active,generation:1,sessionId:stack.sessionManager.getSessionId(),env:process.env});
}finally{stack.dispose();}
assert.equal(networkRequests,0);
const summary={piVersion:version,mode:mode==='--live-copy'?'deployed-live-copy':'staged-live-overlay',fixture,extensionsLoaded:loaded.extensions.length,cases,isolation:{sessions:2,reloads:3,signalsPerSession:4},pipeline,runtimeReceipt,networkRequests,realProviderRequests:0};
if(receiptPath)await writeFile(resolve(receiptPath),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({piVersion:version,fixture,extensionsLoaded:loaded.extensions.length,cases,networkRequests,realProviderRequests:0,receiptPath},null,2));

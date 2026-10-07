#!/usr/bin/env node
// Offline, process-isolated comparison of the extraction's public planning contract.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'../..');
if(process.argv[2]==='--snapshot'){
 const source=resolve(process.argv[3]);
 process.env.PI_CODING_AGENT_DIR=mkdtempSync(join(tmpdir(),'munchkin-parity-agent-'));
 process.env.PLAN_STORAGE='project';process.env.TELEMETRY='off';process.env.GOALS='on';
 const {makeFakePi,makeCtx,fire,callTool}=await import(pathToFileURL(join(root,'harness/tests/integration-harness.ts')));
 const planner=(await import(pathToFileURL(join(source,'harness/extensions/plan-runner.ts')))).default;
 const fp=makeFakePi();
 for(const name of ['read','grep','find','ls','bash','edit','write','search_spans','read_span','recall','capability','web_search','web_read','subagent'])fp.pi.registerTool({name,parameters:{}});
 planner(fp.pi);fp.pi.setActiveTools([...fp.tools.keys()]);
 const cwd=mkdtempSync(join(tmpdir(),'munchkin-parity-project-'));const {ctx}=makeCtx(cwd);
 const trace=[];
 trace.push({tools:[...fp.tools.values()].map(({execute,...tool})=>tool),commands:[...fp.commands].map(([name,{description}])=>({name,description}))});
 await fire(fp,'session_start',{},ctx);trace.push({ordinary:fp.pi.getActiveTools()});
 await fp.commands.get('plan').handler('Repair fixture',ctx);trace.push({planning:fp.pi.getActiveTools(),messages:fp.customDeliveries});
 trace.push({blocked:await fire(fp,'tool_call',{toolCallId:'blocked',toolName:'edit',input:{path:'fixture.ts'}},ctx)});
 trace.push({written:await callTool(fp,'plan_write',{summary:'Repair fixture',items:[{title:'Inspect failure',note:'Keep evidence'},{title:'Apply repair'}]},cwd)});
 const statePath=join(cwd,'.pi/plan-state.json');const before=readFileSync(statePath,'utf8');
 trace.push({oversized:await callTool(fp,'plan_write',{summary:'Invalid rewrite',items:Array.from({length:58},()=>({title:'Too many'}))},cwd),preserved:readFileSync(statePath,'utf8')===before});
 await fp.commands.get('plan-go').handler('',ctx);trace.push({executing:fp.pi.getActiveTools(),messages:fp.customDeliveries.slice(1)});
 const ids=new Map();let text=JSON.stringify(trace,(_key,value)=>typeof value==='function'?undefined:value);
 text=text.replaceAll(cwd,'<project>').replaceAll(process.env.PI_CODING_AGENT_DIR,'<agent>').replace(/(?<![A-F0-9])[A-F0-9]{16}(?![A-F0-9])/g,id=>{if(!ids.has(id))ids.set(id,`ITEM_${ids.size+1}`);return ids.get(id);}).replace(/\d{4}-\d{2}-\d{2}T[\d:.-]+Z/g,'<time>');
 console.log(text);
}else{
 const [baseline,reportPath]=process.argv.slice(2);assert.ok(baseline,'planning-trace-parity <baseline checkout> [report.json]');
 const run=source=>JSON.parse(execFileSync(process.execPath,['--experimental-strip-types',import.meta.filename,'--snapshot',source],{encoding:'utf8',maxBuffer:4*1024*1024}));
 const before=run(resolve(baseline)),after=run(root);assert.deepEqual(after,before,'unexplained public planning trace change');
 const receipt={baseline:resolve(baseline),candidate:root,observations:before.length,publicTraceEqual:true,providerRequests:0};
 if(reportPath)writeFileSync(resolve(reportPath),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}

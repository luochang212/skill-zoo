import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
const currentRoot=process.cwd();
const baselineRoot=process.argv[2];
if(!baselineRoot) throw new Error('Pass the baseline worktree directory');
const current=await import(path.join(currentRoot,'packages/cli/src/protocol/scan.ts'));
const baseline=await import(path.join(baselineRoot,'packages/cli/src/protocol/scan.ts'));
const registry=await import(path.join(currentRoot,'packages/cli/src/protocol/custom-agents.ts'));
const currentPaths=await import(path.join(currentRoot,'packages/cli/src/protocol/paths.ts'));
const baselinePaths=await import(path.join(baselineRoot,'packages/cli/src/protocol/paths.ts'));
const rows=[];
async function measure(fn:()=>Promise<unknown>|unknown,runs=5){await fn();let ms=[];for(let i=0;i<runs;i++){const start=performance.now();await fn();ms.push(performance.now()-start)}ms.sort((a,b)=>a-b);return {median:ms[Math.floor(ms.length/2)],p95:ms[ms.length-1]};}
for(const skills of [100,1000])for(const customs of [0,5,20])for(const populated of customs?[false,true]:[false]){
const home=await fs.mkdtemp(path.join(os.tmpdir(),'szoo-agent-bench-'));
try{
const config=path.join(home,'.skill-zoo');await fs.mkdir(config,{recursive:true});
const agents=Array.from({length:customs},(_,i)=>({id:`custom-00000000-0000-4000-a000-${String(i).padStart(12,'0')}`,label:`Bench Tool ${i}`,skillsDir:path.join(home,`tool-${i}/skills`)}));
for(const a of agents)await fs.mkdir(a.skillsDir,{recursive:true});
if(customs)await fs.writeFile(path.join(config,'agents.json'),JSON.stringify({version:1,agents}));
for(let i=0;i<skills;i++){const root=populated?agents[i%agents.length].skillsDir:path.join(home,'.codex/skills');const dir=path.join(root,`skill-${i}`);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'SKILL.md'),`---\nname: skill-${i}\ndescription: Benchmark fixture\n---\nBody\n`);}
registry.resetAgentSnapshot(home);
const scan=await measure(()=>current.scanCacheEntries(home));
const base=customs===0?await measure(()=>baseline.scanCacheEntries(home)):undefined;
const lookup=await measure(()=>{for(let i=0;i<10000;i++)currentPaths.getAgentSkillsDir(home,'codex')});
const baseLookup=customs===0?await measure(()=>{for(let i=0;i<10000;i++)baselinePaths.getAgentSkillsDir(home,'codex')}):undefined;
rows.push({skills,customs,populated,scan,baselineScan:base,path10000:lookup,baselinePath10000:baseLookup});
console.log(JSON.stringify(rows.at(-1)));
}finally{await fs.rm(home,{recursive:true,force:true});}}
await fs.writeFile('/tmp/skill-zoo-agent-benchmark.json',JSON.stringify({baseline:'0894795',platform:os.platform(),cpu:os.cpus()[0].model,runtime:process.version,rows},null,2));

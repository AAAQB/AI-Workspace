import{test}from'node:test';import assert from'node:assert/strict';import{promises as fs}from'node:fs';import path from'node:path';import{Store}from'../src/core/store';import{ProjectFiles}from'../src/core/files';import{Runner}from'../src/core/runner';
import{writeFileSync}from'node:fs';
async function make(){const base=path.resolve('../../work/runtime-tests');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'case-'));const project=path.join(dir,'project');await fs.mkdir(project);const store=new Store(path.join(dir,'data'));return{dir,project,store,files:new ProjectFiles(project,store),runner:new Runner(path.resolve('native/SandboxRunner.exe'),store.directory,async()=>true,()=>{})}}
test('pausing kills the entire isolated process tree and does not sync partial files',{skip:process.platform!=='win32',timeout:45000},async()=>{
 const f=await make();const controller=new AbortController();let childPid=0;let abortTimer:ReturnType<typeof setTimeout>|undefined;
 const safety=setTimeout(()=>controller.abort(),30000);
 try{
  f.runner.publish=text=>{const match=text.match(/child-pid:(\d+)/);if(match&&!childPid){childPid=Number(match[1]);abortTimer=setTimeout(()=>controller.abort(),500)}};
  const code=`const cp=require('child_process').spawn(process.execPath,['-e',\"setInterval(()=>require('fs').appendFileSync('child.txt','x'),50)\"],{stdio:'ignore'});console.log('child-pid:'+cp.pid);setInterval(()=>{},1000)`;
  await assert.rejects(f.runner.run('cancel',f.files,{program:'node',args:['-e',code],purpose:'execute'},controller.signal));
  assert.ok(childPid>0,'the child process was actually launched before pause');
  await new Promise(r=>setTimeout(r,250));assert.throws(()=>process.kill(childPid,0),(e:any)=>e.code==='ESRCH','child process no longer exists');
  assert.equal(await f.files.digest('child.txt'),'');
  assert.equal((await fs.readdir(path.join(f.store.directory,'executions'))).length,0,'temporary execution copy cleaned');
 }finally{clearTimeout(safety);if(abortTimer)clearTimeout(abortTimer);f.store.close()}
});
test('npm project dependency installation works inside AppContainer',{skip:process.platform!=='win32'||process.env.AIW_NETWORK_TEST!=='1',timeout:90000},async()=>{const f=await make();try{await fs.writeFile(path.join(f.project,'package.json'),JSON.stringify({name:'ai-workspace-install-test',version:'1.0.0',private:true}));const result=await f.runner.install('install',f.files,'npm',['is-number@7.0.0'],new AbortController().signal);assert.equal(result.exitCode,0,result.stderr+'\n'+result.stdout);assert.equal(JSON.parse(await f.files.read('node_modules/is-number/package.json')).version,'7.0.0');}finally{f.store.close()}});
test('external project edits invalidate an isolated command result and are preserved',{skip:process.platform!=='win32',timeout:45000},async()=>{
 const f=await make();try{await fs.writeFile(path.join(f.project,'original.txt'),'before');let edited=false;f.runner.publish=text=>{if(text.includes('ready-for-change')&&!edited){edited=true;writeFileSync(path.join(f.project,'original.txt'),'external edit')}};
 await assert.rejects(f.runner.run('external',f.files,{program:'node',args:['-e',"console.log('ready-for-change');setTimeout(()=>require('fs').writeFileSync('generated.txt','result from old copy'),450)"],purpose:'verify'},new AbortController().signal),/其他程序修改/);
 assert.equal(edited,true);assert.equal(await f.files.read('original.txt'),'external edit');assert.equal(await f.files.digest('generated.txt'),'');
 }finally{f.store.close()}
});

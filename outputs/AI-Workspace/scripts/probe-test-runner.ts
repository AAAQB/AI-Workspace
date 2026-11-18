import{promises as fs}from'node:fs';import path from'node:path';import{Store}from'../src/core/store';import{Runner}from'../src/core/runner';import{ProjectFiles}from'../src/core/files';
const project=path.resolve(process.argv[2]);const dir=path.resolve('../../work/test-runner-probe');await fs.mkdir(dir,{recursive:true});const store=new Store(dir);const runner=new Runner(path.resolve('native/SandboxRunner.exe'),dir,async()=>false,text=>process.stdout.write(text));
try{
 for(const variant of [{name:'single-process CLI',args:['--experimental-test-isolation=none','--test','tests/math.test.cjs']},{name:'direct test file',args:['tests/math.test.cjs']}]){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{const r=await runner.run('diagnostic',new ProjectFiles(project,store),{program:'node',args:variant.args,purpose:'verify'},controller.signal);console.log(JSON.stringify({variant:variant.name,exitCode:r.exitCode,stdout:r.stdout,stderr:r.stderr}));}
  catch(e){console.log(JSON.stringify({variant:variant.name,error:e instanceof Error?e.message:String(e)}));}finally{clearTimeout(timer)}
 }
}finally{store.close()}

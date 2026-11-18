/** Opt-in development check. Uses this application's own authorized connection;
 * no credentials are returned over stdout or copied into the test project. */
import {app,safeStorage} from 'electron';
import {createChatGPT} from '@siwc/local';
import {DatabaseSync} from 'node:sqlite';
import {promises as fs,writeFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../src/core/store';
import {Engine} from '../src/core/engine';
import {Providers} from '../src/core/providers';
import {Runner} from '../src/core/runner';
import {ToolBroker} from '../src/core/tools';
import {hash} from '../src/core/files';

const source=path.resolve(process.env.AIW_SOURCE_ROOT||'');
const runRoot=path.resolve(process.env.AIW_LIVE_RUN_ROOT||'');
const allowed=path.resolve(source,'../../work/live-e2e');
const relative=path.relative(allowed,runRoot);
if(!source||!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid live verification directory.');
app.setName('AI Workspace');
// Windows safeStorage is bound to this application's Local State. Keep that
// authorized encryption context. No BrowserWindow or live task Store is opened.
app.setPath('userData',path.join(app.getPath('appData'),'AI Workspace'));app.disableHardwareAcceleration();
let store:Store|undefined,engine:Engine|undefined,key='';let controlTimer:ReturnType<typeof setInterval>|undefined;
const redact=(text:string)=>{let value=key?text.replaceAll(key,'[密钥已隐藏]'):text;return value.replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/gi,'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,'[密钥已隐藏]')};
let lastEvent=0,lastWrite=0;
function status(force=false){
 if(!store||!engine)return;const task=engine.current||store.tasks()[0];if(!task)return;
 if(force||Date.now()-lastWrite>700){lastWrite=Date.now();writeFileSync(path.join(runRoot,'status.json'),JSON.stringify({taskId:task.id,status:task.status,phase:task.phase,current:task.plan[task.index]?.title,steps:task.plan.map(s=>({title:s.title,state:s.state,attempts:s.attempts})),note:task.note,usage:store.usage(task.id)},null,2));}
 for(const e of store.events(task.id,15))if(e.id>lastEvent){lastEvent=e.id;if(['phase','plan','review','error','notice','question'].includes(e.kind))console.log(JSON.stringify({kind:e.kind,actor:e.actor,text:redact(e.text).slice(0,650)}));}
 const pending=store.approvals(task.id).find(a=>a.decision==='pending');
 if(pending){console.log(JSON.stringify({requiresUserDecision:true,title:pending.title,detail:redact(pending.detail)}));setTimeout(()=>void engine!.pauseAll(),0);}
}
async function run(){
 await app.whenReady();
 if(process.platform!=='win32'||!safeStorage.isEncryptionAvailable())throw new Error('Windows credential protection is unavailable.');
 const liveData=path.join(app.getPath('appData'),'AI Workspace');
 // Read only model preferences. Do not instantiate Store on the user's live task DB.
 const settingsDb=new DatabaseSync(path.join(liveData,'workspace.sqlite'),{readOnly:true});
 const row=settingsDb.prepare('SELECT body FROM settings WHERE id=1').get() as {body:string}|undefined;
 const preferences=row?JSON.parse(row.body):{};settingsDb.close();
 key=safeStorage.decryptString(await fs.readFile(path.join(liveData,'deepseek.enc')));
 const chatgpt=createChatGPT({appName:'AI Workspace',appId:'ai-workspace',redirectPort:0,sendHostId:true,storageDir:path.join(liveData,'chatgpt'),
  credentialEncryption:{id:'ai-workspace-dpapi-v1',isAvailable:()=>safeStorage.isEncryptionAvailable(),encrypt:s=>safeStorage.encryptString(s),decrypt:b=>safeStorage.decryptString(Buffer.from(b))},
  openBrowser:()=>{throw new Error('Complete authorization in AI Workspace before this opt-in check.')}});
 const session=await chatgpt.getSession();if(session.status!=='connected'||!session.sharing)throw new Error('AI Workspace has no authorized ChatGPT plan connection.');
 if(!preferences.gptModel||!preferences.deepseekModel||!key)throw new Error('Configure both models in AI Workspace first.');
 await fs.mkdir(runRoot,{recursive:true});const project=path.join(runRoot,'project');await fs.mkdir(project,{recursive:true});
 const fixture=path.join(runRoot,'fixture.json');
 if(!await fs.stat(fixture).then(()=>true).catch(()=>false)){
  await fs.mkdir(path.join(project,'src'),{recursive:true});await fs.mkdir(path.join(project,'tests'),{recursive:true});
  // Use the real Node 22 single-process test mode supported by AppContainer.
  // This manifest is fixed BEFORE the agent starts; its hash is checked later.
  const manifest=JSON.stringify({name:'ai-workspace-live-verification',version:'1.0.0',private:true,scripts:{test:'node --experimental-test-isolation=none --test tests/math.test.cjs'}},null,2)+'\n';
  const tests="const test=require('node:test');\nconst assert=require('node:assert/strict');\nconst {sumNumbers}=require('../src/math.cjs');\ntest('empty array is zero',()=>assert.equal(sumNumbers([]),0));\ntest('positive and negative numbers',()=>assert.equal(sumNumbers([2,-3,5]),4));\ntest('decimals',()=>assert.equal(sumNumbers([0.25,0.5]),0.75));\ntest('reject non-array',()=>assert.throws(()=>sumNumbers('123'),TypeError));\ntest('reject string element',()=>assert.throws(()=>sumNumbers([1,'2']),TypeError));\ntest('reject null element',()=>assert.throws(()=>sumNumbers([null]),TypeError));\ntest('reject NaN',()=>assert.throws(()=>sumNumbers([NaN]),TypeError));\ntest('reject Infinity',()=>assert.throws(()=>sumNumbers([Infinity]),TypeError));\n";
  await fs.writeFile(path.join(project,'package.json'),manifest);await fs.writeFile(path.join(project,'tests/math.test.cjs'),tests);
  await fs.writeFile(path.join(project,'src/math.cjs'),"function sumNumbers(values){ return values.reduce((a,b)=>a+b); }\nmodule.exports={sumNumbers};\n");
  await fs.writeFile(fixture,JSON.stringify({packageHash:hash(manifest),testHash:hash(tests)}));
 }
 store=new Store(path.join(runRoot,'state'));store.setSettings({...store.settings(),...preferences});
 const models=new Providers(chatgpt,store,()=>key);
 const runner=new Runner(path.join(source,'native/SandboxRunner.exe'),store.directory,(...args)=>engine!.approve(...args),text=>{if(engine!.current)engine!.log(engine!.current,'command_output','engine',text)});
 const broker=new ToolBroker(store,runner,(...args)=>engine!.approve(...args));
 engine=new Engine(store,models,broker,()=>status(),redact);
 controlTimer=setInterval(async()=>{const file=path.join(runRoot,'control.json');try{const command=JSON.parse(await fs.readFile(file,'utf8'));if(command.action==='pause'){await fs.unlink(file);await engine!.pauseAll();}}catch{}},800);
 const goal='这是 AI Workspace 的真实双模型验收项目。修复 src/math.cjs 的 sumNumbers(values)：只接收数组；元素必须都是有限的 number，否则抛出 TypeError；空数组返回 0；其他数组返回总和。项目已准备不可修改的 tests/math.test.cjs 和 package.json，测试命令为 npm test。不得修改或删除测试文件、测试命令或 package.json 来绕过检查。请修复代码，真实运行并通过全部 8 项测试，补充简短中文 README.md 使用说明，然后由 GPT 验收交付。任务很小，请用尽可能少的子任务完成，但仍需实际运行检查。只操作本项目，使用 node 或 npm；不安装依赖，不联网，不删除文件，不上传，不修改系统。';
 let task=store.tasks()[0];let taskId:string;
 if(task){taskId=task.id;if(task.status!=='completed')await engine.action(task.id,'resume');}
 else taskId=engine.create(goal,project);
 await engine.settled();status(true);task=store.task(taskId);
 const original=JSON.parse(await fs.readFile(fixture,'utf8'));
 const packageUnchanged=hash(await fs.readFile(path.join(project,'package.json')))===original.packageHash;
 const testsUnchanged=hash(await fs.readFile(path.join(project,'tests/math.test.cjs')))===original.testHash;
 // Independent fixed acceptance test, after the agent has finished.
 const check=spawnSync(runner.find('node'),['--test','tests/math.test.cjs'],{cwd:project,windowsHide:true,encoding:'utf8',timeout:30000,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH}});
 const evidence=store.allEvents(taskId).map(e=>({...e,text:redact(e.text)}));
 const report={application:'AI Workspace',version:'0.1.1',realModelsUsed:true,models:{GPT:preferences.gptModel,DeepSeek:preferences.deepseekModel},taskId,status:task.status,phase:task.phase,note:task.note,goal,project,steps:task.plan.map(s=>({title:s.title,state:s.state,attempts:s.attempts,feedback:s.feedback})),summary:task.summary,usage:store.usage(taskId),independentAcceptance:{exitCode:check.status,packageUnchanged,testsUnchanged,output:check.stdout,stderr:check.stderr},modelReviewDecisions:evidence.filter(e=>e.kind==='review').map(e=>e.data),passed:task.status==='completed'&&check.status===0&&packageUnchanged&&testsUnchanged};
 await fs.writeFile(path.join(runRoot,'evidence.json'),JSON.stringify(evidence,null,2));
 await fs.writeFile(path.join(source,'../AI-Workspace-真实任务验收.json'),redact(JSON.stringify(report,null,2)));
 console.log(JSON.stringify({finished:true,taskStatus:task.status,passed:report.passed,independentExitCode:check.status,packageUnchanged,testsUnchanged}));
 if(controlTimer)clearInterval(controlTimer);store.close();store=undefined;key='';app.exit(report.passed?0:2);
}
run().catch(async error=>{const message=redact(error?.message||'Live verification failed.');try{if(engine){await engine.pauseAll();await engine.settled()}if(store)store.close()}catch{}key='';console.error(JSON.stringify({liveVerificationError:message}));app.exit(1)});

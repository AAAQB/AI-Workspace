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
import {Conversations} from '../src/core/conversations';

const source=path.resolve(process.env.AIW_SOURCE_ROOT||'');
const runRoot=path.resolve(process.env.AIW_LIVE_RUN_ROOT||'');
const allowed=path.resolve(source,'../../work/live-chat-e2e');
const relative=path.relative(allowed,runRoot);
if(!source||!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid live verification directory.');
app.setName('AI Workspace');
// Windows safeStorage is bound to this application's Local State. Keep that
// authorized encryption context. No BrowserWindow or live task Store is opened.
app.setPath('userData',path.join(app.getPath('appData'),'AI Workspace'));app.disableHardwareAcceleration();
let store:Store|undefined,engine:Engine|undefined,conversations:Conversations|undefined,key='',stage='connecting';let controlTimer:ReturnType<typeof setInterval>|undefined;
const redact=(text:string)=>{let value=key?text.replaceAll(key,'[密钥已隐藏]'):text;return value.replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/gi,'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,'[密钥已隐藏]')};
let lastWrite=0,lastEvent=0;
function publish(){if(!store||Date.now()-lastWrite<500)return;lastWrite=Date.now();const task=store.tasks()[0],chat=store.chats()[0];writeFileSync(path.join(runRoot,'status.json'),JSON.stringify({stage,chatStatus:chat?.status,chatMessages:chat?.messages.length,taskStatus:task?.status,phase:task?.phase,steps:task?.plan.map(s=>({title:s.title,state:s.state})),usage:store.usage()},null,2));if(task)for(const event of store.events(task.id,10))if(event.id>lastEvent){lastEvent=event.id;if(['phase','review','error'].includes(event.kind))console.log(JSON.stringify({kind:event.kind,text:redact(event.text).slice(0,450)}));}const approval=store.approvals().find(a=>a.decision==='pending');if(approval){console.log(JSON.stringify({unexpectedApproval:true,title:approval.title}));setTimeout(async()=>{await conversations?.pauseAll();await engine?.pauseAll()},0)}}
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

 await fs.mkdir(runRoot,{recursive:true});const project=path.join(runRoot,'project');await fs.mkdir(path.join(project,'src'),{recursive:true});await fs.mkdir(path.join(project,'tests'),{recursive:true});
 const manifest=JSON.stringify({name:'aiw-chat-first-validation',private:true,version:'1.0.0',scripts:{test:'node --experimental-test-isolation=none --test tests/math.test.cjs'}},null,2)+'\n';
 const tests="const test=require('node:test');const assert=require('node:assert/strict');const {sumNumbers}=require('../src/math.cjs');\ntest('empty',()=>assert.equal(sumNumbers([]),0));test('mixed',()=>assert.equal(sumNumbers([2,-3,5]),4));test('decimal',()=>assert.equal(sumNumbers([0.25,0.5]),0.75));test('non-array',()=>assert.throws(()=>sumNumbers('123'),TypeError));test('string',()=>assert.throws(()=>sumNumbers([1,'2']),TypeError));test('null',()=>assert.throws(()=>sumNumbers([null]),TypeError));test('NaN',()=>assert.throws(()=>sumNumbers([NaN]),TypeError));test('Infinity',()=>assert.throws(()=>sumNumbers([Infinity]),TypeError));\n";
 if(!await fs.stat(path.join(project,'package.json')).then(()=>true).catch(()=>false)){await fs.writeFile(path.join(project,'package.json'),manifest);await fs.writeFile(path.join(project,'tests/math.test.cjs'),tests);await fs.writeFile(path.join(project,'src/math.cjs'),"function sumNumbers(values){return values.reduce((a,b)=>a+b)};module.exports={sumNumbers};\n");
 }
 store=new Store(path.join(runRoot,'state'));store.setSettings({...store.settings(),...preferences});let executionReady=false;
 const models=new Providers(chatgpt,store,()=>executionReady?key:undefined);
 const runner=new Runner(path.join(source,'native/SandboxRunner.exe'),store.directory,(...args)=>engine!.approve(...args),text=>{if(engine!.current)engine!.log(engine!.current,'command_output','engine',text)});
 const broker=new ToolBroker(store,runner,(...args)=>engine!.approve(...args));
 engine=new Engine(store,models,broker,()=>{conversations?.scheduleSync();publish()},redact);
 conversations=new Conversations(store,models,engine,publish,()=>executionReady,redact);
 const existingChat=store.chats()[0];const chatId=existingChat?.id||conversations.create();let firstPassed=false,discussionPassed=false;
 controlTimer=setInterval(async()=>{try{const file=path.join(runRoot,'control.json');const command=JSON.parse(await fs.readFile(file,'utf8'));if(command.action==='pause'){await fs.unlink(file);await conversations!.pauseAll();await engine!.pauseAll()}}catch{}},800);
 async function settled(){for(;;){await new Promise(r=>setTimeout(r,200));if(!conversations!.controller&&!engine!.controller){await new Promise(r=>setTimeout(r,200));if(!conversations!.controller&&!engine!.controller)return}}}
 if(!existingChat){stage='ordinary-chat';await conversations.send(chatId,'我想做一个数字数组求和的小工具，先只讨论需求和输入校验，暂时不要开始开发、不要创建或修改文件。请简洁说明你会怎么设计。');await settled();
 const first=store.chat(chatId);firstPassed=first.status==='idle'&&first.messages.some(m=>m.role==='assistant')&&store.tasks().length===0&&store.usage().every(u=>u.provider!=='DeepSeek');
 if(!firstPassed)throw new Error('Ordinary GPT-only chat did not meet acceptance.');
 stage='follow-up-discussion';await conversations.send(chatId,'继续刚才的讨论：为什么要拒绝 NaN 和 Infinity，而不是转换成数字？仍然只解释，不开始开发。');await settled();
 discussionPassed=store.chat(chatId).status==='idle'&&store.tasks().length===0&&store.usage().every(u=>u.provider!=='DeepSeek');if(!discussionPassed)throw new Error('Follow-up discussion unexpectedly delegated development.');
 }else{const prior=JSON.parse(await fs.readFile(path.join(source,'../AI-Workspace-聊天优先验收.json'),'utf8'));if(prior.chatId!==chatId)throw new Error('No matching prior validation evidence');firstPassed=prior.checks.ordinaryChatWithoutProjectOrDeepSeek;discussionPassed=prior.checks.continuedDiscussionNoDelegation;}
 executionReady=true;await conversations.setProject(chatId,project);
 stage='explicit-development';const resumedTask=store.tasks().find(t=>t.chatId===chatId);if(resumedTask&&resumedTask.status!=='completed')await engine.action(resumedTask.id,'resume');else if(!resumedTask)await conversations.send(chatId,'现在开始开发。请在所选项目修复 src/math.cjs 的 sumNumbers(values)：只接受数组，元素必须为有限的 number，否则抛 TypeError；空数组返回 0，其余返回总和。先读取文件，由 GPT 亲自给出关键函数的具体实现代码，再交给 DeepSeek 落地并真实运行 npm test，最后由 GPT 检查交付。tests/math.test.cjs 和 package.json 已固定，禁止修改或删除它们来绕过验证。补充简短中文 README.md。无第三方依赖，不安装、不联网、不删除文件、不上传、不修改系统。全部 8 项测试必须通过。');await settled();
 const task=store.tasks().find(t=>t.chatId===chatId);const beforeFollowup=store.usage().filter(u=>u.provider==='DeepSeek').reduce((n,u)=>n+u.requests,0);const taskCount=store.tasks().length;
 stage='post-development-chat';if(task?.status==='completed'){await conversations.send(chatId,'请用两三句话解释这次为什么空数组需要返回 0，以及你检查了哪些证据。只解释，不修改任何文件，不开始新任务。');await settled();}
 const afterFollowup=store.usage().filter(u=>u.provider==='DeepSeek').reduce((n,u)=>n+u.requests,0);
 const check=spawnSync(runner.find('node'),['--test','tests/math.test.cjs'],{cwd:project,windowsHide:true,encoding:'utf8',timeout:30000,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH}});
 const immutable=hash(await fs.readFile(path.join(project,'package.json')))===hash(manifest)&&hash(await fs.readFile(path.join(project,'tests/math.test.cjs')))===hash(tests);
 const c=store.chat(chatId);const contribution=!!task&&/GPT 提供的设计与关键实现/.test(task.goal)&&/function\s+sumNumbers|sumNumbers\s*=/.test(task.goal);
 const report={application:'AI Workspace',version:'0.2.0',date:'2026-11-17',models:{GPT:preferences.gptModel,DeepSeek:preferences.deepseekModel},realModels:true,chatId,checks:{ordinaryChatWithoutProjectOrDeepSeek:firstPassed,continuedDiscussionNoDelegation:discussionPassed,explicitRequestStartsDevelopment:taskCount===1,GPTProvidedCriticalCode:contribution,developmentCompleted:task?.status==='completed',immutableTestsAndManifest:immutable,independentTestsExitCode:check.status,continuedChatDoesNotDelegate:beforeFollowup===afterFollowup&&store.tasks().length===taskCount,allMainRepliesFromGPT:c.messages.every(m=>m.role==='user'||m.role==='assistant')},chatStatus:c.status,taskStatus:task?.status,taskSummary:task?.summary,usage:store.usage(),conversation:c.messages,independentTestOutput:check.stdout,stderr:check.stderr,testConfiguration:'Manifest fixed before the chat; Node 22 single-process test mode in AppContainer; independent test uses default node --test outside AppContainer.',GPTTokenUsage:'not returned by official connection; zero counters mean unavailable'};
 const passed=Object.values(report.checks).every(v=>v===true||v===0)&&c.status==='idle';
 await fs.writeFile(path.join(source,'../AI-Workspace-聊天优先验收.json'),redact(JSON.stringify({...report,passed},null,2)));
 if(task)await fs.writeFile(path.join(runRoot,'evidence.json'),redact(JSON.stringify(store.allEvents(task.id),null,2)));
 stage='finished';publish();console.log(JSON.stringify({finished:true,passed,checks:report.checks}));
 if(controlTimer)clearInterval(controlTimer);await conversations.pauseAll();await engine.pauseAll();await conversations.settled();await engine.settled();store.close();store=undefined;key='';app.exit(passed?0:2);
}
run().catch(async error=>{console.error(JSON.stringify({validationError:redact(error?.message||'failed')}));try{if(conversations)await conversations.pauseAll();if(engine)await engine.pauseAll();if(conversations)await conversations.settled();if(engine)await engine.settled();if(store)store.close()}catch{}key='';app.exit(1)});

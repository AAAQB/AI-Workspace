import { app, BrowserWindow, ipcMain, dialog, Menu, protocol, net, safeStorage, shell, powerMonitor, clipboard } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createChatGPT } from '@siwc/local';
import { z } from 'zod';
import { Store } from './core/store';
import { parseSettingsUpdate } from './core/settings';
import { Providers } from './core/providers';
import { ProjectFiles } from './core/files';
import { Runner } from './core/runner';
import { ToolBroker } from './core/tools';
import { Engine } from './core/engine';
import { Conversations } from './core/conversations';
import { webUrl } from './core/urls';
import {PreviewManager}from'./preview-manager';
import { AnswerList } from './core/decisions';
import type { Snapshot, Settings } from './shared';

app.setName('AI Workspace');
app.commandLine.appendSwitch('disable-quic');
app.setAppUserModelId('personal.aiworkspace.desktop');
const profileArg=process.argv.find(a=>a.startsWith('--profile-dir='))?.slice('--profile-dir='.length);
if(profileArg&&(!path.isAbsolute(profileArg)||path.resolve(profileArg)===path.parse(path.resolve(profileArg)).root))throw new Error('诊断配置目录必须是具体的绝对路径。');
const testMode=(!app.isPackaged&&process.env.AIW_TEST_MODE==='1')||!!profileArg&&process.argv.includes('--diagnostic-hidden');
if(testMode)app.disableHardwareAcceleration();
if(profileArg)app.setPath('userData',path.resolve(profileArg));
else if(!app.isPackaged&&process.env.AIW_DATA_DIR)app.setPath('userData',path.resolve(process.env.AIW_DATA_DIR));
else app.setPath('userData',path.join(app.getPath('appData'),'AI Workspace'));
protocol.registerSchemesAsPrivileged([{scheme:'aiw',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const hasLock=app.requestSingleInstanceLock();if(!hasLock)app.quit();
let win:BrowserWindow|undefined,store:Store,engine:Engine,conversations:Conversations,providers:Providers,chatgpt:ReturnType<typeof createChatGPT>;
let session:Snapshot['session']={status:'disconnected',sharing:false},profiles:Snapshot['profiles']=[],gptModels:Snapshot['gptModels']=[],deepseekModels:string[]=[];
let preview:PreviewManager,previewBuild:AbortController|undefined,previewBuildDone:Promise<void>|undefined,buildState:{chatId:string;log:string}|undefined;
let deepseekKey:string|undefined,notice:string|undefined,closing=false,connectionTest:AbortController|undefined;
const selectedProjects=new Set<string>();
const text=z.string().min(1).max(100000),id=z.string().min(1).max(200);
const redact=(input:string)=>{
  let result=input;if(deepseekKey)result=result.replaceAll(deepseekKey,'[密钥已隐藏]');
  return result.replace(/Bearer\s+[A-Za-z0-9._~-]{16,}/gi,'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g,'[密钥已隐藏]');
};
const safeMessage=(e:unknown)=>redact(e instanceof Error?(e.name==='AbortError'?'操作已停止，已有记录已保留。':e.message):'操作未完成，请重试。');
function snapshot():Snapshot {
  const tasks=store.tasks().map(t=>({...t,messages:[]}));const chat=conversations.selected?store.chat(conversations.selected):undefined;const selected=chat?.activeTaskId;
  const chats=store.chats().map(({id,title,project,status,activeTaskId,taskIds,updated})=>({id,title,project,status,activeTaskId,taskIds,updated,developmentStatus:tasks.find(t=>taskIds.includes(t.id)&&!['completed','cancelled'].includes(t.status))?.status}));
  const visible=chat?(({pending,memory,memoryThrough,notices,...rest})=>rest)(chat):undefined;
  const usageIds=chat?[chat.id,...chat.taskIds]:[];const usage=usageIds.flatMap(id=>store.usage(id)).reduce<Snapshot['usage']>((all,row)=>{const existing=all.find(u=>u.provider===row.provider);if(existing){existing.input+=row.input;existing.cached+=row.cached;existing.output+=row.output;existing.requests+=row.requests;existing.estimated=existing.estimated===null||row.estimated===null?null:existing.estimated+row.estimated;}else all.push({...row});return all;},[]);
  const previewState=preview?.snapshot(chat?.id),build=buildState?.chatId===chat?.id?buildState:undefined;
  return {preview:build?{...(previewState||{chatId:chat!.id,status:'loading',root:'',entry:'index.html',route:'/',title:'项目网页',viewport:{width:1100,height:760},logs:[],shots:[]}),building:true,buildLog:build.log}:previewState,chats,activeChat:chat?.id,chat:visible,chatStreaming:conversations.streaming,chatBusy:!!conversations.controller,tasks,active:selected,settings:store.settings(),session,profiles,gptModels,deepseekModels,hasDeepseekKey:!!deepseekKey,events:selected?store.events(selected):[],approvals:chat?chat.taskIds.flatMap(id=>store.approvals(id)):[],usage,notice,streaming:engine.streaming,busy:!!previewBuild||!!engine.controller||!!conversations.controller||!!connectionTest,version:app.getVersion()};
}
let scheduled=false;
function publish(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;if(win&&!win.isDestroyed()&&!win.webContents.isLoadingMainFrame())win.webContents.send('aiw:state',snapshot());},30);}
async function secretFile(){return path.join(store.directory,'deepseek.enc');}
async function writeSecret(key:string){if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 凭据加密不可用，未保存密钥。');const file=await secretFile(),tmp=file+'.'+randomUUID();await fs.writeFile(tmp,safeStorage.encryptString(key),{mode:0o600});await fs.rename(tmp,file);deepseekKey=key;}
function editable(){if(previewBuild||engine.controller||conversations.controller||connectionTest)throw new Error('请先暂停回复与开发任务，等待操作结束后再修改设置或文件。');}
async function pauseAll(){previewBuild?.abort();await previewBuildDone?.catch(()=>{});preview?.hide();connectionTest?.abort();while(connectionTest)await new Promise(r=>setTimeout(r,25));await conversations.pauseAll();await engine.pauseAll();await conversations.settled();await engine.settled();}
async function changeAccount(action:()=>Promise<unknown>){await pauseAll();try{await action();}finally{session=await chatgpt.getSession();profiles=await chatgpt.listProfiles();gptModels=[];if(session.sharing)await refreshModels();publish();}}
async function refreshModels(){
  const errors:string[]=[];
  if(session.sharing)try{gptModels=await chatgpt.listModels();const s=store.settings();if(!gptModels.some(m=>m.slug===s.gptModel)){s.gptModel=gptModels[0]?.slug||'';store.setSettings(s);}}catch(e){errors.push(safeMessage(e));}
  if(deepseekKey)try{deepseekModels=await providers.deepseekModels();const s=store.settings();if(deepseekModels.length&&!deepseekModels.includes(s.deepseekModel)){s.deepseekModel=deepseekModels[0];store.setSettings(s);}}catch(e){errors.push(safeMessage(e));}
  if(errors.length)notice=errors.join('\n');publish();
}
function handle(name:string,action:(...args:any[])=>unknown){ipcMain.handle('aiw:'+name,async(event,...args)=>{
  if(!win||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame?.url.startsWith('aiw://app/'))throw new Error('无效的操作来源。');
  try{if(previewBuild&&['sendMessage','answerQuestion','confirmRequirements','startDevelopment','chatAction','action','answer','setChatProject','createTask'].includes(name))throw new Error('网页正在构建，请等待完成或先停止构建。');return await action(...args);}catch(e){notice=safeMessage(e);publish();throw new Error(notice);}
});}
async function close(){if(closing)return;closing=true;chatgpt.cancelSignIn();await pauseAll();await preview?.close();win?.destroy();store.close();app.quit();}
async function start(){
  const dir=app.getPath('userData');await fs.mkdir(dir,{recursive:true});store=new Store(dir);
  try{const b=await fs.readFile(await secretFile());if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 加密服务不可用。');deepseekKey=safeStorage.decryptString(b);}catch(e:any){if(e.code!=='ENOENT')notice='无法读取已保存的 DeepSeek 密钥。请在设置中重新连接；原文件已保留。';}
  chatgpt=createChatGPT({appName:'AI Workspace',appId:'ai-workspace',redirectPort:0,storageDir:path.join(dir,'chatgpt'),sendHostId:true,
    credentialEncryption:{id:'ai-workspace-dpapi-v1',isAvailable:()=>safeStorage.isEncryptionAvailable(),encrypt:s=>safeStorage.encryptString(s),decrypt:b=>safeStorage.decryptString(Buffer.from(b))},
    openBrowser:async url=>{if(new URL(url).origin!=='https://auth.openai.com')throw new Error('授权地址不正确。');await shell.openExternal(url);}});
  providers=new Providers(chatgpt,store,()=>deepseekKey,(input,init)=>net.fetch(input,{...init,credentials:'omit'}));
  const runner=new Runner(app.isPackaged?path.join(process.resourcesPath,'SandboxRunner.exe'):path.join(app.getAppPath(),'native/SandboxRunner.exe'),dir,(...args)=>engine.approve(...args),text=>{if(engine.current)engine.log(engine.current,'command_output','engine',text);});
  const broker=new ToolBroker(store,runner,(...args)=>engine.approve(...args));engine=new Engine(store,providers,broker,()=>{publish();conversations?.scheduleSync();},redact);
  conversations=new Conversations(store,providers,engine,publish,()=>!!deepseekKey&&!!store.settings().deepseekModel,redact,id=>preview.inspectChat(id));
  for(const t of store.tasks())selectedProjects.add(t.project);
  for(const c of store.chats())if(c.project)selectedProjects.add(c.project);
  chatgpt.subscribe(s=>{session=s;publish();});session=await chatgpt.getSession();profiles=await chatgpt.listProfiles();
  protocol.handle('aiw',async request=>{
    const url=new URL(request.url);if(url.host!=='app'||request.method!=='GET')return new Response('Not allowed',{status:403});
    const rel=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1));const root=path.join(app.getAppPath(),'dist/ui'),file=path.resolve(root,rel);
    if(path.relative(root,file).startsWith('..')||path.isAbsolute(path.relative(root,file)))return new Response('Not allowed',{status:403});
    try{const result=await net.fetch(pathToFileURL(file).href);const headers=new Headers(result.headers);headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");return new Response(result.body,{status:result.status,headers});}catch{return new Response('Not found',{status:404});}
  });
  win=new BrowserWindow({width:1440,height:920,minWidth:900,minHeight:700,show:!testMode,backgroundColor:'#ffffff',title:'AI Workspace',icon:path.join(app.getAppPath(),'dist/icon.png'),webPreferences:{preload:path.join(app.getAppPath(),'dist/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,allowRunningInsecureContent:false,backgroundThrottling:false,offscreen:testMode,devTools:!app.isPackaged}});
  preview=new PreviewManager(()=>win,store,publish,redact);broker.preview=preview;
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('aiw://app/'))e.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.on('close',e=>{if(!closing){e.preventDefault();void close();}});powerMonitor.on('suspend',()=>{void pauseAll();});
  app.on('before-quit',e=>{if(!closing){e.preventDefault();void close();}});app.on('second-instance',()=>{if(win?.isMinimized())win.restore();win?.show();win?.focus();});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'文件',submenu:[{label:'关闭',accelerator:'Alt+F4',click:()=>{void close();}}]},{label:'编辑',submenu:[{role:'undo',label:'撤销'},{role:'redo',label:'重做'},{type:'separator'},{role:'cut',label:'剪切'},{role:'copy',label:'复制'},{role:'paste',label:'粘贴'},{role:'selectAll',label:'全选'}]}]));
  const previewChat=(value:unknown)=>{const chatId=id.parse(value);if(conversations.selected!==chatId)throw new Error('请先切换到这个聊天。');const c=store.chat(chatId);if(!c.project)throw new Error('请先选择项目文件夹。');return c;};
  handle('previewOpen',(value,options)=>{const c=previewChat(value);return preview.open(c.id,z.object({root:z.string().max(2000).optional(),entry:z.string().max(2000).optional()}).strict().parse(options||{}));});
  handle('previewClose',value=>preview.close(previewChat(value).id));
  handle('previewNavigate',(value,route)=>preview.navigate(previewChat(value).id,z.string().max(4000).parse(route)));
  handle('previewReload',value=>preview.reload(previewChat(value).id));
  handle('previewViewport',(value,w,h)=>preview.viewport(previewChat(value).id,z.number().int().min(360).max(1920).parse(w),z.number().int().min(480).max(1200).parse(h)));
  handle('previewBounds',(value,bounds)=>{id.parse(value);const b=z.object({x:z.number().finite(),y:z.number().finite(),width:z.number().finite().min(0),height:z.number().finite().min(0),visible:z.boolean()}).strict().parse(bounds);if(conversations.selected!==value){preview.hide();return;}preview.setBounds(value,b);});
  handle('previewScreenshot',value=>preview.screenshot(previewChat(value).id));
  handle('previewCancelBuild',()=>{previewBuild?.abort();});
  handle('previewBuild',async value=>{editable();const c=previewChat(value);const files=new ProjectFiles(c.project!,store);const pkg=JSON.parse(await files.read('package.json'));if(typeof pkg.scripts?.build!=='string')throw new Error('这个项目没有 build 构建命令。静态网页可直接打开，其他项目可让 GPT 准备构建方式。');
    const controller=new AbortController(),enabled=engine.enabled;engine.enabled=false;previewBuild=controller;buildState={chatId:c.id,log:'正在准备项目构建…'};preview.hide();publish();
    const manual=new Runner(runner.helper,dir,async(title,detail,_operation,signal)=>{signal.throwIfAborted();preview.hide();const response=await dialog.showMessageBox(win!,{type:'question',title,message:title,detail,signal,buttons:['允许这次操作','取消'],defaultId:1,cancelId:1,noLink:true});signal.throwIfAborted();return response.response===0;},()=>{});
    previewBuildDone=(async()=>{try{const result=await manual.run('preview-'+c.id,files,{program:'npm',args:['run','build'],cwd:'',purpose:'execute'},controller.signal,false,(_kind,text)=>{if(buildState){buildState.log=(buildState.log+'\n'+redact(text)).slice(-12000);publish();}});if(result.exitCode!==0)throw new Error('网页构建未通过。'+redact(result.stderr||result.stdout).slice(-3000));controller.signal.throwIfAborted();const latest=store.chat(c.id);latest.previewBuildFingerprint=await files.fingerprint();store.saveChat(latest);await preview.open(c.id);notice='网页已构建并打开。';}finally{previewBuild=undefined;buildState=undefined;engine.enabled=enabled;publish();}})();
    try{await previewBuildDone;}finally{previewBuildDone=undefined;}
  });
  handle('snapshot',()=>snapshot());handle('selectTask',(value)=>conversations.selectTask(id.parse(value)));
  handle('createChat',()=>conversations.create());handle('selectChat',value=>{preview.hide();return conversations.select(id.parse(value))});
  handle('saveQuestionDraft',(chatId,questionId,answers)=>conversations.saveQuestionDraft(id.parse(chatId),id.parse(questionId),AnswerList.parse(answers)));
  handle('answerQuestion',(chatId,questionId,answers)=>conversations.answerQuestion(id.parse(chatId),id.parse(questionId),AnswerList.parse(answers)));
  handle('confirmRequirements',(chatId,revision)=>conversations.confirmRequirements(id.parse(chatId),z.number().int().min(0).parse(revision)));
  handle('renameChat',(chatId,title)=>{const chat=store.chat(id.parse(chatId));chat.title=redact(z.string().trim().min(1).max(100).parse(title));store.saveChat(chat);publish();});
  handle('copyText',value=>clipboard.writeText(z.string().max(2_000_000).parse(value)));handle('openLink',value=>shell.openExternal(webUrl(z.string().max(8000).parse(value))));
  handle('exportChat',async value=>{const chat=store.chat(id.parse(value));const result=await dialog.showSaveDialog(win!,{title:'导出聊天记录',defaultPath:'AI-Workspace-chat.json',filters:[{name:'聊天记录',extensions:['json']}]});if(result.canceled||!result.filePath)return;await fs.writeFile(result.filePath,redact(JSON.stringify({title:chat.title,messages:chat.messages,tasks:chat.taskIds.map(id=>{const t=store.task(id);return{...t,messages:[]}}),usage:[chat.id,...chat.taskIds].flatMap(id=>store.usage(id))},null,2)),'utf8');notice='聊天记录已导出。';publish();});
  handle('sendMessage',(chatId,value)=>{if(!session.sharing||!store.settings().gptModel)throw new Error('请先连接 ChatGPT 并选择 GPT 模型。普通聊天不需要 DeepSeek。');return conversations.send(id.parse(chatId),text.parse(value).trim());});
  handle('setChatProject',(chatId,project)=>{project=text.parse(project);if(!selectedProjects.has(project))throw new Error('请通过“选择项目”指定文件夹。');return conversations.setProject(id.parse(chatId),project);});
  handle('startDevelopment',value=>conversations.startDevelopment(id.parse(value)));handle('chatAction',(chatId,action)=>conversations.action(id.parse(chatId),z.enum(['pause','resume']).parse(action)));
  handle('chooseProject',async()=>{const r=await dialog.showOpenDialog(win!,{title:'选择本次任务的项目文件夹',properties:['openDirectory','createDirectory']});if(r.canceled)return null;const project=await fs.realpath(r.filePaths[0]);const f=new ProjectFiles(project,store);await f.checkRoot();const relative=path.relative(project,dir);if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw new Error('请选择具体项目文件夹，不能包含 AI Workspace 的账户和记录目录。');selectedProjects.add(project);return project;});
  handle('createTask',async(goal,project)=>{goal=text.parse(goal).trim();project=text.parse(project);if(!selectedProjects.has(project))throw new Error('请使用“选择项目”指定文件夹。');await new ProjectFiles(project,store).checkRoot();return engine.create(goal,project);});
  handle('action',(taskId,action)=>engine.action(id.parse(taskId),z.enum(['resume','pause','cancel','enqueue']).parse(action)));
  handle('answer',(taskId,value)=>engine.answer(id.parse(taskId),text.parse(value)));handle('decide',(value,decision)=>engine.decide(id.parse(value),z.enum(['approved','denied']).parse(decision)));
  handle('settings',(value)=>{const parsed=parseSettingsUpdate(value);if(Object.keys(parsed).some(key=>key!=='theme'))editable();if(parsed.gptModel&&gptModels.length&&!gptModels.some(m=>m.slug===parsed.gptModel))throw new Error('请选择当前 ChatGPT 账号可用的模型。');store.setSettings({...store.settings(),...parsed});publish();});
  handle('saveDeepseek',async(value)=>{editable();const key=z.string().trim().min(12).max(500).regex(/^[\x21-\x7e]+$/).parse(value);await writeSecret(key);await refreshModels();publish();});
  handle('removeDeepseek',async()=>{editable();deepseekKey=undefined;await fs.rm(await secretFile(),{force:true});deepseekModels=[];publish();});
  handle('signIn',(newProfile)=>changeAccount(()=>chatgpt.signIn({newProfile:z.boolean().optional().parse(newProfile),reconsent:session.status==='connected'&&!session.sharing})));
  handle('cancelSignIn',()=>chatgpt.cancelSignIn());handle('signOut',()=>changeAccount(()=>chatgpt.disconnect()));handle('profile',(value)=>changeAccount(()=>chatgpt.selectProfile(id.parse(value))));handle('refreshModels',refreshModels);
  async function checkConnections(both:boolean){editable();if(both&&!session.sharing)throw new Error('请先登录 ChatGPT 并允许本应用使用套餐。');if(!deepseekKey)throw new Error('请先填写 DeepSeek API Key。');const controller=new AbortController();connectionTest=controller;publish();const begin=Date.now();try{if(both)await providers.gpt('__connection_test__','只回复：GPT 连接成功','测试模型连接。',controller.signal,()=>{});await providers.deepseek('__connection_test__',[{role:'user',content:'只回复：DeepSeek 连接成功。'}],[],controller.signal,()=>{});notice=both?'GPT 和 DeepSeek 均已完成真实请求验证。':'DeepSeek 连接正常，已完成真实请求（'+((Date.now()-begin)/1000).toFixed(1)+' 秒）。';}finally{connectionTest=undefined;publish();}}
  handle('testConnections',()=>checkConnections(true));handle('testDeepseek',()=>checkConnections(false));

  handle('files',(taskId,directory)=>new ProjectFiles(store.task(id.parse(taskId)).project,store).list(z.string().max(3000).parse(directory)));
  handle('readFile',(taskId,file)=>new ProjectFiles(store.task(id.parse(taskId)).project,store).read(text.parse(file)));
  handle('saveFile',async(taskId,file,content)=>{editable();const t=store.task(id.parse(taskId));await new ProjectFiles(t.project,store).write(t.id,text.parse(file),z.string().max(2_000_000).parse(content),'手动编辑前的版本');t.revision++;if(t.status==='completed'){t.status='paused';t.phase='final';t.note='文件已手动修改，继续任务可重新验收。';}store.save(t);publish();});
  handle('versions',(taskId)=>store.versions(id.parse(taskId)));
  handle('restore',async(taskId,versionId)=>{editable();const t=store.task(id.parse(taskId)),v=store.versions(t.id).find(v=>v.id===id.parse(versionId));if(!v)throw new Error('找不到恢复点。');const f=new ProjectFiles(t.project,store);if(!v.existed){const r=await dialog.showMessageBox(win!,{type:'question',title:'恢复到文件创建之前',message:`该文件原本不存在。恢复将删除 ${v.path}，是否继续？`,buttons:['取消','确认删除'],defaultId:0,cancelId:0});if(r.response!==1)return;await f.remove(t.id,v.path,await f.digest(v.path));}else await f.restore(t.id,v);t.revision++;if(t.status==='completed'){t.status='paused';t.phase='final';}store.save(t);publish();});
  handle('openProject',(taskId)=>shell.openPath(store.task(id.parse(taskId)).project));handle('openUsage',()=>shell.openExternal('https://chatgpt.com/settings/usage'));
  handle('exportTask',async(taskId)=>{const t=store.task(id.parse(taskId));const r=await dialog.showSaveDialog(win!,{title:'导出任务记录',defaultPath:'AI-Workspace-task.json',filters:[{name:'任务记录',extensions:['json']}]});if(r.canceled||!r.filePath)return;await fs.writeFile(r.filePath,redact(JSON.stringify({task:{...t,messages:[]},events:store.allEvents(t.id),usage:store.usage(t.id)},null,2)),'utf8');});
  await win.loadURL('aiw://app/');if(!testMode){if(win.isMinimized())win.restore();win.show();win.focus();void refreshModels();}
}
if(hasLock)app.whenReady().then(start).catch(async e=>{await dialog.showMessageBox({type:'error',title:'AI Workspace 无法启动',message:safeMessage(e)});closing=true;app.quit();});

// Regression for expanded execution logs pushing the chat composer off screen.
// All state is an isolated offline fixture. No model requests or task actions.
import{_electron}from'playwright';import electronPath from'electron';import{mkdir,writeFile}from'node:fs/promises';import path from'node:path';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';import{DatabaseSync}from'node:sqlite';
const packaged=process.argv.includes('--packaged'),reproduce=process.argv.includes('--expect-bug'),root=path.resolve('../../work/execution-layout-'+randomUUID());await mkdir(root,{recursive:true});const env={...process.env,AIW_TEST_MODE:'1',AIW_DATA_DIR:root};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:packaged?path.resolve('../../work/final-release/win-unpacked/AI Workspace.exe'):electronPath,args:packaged?['--profile-dir='+root,'--diagnostic-hidden']:['.'],cwd:process.cwd(),env,timeout:30000});let db;const checks=[],metrics=[];
async function capture(name){const data=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64'));await writeFile(name,Buffer.from(data,'base64'))}
try{
 const page=await app.firstWindow();await page.getByRole('heading',{name:'先聊想法，再一起完成。'}).waitFor();
 const project=path.join(root,'project');await mkdir(project);const now=Date.now();
 const task={id:'long-logs',chatId:'long-chat',title:'长日志布局回归',goal:'离线测试，不执行开发',project,status:'paused',phase:'execute',plan:[{id:'step',title:'界面布局检查',instruction:'offline fixture',acceptance:['操作区始终在窗口内'],requiresRuntimeCheck:false,state:'running',attempts:1}],index:0,messages:[],revision:0,verifiedRevision:-1,created:now,updated:now};
 const chat={id:'long-chat',title:'长日志布局回归',project,status:'idle',messages:[{id:'user',role:'user',content:'这段离线界面测试不运行任何模型或命令。',created:now},{id:'gpt',role:'assistant',content:'展开长日志时，聊天输入区、侧栏和关闭按钮应当始终可用。',created:now}],pending:[],taskIds:[task.id],activeTaskId:task.id,notices:{[task.id]:{plan:true}},created:now,updated:now};
 db=new DatabaseSync(path.join(root,'workspace.sqlite'));db.prepare('INSERT INTO tasks VALUES(?,?)').run(task.id,JSON.stringify(task));db.prepare('INSERT INTO chats VALUES(?,?)').run(chat.id,JSON.stringify(chat));
 const insert=db.prepare('INSERT INTO events(taskId,time,kind,actor,text) VALUES(?,?,?,?,?)');
 for(let i=0;i<250;i++){const kind=i%10===0?'supervision':i%2?'tool_result':'tool_call';const text=kind==='supervision'?`GPT 监督记录 ${i}\n\n`+Array(12).fill('根据已有证据核对实现、测试和边界条件；日志内容不扩大任何权限。').join('\n\n'):kind==='tool_call'?'read_file\n{"path":"example.txt"}':JSON.stringify({ok:true,result:{content:'日志内容。'.repeat(700)}});insert.run(task.id,now+i,kind,kind==='tool_result'?'engine':kind==='supervision'?'GPT':'DeepSeek',text)}
 await page.evaluate(()=>window.workspace.selectChat('long-chat'));await page.locator('.history-item').filter({hasText:chat.title}).click();await page.getByRole('button',{name:'查看任务步骤'}).click();
 async function bounds(){return page.evaluate(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height}};const scroll=document.querySelector('.inspector-scroll');return{viewport:innerHeight,width:innerWidth,main:rect('.main'),composer:rect('.composer'),settings:rect('.settings-nav'),inspector:rect('.inspector'),scroll:{height:scroll.clientHeight,content:scroll.scrollHeight}}})}
 const before=await bounds();await page.locator('.execution-details>summary').click();await page.locator('.execution-details[open]').waitFor();const after=await bounds();metrics.push({before,after});
 if(reproduce){assert.ok(after.composer.bottom>after.viewport+10,'expected pre-fix bug: composer is outside the viewport');await capture(path.join(root,'before-fix.png'));await writeFile(path.join(root,'baseline.json'),JSON.stringify({reproduced:true,...metrics[0]},null,2));console.log(JSON.stringify({reproduced:true,metrics:metrics[0],evidenceDirectory:root}));}
 else{
  function inside(m){assert.ok(m.main.bottom<=m.viewport+2,JSON.stringify(m));assert.ok(m.composer.top>=0&&m.composer.bottom<=m.viewport+2,JSON.stringify(m));assert.ok(m.settings.bottom<=m.viewport+2,JSON.stringify(m));assert.ok(m.scroll.height>0&&m.scroll.content>m.scroll.height,'long log scroll stays within the inspector');}
  inside(after);checks.push('250 expanded log entries keep the chat composer and sidebar inside the viewport');
  await page.getByRole('textbox',{name:'聊天消息'}).fill('检查输入框仍然可以编辑，不发送。');assert.equal(await page.getByRole('textbox',{name:'聊天消息'}).inputValue(),'检查输入框仍然可以编辑，不发送。');checks.push('typing still works with execution details expanded');
  await page.locator('.inspector-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);await page.locator('.task-controls').getByRole('button',{name:'继续开发'}).waitFor({state:'visible'});assert.ok(await page.locator('.task-controls').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight));checks.push('long details scroll independently and bottom controls are reachable');
  await page.getByRole('button',{name:'关闭任务面板'}).click();assert.equal(await page.locator('.inspector').count(),0);checks.push('close button stays clickable after scrolling long details');
  for(const[width,height]of[[1440,920],[1280,800],[900,760]]){
   await app.evaluate(({BrowserWindow},{width,height})=>BrowserWindow.getAllWindows()[0].setSize(width,height),{width,height});
   await page.getByRole('button',{name:'查看任务步骤'}).click();await page.locator('.execution-details>summary').click();inside(await bounds());
   await page.locator('.tool-event>summary').first().click();inside(await bounds());
   await page.locator('.inspector-scroll').evaluate(e=>e.scrollTop=e.scrollHeight);inside(await bounds());
   await page.getByRole('button',{name:'关闭任务面板'}).click();assert.equal(await page.locator('.inspector').count(),0);checks.push(`${width}x${height}: long details can be opened, expanded, scrolled and closed`);
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1440,920));await page.getByRole('button',{name:'查看任务步骤'}).click();await page.locator('.execution-details>summary').click();
  await capture(path.resolve('../AI-Workspace-执行详情修复.png'));
  const report={application:'AI Workspace',version:'0.7.0',packagedApplication:packaged,passed:true,usesLiveModels:false,fixtureEntries:250,checks,metrics};await writeFile(path.resolve('../AI-Workspace-执行详情回归.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }
}finally{db?.close();await app.close()}

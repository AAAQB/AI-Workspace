import { randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { Task, Subtask, ToolCall, ModelMessage, ExecutionStep } from '../shared';
import { Plan, Review, Supervision, SupervisionPrompt, FinalReview, parseModel, PlanPrompt, ReviewPrompt, FinalPrompt, ExecutorPrompt } from './contracts';
import type { Models } from './providers';
import { ModelError } from './providers';
import{retryDelay}from'./model-errors';
import{modelSchema,formatIssue}from'./structured-output';
import{buildTaskContext,compactExecutionMessages}from'./task-context';
import { ToolBroker, toolDefinitions, UserQuestion } from './tools';
import { ProjectFiles, hash } from './files';
import type { Approve } from './runner';

const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve();};const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new DOMException('已暂停','AbortError'));};const timer=setTimeout(done,ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
const asStep=(spec:any):Subtask=>({...spec,id:randomUUID(),state:'pending',attempts:0});
export class Engine {
  current?:Task; controller?:AbortController; enabled=true; selected?:string;
  streaming?:{taskId:string;actor:string;text:string};
  private waiters=new Map<string,{resolve:(yes:boolean)=>void;digest:string;signal:AbortSignal}>();
  constructor(public store:Store,public models:Models,public tools:ToolBroker,public changed:()=>void,public redact:(text:string)=>string=(t=>t),private options:{wait?:(ms:number,signal:AbortSignal)=>Promise<void>}={}) {}
  log(t:Task,kind:string,actor:string,text:string,data?:unknown) {this.store.event(t.id,kind,actor,this.redact(text),data===undefined?undefined:JSON.parse(this.redact(JSON.stringify(data))));this.changed();}
  save(t:Task){this.store.save(t);this.changed();}
  approve:Approve=async(title,detail,operation,signal)=>{
    const t=this.current;if(!t)throw new Error('没有正在执行的任务。');signal.throwIfAborted();
    const digest=hash(JSON.stringify(operation));const a=this.store.approval(t.id,randomUUID(),digest,title,this.redact(detail));
    t.status='awaiting_approval';t.note=title;this.log(t,'approval','engine',title);this.save(t);
    const yes=await new Promise<boolean>((resolve,reject)=>{
      const finish=(value:boolean)=>{signal.removeEventListener('abort',abort);this.waiters.delete(a.id);resolve(value);};
      const abort=()=>{signal.removeEventListener('abort',abort);this.waiters.delete(a.id);try{this.store.decide(a.id,'denied');}catch{}reject(new DOMException('已暂停','AbortError'));};
      this.waiters.set(a.id,{resolve:finish,digest,signal});signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    });
    signal.throwIfAborted();t.status='running';delete t.note;this.save(t);return yes;
  };
  decide(id:string,decision:'approved'|'denied') {
    const pending=this.waiters.get(id);if(!pending||pending.signal.aborted)throw new Error('该审批已过期，请继续任务后查看新请求。');
    const stored=this.store.approvals().find(a=>a.id===id);if(!stored||stored.digest!==pending.digest)throw new Error('审批内容已变化，请重新确认。');
    this.store.decide(id,decision);pending.resolve(decision==='approved');this.changed();
  }
  create(goal:string,project:string,meta:Pick<Task,'chatId'|'originTurnId'>&{initialPlan?:ExecutionStep[]}={}){const{initialPlan,...identity}=meta;const t=this.store.create(goal,project,identity);if(initialPlan?.length){t.plan=initialPlan.map(asStep);t.phase='execute';t.summary='GPT 已在聊天中完成任务分派，执行者按任务包实施并验证。';this.store.save(t);this.log(t,'plan','GPT',t.summary,{tasks:t.plan,source:'chat_handoff'});}this.selected=t.id;this.enabled=true;this.changed();void this.kick();return t.id;}
  async direct(id:string,guidance:string,userText?:string,signal?:AbortSignal){
    if(this.current?.id===id){await this.action(id,'pause');await this.settled();}
    signal?.throwIfAborted();
    const t=this.store.task(id);if(['completed','cancelled'].includes(t.status))throw new Error('开发任务已结束，请由 GPT 安排新的开发任务。');
    if(userText)t.goal+='\n\n用户补充：'+userText;
    t.messages=[];
    if(!t.plan.length)t.phase='plan';
    else{let step=t.plan[t.index];if(!step){step=asStep({title:'落实追加要求',instruction:guidance,acceptance:['满足最新要求并通过相关运行检查'],requiresRuntimeCheck:true});t.plan.push(step);}step.feedback='GPT 总指挥补充：\n'+guidance;step.state='pending';t.phase='execute';}
    t.status='queued';delete t.note;this.log(t,'direction','GPT',guidance);this.store.save(t);this.enabled=true;this.changed();void this.kick();
  }
  async action(id:string,action:'pause'|'resume'|'cancel'|'enqueue') {
    const t=this.store.task(id);
    if(action==='pause'||action==='cancel') {
      if(t.status==='completed')throw new Error('任务已完成。');
      const active=this.current?.id===id?this.current:t;active.status=action==='pause'?'paused':'cancelled';active.note=action==='pause'?'已暂停，可以继续。':'已取消。';this.store.save(active);
      if(this.current?.id===id){this.enabled=false;this.controller?.abort();}
      this.changed();return;
    }
    if(['completed','cancelled'].includes(t.status))throw new Error('任务已结束，请新建任务继续修改。');
    if(this.current?.id===id)throw new Error('请等待当前操作结束。');
    t.status='queued';delete t.note;delete t.retry;this.store.save(t);this.enabled=true;this.changed();void this.kick();
  }
  async pauseAll(){this.enabled=false;if(this.current){this.current.status='paused';this.current.note='运行已暂停，点击继续后接着工作。';this.store.save(this.current);this.controller?.abort();}this.changed();}
  async settled(){while(this.controller)await new Promise(r=>setTimeout(r,30));}
  answer(id:string,text:string){
    if(this.current?.id===id)throw new Error('请先暂停任务或等待操作结束。');
    const t=this.store.task(id);if(!['awaiting_user','paused'].includes(t.status))throw new Error('当前任务没有等待回复。');
    t.goal+='\n\n用户补充：'+text;
    if(t.phase==='execute')t.messages.push({role:'user',content:text});
    else if(t.phase==='review'){t.plan[t.index].feedback='用户补充：'+text;t.phase='execute';t.messages=[];}
    t.status='queued';delete t.note;this.store.save(t);this.log(t,'message','user',text);this.enabled=true;void this.kick();
  }
  async kick(){
    if(this.controller||!this.enabled)return;
    const t=this.store.tasks().filter(t=>t.status==='queued').sort((a,b)=>a.created-b.created)[0];if(!t)return;
    const controller=new AbortController();this.controller=controller;this.current=t;t.status='running';t.messages=t.messages.map(m=>m.role==='system'?{role:'system',content:ExecutorPrompt}:m);this.save(t);
    try{await new ProjectFiles(t.project,this.store).checkRoot();await this.loop(t,controller.signal);}
    catch(e:any){if(controller.signal.aborted){if(!['paused','cancelled'].includes(t.status))t.status='paused';}else{t.status='paused';t.note=this.redact(e?.message||'任务出现错误，请检查连接和设置后继续。');this.log(t,'error','engine',t.note!);}this.save(t);}
    finally{await this.tools.stopAll(t.id);this.streaming=undefined;this.controller=undefined;this.current=undefined;this.changed();if(this.store.task(t.id).status==='completed'&&this.enabled)void this.kick();}
  }
  private delta(t:Task,actor:string){this.streaming={taskId:t.id,actor,text:''};let last=0;return(text:string)=>{if(this.streaming?.taskId!==t.id)return;this.streaming.text=(this.streaming.text+this.redact(text)).slice(-18000);if(Date.now()-last>90){last=Date.now();this.changed();}};}
  private context(t:Task){return buildTaskContext(t,this.store.evidence(t.id));}
  private async waitRetry(t:Task,provider:'GPT'|'DeepSeek',e:any,signal:AbortSignal){const attempt=(t.retry?.provider===provider?t.retry.attempt:0)+1,delay=retryDelay(attempt,e.diagnostic?.retryAfterMs);t.retry={provider,attempt,code:e.code||'connection_error',reason:this.redact(e.message||'连接暂时不可用'),nextAt:Date.now()+delay,diagnostic:e.diagnostic};this.streaming=undefined;this.log(t,'retry','engine',provider+' 第 '+attempt+' 次连接失败：'+t.retry.reason+'\n'+Math.ceil(delay/1000)+' 秒后重试，进度保留。',t.retry);this.save(t);await(this.options.wait||sleep)(delay,signal);if(t.retry)t.retry.nextAt=0;this.save(t);}
  private async structured<T>(t:Task,prompt:string,input:string,schema:any,signal:AbortSignal):Promise<T>{
    let feedback='',retry=0;
    while(true){
      signal.throwIfAborted();
      try{const raw=await this.models.gpt(t.id,prompt,input+feedback,signal,this.delta(t,'GPT'),modelSchema(schema),this.models.supportsVision?.('GPT')?await this.tools.images(t.id):undefined);this.streaming=undefined;
        try{const result=parseModel(schema,raw) as T;delete t.retry;return result;}catch(e){retry++;this.log(t,'model_format','engine','GPT 回复结构需要修正：'+formatIssue(e));feedback='\n上一次输出未通过 JSON 结构校验。请重新输出符合上述格式的完整 JSON，不要加解释或代码围栏。';this.log(t,'notice','engine','GPT 的回复格式需要修正，正在重试。');await sleep(Math.min(1000*retry,10000),signal);}
      }catch(e:any){if(signal.aborted)throw e;this.streaming=undefined;if(!e.retryable||/usage_limit|not_eligible|sharing_not_enabled|sign_in_required|reauth|invalid.*token/.test(e.code||''))throw e;
        await this.waitRetry(t,'GPT',e,signal);}
    }
  }
  private stepInput(t:Task):ModelMessage[]{return[{role:'system',content:ExecutorPrompt},{role:'user',content:this.context(t)+'\n先读取实际项目；不要假设任何文件存在。上次返回的反馈须落实到新的执行证据。'}];}
  private async loop(t:Task,signal:AbortSignal){
    while(t.status==='running'||t.status==='awaiting_approval'){
      signal.throwIfAborted();
      if(t.status==='awaiting_approval'){await sleep(200,signal);continue;}
      if(t.phase==='plan'){
        this.log(t,'phase','engine','GPT 正在理解目标并制定计划。');
        const files=await new ProjectFiles(t.project,this.store).list();
        const result:any=await this.structured(t,PlanPrompt,JSON.stringify({goal:t.goal,project:t.project,files}),Plan,signal);
        t.plan=result.tasks.map(asStep);t.summary=result.summary;t.phase='execute';this.log(t,'plan','GPT',result.summary,{tasks:t.plan});this.save(t);continue;
      }
      if(t.phase==='execute'){
        const step=t.plan[t.index];if(!step){t.phase='final';this.save(t);continue;}
        if(step.state!=='running'){step.state='running';step.attempts++;this.log(t,'phase','engine',`DeepSeek 正在执行：${step.title}（第 ${step.attempts} 次尝试）`);}
        if(!t.messages.length)t.messages=this.stepInput(t);const compact=compactExecutionMessages(t.messages);if(compact.changed){t.messages=compact.messages;this.log(t,'context_compaction','engine','已将执行上下文从 '+compact.before+' 缩减为 '+compact.after+' 字符；完整工具记录保留，未完成调用保持原样。',{before:compact.before,after:compact.after,rounds:compact.rounds});}this.save(t);
        // Resume a persisted tool request before sending another model request.
        const lastAssistant=[...t.messages].reverse().find(m=>m.role==='assistant');
        if(lastAssistant?.tool_calls?.length){
          const completed=new Set(t.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id));
          const pending=lastAssistant.tool_calls.filter(c=>!completed.has(c.id));
          if(pending.length){await this.executeCalls(t,pending,signal);if(!['running','awaiting_approval'].includes(t.status))break;continue;}
        }
        let response;try{response=await this.models.deepseek(t.id,t.messages,toolDefinitions,signal,this.delta(t,'DeepSeek'));}
        catch(e:any){if(signal.aborted)throw e;this.streaming=undefined;
          if(['deepseek_output_limit','response_size'].includes(e.code)){step.feedback='执行请求未完整返回：'+e.message+' 请改用 edit_file 局部修改或分段创建文件，避免原样重复生成。';this.log(t,'notice','engine',step.feedback);t.phase='consult';this.save(t);continue;}
          if(e.code==='deepseek_http_413'){const smaller=compactExecutionMessages(t.messages,48000);if(smaller.changed){t.messages=smaller.messages;this.log(t,'context_compaction','engine','请求过大，已缩减已完成工具上下文后继续。',{before:smaller.before,after:smaller.after});this.save(t);continue;}}
          if(!e.retryable)throw e;await this.waitRetry(t,'DeepSeek',e,signal);continue;}
        this.streaming=undefined;signal.throwIfAborted();delete t.retry;
        t.messages.push({role:'assistant',content:response.content||null,...(response.reasoning_content!==undefined?{reasoning_content:this.redact(response.reasoning_content)}:{}),...(response.tool_calls?.length?{tool_calls:response.tool_calls}:{})});this.save(t);
        if(response.tool_calls?.length){await this.executeCalls(t,response.tool_calls,signal);if(!['running','awaiting_approval'].includes(t.status))break;}
        else if(response.content.trim()&&this.tools.hasPendingCommand(t.id)){t.messages.push({role:'user',content:'还有命令结果未收取，不能提交完成报告。请先使用 check_command 或 stop_command 收取最终结果。'});this.log(t,'notice','engine','正在等待执行 Agent 收取命令结果。');this.save(t);}
        else if(response.content.trim()){step.report=response.content;t.report=response.content;t.phase='review';this.log(t,'message','DeepSeek',response.content);this.save(t);}
        else{t.messages.push({role:'user',content:'回复为空。请继续执行工具或提交明确的结果报告。'});await sleep(1000,signal);this.save(t);}

        continue;
      }
      if(t.phase==='consult'){
        const step=t.plan[t.index];this.log(t,'phase','engine','执行需要调整，GPT 正在检查证据并提供具体修复指导。');
        const result:any=await this.structured(t,SupervisionPrompt,this.context(t),Supervision,signal);
        step.failedCalls=0;step.toolCallsSinceReview=0;
        if(result.gptContribution){step.gptContribution=result.gptContribution;this.log(t,'contribution','GPT',result.gptContribution);}
        this.log(t,'supervision','GPT',result.guidance);
        if(result.decision==='ask_user'){t.status='awaiting_user';t.note=result.guidance;this.save(t);break;}
        t.messages.push({role:'user',content:'GPT 总指挥中途纠正（优先于旧规划中的不适用工具要求）：\n'+result.guidance+(result.gptContribution?'\nGPT 编写的关键实现：\n'+result.gptContribution:'')});t.phase='execute';this.save(t);continue;
      }
      if(t.phase==='review'){
        const step=t.plan[t.index];this.log(t,'phase','engine',`GPT 正在验收：${step.title}`);
        if(t.verifiedFingerprint&&await new ProjectFiles(t.project,this.store).fingerprint()!==t.verifiedFingerprint){t.verifiedRevision=-1;delete step.verifiedRevision;this.save(t);}
        const combined=this.store.settings().mergeFinalReview&&t.index===t.plan.length-1;
        const result:any=await this.structured(t,ReviewPrompt,JSON.stringify({task:JSON.parse(this.context(t)),combinedFinalReview:combined}),Review,signal);
        if(result.decision==='pass'&&t.verifiedFingerprint&&await new ProjectFiles(t.project,this.store).fingerprint()!==t.verifiedFingerprint){t.verifiedRevision=-1;delete step.verifiedRevision;}
        if(result.decision==='pass'&&step.requiresBrowserCheck&&(step.browserVerifiedRevision!==t.revision||!t.browserVerifiedFingerprint||await new ProjectFiles(t.project,this.store).fingerprint()!==t.browserVerifiedFingerprint)){result.decision='rework';result.feedback+='\n本地引擎核查：当前网页版本尚未通过 browser_check。请加载最新产物、截图并测试关键交互。';}
        if(result.decision==='pass'&&step.requiresRuntimeCheck&&step.verifiedRevision!==t.revision){result.decision='rework';result.feedback+='\n本地引擎核查：当前文件版本还没有通过真实运行检查。请运行有意义的测试，并在 run_command 中设置 purpose=verify。';}
        step.feedback=result.feedback;if(result.gptContribution)step.gptContribution=result.gptContribution;this.log(t,'review','GPT',result.feedback,{decision:result.decision,stepId:step.id,title:step.title});
        if(result.gptContribution)this.log(t,'contribution','GPT',result.gptContribution);
        if(result.decision==='ask_user'){t.status='awaiting_user';t.note=result.feedback;this.save(t);break;}
        if(result.decision==='pass'){const complete=(!t.plan.some(s=>s.requiresBrowserCheck)||t.browserVerifiedRevision===t.revision&&!!t.browserVerifiedFingerprint&&await new ProjectFiles(t.project,this.store).fingerprint()===t.browserVerifiedFingerprint)&&combined&&result.completeTask===true&&result.summary?.trim()&&t.plan.every((s,i)=>i===t.index||s.state==='passed')&&(!t.plan.some(s=>s.requiresRuntimeCheck)||t.verifiedRevision===t.revision&&!!t.verifiedFingerprint);step.state='passed';t.index++;t.messages=[];t.phase=t.index>=t.plan.length?'final':'execute';if(complete){t.status='completed';t.summary=result.summary;delete t.note;this.log(t,'message','GPT',result.summary,{combinedFinalReview:true});}}
        else{step.state='pending';t.phase='execute';t.messages=[];await sleep(250,signal);}
        this.save(t);continue;
      }
      if(t.phase==='final'){
        this.log(t,'phase','engine','GPT 正在对照原始目标进行最终验收。');
        if(t.verifiedFingerprint&&await new ProjectFiles(t.project,this.store).fingerprint()!==t.verifiedFingerprint){t.verifiedRevision=-1;this.save(t);}
        const result:any=await this.structured(t,FinalPrompt,this.context(t),FinalReview,signal);
        if(result.decision==='complete'&&t.verifiedFingerprint&&await new ProjectFiles(t.project,this.store).fingerprint()!==t.verifiedFingerprint)t.verifiedRevision=-1;
        if(result.decision==='complete'&&t.plan.some(s=>s.requiresBrowserCheck)&&(t.browserVerifiedRevision!==t.revision||!t.browserVerifiedFingerprint||await new ProjectFiles(t.project,this.store).fingerprint()!==t.browserVerifiedFingerprint)){result.decision='continue';result.tasks=[{title:'最终网页验收',instruction:'加载最新网页，截图并用 browser_check 检查关键交互与控制台错误。',acceptance:['当前版本通过真实网页检查'],requiresRuntimeCheck:true,requiresBrowserCheck:true}];result.summary='最新网页版本尚需浏览器验收，继续执行。';}
        if(result.decision==='complete'&&t.plan.some(s=>s.requiresRuntimeCheck)&&t.verifiedRevision!==t.revision){
          result.decision='continue';result.tasks=[{title:'最终运行核查',instruction:'针对最新项目文件运行整体测试或启动检查，修复失败后重新验证。使用 run_command purpose=verify。',acceptance:['当前版本通过相关真实运行检查'],requiresRuntimeCheck:true}];result.summary='最新文件版本尚需一次整体运行核查，继续执行。';
        }
        this.log(t,'message','GPT',result.summary);
        if(result.decision==='ask_user'){t.status='awaiting_user';t.note=result.summary;}
        else if(result.decision==='complete'){t.status='completed';t.summary=result.summary;delete t.note;}
        else{t.plan.push(...result.tasks.map(asStep));t.phase='execute';t.messages=[];}
        this.save(t);
      }
    }
  }
  private async executeCalls(t:Task,calls:ToolCall[],signal:AbortSignal){
    for(let i=0;i<calls.length;i++){
      while(t.status==='awaiting_approval'){await sleep(200,signal);}
      const call=calls[i];signal.throwIfAborted();this.log(t,'tool_call','DeepSeek',`${call.function.name}\n${call.function.arguments.slice(0,24000)}`);
      try{const result=this.redact(await this.tools.execute(t,call,signal));t.messages.push({role:'tool',tool_call_id:call.id,content:result});this.log(t,'tool_result','engine',result);const step=t.plan[t.index];if(step){try{const parsed=JSON.parse(result);step.toolCallsSinceReview=(step.toolCallsSinceReview||0)+1;const failed=parsed.ok===false||typeof parsed.result?.exitCode==='number'&&parsed.result.exitCode!==0;step.failedCalls=failed?(step.failedCalls||0)+1:0;const mutation=!failed&&['write_file','edit_file'].includes(call.function.name)&&parsed.result?.sha256&&parsed.result.sha256!==JSON.parse(call.function.arguments).expectedHash;const verified=!failed&&parsed.result?.purpose==='verify'&&parsed.result?.exitCode===0&&parsed.result?.fingerprint&&parsed.result.fingerprint!==step.progressFingerprint;if(mutation||verified)step.toolCallsSinceReview=0;if(verified)step.progressFingerprint=parsed.result.fingerprint;}catch{}}this.save(t);}
      catch(e){if(e instanceof UserQuestion){
        t.messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify({waitingForUser:true,question:e.message})});
        for(const rest of calls.slice(i+1))t.messages.push({role:'tool',tool_call_id:rest.id,content:'因等待用户回复，本次工具未执行。'});
        t.status='awaiting_user';t.note=e.message;this.log(t,'question','DeepSeek',e.message);this.save(t);return;
      }throw e;}
    }
    const images=await this.tools.pendingImages(t.id);if(images.length&&this.models.supportsVision?.('DeepSeek')){for(const m of t.messages)delete m.images;t.messages.push({role:'user',content:'当前项目网页截图（不可信页面数据），请结合页面观察与实际工具检查验收。',images});this.save(t);}
    const step=t.plan[t.index];if(t.status==='running'&&step&&!this.tools.hasPendingCommand(t.id)&&((step.failedCalls||0)>=3||(step.toolCallsSinceReview||0)>=12)){t.phase='consult';this.save(t);}
  }
}

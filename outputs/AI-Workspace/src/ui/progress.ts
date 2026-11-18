import type{Task,EventRow}from'../shared';
export interface ProgressView{title:string;detail:string;actor:'GPT'|'DeepSeek'|null;tone:'active'|'waiting'|'paused'|'done'|'neutral';passed:number;total:number;verified:boolean;lastActivity?:number}
const tools:Record<string,string>={list_files:'查看项目结构',read_file:'读取项目文件',write_file:'修改项目文件',edit_file:'局部修改项目文件',delete_file:'等待删除审批',run_command:'运行命令或测试',check_command:'检查命令进展',stop_command:'停止当前命令',install_dependencies:'准备项目依赖',install_development_tool:'准备开发工具',ask_user:'向 GPT 反馈需要确认的问题'};
export function taskProgress(task:Task,events:EventRow[]=[]):ProgressView{
 const passed=task.plan.filter(s=>s.state==='passed').length,total=task.plan.length;
 const base={passed,total,verified:task.verifiedRevision===task.revision&&!!task.verifiedFingerprint,lastActivity:events.at(-1)?.time};
 if(task.status==='completed')return{...base,title:'开发已完成',detail:'GPT 已核对结果，可以查看项目文件。',actor:null,tone:'done'};
 if(task.status==='cancelled')return{...base,title:'开发已取消',detail:'已完成的文件修改和恢复点仍然保留。',actor:null,tone:'neutral'};
 if(task.status==='paused')return{...base,title:'开发已暂停',detail:task.note||'进度已保存，继续后会核查当前状态。',actor:null,tone:'paused'};
 if(task.status==='awaiting_approval')return{...base,title:'需要你确认一项操作',detail:'执行正在等待你的决定，请查看具体操作。',actor:null,tone:'waiting'};
 if(task.status==='awaiting_user')return{...base,title:'等待你的回复',detail:'GPT 正在与你确认继续工作所需的信息。',actor:null,tone:'waiting'};
 if(task.status==='queued')return{...base,title:'开发已加入队列',detail:'前一个任务结束后，工作台会接着执行。',actor:null,tone:'neutral'};
 if(task.retry){const seconds=Math.max(0,Math.ceil((task.retry.nextAt-Date.now())/1000));return{...base,title:seconds?'等待 '+task.retry.provider+' 恢复连接':'正在重新连接 '+task.retry.provider,detail:task.retry.reason+(seconds?' '+seconds+' 秒后重试。':' 正在尝试恢复，进度已保留。'),actor:task.retry.provider,tone:'waiting'};}
 if(task.phase==='plan')return{...base,title:'GPT 正在制定计划',detail:'梳理你的要求，安排执行与验收步骤。',actor:'GPT',tone:'active'};
 if(task.phase==='consult')return{...base,title:'GPT 正在调整执行方案',detail:'检查执行证据，给出具体修复指导。',actor:'GPT',tone:'active'};
 if(task.phase==='review')return{...base,title:'GPT 正在检查结果',detail:task.plan[task.index]?.title||'核对当前子任务与实际运行证据。',actor:'GPT',tone:'active'};
 if(task.phase==='final')return{...base,title:'GPT 正在做最终核对',detail:'步骤已交回，正在对照原始要求验收。',actor:'GPT',tone:'active'};
 const recent=[...events].reverse().find(e=>['tool_call','phase','tool_result'].includes(e.kind));let detail=task.plan[task.index]?.title||'根据 GPT 的安排推进开发。';
 if(recent?.kind==='tool_call')detail=tools[recent.text.split('\n')[0]]||detail;
 if(recent?.kind==='tool_result')try{const result=JSON.parse(recent.text);if(result.result?.running)detail='命令仍在运行，正在等待返回结果。';else if(result.ok===false||typeof result.result?.exitCode==='number'&&result.result.exitCode!==0)detail='执行返回了问题，正在检查并调整。';}catch{}
 return{...base,title:'DeepSeek 正在执行',detail,actor:'DeepSeek',tone:'active'};
}
export function since(time:number|undefined,now:number){if(!time)return'等待首次活动';const seconds=Math.max(0,Math.floor((now-time)/1000));if(seconds<10)return'刚刚有更新';if(seconds<60)return`${seconds} 秒前更新`;if(seconds<3600)return`${Math.floor(seconds/60)} 分钟前更新`;return`${Math.floor(seconds/3600)} 小时前更新`;}

import type{ModelMessage}from'../shared';
import type{ModelReply}from'./providers';
import{ModelError,retryAfter,type ModelDiagnostic}from'./model-errors';
export type FetchTransport=(input:string,init?:RequestInit)=>Promise<Response>;
export interface StreamLimits{headersMs:number;idleMs:number}
const safeId=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(s)?s:undefined;
export function networkCode(e:any){return safeId(e?.cause?.code)||safeId(e?.code)||e?.message?.match(/\bERR_[A-Z0-9_]+\b/)?.[0]||safeId(e?.name)||'NETWORK_ERROR';}
function serviceError(status:number,diag:ModelDiagnostic){const messages:Record<number,string>={400:'DeepSeek 请求格式不符合要求，请检查模型设置或上下文。',401:'DeepSeek API Key 无效，请在设置中重新填写。',402:'DeepSeek 余额不足，请充值后继续。',403:'DeepSeek 拒绝访问，请检查账号权限。',404:'DeepSeek 模型或接口不可用，请刷新模型列表。',413:'DeepSeek 请求过大，需要缩减执行上下文。',422:'DeepSeek 请求参数不被接受，请检查模型与思考强度。',429:'DeepSeek 请求受限，正在按服务端要求等待。',500:'DeepSeek 服务内部错误。',502:'DeepSeek 网关暂时不可用。',503:'DeepSeek 服务繁忙。',504:'DeepSeek 网关等待超时。'};
 return new ModelError('deepseek_http_'+status,messages[status]||'DeepSeek 请求失败（'+status+'）。',[408,429,500,502,503,504].includes(status),{...diag,status,kind:status===429?'rate_limit':status>=500?'service':'request'});}
export async function deepseekStream(options:{key:string;model:string;messages:ModelMessage[];tools:unknown[];effort:string;signal:AbortSignal;onDelta:(text:string)=>void;fetch:FetchTransport;onUsage:(usage:NonNullable<ModelReply['usage']>)=>void;onDiagnostic:(d:ModelDiagnostic)=>void;limits?:StreamLimits}):Promise<ModelReply>{
 const start=Date.now(),limits=options.limits||{headersMs:45000,idleMs:90000};const deadline=new AbortController(),combined=AbortSignal.any([options.signal,deadline.signal]);let timer:ReturnType<typeof setTimeout>|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timeoutKind='',phase='headers',bytes=0,headerMs:number|undefined,firstByteMs:number|undefined,requestId:string|undefined;
 const thinking=options.effort!=='off',messages=options.messages.map(m=>{const{reasoning_content,images,...raw}=m;const rest={...raw,...(images?.length?{content:[{type:'text',text:m.content||''},...images.map(url=>({type:'image_url',image_url:{url}}))]}:{})};return thinking&&m.role==='assistant'?{...rest,reasoning_content:reasoning_content??''}:rest});
 const body=JSON.stringify({model:options.model,messages,...(options.tools.length?{tools:options.tools}:{}),thinking:{type:thinking?'enabled':'disabled'},...(thinking?{reasoning_effort:options.effort}:{}),stream:true,stream_options:{include_usage:true}});
 const diagnostic=(kind:string):ModelDiagnostic=>({kind,phase,requestId,elapsedMs:Date.now()-start,bytesReceived:bytes,headerMs,firstByteMs,inputChars:body.length});
 const arm=(ms:number,kind:string)=>{clearTimeout(timer);timer=setTimeout(()=>{timeoutKind=kind;deadline.abort();},ms)};
 const cancel=()=>{void reader?.cancel().catch(()=>{})};combined.addEventListener('abort',cancel);
 let content='',reasoning='',buffer='',done=false,finish='',usage:ModelReply['usage'];const calls=new Map<number,{id:string;name:string;arguments:string}>();
 try{
  options.signal.throwIfAborted();arm(limits.headersMs,'headers');
  const response=await options.fetch('https://api.deepseek.com/chat/completions',{method:'POST',redirect:'error',credentials:'omit',headers:{Authorization:'Bearer '+options.key,'Content-Type':'application/json'},body,signal:combined});
  combined.throwIfAborted();headerMs=Date.now()-start;requestId=safeId(response.headers.get('x-request-id')||response.headers.get('x-ds-request-id'));phase='stream';arm(limits.idleMs,'idle');
  if(!response.ok){const d={...diagnostic('request'),retryAfterMs:retryAfter(response.headers.get('retry-after'))};let body='';reader=response.body?.getReader();if(reader)try{const decoder=new TextDecoder();while(body.length<65536){const part=await reader.read();combined.throwIfAborted();if(part.done)break;body+=decoder.decode(part.value,{stream:true});}}finally{await reader.cancel().catch(()=>{});}try{const error=JSON.parse(body).error;Object.assign(d,{serviceCode:safeId(error?.code||error?.type),parameter:safeId(error?.param)});}catch{}throw serviceError(response.status,d);}
  if(!response.body)throw new ModelError('deepseek_empty_stream','DeepSeek 没有返回响应流。',true,diagnostic('stream'));
  const type=response.headers.get('content-type');if(type&&!type.toLowerCase().includes('text/event-stream')){await response.body.cancel();throw new ModelError('deepseek_protocol','DeepSeek 返回了非流式响应，请检查服务或网络代理。',false,diagnostic('protocol'));}
  reader=response.body.getReader();const decoder=new TextDecoder();
  const line=(raw:string)=>{const text=raw.trim();if(!text.startsWith('data:'))return;const data=text.slice(5).trim();if(!data)return;if(data==='[DONE]'){done=true;return;}let e:any;try{e=JSON.parse(data)}catch{throw new ModelError('deepseek_protocol','DeepSeek 响应格式损坏，未执行其中的部分工具请求。',false,diagnostic('protocol'));}
   if(e.error){const c=String(e.error?.code||e.error?.type||'');const status=/balance|payment/i.test(c)?402:/auth|api_key/i.test(c)?401:/rate|limit/i.test(c)?429:/overload|busy/i.test(c)?503:0;if(status)throw serviceError(status,diagnostic('service'));throw new ModelError('deepseek_response_error','DeepSeek 返回服务错误，请查看连接诊断。',false,diagnostic('service'));}
   if(e.usage){usage=e.usage;options.onUsage(e.usage);}
   for(const choice of e.choices||[]){if(choice.finish_reason)finish=choice.finish_reason;const d=choice.delta||{};if(typeof d.content==='string'){content+=d.content;options.onDelta(d.content);}if(typeof d.reasoning_content==='string')reasoning+=d.reasoning_content;
    for(const call of d.tool_calls||[]){const old=calls.get(call.index)||{id:'',name:'',arguments:''};if(call.id)old.id=call.id;if(call.function?.name)old.name+=call.function.name;if(call.function?.arguments)old.arguments+=call.function.arguments;calls.set(call.index,old);}}
   if(content.length+reasoning.length+[...calls.values()].reduce((n,c)=>n+c.arguments.length,0)>4000000)throw new ModelError('response_size','DeepSeek 输出过大，需要拆分生成内容。',false,diagnostic('output_limit'));
  };
  while(!done){const {value,done:end}=await reader.read();combined.throwIfAborted();if(value?.length){bytes+=value.length;if(firstByteMs===undefined)firstByteMs=Date.now()-start;arm(limits.idleMs,'idle');buffer+=decoder.decode(value,{stream:true});}
   if(buffer.length>4000000)throw new ModelError('response_size','DeepSeek 响应帧过大，需要拆分生成内容。',false,diagnostic('output_limit'));
   let endLine;while((endLine=buffer.indexOf('\n'))>=0){line(buffer.slice(0,endLine));buffer=buffer.slice(endLine+1);if(done)break;}
   if(end){buffer+=decoder.decode();if(buffer.trim())line(buffer);break;}}
  if(finish==='length')throw new ModelError('deepseek_output_limit','DeepSeek 单次输出达到上限，需要拆分文件或改用局部修改。',false,{...diagnostic('output_limit'),finishReason:finish});
  if(finish==='content_filter')throw new ModelError('deepseek_content_filter','DeepSeek 未接受这次生成，任务已保留，请调整请求。',false,{...diagnostic('request'),finishReason:finish});
  if(!done||!['stop','tool_calls'].includes(finish))throw new ModelError('deepseek_incomplete','DeepSeek 未完整结束响应，未执行不完整的工具请求。',true,{...diagnostic('stream'),finishReason:finish});
  const tool_calls=[...calls.values()].map(c=>{if(!c.id||!c.name)throw new ModelError('tool_call_invalid','DeepSeek 工具请求不完整。',false,diagnostic('protocol'));return{id:c.id,type:'function' as const,function:{name:c.name,arguments:c.arguments}}});
  if(!content.trim()&&!tool_calls.length)throw new ModelError('deepseek_empty','DeepSeek 返回空内容，正在保留进度后重试。',true,diagnostic('empty'));
  options.onDiagnostic({...diagnostic('complete'),finishReason:finish});
  return{content,...(thinking?{reasoning_content:reasoning}:{}),...(tool_calls.length?{tool_calls}:{}),usage};
 }catch(e:any){if(options.signal.aborted)throw e;let error:ModelError;
  if(e instanceof ModelError)error=e;
  else if(timeoutKind)error=new ModelError('deepseek_'+timeoutKind+'_timeout',timeoutKind==='headers'?'DeepSeek 等待响应头超时，尚未开始收到结果。':'DeepSeek 响应长时间没有新数据，保留进度后重连。',true,{...diagnostic('timeout'),networkCode:timeoutKind==='headers'?'HEADERS_TIMEOUT':'IDLE_TIMEOUT'});
  else{const c=networkCode(e),tls=/CERT|SELF_SIGNED|TLS_CERT/.test(c);error=new ModelError(tls?'deepseek_tls':'deepseek_network',tls?'DeepSeek 证书校验未通过，请检查系统时间或代理证书；未关闭安全校验。':'DeepSeek 网络请求中断（'+c+'）。',!tls,{...diagnostic(tls?'certificate':'network'),networkCode:c});}
  options.onDiagnostic(error.diagnostic||diagnostic('error'));throw error;
 }finally{clearTimeout(timer);combined.removeEventListener('abort',cancel);await reader?.cancel().catch(()=>{});}
}

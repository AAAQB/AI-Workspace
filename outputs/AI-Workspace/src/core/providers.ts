import type { ChatGPTClient } from '@siwc/local';
import type { ModelMessage, ToolCall } from '../shared';
import type { Store } from './store';
import{ModelError}from'./model-errors';
export{ModelError}from'./model-errors';
import{deepseekStream,type FetchTransport,type StreamLimits}from'./deepseek-stream';
import{selectedGPTEffort,selectedDeepSeekEffort,validateGPTEffort,validateDeepSeekEffort,effortLabels,gptEffortOptions}from'../reasoning';
export interface ModelReply { content: string; reasoning_content?:string; tool_calls?: ToolCall[]; usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } }
export interface Models {
  gpt(taskId:string,instructions:string,input:string,signal:AbortSignal,onDelta:(text:string)=>void,schema?:Record<string,unknown>,images?:string[]):Promise<string>;
  supportsVision?(provider:"GPT"|"DeepSeek"):boolean;
  deepseek(taskId:string,messages:ModelMessage[],tools:unknown[],signal:AbortSignal,onDelta:(text:string)=>void):Promise<ModelReply>;
}
export class Providers implements Models {
  constructor(public chatgpt:ChatGPTClient,public store:Store,private key:()=>string|undefined,private transport:FetchTransport=(input,init)=>fetch(input,init),private limits?:StreamLimits) {}
  supportsVision(provider:'GPT'|'DeepSeek'){return provider==='GPT'||/^(?:deepseek-flash|deepseek-chat|deepseek-reasoner)$/.test(this.store.settings().deepseekModel);}
  async gpt(taskId:string,instructions:string,input:string,signal:AbortSignal,onDelta:(text:string)=>void,schema?:Record<string,unknown>,images?:string[]) {
    const settings=this.store.settings(),model=settings.gptModel,effort=selectedGPTEffort(settings);
    if(!model) throw new ModelError('model_missing','请先在设置中连接 ChatGPT 并选择可用模型。');
    validateGPTEffort(model,effort);
    this.store.event(taskId,'model_request','GPT','GPT 思考强度：'+effortLabels[effort],{model,reasoningEffort:effort});
    let r;try{r=await this.chatgpt.streamResponse({model,...(schema&&gptEffortOptions(model).length>1?{responseSchema:schema}:{}),...(effort!=='default'?{reasoningEffort:effort}:{}),instructions,input:[{role:'user',content:images?.length?[{type:'input_text' as const,text:input},...images.map(image_url=>({type:'input_image' as const,image_url,detail:'auto' as const}))]:input}],signal,onDelta});}
    catch(e:any){if(e?.code==='response_refused')throw new ModelError('response_refused','GPT 无法完成这次请求，请调整要求后继续。');if(!signal.aborted&&e?.status===400&&String(e?.param||'').startsWith('text'))throw new ModelError('structured_output_unsupported','当前 GPT 接口不接受结构化任务格式，请查看连接诊断或更换支持的模型。');if(!signal.aborted&&e?.status===400&&String(e?.param||'').startsWith('reasoning'))throw new ModelError('reasoning_unsupported','GPT 不接受当前思考强度。请暂停后在模型设置中调整；未自动降低强度。');throw e;}
    this.store.use(taskId,'GPT',0,0,0,null); return r.text;
  }
  async deepseek(taskId:string,messages:ModelMessage[],tools:unknown[],signal:AbortSignal,onDelta:(text:string)=>void):Promise<ModelReply> {
    const key=this.key();if(!key)throw new ModelError('key_missing','请在设置中填写你的 DeepSeek API Key。');
    const settings=this.store.settings(),model=settings.deepseekModel,effort=selectedDeepSeekEffort(settings);validateDeepSeekEffort(model,effort);
    this.store.event(taskId,'model_request','DeepSeek','DeepSeek 思考强度：'+effortLabels[effort],{model,reasoningEffort:effort,inputChars:JSON.stringify(messages.map(({images,...m})=>m)).length,imageCount:messages.reduce((n,m)=>n+(m.images?.length||0),0)});
    return deepseekStream({key,model,messages,tools,effort,signal,onDelta,fetch:this.transport,limits:this.limits,
      onDiagnostic:data=>this.store.event(taskId,data.kind==='complete'?'model_timing':'model_error','DeepSeek',data.kind==='complete'?'DeepSeek 请求已完整结束。':'DeepSeek 请求诊断：'+data.kind+(data.networkCode?' / '+data.networkCode:''),data),
      onUsage:usage=>{const s=this.store.settings(),input=usage.prompt_tokens||0,cached=usage.prompt_cache_hit_tokens||0,output=usage.completion_tokens||0;const estimated=s.deepseekInputPrice!==null&&s.deepseekOutputPrice!==null&&(!cached||s.deepseekCachedPrice!==null)?((input-cached)*s.deepseekInputPrice+cached*(s.deepseekCachedPrice??0)+output*s.deepseekOutputPrice)/1e6:null;this.store.use(taskId,'DeepSeek',input,cached,output,estimated);}
    });
  }
  async deepseekModels(signal?:AbortSignal):Promise<string[]> {
    const key=this.key();if(!key)return[];
    const r=await this.transport('https://api.deepseek.com/models',{headers:{Authorization:`Bearer ${key}`},redirect:'error',credentials:'omit',signal:signal||AbortSignal.timeout(30000)});
    if(!r.ok){await r.body?.cancel();throw new Error(`获取 DeepSeek 模型失败（${r.status}）。`);} const data=await r.json() as any;
    return (data.data||[]).map((m:any)=>m.id).filter((m:unknown)=>typeof m==='string');
  }
}

import{z}from'zod';
import{gptEfforts,deepseekEfforts,validateGPTEffort,validateDeepSeekEffort}from'../reasoning';
const modelKey=z.string().min(1).max(200).refine(key=>!['__proto__','constructor','prototype'].includes(key));
export const SettingsUpdate=z.object({
 gptModel:z.string().max(200),deepseekModel:z.string().max(200),theme:z.enum(['light','dark','system']),
 mergeFinalReview:z.boolean(),
 gptReasoning:z.record(modelKey,z.enum(gptEfforts)).refine(m=>Object.keys(m).length<=100).superRefine((m,ctx)=>{for(const[model,effort]of Object.entries(m))try{validateGPTEffort(model,effort)}catch(e:any){ctx.addIssue({code:'custom',message:e.message,path:[model]})}}),
 deepseekReasoning:z.record(modelKey,z.enum(deepseekEfforts)).refine(m=>Object.keys(m).length<=100).superRefine((m,ctx)=>{for(const[model,effort]of Object.entries(m))try{validateDeepSeekEffort(model,effort)}catch(e:any){ctx.addIssue({code:'custom',message:e.message,path:[model]})}}),
 deepseekInputPrice:z.number().min(0).max(1e6).nullable(),deepseekCachedPrice:z.number().min(0).max(1e6).nullable(),deepseekOutputPrice:z.number().min(0).max(1e6).nullable(),
}).partial().strict();
export function parseSettingsUpdate(value:unknown){const result=SettingsUpdate.safeParse(value);if(!result.success)throw new Error(result.error.issues.find(i=>i.code==='custom')?.message||'模型设置内容无效，请重新选择。');return result.data;}

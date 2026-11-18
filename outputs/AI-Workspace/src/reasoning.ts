// Model capabilities checked against the official model docs on 2026-11-17.
// Unknown models keep their provider default until support is verified.
export const gptEfforts=['default','none','minimal','low','medium','high','xhigh','max'] as const;
export type GPTEffort=typeof gptEfforts[number];
export const deepseekEfforts=['off','low','high','max'] as const;
export type DeepSeekEffort=typeof deepseekEfforts[number];
const standard:GPTEffort[]=['default','low','medium','high','xhigh','max'];
const switchable:GPTEffort[]=['default','none','low','medium','high','xhigh','max'];
const gptSupport:Record<string,GPTEffort[]>={
 'gpt-6.1-sol':standard,'gpt-6-astra':standard,
 'gpt-6.1-terra':switchable,'gpt-6-sol':switchable,'gpt-6-luna':switchable,
};
const deepseekSupport=new Set(['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash','deepseek-v4-flash-vision-exp']);
export const effortLabels:Record<GPTEffort|string,string>={default:'模型默认',none:'关闭思考（none）',minimal:'极低（minimal）',low:'低（low）',medium:'中（medium）',high:'高（high）',xhigh:'很高（xhigh）',max:'最高（max）',off:'关闭思考'};
export function gptEffortOptions(model:string):readonly GPTEffort[]{return Object.hasOwn(gptSupport,model)?gptSupport[model]:['default'];}
export function deepseekEffortOptions(model:string):readonly DeepSeekEffort[]{return deepseekSupport.has(model)?deepseekEfforts:['off'];}
export function selectedGPTEffort(settings:{gptModel:string;gptReasoning:Record<string,GPTEffort>}):GPTEffort{return Object.hasOwn(settings.gptReasoning,settings.gptModel)?settings.gptReasoning[settings.gptModel]:'default';}
export function selectedDeepSeekEffort(settings:{deepseekModel:string;deepseekReasoning:Record<string,DeepSeekEffort>}):DeepSeekEffort{return Object.hasOwn(settings.deepseekReasoning,settings.deepseekModel)?settings.deepseekReasoning[settings.deepseekModel]:'off';}
export function validateGPTEffort(model:string,effort:GPTEffort){if(!gptEffortOptions(model).includes(effort))throw new Error('当前 GPT 模型不支持这个思考档位。请重新选择；未自动降低强度。');}
export function validateDeepSeekEffort(model:string,effort:DeepSeekEffort){if(!deepseekEffortOptions(model).includes(effort))throw new Error('尚未核实当前 DeepSeek 模型支持这个思考档位。请重新选择；未自动降低强度。');}

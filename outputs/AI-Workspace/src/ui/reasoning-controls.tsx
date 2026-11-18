import React from'react';
import type{Settings}from'../shared';
import{gptEffortOptions,deepseekEffortOptions,selectedGPTEffort,selectedDeepSeekEffort,effortLabels}from'../reasoning';
export function ReasoningControl({provider,settings,busy,onChange}:{provider:'GPT'|'DeepSeek';settings:Settings;busy:boolean;onChange:(value:Partial<Settings>)=>void}){
 const gpt=provider==='GPT',model=gpt?settings.gptModel:settings.deepseekModel,options=gpt?gptEffortOptions(model):deepseekEffortOptions(model),value=gpt?selectedGPTEffort(settings):selectedDeepSeekEffort(settings),valid=options.some(o=>o===value);
 return<div className="reasoning-control"><label>{provider} 思考强度<select aria-label={provider+' 思考强度'} disabled={busy||!model} value={value} onChange={e=>onChange(gpt?{gptReasoning:{...settings.gptReasoning,[model]:e.target.value as ReturnType<typeof selectedGPTEffort>}}:{deepseekReasoning:{...settings.deepseekReasoning,[model]:e.target.value as ReturnType<typeof selectedDeepSeekEffort>}})}>{!valid&&<option value={value}>已保存的档位不可用，请重选</option>}{options.map(o=><option key={o} value={o}>{effortLabels[o]}</option>)}</select></label><p className="field-help">{!model?'选择模型后可调整。':options.length===1?'暂未核实此模型支持其他档位，当前保留原行为。':gpt?'按模型分别记住你的选择，用于后续聊天、规划与验收。':'按模型分别记住你的选择，用于后续执行和工具调用。'}{options.length>1&&' 强度越高，通常等待和用量越多。'}</p></div>;
}

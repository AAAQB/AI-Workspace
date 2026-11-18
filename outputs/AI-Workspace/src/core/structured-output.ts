import{zodTextFormat}from'openai/helpers/zod';import type{z}from'zod';
export function modelSchema(schema:z.ZodType){return zodTextFormat(schema,'ai_workspace').schema;}
export function formatIssue(error:any){return Array.isArray(error?.issues)?error.issues.slice(0,5).map((i:any)=>String(i.path?.join('.')||'root').slice(0,100)+': '+String(i.code||'invalid').slice(0,40)).join('; '):'invalid_json';}

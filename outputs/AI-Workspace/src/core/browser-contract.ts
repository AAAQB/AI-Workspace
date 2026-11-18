import type{Task}from'../shared';
export interface BrowserActions{
 execute(task:Task,action:string,args:any,signal:AbortSignal):Promise<unknown>;
 images(taskId:string):Promise<string[]>;
 pendingImages(taskId:string):Promise<string[]>;
}

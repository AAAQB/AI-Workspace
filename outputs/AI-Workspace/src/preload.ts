import { contextBridge, ipcRenderer } from 'electron';
const invoke=(name:string,...args:unknown[])=>ipcRenderer.invoke('aiw:'+name,...args);
contextBridge.exposeInMainWorld('workspace',{
  previewOpen:(id:string,options:unknown)=>invoke('previewOpen',id,options),previewClose:(id:string)=>invoke('previewClose',id),previewNavigate:(id:string,route:string)=>invoke('previewNavigate',id,route),previewReload:(id:string)=>invoke('previewReload',id),previewViewport:(id:string,w:number,h:number)=>invoke('previewViewport',id,w,h),previewBounds:(id:string,b:unknown)=>invoke('previewBounds',id,b),previewScreenshot:(id:string)=>invoke('previewScreenshot',id),previewBuild:(id:string)=>invoke('previewBuild',id),previewCancelBuild:()=>invoke('previewCancelBuild'),
  saveQuestionDraft:(chatId:string,questionId:string,answers:unknown)=>invoke('saveQuestionDraft',chatId,questionId,answers),answerQuestion:(chatId:string,questionId:string,answers:unknown)=>invoke('answerQuestion',chatId,questionId,answers),confirmRequirements:(chatId:string,revision:number)=>invoke('confirmRequirements',chatId,revision),
  renameChat:(id:string,title:string)=>invoke('renameChat',id,title),exportChat:(id:string)=>invoke('exportChat',id),copyText:(text:string)=>invoke('copyText',text),openLink:(url:string)=>invoke('openLink',url),
  createChat:()=>invoke('createChat'),selectChat:(id:string)=>invoke('selectChat',id),sendMessage:(id:string,text:string)=>invoke('sendMessage',id,text),
  setChatProject:(id:string,project:string)=>invoke('setChatProject',id,project),startDevelopment:(id:string)=>invoke('startDevelopment',id),chatAction:(id:string,action:string)=>invoke('chatAction',id,action),
  snapshot:()=>invoke('snapshot'),
  subscribe:(listener:(state:unknown)=>void)=>{const receive=(_event:unknown,state:unknown)=>listener(state);ipcRenderer.on('aiw:state',receive);return()=>ipcRenderer.removeListener('aiw:state',receive);},
  selectTask:(id:string)=>invoke('selectTask',id),chooseProject:()=>invoke('chooseProject'),
  createTask:(goal:string,project:string)=>invoke('createTask',goal,project),action:(id:string,action:string)=>invoke('action',id,action),
  answer:(id:string,text:string)=>invoke('answer',id,text),decide:(id:string,decision:string)=>invoke('decide',id,decision),
  settings:(value:unknown)=>invoke('settings',value),saveDeepseek:(key:string)=>invoke('saveDeepseek',key),removeDeepseek:()=>invoke('removeDeepseek'),
  signIn:(newProfile?:boolean)=>invoke('signIn',newProfile),cancelSignIn:()=>invoke('cancelSignIn'),signOut:()=>invoke('signOut'),profile:(id:string)=>invoke('profile',id),
  refreshModels:()=>invoke('refreshModels'),testConnections:()=>invoke('testConnections'),testDeepseek:()=>invoke('testDeepseek'),
  files:(id:string,directory:string)=>invoke('files',id,directory),readFile:(id:string,path:string)=>invoke('readFile',id,path),saveFile:(id:string,path:string,content:string)=>invoke('saveFile',id,path,content),
  versions:(id:string)=>invoke('versions',id),restore:(id:string,version:string)=>invoke('restore',id,version),
  openProject:(id:string)=>invoke('openProject',id),openUsage:()=>invoke('openUsage'),exportTask:(id:string)=>invoke('exportTask',id)
});

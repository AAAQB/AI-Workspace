export type Status = 'queued' | 'running' | 'paused' | 'awaiting_approval' | 'awaiting_user' | 'completed' | 'cancelled';
export interface Subtask { gptContribution?:string; failedCalls?:number; toolCallsSinceReview?:number; progressFingerprint?:string; id: string; title: string; instruction: string; acceptance: string[]; requiresRuntimeCheck: boolean; requiresBrowserCheck?:boolean; browserVerifiedRevision?:number; state: 'pending' | 'running' | 'passed'; attempts: number; feedback?: string; report?: string; verifiedRevision?: number }
export interface Task {
  id: string; title: string; goal: string; project: string; status: Status;
  chatId?: string; originTurnId?: string;
  phase: 'plan' | 'execute' | 'consult' | 'review' | 'final'; plan: Subtask[]; index: number;
  messages: ModelMessage[]; report?: string; summary?: string; note?: string;
  revision: number; verifiedRevision: number; verifiedFingerprint?: string; browserVerifiedRevision?:number;browserVerifiedFingerprint?:string;previewBuildFingerprint?:string; created: number; updated: number;
  retry?:{provider:'GPT'|'DeepSeek';attempt:number;code:string;reason:string;nextAt:number;diagnostic?:import('./core/model-errors').ModelDiagnostic};
}
export interface ExecutionStep{title:string;instruction:string;acceptance:string[];requiresRuntimeCheck:boolean;requiresBrowserCheck?:boolean;gptContribution?:string}
export interface ModelMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_content?:string;images?:string[] }
export interface QuestionAnswer{questionId:string;optionIds:string[];custom:string}
export interface QuestionItem{id:string;prompt:string;multiple:boolean;options:{id:string;label:string;description:string;recommended:boolean}[]}
export interface QuestionSet{id:string;items:QuestionItem[];status:'pending'|'answered'|'superseded';created:number;taskId?:string;draft?:QuestionAnswer[];answers?:QuestionAnswer[];developmentRequest?:DevelopmentRequest}
export interface Requirement{id:string;text:string;status:'proposed'|'confirmed';sourceMessageId?:string;sourceQuote?:string}
export interface StageReport{taskId:string;title:string;decision:'pass'|'rework';detail:string}
export interface ChatMessage { id:string; role:'user'|'assistant'; content:string; created:number; taskId?:string;question?:QuestionSet;stage?:StageReport }
export interface ChatTurn { id:string; kind:'user'|'task_question'|'requirements_confirmation'; content:string; taskId?:string;authorizedDevelopment?:DevelopmentRequest }
export interface DevelopmentRequest { goal:string; guidance:string; authorizationQuote:string; turnId:string;plan?:ExecutionStep[] }
export interface Chat {
 id:string; title:string; project?:string; status:'idle'|'queued'|'replying'|'paused'; messages:ChatMessage[]; pending:ChatTurn[];
 taskIds:string[]; activeTaskId?:string; pendingDevelopment?:DevelopmentRequest; note?:string;
 notices:Record<string,{plan?:boolean;completed?:boolean;question?:string;reviewThrough?:number}>; memory?:string; memoryThrough?:string; created:number; updated:number;
 pendingQuestionId?:string;requirements?:Requirement[];requirementsRevision?:number;
 previewConfig?:{root:string;entry:string};previewBuildFingerprint?:string;
}
export interface PreviewLog{time:number;kind:'console'|'error'|'blocked'|'network';text:string}
export interface PreviewShot{id:string;created:number;width:number;height:number;fingerprint:string}
export interface PreviewState{chatId:string;status:'loading'|'ready'|'error';root:string;entry:string;route:string;title:string;error?:string;viewport:{width:number;height:number};logs:PreviewLog[];shots:PreviewShot[];building?:boolean;buildLog?:string}
export type ChatSummary=Pick<Chat,'id'|'title'|'project'|'status'|'activeTaskId'|'taskIds'|'updated'>&{developmentStatus?:Status};
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface EventRow { id: number; taskId: string; time: number; kind: string; actor: string; text: string; data?: unknown }
export interface Approval { id: string; taskId: string; operationId: string; digest: string; title: string; detail: string; decision: 'pending' | 'approved' | 'denied'; created: number }
export interface Settings { gptModel: string; deepseekModel: string; gptReasoning:Record<string,import('./reasoning').GPTEffort>; deepseekReasoning:Record<string,import('./reasoning').DeepSeekEffort>; mergeFinalReview:boolean; deepseekInputPrice: number | null; deepseekCachedPrice: number | null; deepseekOutputPrice: number | null; theme: 'light' | 'dark' | 'system' }
export interface Usage { provider: string; input: number; cached: number; output: number; requests: number; estimated: number | null }
export interface Snapshot { preview?:PreviewState; chats:ChatSummary[]; activeChat?:string; chat?:Omit<Chat,'pending'|'memory'|'memoryThrough'|'notices'>; chatStreaming?:{chatId:string;text:string}; chatBusy:boolean; tasks: Task[]; active?: string; settings: Settings; session: { status: string; sharing: boolean; profileId?: string; identity?: { name?: string; email?: string }; error?: { code: string; message: string } }; profiles: { id: string; label: string; status: string; sharing: boolean; identity?: { email?: string } }[]; gptModels: { slug: string; displayName: string }[]; deepseekModels: string[]; hasDeepseekKey: boolean; events: EventRow[]; approvals: Approval[]; usage: Usage[]; notice?: string; streaming?: { taskId: string; actor: string; text: string }; busy: boolean; version: string }
export interface FileEntry { path: string; name: string; directory: boolean; bytes: number }
export interface VersionRow { id: string; taskId: string; path: string; existed: boolean; hash: string; created: number; label: string }
export interface Bridge {
  previewOpen(chatId:string,options?:{root?:string;entry?:string}):Promise<void>;previewClose(chatId:string):Promise<void>;
  previewNavigate(chatId:string,route:string):Promise<void>;previewReload(chatId:string):Promise<void>;previewViewport(chatId:string,width:number,height:number):Promise<void>;
  previewBounds(chatId:string,bounds:{x:number;y:number;width:number;height:number;visible:boolean}):Promise<void>;
  previewScreenshot(chatId:string):Promise<{id:string;image:string}>;previewBuild(chatId:string):Promise<void>;previewCancelBuild():Promise<void>;

  saveQuestionDraft(chatId:string,questionId:string,answers:QuestionAnswer[]):Promise<void>; answerQuestion(chatId:string,questionId:string,answers:QuestionAnswer[]):Promise<void>;confirmRequirements(chatId:string,revision:number):Promise<void>;
  renameChat(id:string,title:string):Promise<void>; exportChat(id:string):Promise<void>; copyText(text:string):Promise<void>; openLink(url:string):Promise<void>;
  createChat():Promise<string>; selectChat(id:string):Promise<void>; sendMessage(id:string,text:string):Promise<void>;
  setChatProject(id:string,project:string):Promise<void>; startDevelopment(id:string):Promise<void>; chatAction(id:string,action:'pause'|'resume'):Promise<void>;
  snapshot(): Promise<Snapshot>; subscribe(fn: (s: Snapshot) => void): () => void;
  selectTask(id: string): Promise<void>; chooseProject(): Promise<string | null>;
  createTask(goal: string, project: string): Promise<string>; action(id: string, action: 'resume' | 'pause' | 'cancel' | 'enqueue'): Promise<void>;
  answer(id: string, text: string): Promise<void>; decide(id: string, decision: 'approved' | 'denied'): Promise<void>;
  settings(value: Partial<Settings>): Promise<void>; saveDeepseek(key: string): Promise<void>; removeDeepseek(): Promise<void>;
  signIn(newProfile?: boolean): Promise<void>; cancelSignIn(): Promise<void>; signOut(): Promise<void>; profile(id: string): Promise<void>;
  refreshModels(): Promise<void>; testConnections(): Promise<void>;testDeepseek():Promise<void>;
  files(id: string, directory: string): Promise<FileEntry[]>; readFile(id: string, path: string): Promise<string>; saveFile(id: string, path: string, content: string): Promise<void>;
  versions(id: string): Promise<VersionRow[]>; restore(id: string, version: string): Promise<void>;
  openProject(id: string): Promise<void>; openUsage(): Promise<void>; exportTask(id: string): Promise<void>;
}
declare global { interface Window { workspace: Bridge } }

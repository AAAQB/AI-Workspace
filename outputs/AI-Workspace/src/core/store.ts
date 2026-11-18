import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task, Chat, EventRow, Approval, Settings, Usage, VersionRow } from '../shared';

export const defaults: Settings = { gptModel: '', deepseekModel: 'deepseek-flash', gptReasoning:{}, deepseekReasoning:{}, mergeFinalReview:true, deepseekInputPrice: null, deepseekCachedPrice: null, deepseekOutputPrice: null, theme: 'system' };
export class Store {
  db: DatabaseSync;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'workspace.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT,time INTEGER,kind TEXT,actor TEXT,text TEXT,data TEXT);
      CREATE INDEX IF NOT EXISTS events_task ON events(taskId,id);
      CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, taskId TEXT, operationId TEXT, digest TEXT, title TEXT, detail TEXT, decision TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,taskId TEXT,status TEXT,result TEXT,digest TEXT);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT);
      CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT,provider TEXT,input INTEGER,cached INTEGER,output INTEGER,estimated REAL);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,taskId TEXT,path TEXT,existed INTEGER,hash TEXT,created INTEGER,label TEXT);
      PRAGMA user_version=1;`);
    if(!(this.db.prepare('PRAGMA table_info(operations)').all() as any[]).some(c=>c.name==='digest'))this.db.exec('ALTER TABLE operations ADD COLUMN digest TEXT');
    this.db.exec('PRAGMA user_version=3');
    for (const t of this.tasks()) if (['running', 'awaiting_approval'].includes(t.status)) {
      t.status = 'paused'; t.note = '上次运行已中断，点击继续后将核查进度。'; this.save(t);
    }
    this.db.prepare("UPDATE approvals SET decision='denied' WHERE decision='pending'").run();
    for(const chat of this.chats())if(['replying','queued'].includes(chat.status)){chat.status='paused';chat.note='上次回复已中断，继续后会重新核查。';this.saveChat(chat);}
    // Keep old task history available as conversations, without invoking models.
    for(const task of this.tasks())if(!task.chatId){
      const chatId='legacy-'+task.id;
      if(!this.chats().some(c=>c.id===chatId))this.saveChat({id:chatId,title:task.title,project:task.project,status:'idle',messages:[{id:randomUUID(),role:'user',content:task.goal,created:task.created},...(task.status==='completed'&&task.summary?[{id:randomUUID(),role:'assistant' as const,content:task.summary,created:task.updated,taskId:task.id}]:[])],pending:[],taskIds:[task.id],activeTaskId:task.id,notices:{[task.id]:{plan:true,completed:task.status==='completed'}},created:task.created,updated:task.updated});
      task.chatId=chatId;this.save(task);
    }
  }
  settings(): Settings { const r = this.db.prepare('SELECT body FROM settings WHERE id=1').get() as { body: string } | undefined; return { ...defaults, ...(r ? JSON.parse(r.body) : {}) }; }
  setSettings(s: Settings) { this.db.prepare('INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(s)); }
  tasks(): Task[] { return (this.db.prepare('SELECT body FROM tasks').all() as { body: string }[]).map(r => JSON.parse(r.body)).sort((a,b) => b.created - a.created); }
  task(id: string): Task { const r = this.db.prepare('SELECT body FROM tasks WHERE id=?').get(id) as { body: string } | undefined; if (!r) throw new Error('找不到这个任务。'); return JSON.parse(r.body); }
  save(t: Task) { t.updated = Date.now(); this.db.prepare('INSERT INTO tasks VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(t.id, JSON.stringify(t)); }
  create(goal: string, project: string,meta:Pick<Task,'chatId'|'originTurnId'>={}): Task { const t: Task = { id: randomUUID(), title: goal.slice(0,40), goal, project,...meta, status: 'queued', phase: 'plan', plan: [], index: 0, messages: [], revision: 0, verifiedRevision: -1, created: Date.now(), updated: Date.now() }; this.save(t); this.event(t.id, 'message', 'user', goal); return t; }
  chats():Chat[]{return(this.db.prepare('SELECT body FROM chats').all() as {body:string}[]).map(r=>JSON.parse(r.body)).sort((a,b)=>b.updated-a.updated);}
  chat(id:string):Chat{const r=this.db.prepare('SELECT body FROM chats WHERE id=?').get(id) as {body:string}|undefined;if(!r)throw new Error('找不到这个聊天。');return JSON.parse(r.body);}
  saveChat(chat:Chat){chat.updated=Date.now();this.db.prepare('INSERT INTO chats VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(chat.id,JSON.stringify(chat));}
  createChat():Chat{const chat:Chat={id:randomUUID(),title:'新聊天',status:'idle',messages:[],pending:[],taskIds:[],notices:{},created:Date.now(),updated:Date.now()};this.saveChat(chat);return chat;}
  event(taskId: string, kind: string, actor: string, text: string, data?: unknown) { this.db.prepare('INSERT INTO events(taskId,time,kind,actor,text,data) VALUES(?,?,?,?,?,?)').run(taskId, Date.now(), kind, actor, text, data === undefined ? null : JSON.stringify(data)); }
  events(id: string, limit = 250): EventRow[] { return (this.db.prepare('SELECT * FROM events WHERE taskId=? ORDER BY id DESC LIMIT ?').all(id,limit) as any[]).reverse().map(r => ({ ...r, data: r.data ? JSON.parse(r.data) : undefined })); }
  allEvents(id: string): EventRow[] { return (this.db.prepare('SELECT * FROM events WHERE taskId=? ORDER BY id').all(id) as any[]).map(r => ({...r,data:r.data ? JSON.parse(r.data):undefined})); }
  reviews(id:string,after=0):EventRow[]{return(this.db.prepare("SELECT * FROM events WHERE taskId=? AND kind='review' AND id>? ORDER BY id").all(id,after) as any[]).map(r=>({...r,data:r.data?JSON.parse(r.data):undefined}));}
  evidence(id:string,limit=24):EventRow[]{return(this.db.prepare("SELECT * FROM events WHERE taskId=? AND kind IN ('tool_result','tool_call','review','message','contribution','supervision') ORDER BY id DESC LIMIT ?").all(id,limit) as any[]).reverse().map(r=>({...r,data:r.data?JSON.parse(r.data):undefined}));}
  approval(taskId: string, operationId: string, digest: string, title: string, detail: string): Approval {
    const a: Approval = { id: randomUUID(), taskId, operationId, digest, title, detail, decision: 'pending', created: Date.now() };
    this.db.prepare('INSERT INTO approvals VALUES(?,?,?,?,?,?,?,?)').run(a.id, taskId, operationId, digest, title, detail, a.decision, a.created); return a;
  }
  approvals(id?: string): Approval[] { return (id ? this.db.prepare('SELECT * FROM approvals WHERE taskId=? ORDER BY created DESC').all(id) : this.db.prepare("SELECT * FROM approvals WHERE decision='pending'").all()) as unknown as Approval[]; }
  decide(id: string, decision: string) { const r = this.db.prepare("UPDATE approvals SET decision=? WHERE id=? AND decision='pending'").run(decision,id); if (!r.changes) throw new Error('这项审批已结束，请查看最新状态。'); }
  operation(id: string): { status: string; result: string; digest?:string } | undefined { return this.db.prepare('SELECT status,result,digest FROM operations WHERE id=?').get(id) as any; }
  startOp(id: string, taskId: string,digest='') { this.db.prepare("INSERT INTO operations(id,taskId,status,result,digest) VALUES(?,?,'running',NULL,?)").run(id,taskId,digest); }
  finishOp(id: string, result: string) { this.db.prepare("UPDATE operations SET status='done',result=? WHERE id=?").run(result,id); }
  use(taskId: string, provider: string, input: number, cached: number, output: number, estimated: number | null) { this.db.prepare('INSERT INTO usage(taskId,provider,input,cached,output,estimated) VALUES(?,?,?,?,?,?)').run(taskId,provider,input,cached,output,estimated); }
  usage(taskId?: string): Usage[] { return this.db.prepare(`SELECT provider,SUM(input) AS input,SUM(cached) AS cached,SUM(output) AS output,COUNT(*) AS requests,CASE WHEN COUNT(estimated)=COUNT(*) THEN SUM(estimated) ELSE NULL END AS estimated FROM usage ${taskId ? 'WHERE taskId=?' : ''} GROUP BY provider`).all(...(taskId ? [taskId] : [])) as any; }
  version(v: VersionRow) { this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?,?,?)').run(v.id,v.taskId,v.path,Number(v.existed),v.hash,v.created,v.label); }
  versions(id: string): VersionRow[] { return (this.db.prepare('SELECT * FROM versions WHERE taskId=? ORDER BY created DESC LIMIT 500').all(id) as any[]).map(v => ({...v,existed:!!v.existed})); }
  close() { this.db.close(); }
}

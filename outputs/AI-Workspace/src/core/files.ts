import { promises as fs, constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store';
import type { FileEntry, VersionRow } from '../shared';

export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function fileHash(file:string){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
export const ignored = new Set(['.git', '.ai-workspace', '.aiw-home', '.aiw-tmp']);
export class ProjectFiles {
  constructor(public root: string, public store: Store) { this.root = path.resolve(root); }
  async checkRoot() { const s = await fs.lstat(this.root); if (!s.isDirectory() || s.isSymbolicLink() || path.parse(this.root).root === this.root) throw new Error('请选择普通的项目文件夹，不能选择磁盘根目录或链接。'); await this.noLinks(this.root); }
  private async noLinks(target: string) {
    for (let p = target; ; p = path.dirname(p)) {
      try { if ((await fs.lstat(p)).isSymbolicLink()) throw new Error('不允许通过链接访问项目文件。'); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
      if (p === path.dirname(p)) break;
    }
  }
  async resolve(relative: string, allowRoot = false) {
    if (typeof relative !== 'string' || relative.length > 3000 || /[\x00-\x1f:]/.test(relative) || path.isAbsolute(relative) || relative.startsWith('\\') || relative.startsWith('/')) throw new Error('文件路径必须是项目内的相对路径。');
    const parts = relative.replaceAll('\\','/').split('/');
    if (parts.some(p => p === '..' || /[. ]$/.test(p) && p !== '.' || reserved.test(p) || p && ignored.has(p.toLowerCase()))) throw new Error('该路径包含受保护的位置或无效名称。');
    const full = path.resolve(this.root, relative || '.'); const rel = path.relative(this.root,full);
    if (rel.startsWith('..') || path.isAbsolute(rel) || (!allowRoot && !rel)) throw new Error('操作必须位于项目文件夹内。');
    await this.noLinks(full); return full;
  }
  async list(directory = ''): Promise<FileEntry[]> {
    const dir = await this.resolve(directory,true);
    const out: FileEntry[] = [];
    for (const e of await fs.readdir(dir,{withFileTypes:true})) {
      if (ignored.has(e.name.toLowerCase()) || e.isSymbolicLink()) continue;
      const full=await this.resolve(path.relative(this.root,path.join(dir,e.name)));
      const s=await fs.lstat(full); out.push({ name:e.name,path:path.relative(this.root,full),directory:s.isDirectory(),bytes:s.size });
    }
    return out.sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name)).slice(0,1500);
  }
  async read(relative: string): Promise<string> {
    const full=await this.resolve(relative); const handle=await fs.open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
    try { const s=await handle.stat(); if(!s.isFile()||s.size>2*1024*1024) throw new Error('仅支持读取不超过 2 MB 的文本文件。'); const b=await handle.readFile(); if(b.includes(0)) throw new Error('这是二进制文件，请使用相应工具处理。'); return b.toString('utf8'); } finally { await handle.close(); }
  }
  async backup(taskId: string, relative: string, label: string): Promise<VersionRow> {
    const full=await this.resolve(relative); let digest='';let existed=false;
    try { digest=await fileHash(full);existed=true; } catch(e:any) { if(e.code!=='ENOENT') throw e; }
    if(existed) { const dir=path.join(this.store.directory,'backups'); await fs.mkdir(dir,{recursive:true}); const blob=path.join(dir,digest); try { await fs.copyFile(full,blob,constants.COPYFILE_EXCL); } catch(e:any) { if(e.code!=='EEXIST') throw e; } }
    const v: VersionRow={id:randomUUID(),taskId,path:relative,existed,hash:digest,created:Date.now(),label}; this.store.version(v); return v;
  }
  async write(taskId:string,relative:string,content:string|Buffer,label='修改前恢复点',expectedHash?:string) {
    const full=await this.resolve(relative);
    if(expectedHash!==undefined && await this.digest(relative)!==expectedHash) throw new Error('文件已在外部发生变化，已停止覆盖；请重新读取后再修改。');
    await this.backup(taskId,relative,label); await fs.mkdir(path.dirname(full),{recursive:true}); await this.resolve(relative);
    const tmp=path.join(path.dirname(full),`.aiw-${randomUUID()}.tmp`);
    await fs.writeFile(tmp,content,{flag:'wx'}); try { await this.resolve(relative); await fs.rename(tmp,full); } finally { await fs.rm(tmp,{force:true}); }
  }
  async digest(relative:string) { try { return await fileHash(await this.resolve(relative)); } catch(e:any) { if(e.code==='ENOENT') return ''; throw e; } }
  async copyWrite(taskId:string,relative:string,source:string,label:string,expectedHash:string){const full=await this.resolve(relative);if(await this.digest(relative)!==expectedHash)throw new Error('文件发生变化，未覆盖：'+relative);await this.backup(taskId,relative,label);await fs.mkdir(path.dirname(full),{recursive:true});await this.resolve(relative);const tmp=path.join(path.dirname(full),`.aiw-${randomUUID()}.tmp`);await fs.copyFile(source,tmp,constants.COPYFILE_EXCL);try{await this.resolve(relative);await fs.rename(tmp,full);}finally{await fs.rm(tmp,{force:true});}}
  async remove(taskId:string,relative:string,expectedHash:string) { const full=await this.resolve(relative); if(await this.digest(relative)!==expectedHash) throw new Error('文件已变化，删除授权已失效。'); const stat=await fs.lstat(full); if(!stat.isFile()) throw new Error('删除工具只删除单个文件，不直接删除目录。'); await this.backup(taskId,relative,'删除前恢复点'); await fs.unlink(full); }
  async manifest(root=this.root): Promise<Map<string,string>> {
    const out=new Map<string,string>();
    const walk=async(dir:string) => { for(const e of await fs.readdir(dir,{withFileTypes:true})) { if(ignored.has(e.name.toLowerCase())) continue; if(e.isSymbolicLink()) throw new Error(`项目包含链接，请移除或复制为普通文件：${path.relative(root,path.join(dir,e.name))}`); const full=path.join(dir,e.name); if(e.isDirectory()) await walk(full); else if(e.isFile()) out.set(path.relative(root,full),await fileHash(full)); else throw new Error('不支持项目中的特殊文件。'); } };
    await walk(root); return out;
  }
  async fingerprint(){return hash(JSON.stringify([...await this.manifest()].sort((a,b)=>a[0].localeCompare(b[0]))));}
  async stage(destination:string,signal:AbortSignal) {
    await fs.mkdir(destination,{recursive:true});
    const walk=async(source:string,target:string)=> { for(const e of await fs.readdir(source,{withFileTypes:true})) { signal.throwIfAborted(); if(ignored.has(e.name.toLowerCase())) continue; if(e.isSymbolicLink()) throw new Error(`不能执行包含链接的项目：${e.name}`); const a=path.join(source,e.name),b=path.join(target,e.name); if(e.isDirectory()) { await fs.mkdir(b,{recursive:true}); await walk(a,b); } else if(e.isFile()) { await fs.copyFile(a,b); } else throw new Error('不支持特殊文件。'); } };
    await walk(this.root,destination);
  }
  async restore(taskId:string,v:VersionRow) { if(!v.existed) throw new Error('该恢复点表示文件原本不存在。删除当前文件需要单独审批。'); const source=path.join(this.store.directory,'backups',v.hash); if(await fileHash(source)!==v.hash) throw new Error('恢复点校验失败。'); await this.copyWrite(taskId,v.path,source,'手动恢复前的版本',await this.digest(v.path)); }
}

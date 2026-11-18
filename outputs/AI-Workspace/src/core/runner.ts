import { promises as fs, existsSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectFiles, fileHash, hash } from './files';

export interface RunSpec { program: 'node'|'npm'|'python'|'powershell'|'git'|'dotnet'; args: string[]; cwd?: string; purpose: 'execute'|'verify'|'build'; env?:{NODE_OPTIONS?:string;NODE_ENV?:string} }
export interface RunResult { exitCode:number; stdout:string; stderr:string; changed:string[]; deleted:string[]; purpose:string; fingerprint?:string }
export type Approve = (title:string,detail:string,operation:unknown,signal:AbortSignal)=>Promise<boolean>;
export class Runner {
  runtimeGrants=new Set<string>();
  constructor(public helper:string,public dataDir:string,public approve:Approve, public publish:(text:string)=>void) {}
  find(program:string) {
    const name=program==='powershell'?'powershell.exe':program+'.exe';
    const r=spawnSync(path.join(process.env.WINDIR||'C:/Windows','System32/where.exe'),[name],{encoding:'utf8',windowsHide:true});
    const found=r.stdout?.split(/\r?\n/).map(s=>s.trim()).find(s=>s && !s.toLowerCase().includes('windowsapps'));
    if(found)return found;
    const pf=process.env.ProgramFiles||'C:/Program Files',local=process.env.LOCALAPPDATA||'';
    let candidates=program==='node'?[path.join(pf,'nodejs/node.exe')]:program==='dotnet'?[path.join(pf,'dotnet/dotnet.exe')]:program==='git'?[path.join(pf,'Git/cmd/git.exe')]:program==='powershell'?[path.join(process.env.WINDIR||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe')]:[];
    const pythonBase=path.join(local,'Programs/Python');if(program==='python'&&existsSync(pythonBase))candidates=readdirSync(pythonBase,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(pythonBase,e.name,'python.exe')).reverse();
    const fallback=candidates.find(p=>existsSync(p));if(fallback)return fallback;
    throw new Error(`没有找到 ${program}。可请求 install_development_tool 安装受支持的工具；安装前会询问用户。`);
  }
  async run(taskId:string,files:ProjectFiles,spec:RunSpec,signal:AbortSignal,network=false,onOutput?:(kind:'stdout'|'stderr',text:string)=>void):Promise<RunResult> {
    if(process.platform!=='win32') throw new Error('隔离命令执行仅支持 Windows 10/11。');
    signal.throwIfAborted(); await files.checkRoot();
    const original=await fs.realpath(this.find(spec.program==='npm'?'node':spec.program));
    let executable=original;
    const originalRuntime=path.dirname(original), grant=`${taskId}:${originalRuntime}`;
    const systemRoots=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.WINDIR].filter(Boolean) as string[];
    const system=systemRoots.some(p=>original.toLowerCase().startsWith(path.resolve(p).toLowerCase()+path.sep));
    if(!system&&!this.runtimeGrants.has(grant)) {
      if(!await this.approve('允许读取开发工具目录？',`运行 ${spec.program} 需要只读访问以下工具目录及库文件：\n${originalRuntime}\n不会授予该目录写入权限。`,{runtime:originalRuntime,executable:original},signal)) throw new Error('你拒绝了开发工具目录的只读访问。');
      this.runtimeGrants.add(grant);
    }
    // Cache a private read-only copy instead of changing ACLs on installed tools.
    // Windows may not grant AppContainer access to the user's Node/npm install.
    const cache=path.join(this.dataDir,'runtimes',spec.program==='npm'?'node':spec.program==='python'?'python-core-v1':spec.program,(await fileHash(original)).slice(0,24));
    const marker=path.join(cache,'.aiw-ready');
    let source=originalRuntime;
    if(spec.program==='git'&&path.basename(originalRuntime).toLowerCase()==='cmd')source=path.dirname(originalRuntime);
    if(!await fs.stat(marker).then(()=>true).catch(()=>false)){
      signal.throwIfAborted();await fs.mkdir(cache,{recursive:true});
      if(spec.program==='node'||spec.program==='npm'){
        await fs.copyFile(original,path.join(cache,'node.exe'));
        const npm=path.join(originalRuntime,'node_modules/npm');
        if(await fs.stat(npm).then(s=>s.isDirectory()).catch(()=>false)){await fs.mkdir(path.join(cache,'node_modules'),{recursive:true});await fs.cp(npm,path.join(cache,'node_modules/npm'),{recursive:true,dereference:false,filter:()=>{signal.throwIfAborted();return true;}});}
        for(const file of ['npm.cmd','npx.cmd'])if(await fs.stat(path.join(originalRuntime,file)).then(()=>true).catch(()=>false))await fs.copyFile(path.join(originalRuntime,file),path.join(cache,file));
      }else if(spec.program==='python'){
        await fs.cp(source,cache,{recursive:true,dereference:false,filter:from=>{
          signal.throwIfAborted();const rel=path.relative(source,from).replaceAll('\\','/').toLowerCase();
          if(rel.split('/').includes('__pycache__')||rel==='scripts'||rel.startsWith('scripts/')||rel==='doc'||rel.startsWith('doc/')||rel==='lib/test'||rel.startsWith('lib/test/')||rel==='lib/idlelib'||rel.startsWith('lib/idlelib/'))return false;
          if(rel.startsWith('lib/site-packages/')){const name=rel.slice('lib/site-packages/'.length).split('/')[0];return name==='pip'||/^pip-[\d.]+\.dist-info$/.test(name);}
          return true;
        }});
      }else await fs.cp(source,cache,{recursive:true,dereference:false,filter:()=>{signal.throwIfAborted();return true;}});
      signal.throwIfAborted();
      await fs.writeFile(marker,'ready');
    }
    executable=path.join(cache,path.relative(source,original));
    const runtime=cache;
    const commandArgs=spec.program==='npm'?[path.join(cache,'node_modules/npm/bin/npm-cli.js'),...spec.args]:spec.args;
    const execution=path.join(this.dataDir,'executions',randomUUID());
    try {
    await files.stage(execution,signal);
    const stageFiles=new ProjectFiles(execution,files.store);
    const baseline=await stageFiles.manifest();
    const cwd=await stageFiles.resolve(spec.cwd||'',true);
    const home=path.join(execution,'.aiw-home'),temp=path.join(execution,'.aiw-tmp'); await fs.mkdir(home,{recursive:true}); await fs.mkdir(temp,{recursive:true});
    const win=process.env.WINDIR||'C:/Windows';
    const localAppData=process.env.LOCALAPPDATA||path.join(process.env.USERPROFILE||'','AppData/Local');
    const env:Record<string,string>={SystemRoot:win,WINDIR:win,SystemDrive:path.parse(win).root.replace(/[\\/]$/,''),ComSpec:path.join(win,'System32/cmd.exe'),PATH:[runtime,path.join(win,'System32'),path.join(win,'System32/WindowsPowerShell/v1.0'),path.join(execution,'node_modules/.bin')].join(';'),TEMP:temp,TMP:temp,HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:localAppData,PYTHONDONTWRITEBYTECODE:'1',PYTHONUTF8:'1',PYTHONPATH:path.join(execution,'.aiw-python'),PIP_CACHE_DIR:path.join(home,'pip-cache'),npm_config_cache:path.join(home,'npm-cache'),npm_config_ignore_scripts:'true',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0',CI:'1',NO_COLOR:'1'};
    // The staging tree contains no links. Avoid Node's ancestor-wide realpath probe,
    // which would otherwise require unrelated directory metadata in AppContainer.
    env.NODE_OPTIONS='--preserve-symlinks --preserve-symlinks-main';
    if(spec.env?.NODE_OPTIONS)env.NODE_OPTIONS+=' '+spec.env.NODE_OPTIONS;
    if(spec.env?.NODE_ENV)env.NODE_ENV=spec.env.NODE_ENV;
    env.PYTHONNOUSERSITE='1';
    const result=await new Promise<{exitCode:number;stdout:string;stderr:string}>((resolve,reject)=>{
      const p=spawn(this.helper,[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:win,WINDIR:win,LOCALAPPDATA:localAppData,USERPROFILE:process.env.USERPROFILE||home,TEMP:process.env.TEMP||temp,PATH:path.join(win,'System32')}});
      let stdout='',stderr='',settled=false;
      const abort=()=>{p.stdin.end();}; signal.addEventListener('abort',abort,{once:true});
      const add=(kind:'stdout'|'stderr',b:Buffer)=>{const t=b.toString('utf8'); if(kind==='stdout') stdout=(stdout+t).slice(-1_000_000); else stderr=(stderr+t).slice(-1_000_000); onOutput?.(kind,t);this.publish(t.slice(-8000));};
      p.stdout.on('data',b=>add('stdout',b)); p.stderr.on('data',b=>add('stderr',b)); p.stdin.on('error',()=>{});
      p.on('error',e=>{signal.removeEventListener('abort',abort);if(!settled){settled=true;reject(e);}});
      p.on('close',code=>{signal.removeEventListener('abort',abort);if(!settled){settled=true;signal.aborted?reject(new DOMException('已暂停','AbortError')):resolve({exitCode:code??125,stdout,stderr});}});
      p.stdin.write(JSON.stringify({stage:execution,cwd,file:executable,args:commandArgs,runtimeRoots:[runtime],network,env})+'\n'); if(signal.aborted) abort();
    });
    signal.throwIfAborted();
    if(result.stderr.includes('AIW_SANDBOX_ERROR:')) throw new Error(`Windows 隔离执行未成功，未使用普通权限重试。\n${result.stderr.slice(-2500)}`);
    const after=await stageFiles.manifest(); const changed:string[]=[],deleted:string[]=[];
    const current=await files.manifest();
    if(current.size!==baseline.size||[...baseline].some(([file,digest])=>current.get(file)!==digest))throw new Error('执行期间项目被其他程序修改，未同步执行副本，也未把此次运行结果作为验证依据。请重新读取项目后再运行。');
    for(const [file,digest] of after) if(baseline.get(file)!==digest) {
      signal.throwIfAborted(); if(await files.digest(file)!==(baseline.get(file)||'')) throw new Error(`执行期间原项目文件被其他程序修改，未覆盖：${file}`);
      await files.copyWrite(taskId,file,await stageFiles.resolve(file),'执行命令前的版本',baseline.get(file)||''); changed.push(file);
    }
    for(const [file,digest] of baseline) if(!after.has(file)) {
      signal.throwIfAborted();
      const approved=await this.approve('命令请求删除已有文件',`文件：${file}\n原内容校验：${digest}\n命令：${spec.program} ${spec.args.join(' ')}`,{file,digest,spec},signal);
      if(!approved) { result.stderr+='\n用户拒绝删除文件：'+file; result.exitCode=result.exitCode||1; continue; }
      await files.remove(taskId,file,digest); deleted.push(file);
    }
    return {...result,changed,deleted,purpose:spec.purpose,fingerprint:hash(JSON.stringify([...after].sort((a,b)=>a[0].localeCompare(b[0]))))};
    }finally{
      const root=path.resolve(this.dataDir,'executions'),target=path.resolve(execution),relative=path.relative(root,target);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('执行目录清理路径无效。');
      const real=await fs.realpath(target).catch(()=>undefined);
      if(real&&real.toLowerCase()===target.toLowerCase())await fs.rm(target,{recursive:true,force:true}).catch(()=>{});
    }
  }
  async installTool(tool:'node_lts'|'python'|'git'|'dotnet',reason:string,signal:AbortSignal,onOutput?:(kind:'stdout'|'stderr',text:string)=>void){
    const packages={node_lts:{id:'OpenJS.NodeJS.LTS',name:'Node.js LTS'},python:{id:'Python.Python.3.13',name:'Python 3.13'},git:{id:'Git.Git',name:'Git'},dotnet:{id:'Microsoft.DotNet.SDK.10',name:'.NET SDK 10'}};
    const target=packages[tool];if(!target)throw new Error('不支持这个系统安装项。');
    const args=['install','--id',target.id,'--exact','--source','winget','--silent','--disable-interactivity','--accept-source-agreements','--accept-package-agreements'];
    const approved=await this.approve(`安装 ${target.name}？`,`原因：${reason}\n软件包：${target.id}\n来源：Windows 包管理器 winget 源\n这会安装开发工具，可能修改项目外的目录和系统环境，并可能要求 Windows 管理员确认。\n允许本次操作也表示接受该来源和软件的安装许可。暂停不能保证回滚已开始的系统安装。\n命令：winget ${args.join(' ')}`,{tool,packageId:target.id,args},signal);
    if(!approved)throw new Error('用户拒绝安装系统开发工具，请调整方案或请求用户提供其他环境。');
    signal.throwIfAborted();
    const winget=path.join(process.env.LOCALAPPDATA||'','Microsoft/WindowsApps/winget.exe');
    if(!existsSync(winget))throw new Error('这台电脑没有可用的 winget。请由用户在 Microsoft Store 安装或更新“应用安装程序”，或者手动安装所需开发工具。');
    return new Promise<{exitCode:number;stdout:string;stderr:string}>((resolve,reject)=>{
      const env:Record<string,string>={};for(const key of ['SystemRoot','WINDIR','SystemDrive','PATH','USERPROFILE','LOCALAPPDATA','APPDATA','TEMP','TMP','ProgramFiles','ProgramFiles(x86)','ProgramData'])if(process.env[key])env[key]=process.env[key]!;
      const p=spawn(winget,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env});let stdout='',stderr='';
      const abort=()=>p.kill();signal.addEventListener('abort',abort,{once:true});
      p.stdout.on('data',b=>{stdout=(stdout+b.toString('utf8')).slice(-1e6);onOutput?.('stdout',b.toString('utf8'));this.publish(b.toString('utf8').slice(-8000))});p.stderr.on('data',b=>{stderr=(stderr+b.toString('utf8')).slice(-1e6);onOutput?.('stderr',b.toString('utf8'))});
      p.on('error',e=>{signal.removeEventListener('abort',abort);reject(e)});p.on('close',code=>{signal.removeEventListener('abort',abort);signal.aborted?reject(new DOMException('任务已暂停；请检查系统安装程序是否已结束。','AbortError')):resolve({exitCode:code??1,stdout,stderr})});if(signal.aborted)abort();
    });
  }
  async install(taskId:string,files:ProjectFiles,manager:'npm'|'pip',packages:string[],signal:AbortSignal,onOutput?:(kind:'stdout'|'stderr',text:string)=>void):Promise<RunResult> {
    if(manager==='pip') return this.run(taskId,files,{program:'python',args:['-m','pip','install','--disable-pip-version-check','--only-binary=:all:','--target','.aiw-python',...packages],purpose:'execute'},signal,true,onOutput);
    return this.run(taskId,files,{program:'npm',args:['install','--ignore-scripts','--no-audit','--no-fund',...packages],purpose:'execute'},signal,true,onOutput);
  }
}

import React,{useState,useEffect,useLayoutEffect,useRef}from'react';
import{Globe,RefreshCw,Camera,Monitor,Smartphone,Columns2,Settings2,X,LoaderCircle,Square,ChevronDown}from'lucide-react';
import type{Chat,PreviewState}from'../shared';
import'./preview.css';
const api=window.workspace;
export function PreviewView({chat,state,enabled,split,onSplit,onChoose,onError,busy}:{chat:Chat|Omit<Chat,'pending'|'memory'|'memoryThrough'|'notices'>;state?:PreviewState;enabled:boolean;split:boolean;onSplit:()=>void;onChoose:()=>void;onError:(text:string)=>void;busy:boolean}){
 const[working,setWorking]=useState(''),[root,setRoot]=useState(chat.previewConfig?.root||''),[entry,setEntry]=useState(chat.previewConfig?.entry||'index.html'),[route,setRoute]=useState('/'),[image,setImage]=useState(''),[logs,setLogs]=useState(false),[config,setConfig]=useState(false);
 const frame=useRef<HTMLDivElement>(null);
 useEffect(()=>{setRoot(chat.previewConfig?.root||'');setEntry(chat.previewConfig?.entry||'index.html');setImage('');setRoute(state?.route||'/');},[chat.id]);
 useEffect(()=>{if(state?.route)setRoute(state.route)},[state?.route]);
 useLayoutEffect(()=>{const el=frame.current;if(!el)return;const update=()=>{const r=el.getBoundingClientRect();void api.previewBounds(chat.id,{x:r.x,y:r.y,width:r.width,height:r.height,visible:enabled&&state?.status==='ready'&&!state.building&&!image&&r.width>10&&r.height>10}).catch(()=>{});};update();const observer=new ResizeObserver(update);observer.observe(el);window.addEventListener('resize',update);return()=>{observer.disconnect();window.removeEventListener('resize',update);void api.previewBounds(chat.id,{x:0,y:0,width:0,height:0,visible:false}).catch(()=>{});}},[chat.id,enabled,state?.status,state?.building,image,split,logs,config]);
 async function run(name:string,fn:()=>Promise<unknown>){setWorking(name);try{await fn()}catch(e:any){onError(e.message?.replace(/^Error invoking remote method '[^']+': Error: /,''))}finally{setWorking('')}}
 const ready=state?.status==='ready'&&!state.building;
 const count=state?.logs.filter(l=>l.kind==='error'||l.kind==='blocked'||l.kind==='network').length||0;
 return<section className="preview-workspace" aria-label="网页预览">
  <div className="preview-toolbar">
   <button disabled={!chat.project||!!working||!!state?.building} className={!ready?'primary':''} onClick={()=>void run('open',()=>api.previewOpen(chat.id))}>{working==='open'?<LoaderCircle className="spin" size={15}/>:<Globe size={15}/>}打开网页</button>
   <button disabled={!chat.project||busy||!!working} onClick={()=>void run('build',()=>api.previewBuild(chat.id))}>{state?.building?<LoaderCircle className="spin" size={15}/>:null}构建并预览</button>
   <span className="preview-spacer"/>
   <button aria-label="刷新网页" title="重新加载最新网页" disabled={!ready||!!working} onClick={()=>{setImage('');void run('reload',()=>api.previewReload(chat.id))}}><RefreshCw size={15}/></button>
   <button aria-label="查看网页截图" title="查看网页截图" disabled={!ready||!!working} onClick={()=>void run('shot',async()=>{const shot=await api.previewScreenshot(chat.id);setImage(shot.image)})}><Camera size={15}/></button>
   <button aria-label="电脑尺寸" title="电脑尺寸" disabled={!ready||!!working} onClick={()=>void run('size',()=>api.previewViewport(chat.id,1100,760))}><Monitor size={15}/></button>
   <button aria-label="手机尺寸" title="手机尺寸" disabled={!ready||!!working} onClick={()=>void run('size',()=>api.previewViewport(chat.id,390,844))}><Smartphone size={15}/></button>
   <button className={'preview-split-button'+(split?' selected':'')} aria-pressed={split} onClick={onSplit} title="聊天与网页并排查看"><Columns2 size={15}/><span>并排聊天</span></button>
   <button aria-label="预览位置设置" aria-expanded={config} title="预览位置设置" onClick={()=>setConfig(!config)}><Settings2 size={15}/></button>
   {state&&<button aria-label="关闭网页" title="关闭网页" disabled={!!state.building} onClick={()=>void run('close',()=>api.previewClose(chat.id))}><X size={15}/></button>}
  </div>
  {config&&<form className="preview-config" onSubmit={e=>{e.preventDefault();setImage('');void run('open',()=>api.previewOpen(chat.id,{root,entry}))}}><label>网页所在文件夹<input aria-label="网页所在文件夹" placeholder="留空为项目根目录，如 dist" value={root} onChange={e=>setRoot(e.target.value)}/></label><label>入口文件<input aria-label="网页入口文件" value={entry} onChange={e=>setEntry(e.target.value)}/></label><button disabled={!chat.project||!!working}>打开此位置</button><p>填写项目内的相对位置。需要后端服务的页面目前只预览已构建的前端。</p></form>}
  {ready&&<form className="preview-address" onSubmit={e=>{e.preventDefault();setImage('');void run('navigate',()=>api.previewNavigate(chat.id,route))}}><Globe size={13}/><span>项目网页</span><input aria-label="项目网页路径" value={route} onChange={e=>setRoute(e.target.value)}/><button type="submit" disabled={!!working}>前往</button><small>{state.viewport.width} × {state.viewport.height}</small></form>}
  <div className="preview-frame" ref={frame} aria-label="网页画面">
   {image?<div className="preview-captured"><div><span>当前网页截图</span><button onClick={()=>setImage('')}><X size={14}/>返回网页</button></div><img src={image} alt="当前项目网页的真实截图"/></div>:!ready?<div className="preview-empty">{state?.building?<><LoaderCircle className="spin" size={30}/><h2>正在构建网页</h2><p>完成后会打开网页。你可以随时停止。</p><button onClick={()=>void api.previewCancelBuild()}><Square size={13}/>停止构建</button><pre>{state.buildLog}</pre></>:state?.status==='loading'?<><LoaderCircle className="spin" size={30}/><h2>正在打开网页</h2></>:<><Globe size={34}/><h2>{state?.error?'网页还没有打开':'把网页放到眼前。'}</h2><p>{state?.error||'AI 可以查看画面、检查报错，并测试按钮和表单。你也可以直接在这里操作网页。'}</p>{!chat.project?<button className="primary" onClick={onChoose}>选择项目文件夹</button>:<><p className="preview-help">普通网页点“打开网页”；React、Vite 等项目先点“构建并预览”。</p><small>当前支持静态网页和前端构建产物。需要后端服务时，GPT 会说明尚未验证的部分。</small></>}</>}</div>:null}
  </div>
  {state&&<div className={'preview-console'+(logs?' expanded':'')}><button className="preview-console-toggle" aria-expanded={logs} onClick={()=>setLogs(!logs)}><ChevronDown size={14}/>页面消息{count>0&&<span>{count}</span>}<small>{state.title||'项目网页'}{state.root?' / '+state.root:''}</small></button>{logs&&<div className="preview-log-list">{!state.logs.length?<p>暂时没有页面消息。</p>:state.logs.map((l,i)=><div key={i} className={'preview-log '+l.kind}><time>{new Date(l.time).toLocaleTimeString('zh-CN')}</time><span>{l.kind==='blocked'?'已拦截':l.kind==='error'?'错误':l.kind==='network'?'网络':'消息'}</span><pre>{l.text}</pre></div>)}</div>}</div>}
 </section>
}


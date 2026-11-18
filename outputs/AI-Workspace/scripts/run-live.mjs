import{build}from'esbuild';import{spawn}from'node:child_process';import{mkdir}from'node:fs/promises';import path from'node:path';import{randomUUID}from'node:crypto';import electron from'electron';
const modes={
 '--preview':['live-preview-e2e','live-preview-validation.ts'],
 '--chat':['live-chat-e2e','live-chat-validation.ts'],
 '--questions':['live-question-e2e','live-question-validation.ts'],
 '--reasoning':['live-reasoning-e2e','live-reasoning-validation.ts'],
 '--cooperation':['live-cooperation-e2e','live-cooperation-validation.ts'],
 '--diagnostic':['live-deepseek-diagnostic','live-deepseek-diagnostic.ts'],
};
const args=process.argv.slice(2),flags=args.filter(a=>a.startsWith('--'));if(flags.length>1||flags.some(a=>!Object.hasOwn(modes,a)))throw new Error('Choose one supported validation mode.');const mode=flags[0]?modes[flags[0]]:['live-e2e','live-validation.ts'],source=process.cwd(),base=path.resolve('../../work',mode[0]),arg=args.find(a=>!a.startsWith('--')),root=arg?path.resolve(arg):path.join(base,randomUUID());const rel=path.relative(base,root);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Validation directory must be inside its own work folder.');
await mkdir(root,{recursive:true});const driver=path.join(root,'driver.cjs');await build({entryPoints:[path.join('scripts',mode[1])],bundle:true,platform:'node',format:'cjs',outfile:driver,external:['electron','node:sqlite'],target:'node22'});
const env={...process.env,AIW_SOURCE_ROOT:source,AIW_LIVE_RUN_ROOT:root};delete env.ELECTRON_RUN_AS_NODE;console.log(JSON.stringify({liveVerificationStarted:true,runRoot:root,mode:flags[0]||'development'}));
const p=spawn(electron,[driver],{stdio:'inherit',windowsHide:true,env});p.on('error',e=>{console.error(e.message);process.exitCode=1});p.on('close',code=>process.exitCode=code??1);

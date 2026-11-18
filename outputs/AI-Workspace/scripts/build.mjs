import { build } from 'esbuild';
import { mkdir, cp, readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

await mkdir('dist/ui', { recursive: true });
const tsc = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'vendor/siwc/packages/local/tsconfig.json'], { stdio: 'inherit', windowsHide: true });
if (tsc.status !== 0) process.exit(tsc.status || 1);
await build({ entryPoints: ['src/main.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/main.cjs', external: ['electron', 'node:sqlite'], target: 'node22', sourcemap: true, logLevel: 'info' });
await build({ entryPoints: ['src/preload.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'dist/preload.cjs', external: ['electron'], target: 'node22', logLevel: 'info' });
await build({entryPoints:['src/preview-preload.ts'],bundle:true,platform:'node',format:'cjs',outfile:'dist/preview-preload.cjs',external:['electron'],target:'node22',logLevel:'info'});
await build({ entryPoints: ['src/ui/app.tsx'], bundle: true, platform: 'browser', format: 'esm', outfile: 'dist/ui/app.js', target: 'chrome120', minify: true, logLevel: 'info', define: { 'process.env.NODE_ENV': '"production"' } });
await cp('src/ui/index.html', 'dist/ui/index.html');
await cp('assets/icon.png','dist/icon.png');
await mkdir('dist/notices', { recursive: true });
await cp('vendor/siwc/LICENSE', 'dist/notices/OpenAI-DevKit-LICENSE.txt');
await cp('vendor/siwc/THIRD_PARTY_NOTICES.md', 'dist/notices/OpenAI-DevKit-THIRD-PARTY.txt');
await cp('vendor/siwc/AI-WORKSPACE-CHANGES.txt', 'dist/notices/OpenAI-DevKit-AI-Workspace-CHANGES.txt');
const inventory = JSON.parse(await readFile('package-lock.json', 'utf8'));
await writeFile('dist/notices/dependencies.json', JSON.stringify(inventory.packages, null, 2));
for(const modulePath of Object.keys(inventory.packages)){
  if(!modulePath.startsWith('node_modules/'))continue;
  let names=[];try{names=await readdir(modulePath)}catch{continue}
  for(const name of names)if(/^(?:licen[sc]e|notice|copying)(?:[._-]|$)/i.test(name)){
    const target=resolve('dist/notices/third-party',modulePath.slice('node_modules/'.length));
    await mkdir(target,{recursive:true});await cp(resolve(modulePath,name),resolve(target,name),{recursive:true});
  }
}
const csc = resolve(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const native = spawnSync(csc, ['/nologo', '/optimize+', '/target:exe', '/reference:System.Web.Extensions.dll', '/out:'+resolve('native/SandboxRunner.exe'), resolve('native/SandboxRunner.cs')], { stdio: 'inherit', windowsHide: true });
if (native.status !== 0) process.exit(native.status || 1);

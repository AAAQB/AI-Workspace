import {spawn} from 'node:child_process';
import path from 'node:path';
import electronPath from 'electron';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.AIW_TEST_MODE;delete env.AIW_DATA_DIR;
const p=spawn(electronPath,[path.resolve('.')],{detached:true,stdio:'ignore',windowsHide:true,env});p.unref();console.log(JSON.stringify({pid:p.pid,application:'AI Workspace',storage:'Windows application data (encrypted credentials)'}));

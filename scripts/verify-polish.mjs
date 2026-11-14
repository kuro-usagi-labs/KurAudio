import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createServer} from 'vite';
fs.mkdirSync('test-results/polish-gate',{recursive:true});
const suites=[['unit','node_modules/vitest/vitest.mjs','run','--dir','src'],...['home-transport','focus-workflow','selection-comfort','trim-interaction','drop-effects','polish-workflow','polish-review','studio7-history','live-mix','transport-continuity','polish-visual','editing-effects','review-playback','loudness-audio','timeline-scroll','motion','advanced','studio7-recording'].map(s=>[s,`tests/${s}.mjs`])];
const server=await createServer({server:{host:'127.0.0.1',port:1422,strictPort:true,hmr:false,watch:{ignored:['**/release/**','**/src-tauri/**','**/test-results/**']}}});await server.listen();
try{for(const [name,...args] of suites){let output='';const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.on('error',reject);child.on('close',resolve);});fs.writeFileSync(`test-results/polish-gate/${name}.log`,output);console.log(`${name}: ${code===0?'PASS':'FAIL'}`);if(code!==0){console.error(output);process.exitCode=code||1;break;}}}finally{await server.close();}

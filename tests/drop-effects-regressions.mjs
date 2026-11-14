import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
const folder='test-results/drop-effects/regressions';await fs.mkdir(folder,{recursive:true});
const server=await createServer({cacheDir:'node_modules/.vite-drop-regressions',server:{host:'127.0.0.1',port:1474,hmr:false,strictPort:true},clearScreen:false});await server.listen();
const suites=process.argv.slice(2);if(!suites.length)suites.push('home-screen','editing-effects','advanced','studio-ui','editor','motion','controls','loudness-audio');
try{for(const suite of suites){const code=(await fs.readFile('tests/'+suite+'.mjs','utf8')).replaceAll('http://127.0.0.1:1422','http://127.0.0.1:1474');const output=await new Promise((resolve,reject)=>{let log='';const child=spawn(process.execPath,['--input-type=module','-e',code],{windowsHide:true});child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);child.once('error',reject);child.once('exit',status=>resolve({status,log}));});await fs.writeFile(folder+'/'+suite+'.log',output.log);console.log(suite+': '+output.log.trim().split('\n').at(-1));if(output.status!==0)throw Error(suite+' failed. See '+folder+'/'+suite+'.log');}}finally{await server.close();}

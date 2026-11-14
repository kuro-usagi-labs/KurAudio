import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('test-results/polish-native');
const exe=path.join(root,'qa/KurAudio.exe');
const binary=(await fs.readFile(exe)).toString('utf8');
if(!binary.includes('id.kuraudio.polishqa')||binary.includes('id.kuraudio.desktop')) throw Error('Native verification requires the isolated QA executable');
await fs.mkdir(root,{recursive:true});
const results=[];
for(const suite of ['drop-effects-native','lifecycle','studio7-native','advanced-native','appearance-native']) {
 let output='';
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[`tests/${suite}.mjs`],{windowsHide:true,env:{...process.env,KURAUDIO_TEST_EXE:exe}});
  child.stdout.on('data',chunk=>output+=chunk);
  child.stderr.on('data',chunk=>output+=chunk);
  child.on('error',reject);child.on('close',resolve);
 });
 await fs.writeFile(path.join(root,`${suite}.log`),output);
 results.push({suite,code,checks:output.split('\n').filter(line=>line.startsWith('PASS ')).length});
 await fs.writeFile(path.join(root,'native-gate.json'),JSON.stringify({exe,results},null,2));
 console.log(`${suite}: ${code===0?'PASS':'FAIL'} (${results.at(-1).checks} checks)`);
 if(code!==0){console.error(output);process.exitCode=code||1;break;}
}

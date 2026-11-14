import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const folder=path.resolve('test-results/appearance/native'),exe=path.resolve(process.env.KURAUDIO_TEST_EXE||'test-results/appearance/qa/KurAudio.exe'),profile=path.join(folder,'profile-'+Date.now()),fixture=path.resolve('test-results/advanced/speech-pauses.wav'),saved=path.join(folder,'appearance.kura');
await fs.mkdir(folder,{recursive:true});await fs.access(exe);
const checks=[],errors=[],check=(ok,label)=>{assert.ok(ok,label);checks.push(label);console.log('PASS '+label);},delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const top=(page,name)=>page.getByRole('menubar',{name:'Menu aplikasi'}).getByRole('menuitem',{name,exact:true});
const entry=(page,name)=>page.getByRole('menu',{name:/Menu /}).getByRole('menuitem',{name,exact:true});
const settings=async page=>{await top(page,'Pengaturan').click();await page.getByRole('dialog',{name:'Pengaturan aplikasi',exact:true}).waitFor();};
const choose=(page,name)=>page.getByRole('radio',{name,exact:true}).click();
const nativeMatches=(page,value)=>page.waitForFunction(async value=>document.documentElement.dataset.theme===value&&await window.__TAURI_INTERNALS__.invoke('plugin:window|theme',{label:'main'})===value,value);
async function launch(){
 const app=spawn(exe,[],{windowsHide:true,env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9246 --remote-allow-origins=*'}}),exited=new Promise(resolve=>app.once('exit',code=>resolve(code)));let browser;
 for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9246');break;}catch{if(app.exitCode!==null)break;await delay(200);}}
 assert.ok(browser,'isolated native QA starts');const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>document.querySelector('.home-screen:not([inert])'));await fs.access(path.join(profile,'EBWebView'));return{app,exited,browser,page};
}
async function hooks(page){await page.evaluate(({fixture,saved})=>{
 const original=window.fetch.bind(window);window.audit={writes:0,themes:[],backgrounds:0,delayNext:false,nativeErrors:[]};
 window.fetch=async(input,init)=>{
  const command=decodeURIComponent(new URL(typeof input==='string'?input:input.url).pathname.slice(1)),args=typeof init?.body==='string'?JSON.parse(init.body):{};
  if(command==='plugin:dialog|save')return new Response(JSON.stringify(saved),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});
  if(command==='plugin:dialog|open')return new Response(JSON.stringify(args.options?.multiple?[fixture]:saved),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}});
  const slow=command==='plugin:window|set_theme'&&window.audit.delayNext;if(slow)window.audit.delayNext=false;
  const response=await original(input,init),ok=response.headers.get('Tauri-Response')==='ok';
  if(command==='plugin:window|set_theme')window.audit.themes.push({value:args.value,ok});
  if(command==='plugin:window|set_background_color'&&ok)window.audit.backgrounds++;
  if(command.startsWith('plugin:window|set_')&&!ok)window.audit.nativeErrors.push(command);
  if(command==='write_project'&&ok)window.audit.writes++;
  if(slow)await new Promise(resolve=>setTimeout(resolve,350));return response;
 };
},{fixture,saved});}
async function exitCode(run){let timer;try{return await Promise.race([run.exited,new Promise(resolve=>timer=setTimeout(()=>resolve(null),5000))]);}finally{clearTimeout(timer);}}
async function cleanup(run){await run.browser.close().catch(()=>{});if(run.app.exitCode===null)run.app.kill();}
let run;
try{
 run=await launch();let {page}=run;await hooks(page);await nativeMatches(page,'dark');check(true,'native default remains Dark for existing users');
 await settings(page);await choose(page,'Terang');await nativeMatches(page,'light');await page.waitForFunction(()=>window.audit.backgrounds>0);check(!(await page.locator('.settings-footer').innerText()).includes('belum dapat'),'Light updates the real native window theme and background without permission errors');await page.screenshot({path:folder+'/settings-light.png'});
 await choose(page,'Sistem');await page.waitForFunction(()=>window.audit.themes.some(t=>t.value===null&&t.ok));await page.waitForFunction(async()=>document.documentElement.dataset.theme===await window.__TAURI_INTERNALS__.invoke('plugin:window|theme',{label:'main'})&&document.documentElement.dataset.theme===(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));check(true,'System restores native OS following and agrees with WebView2 media preference');
 await page.evaluate(()=>window.audit.delayNext=true);const count=await page.evaluate(()=>window.audit.themes.length);await choose(page,'Gelap');await page.waitForFunction(count=>window.audit.themes.length>count,count);await choose(page,'Terang');await nativeMatches(page,'light');await page.waitForTimeout(450);await nativeMatches(page,'light');check(true,'rapid choices remain Light after a delayed older native theme response');check(await page.evaluate(()=>window.audit.nativeErrors.length===0),'all actual native appearance commands pass capability checks');await page.keyboard.press('Escape');
 await top(page,'File').click();await entry(page,'Keluar KurAudio').click();check(await exitCode(run)===0,'native clean Home closes after changing appearance');await cleanup(run);run=null;
 run=await launch();page=run.page;await hooks(page);await nativeMatches(page,'light');await settings(page);check(await page.getByRole('radio',{name:'Terang',exact:true}).getAttribute('aria-checked')==='true','Light preference survives a real Windows process restart');await page.keyboard.press('Escape');
 await top(page,'File').click();await entry(page,'Proyek baru').click();await top(page,'File').click();await entry(page,'Impor audio…').click();await page.locator('.asset-item').waitFor();check(await page.getByTestId('audio-clip').count()===0,'Light native import decodes real audio into Media without inserting a clip');await page.locator('.asset-item').press('Enter');await page.getByTestId('audio-clip').click();
 await top(page,'File').click();await entry(page,'Simpan').click();await page.waitForFunction(()=>window.audit.writes===1);const bytes=await fs.readFile(saved),doc=JSON.parse(bytes);check(doc.version===3&&doc.project.clips.length===1&&doc.media.length===1&&!JSON.stringify(doc).includes('"appearance"'),'actual Rust save retains portable project v3 and keeps appearance outside the audio document');
 const clip=page.getByTestId('audio-clip').first(),before=await clip.boundingBox();await settings(page);await choose(page,'Gelap');await nativeMatches(page,'dark');await page.keyboard.press('Escape');check(await page.getByLabel('Status berkas proyek',{exact:true}).innerText()==='Berkas: tersimpan','theme changes leave a saved native project clean');const after=await clip.boundingBox();check(before.x===after.x&&before.width===after.width,'native appearance changes preserve the timeline clip position and length');await top(page,'File').click();await entry(page,'Simpan').click();await page.waitForFunction(()=>window.audit.writes===2);check((await fs.readFile(saved)).equals(bytes),'saving again after a theme change preserves exact project bytes');
 await settings(page);await choose(page,'Terang');await nativeMatches(page,'light');await page.keyboard.press('Escape');await page.getByRole('tab',{name:'Efek',exact:true}).click();await page.getByRole('switch',{name:'Reverb',exact:true}).check();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.toggle-switch-thumb,.effect-section-reveal')).every(el=>el.getAnimations().length===0));await page.screenshot({path:folder+'/KurAudio-0.10.0-light-native.png'});check(await page.getByRole('slider',{name:'Reverb',exact:true}).isVisible(),'Light inspector reveals a working effect slider from its custom switch');
 await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}));await page.getByRole('dialog',{name:'Simpan perubahan?',exact:true}).waitFor();await page.screenshot({path:folder+'/close-light.png'});await page.getByRole('button',{name:'Batal',exact:true}).click();check(run.app.exitCode===null&&await page.getByRole('switch',{name:'Reverb',exact:true}).isChecked(),'Light native close Cancel preserves unsaved audio edits');await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}));await page.getByRole('button',{name:'Lanjut tanpa simpan',exact:true}).click();check(await exitCode(run)===0,'Light native close Discard exits the actual Windows process normally');check((await fs.readFile(saved)).equals(bytes),'discarded effect changes never overwrite the saved audio project');check(errors.length===0,'native appearance workflow has no renderer errors');
 await fs.writeFile(folder+'/results.json',JSON.stringify({checks:checks.length,results:checks,errors,profile},null,2));console.log('RESULT: '+checks.length+' native appearance checks passed');
}catch(error){if(run){const {page}=run;await page.screenshot({path:folder+'/failure.png'}).catch(()=>{});await fs.writeFile(folder+'/failure.json',JSON.stringify(await page.evaluate(()=>({audit:window.audit,text:document.body.innerText,theme:document.documentElement.dataset.theme})),null,2)).catch(()=>{});}throw error;}finally{if(run)await cleanup(run);}

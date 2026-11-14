import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const folder='test-results/flow-audit',fixture=path.resolve(folder,'speech-pauses.wav');
await fs.mkdir(folder,{recursive:true});
const rate=16000,samples=rate*2,wav=Buffer.alloc(44+samples*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*12000),44+i*2);await fs.writeFile(fixture,wav);
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${fixture}`]}),results=[],failures=[],errors=[];
const check=(ok,label)=>{assert.ok(ok,label);results.push(label);console.log('PASS '+label);};
async function run(name,width,body){
 if(process.env.KURAUDIO_FLOW_CASE&&process.env.KURAUDIO_FLOW_CASE!==name)return;
 const context=await browser.newContext({viewport:{width,height:width===900?620:900},reducedMotion:'reduce',permissions:['microphone'],acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(String(e)));
 try{await page.goto('http://127.0.0.1:1422');await page.getByRole('button',{name:'Proyek baru',exact:true}).click();await body(page);}catch(error){failures.push({name,error:String(error)});console.error('FAIL '+name+': '+error.message);await page.screenshot({path:`${folder}/failure-${name}.png`});}finally{await context.close();}
}
const state=page=>page.evaluate(async()=>{const url=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/model.ts').name;return(await import(url)).editor.get();});
const unobscured=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit);});
const demo=async page=>{const trigger=page.getByRole('button',{name:'Buka sesi demo',exact:true});if(!await trigger.isVisible())await page.getByRole('button',{name:'Media',exact:true}).click();await trigger.click();if(await page.getByRole('button',{name:'Timeline',exact:true}).isVisible())await page.getByRole('button',{name:'Timeline',exact:true}).click();};
const snapshot=async(page,name)=>{
 await page.mouse.move(0,0);await page.screenshot({path:`${folder}/${name}.png`});
 const html=await page.evaluate(()=>{const doc=document.documentElement.cloneNode(true);doc.querySelectorAll('script,link[rel=stylesheet]').forEach(n=>n.remove());const style=document.createElement('style');style.textContent=Array.from(document.styleSheets).flatMap(s=>Array.from(s.cssRules).map(r=>r.cssText)).join('\n')+'\n*{animation:none!important;transition:none!important}';doc.querySelector('head').append(style);return '<!doctype html>'+doc.outerHTML;});await fs.writeFile(`${folder}/${name}.html`,html);
};
try{
 await run('compact-layout',900,async page=>{
  await demo(page);await page.getByTestId('audio-clip').first().click({position:{x:40,y:50}});const selection=(await state(page)).selected;
  await page.getByRole('button',{name:'Properti',exact:true}).click();
  check(await unobscured(page.getByRole('button',{name:'Alat audio',exact:true})),'compact inspector leaves audio tools operable');
  check(await unobscured(page.getByRole('button',{name:'Properti',exact:true})),'compact inspector leaves its toggle operable');
  const timeline=await page.getByTestId('timeline-scroll').boundingBox(),inspector=await page.locator('.inspector').boundingBox();check(timeline.x+timeline.width<=inspector.x+1,'compact inspector sits beside the timeline without covering its time area');
  check(await page.locator('.media-panel').getAttribute('inert')!==null,'media hidden by compact properties is removed from keyboard navigation');
  await snapshot(page,'compact-properties');await page.getByRole('button',{name:'Alat audio',exact:true}).click();await page.keyboard.press('Escape');
  await page.getByLabel('Nama klip',{exact:true}).focus();await page.keyboard.press('Escape');
  check(await page.getByRole('button',{name:'Properti',exact:true}).getAttribute('aria-expanded')==='false'&&JSON.stringify((await state(page)).selected)===JSON.stringify(selection),'Escape closes compact properties while keeping clip selection');
  check(await page.getByRole('button',{name:'Properti',exact:true}).evaluate(el=>el===document.activeElement),'closing compact properties restores focus to its trigger');
  await page.getByRole('button',{name:'Properti',exact:true}).click();await page.getByRole('button',{name:'Tampilkan media',exact:true}).click();check(await page.locator('.media-panel').getAttribute('inert')===null&&await page.getByRole('button',{name:'Properti',exact:true}).getAttribute('aria-expanded')==='false','media toggle returns from properties to an accessible library');
 });
 await run('import-discovery',900,async page=>{
  await page.getByTestId('audio-input').setInputFiles(fixture);await page.locator('.asset-item').waitFor();await page.getByRole('textbox',{name:'Cari audio',exact:true}).fill('not-a-real-file');await page.getByRole('button',{name:'Tampilkan media',exact:true}).click();
  await page.getByTestId('audio-input').setInputFiles(fixture);await page.waitForFunction(()=>document.querySelector('.panel-heading small')?.textContent==='2');
  check(await page.getByRole('textbox',{name:'Cari audio',exact:true}).inputValue()===''&&await page.locator('.asset-item').last().isVisible()&&await page.locator('.media-panel').getAttribute('inert')===null,'successful import reveals media and clears a stale search filter');
  check((await state(page)).project.clips.length===0,'revealing imported media does not insert it into the timeline');
  await page.locator('.asset-item').last().press('Enter');check((await state(page)).project.clips.length===1,'Enter places the chosen media on the timeline once');
 });
 await run('record-workflow',1440,async page=>{
  await demo(page);await page.locator('.track-header').nth(1).click({position:{x:70,y:20}});await page.locator('.ruler-seek').click({position:{x:48,y:10}});const time=await page.getByLabel('Waktu playhead',{exact:true}).textContent();
  await page.evaluate(()=>{window.__micCalls=0;window.__micTracks=[];const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async(...args)=>{window.__micCalls++;const stream=await original(...args);window.__micTracks.push(...stream.getTracks());return stream;};});
  const mic=page.getByRole('button',{name:'Rekam mikrofon',exact:true});const color=await mic.locator('svg').evaluate(el=>getComputedStyle(el).color.match(/[\d.]+/g).slice(0,3).map(Number));check(color[0]>color[1]*1.5&&color[0]>color[2]*1.5,'record microphone uses a distinct red tone');
  await mic.click();check(await page.getByLabel('Tujuan rekaman',{exact:true}).textContent().then(t=>t.includes('Musik')&&t.includes(time)),'record preflight shows the actual destination track and playhead time');check(await page.evaluate(()=>window.__micCalls===0),'opening record preflight does not request microphone access');
  await page.getByRole('button',{name:'Siapkan mikrofon',exact:true}).click();await page.getByRole('button',{name:'Mulai rekam',exact:true}).waitFor();await snapshot(page,'record-ready');
  await page.getByRole('button',{name:'Ganti mikrofon',exact:true}).click();check(await page.getByRole('radio').first().isEnabled()&&await page.evaluate(()=>window.__micTracks.every(t=>t.readyState==='ended')),'changing input releases the previous stream and unlocks device selection');
  await page.getByRole('button',{name:'Siapkan mikrofon',exact:true}).click();await page.getByRole('button',{name:'Mulai rekam',exact:true}).click();await page.waitForTimeout(350);await snapshot(page,'record-active');
  check(await page.getByRole('status').filter({hasText:'Merekam'}).isVisible(),'active recording is communicated with text as well as color');
  await page.getByRole('button',{name:'Stop & tambahkan',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));const current=(await state(page)).project,last=current.clips.at(-1);
  check(current.clips.length===6&&last.trackId===current.tracks[1].id&&last.start===1,'stopping recording places one take on the displayed track and time');check(await page.evaluate(()=>window.__micTracks.every(t=>t.readyState==='ended')),'finishing the take releases every capture stream');
 });
 await run('insertion-focus',1440,async page=>{
  const bytes=await fs.readFile(fixture);await page.getByTestId('audio-input').setInputFiles([{name:'first.wav',mimeType:'audio/wav',buffer:bytes},{name:'second.wav',mimeType:'audio/wav',buffer:bytes}]);await page.locator('.asset-item').nth(1).waitFor();
  await page.evaluate(()=>{const original=requestAnimationFrame;window.requestAnimationFrame=callback=>original(()=>setTimeout(callback,100));});
  await page.locator('.asset-item').first().press('Enter');await page.locator('.asset-item').nth(1).focus();await page.waitForTimeout(150);
  check(await page.locator('.asset-item').nth(1).evaluate(el=>el===document.activeElement),'pending insertion focus never steals focus from the next chosen media');
  await page.keyboard.press('Enter');check((await state(page)).project.clips.length===2,'rapid keyboard placement can add two consecutive assets');
 });
 await run('record-permission-error',900,async page=>{
  await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};});await page.getByRole('button',{name:'Rekam mikrofon',exact:true}).click();await page.getByRole('button',{name:'Siapkan mikrofon',exact:true}).click();
  check(await page.getByRole('alert').textContent().then(t=>t.includes('Izin mikrofon')&&t.includes('pengaturan')),'microphone denial explains how to recover in Indonesian');check(await page.getByRole('button',{name:'Siapkan mikrofon',exact:true}).isEnabled(),'microphone preparation can be retried after permission failure');await snapshot(page,'record-error');await page.keyboard.press('Escape');check(await page.getByRole('dialog').count()===0,'permission failure never traps the user in the record dialog');
 });
 for(const width of [390,900,1024,1280,1440])await run(`layout-${width}`,width,async page=>{
  await demo(page);if(width<900){await page.getByRole('button',{name:'Media',exact:true}).click();await page.locator('.asset-item').first().press('Enter');check(await page.getByRole('button',{name:'Timeline',exact:true}).getAttribute('aria-pressed')==='true','keyboard insertion returns a narrow screen to the timeline');}
  await page.getByRole('button',{name:'Rekam mikrofon',exact:true}).click();await snapshot(page,`record-${width}`);const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;check(violations.length===0,`${width}px record dialog has no automated WCAG A/AA violations`);await page.keyboard.press('Escape');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px layout contains document overflow`);
 });
 check(errors.length===0,'audited workflows produce no renderer errors');await fs.writeFile(`${folder}/results.json`,JSON.stringify({checks:results.length,results,failures,errors},null,2));if(failures.length)throw Error(`${failures.length} audit scenarios failed`);console.log(`RESULT: ${results.length} flow/layout checks passed`);
}finally{await browser.close();}

import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const folder='test-results/studio';await fs.mkdir(folder,{recursive:true});
const browser=await chromium.launch(),results=[],errors=[];
const check=(ok,label)=>{assert.ok(ok,label);results.push(label);console.log('PASS '+label);};
try {
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:1422');await page.getByRole('button',{name:'Proyek baru',exact:true}).waitFor();
  const snapshot=async(name)=>{
    await page.mouse.move(0,0);await page.screenshot({path:`${folder}/${name}.png`});
    const html=await page.evaluate(()=>{const copy=document.documentElement.cloneNode(true);copy.querySelectorAll('script,link[rel=stylesheet]').forEach(n=>n.remove());const css=Array.from(document.styleSheets).flatMap(s=>Array.from(s.cssRules).map(r=>r.cssText)).join('\n');const style=document.createElement('style');style.textContent=css+'\n*{animation:none!important;transition:none!important}';copy.querySelector('head').append(style);return '<!doctype html>'+copy.outerHTML;});await fs.writeFile(`${folder}/${name}.html`,html);
  };
  await snapshot('home-1440');await page.getByRole('button',{name:'Proyek baru',exact:true}).click();await page.getByRole('button',{name:'Buka sesi demo',exact:true}).click();
  await page.evaluate(()=>{window.__studio=Object.fromEntries(['model','audio'].map(k=>[k,performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/'+k+'.ts').name]));});
  const state=()=>page.evaluate(async()=>(await import(window.__studio.model)).editor.get());
  const stamp=()=>page.evaluate(async()=>JSON.stringify((await import(window.__studio.model)).editor.get().project));
  const thumbs=await page.locator('.asset-thumbnail canvas').evaluateAll(els=>els.map(el=>({w:el.width,h:el.height,painted:el.getContext('2d').getImageData(0,0,el.width,el.height).data.some((n,i)=>i%4===3&&n>0)})));
  check(thumbs.length===3&&thumbs.every(c=>c.w>0&&c.h>0&&c.painted),'media thumbnails draw actual source waveforms');
  await page.getByRole('button',{name:'Alat potong (C)',exact:true}).focus();await page.keyboard.press('Space');
  check(await page.getByRole('button',{name:'Alat potong (C)',exact:true}).getAttribute('aria-pressed')==='true'&&await page.getByRole('button',{name:'Putar (Space)',exact:true}).count()===1,'Space activates a focused toolbar button without starting playback');
  await page.getByRole('button',{name:'Pilih & geser (V)',exact:true}).click();await page.getByTestId('audio-clip').first().click({position:{x:40,y:50}});await page.keyboard.press('e');
  const before=await stamp();await page.getByRole('switch',{name:'Reverb',exact:true}).focus();await page.keyboard.press('Space');
  check(await page.getByRole('switch',{name:'Reverb',exact:true}).isChecked()&&await page.getByRole('button',{name:'Putar (Space)',exact:true}).count()===1,'Space activates an effect without triggering playback');
  check(await page.getByRole('slider',{name:'Reverb',exact:true}).isVisible()&&await stamp()!==before,'effect activation updates project data and reveals its parameters');
  await page.getByRole('slider',{name:'Reverb',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('input[type=range][aria-label=Reverb]').value==='1');
  await page.getByRole('switch',{name:'Reverb',exact:true}).uncheck();await page.getByRole('switch',{name:'Reverb',exact:true}).check();check(await page.getByRole('slider',{name:'Reverb',exact:true}).inputValue()==='1','reactivating an effect retains its actual intensity');
  await page.getByRole('switch',{name:'Equalizer',exact:true}).check();check(await page.getByRole('slider',{name:'Bass',exact:true}).isVisible()&&await page.getByRole('slider',{name:'Treble',exact:true}).isVisible(),'Equalizer reveals both real frequency controls');
  await page.getByRole('switch',{name:'Equalizer',exact:true}).uncheck();await snapshot('effects-1440');
  await page.evaluate(()=>{navigator.mediaDevices.enumerateDevices=async()=>[{kind:'audioinput',deviceId:'',label:'',groupId:''}];});
  await page.getByRole('button',{name:'Rekam mikrofon',exact:true}).click();check(await page.getByRole('tab',{name:'Rekam',exact:true}).getAttribute('aria-selected')==='true'&&await page.getByRole('button',{name:'Siapkan mikrofon',exact:true}).isVisible(),'transport recording shortcut opens explicit microphone preflight');await page.waitForTimeout(100);check(await page.getByRole('radio').count()===1&&await page.locator('[role=radio][aria-checked=true]').count()===1,'permission-redacted devices do not duplicate the selected default microphone');await snapshot('record-1440');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Alat audio',exact:true}).click();await snapshot('markers-1440');await page.getByRole('tab',{name:'Pangkas hening',exact:true}).click();await snapshot('silence-1440');await page.keyboard.press('Escape');
  await page.setViewportSize({width:900,height:620});await page.getByRole('button',{name:'Ekspor audio',exact:true}).click();await page.getByRole('button',{name:'MP3',exact:true}).click();
  await page.locator('.modal-body').evaluate(el=>el.scrollTop=el.scrollHeight);const close=await page.getByRole('button',{name:'Tutup dialog',exact:true}).boundingBox(),modal=await page.getByRole('dialog').boundingBox();check(close.y>=modal.y&&close.y+close.height<=modal.y+modal.height,'scrolling a compact dialog keeps its close control visible');
  const selected=await page.locator('.export-settings .segmented').evaluateAll(groups=>groups.map(group=>Array.from(group.children).filter(el=>el.getAttribute('aria-pressed')==='true').length));check(selected.every(count=>count===1),'each export group exposes exactly one selected setting');
  await snapshot('export-900');const names=new Set();for(let i=0;i<20;i++){await page.keyboard.press('Tab');names.add(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')||document.activeElement.textContent));assert.ok(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));}check(names.size>4,'keyboard traverses export settings and remains inside the sheet');await page.keyboard.press('Escape');
  for(const width of [390,900,1280,1440]){
    await page.setViewportSize({width,height:width===900?620:900});await page.getByRole('button',{name:'Ekspor audio',exact:true}).click();await snapshot(`export-${width}`);await page.keyboard.press('Escape');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}px editor keeps document overflow contained`);
  }
  await page.setViewportSize({width:1440,height:900});const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;await fs.writeFile(`${folder}/axe.json`,JSON.stringify(violations,null,2));check(violations.length===0,'redesigned editor has no automated WCAG A/AA violations');check(errors.length===0,'redesigned interface produces no renderer errors');
  await fs.writeFile(`${folder}/results.json`,JSON.stringify({checks:results.length,results,errors,clipCount:(await state()).project.clips.length},null,2));console.log(`RESULT: ${results.length} studio UI checks passed`);
} finally {await browser.close();}

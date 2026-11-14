import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const out = path.resolve('test-results/studio/critic');
await fs.mkdir(path.join(out,'snapshots'), { recursive:true });
const browser = await chromium.launch();
const log = [], errors=[];
const capture = async(page,name,snapshot=true)=>{
  await page.mouse.move(0,0); await page.waitForTimeout(100);
  await page.screenshot({path:path.join(out,name+'.png')});
  const measure=await page.evaluate(()=>({viewport:[innerWidth,innerHeight],scroll:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],theme:document.documentElement.dataset.theme,background:getComputedStyle(document.body).backgroundColor,focus:document.activeElement?.outerHTML.slice(0,200),controls:[...document.querySelectorAll('button,input,select,[role=slider],[role=tab]')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden'&&!e.closest('[inert]')).map(e=>{let r=e.getBoundingClientRect(),s=getComputedStyle(e);return{name:e.getAttribute('aria-label')||e.innerText||e.getAttribute('placeholder')||e.getAttribute('name'),role:e.getAttribute('role')||e.tagName,disabled:e.disabled,pressed:e.getAttribute('aria-pressed'),expanded:e.getAttribute('aria-expanded'),selected:e.getAttribute('aria-selected'),value:e.value,box:[r.x,r.y,r.width,r.height],font:s.fontSize,color:s.color,background:s.backgroundColor};})}));
  log.push({name,...measure});
  if(snapshot) await fs.writeFile(path.join(out,'snapshots',name+'.html'),await page.evaluate(()=>{const css=[...document.styleSheets].flatMap(s=>[...s.cssRules].map(r=>r.cssText)).join('\n');const html=document.documentElement.cloneNode(true);html.querySelectorAll('script,style,link').forEach(e=>e.remove());html.querySelector('head').insertAdjacentHTML('beforeend','<style>'+css+'</style>');return '<!doctype html>'+html.outerHTML;}));
};
const save = async(page,name,snapshot=true)=>{
 await capture(page,name,snapshot);
 if(name.includes('-1280-')){
  await page.setViewportSize({width:390,height:844});
  const needsInspector=/^(properties|effects)/.test(name);
  if(needsInspector)await page.locator('.mobile-tabs button').getByText('Properti',{exact:true}).click();
  await capture(page,name.replace('-1280-','-390-'),snapshot);
  if(needsInspector)await page.locator('.mobile-tabs button').getByText('Properti',{exact:true}).click();
  await page.setViewportSize({width:1280,height:800});
 }
};
const click=async(page,name,role='button')=>{await page.getByRole(role,{name,exact:true}).click();log.push({action:'click',name});};
try {
 for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width:1280,height:800},colorScheme:theme,reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:1422');
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'});
  await page.getByRole('button',{name:'Proyek baru',exact:true}).waitFor();
  await save(page,`home-1280-${theme}`);
  await page.setViewportSize({width:390,height:844});await save(page,`home-390-${theme}`);
  await page.setViewportSize({width:1280,height:800});await click(page,'Proyek baru');await save(page,`empty-1280-${theme}`);
  await click(page,'Buka sesi demo');await page.getByTestId('audio-clip').first().waitFor();await page.waitForTimeout(400);await save(page,`editor-1280-${theme}`);
  await page.getByTestId('audio-clip').first().click({position:{x:80,y:50}});await save(page,`properties-1280-${theme}`);
  await click(page,'Efek','tab');await save(page,`effects-collapsed-1280-${theme}`);
  while(await page.locator('.effect-section-heading[aria-expanded=false]').count())await page.locator('.effect-section-heading[aria-expanded=false]').first().click();
  await page.locator('.inspector-content').evaluate(el=>el.scrollTop=0);await save(page,`effects-expanded-1280-${theme}`);
  await click(page,'Aktifkan efek');await save(page,`effects-bypass-1280-${theme}`);await click(page,'Aktifkan efek');
  await page.getByRole('slider',{name:'Reverb',exact:true}).fill('20');
  await page.getByRole('button',{name:/Preset pribadi/}).click();await page.getByLabel('Nama preset',{exact:true}).fill('Narasi');await click(page,'Simpan preset');await click(page,'Reset efek');await click(page,'Narasi');await save(page,`effects-preset-1280-${theme}`);
  await click(page,'Ekspor audio');await save(page,`export-wav-1280-${theme}`);
  await click(page,'MP3');await save(page,`export-mp3-1280-${theme}`);
  await click(page,'Klip terpilih');await save(page,`export-selected-1280-${theme}`);
  await page.keyboard.press('Escape');await click(page,'Alat audio');await save(page,`markers-1280-${theme}`);
  await click(page,'Pangkas hening','tab');await save(page,`silence-1280-${theme}`);
  await click(page,'Analisis hening');await page.waitForTimeout(700);await save(page,`silence-analyzed-1280-${theme}`);
  await click(page,'Rekam','tab');await save(page,`record-preflight-1280-${theme}`);await page.keyboard.press('Escape');
  await click(page,'Shortcut');await save(page,`shortcuts-1280-${theme}`);await page.keyboard.press('Escape');
  for(const [w,h]of[[900,620],[1440,900],[390,844]]){
   await page.setViewportSize({width:w,height:h});await save(page,`editor-${w}-${theme}`);
   if(w===900) {await click(page,'Properti');await save(page,`properties-${w}-${theme}`);await click(page,'Efek','tab');await save(page,`effects-${w}-${theme}`);}
   if(w===390){await page.locator('.mobile-tabs button').getByText('Properti',{exact:true}).click();await save(page,`effects-${w}-${theme}`);await page.locator('.mobile-tabs button').getByText('Properti',{exact:true}).click();}
   if(w===900)await click(page,'Tutup properti');
   await click(page,'Ekspor audio');await save(page,`export-${w}-${theme}`);await page.keyboard.press('Escape');
   await click(page,'Alat audio');await save(page,`tools-${w}-${theme}`);await page.keyboard.press('Escape');
  }
  await context.close();
 }
} finally {
 await fs.writeFile(path.join(out,'measurements.json'),JSON.stringify({log,errors},null,2));await browser.close();
}

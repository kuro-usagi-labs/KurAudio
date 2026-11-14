import {createServer} from 'vite';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const stage=process.env.KURAUDIO_UI_STAGE||'after';
const folder=`test-results/interface-audit/${stage}`;
await fs.mkdir(folder,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:1490,strictPort:true,hmr:false}});
await server.listen();
const browser=await chromium.launch();
const checks=[],errors=[];
try {
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 const appearance=async theme=>{await page.evaluate(t=>{document.documentElement.dataset.theme=t;window.dispatchEvent(new Event('kuraudio:appearance-changed'));},theme);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 const capture=async name=>{await page.mouse.move(0,0);await page.screenshot({path:`${folder}/${name}.png`});};
 await page.goto('http://127.0.0.1:1490');
 await page.getByRole('button',{name:'Proyek baru',exact:true}).waitFor();
 for(const theme of ['dark','light']) {
  await appearance(theme);
  await capture(`home-${theme}`);
  const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;
  checks.push({screen:'home',theme,violations:violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.html)}))});
 }
 await page.getByRole('button',{name:'Proyek baru',exact:true}).click();
 await page.getByRole('button',{name:'Buka sesi demo',exact:true}).click();
 if(await page.getByRole('button',{name:'Tutup notifikasi',exact:true}).count()) await page.getByRole('button',{name:'Tutup notifikasi',exact:true}).click();
 await page.getByTestId('audio-clip').first().click();
 const geometry=await page.evaluate(async()=>{const {HEADER_WIDTH}=await import('/src/timelineViewport.ts');return {code:HEADER_WIDTH,css:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--layout-track-header')),actual:document.querySelector('.track-header').getBoundingClientRect().width};});
 assert.equal(geometry.code,geometry.css,'track header CSS matches pointer geometry');
 assert.equal(geometry.code,geometry.actual,'rendered track header matches pointer geometry');
 for(const width of [1440,1280,1024,900]) for(const theme of ['dark','light']) {
  await page.setViewportSize({width,height:width===1440?900:width===900?620:768});
  await appearance(theme);
  await capture(`editor-${theme}-${width}`);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no root overflow');
  const crowded=await page.locator('.editing-toolbar,.timeline-meta,.app-header,.transport').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className));
  checks.push({width,theme,crowded});
  const original=await page.locator('.tool-modes .icon-button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.width];}));
  await page.getByRole('button',{name:'Alat potong (C)',exact:true}).click();
  const changed=await page.locator('.tool-modes .icon-button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.width];}));
  if(stage==='after')assert.deepEqual(changed,original,'switching tools does not shift adjacent controls');
  await page.getByRole('button',{name:'Pilih & geser (V)',exact:true}).click();
 }
 // Both panels can be widened independently; check the actual remaining editor width.
 await page.setViewportSize({width:1280,height:800});
 await page.getByRole('button',{name:'Tampilan workspace',exact:true}).click();
 for(const label of ['Lebar Media','Lebar Properti']){await page.getByRole('slider',{name:label,exact:true}).focus();await page.keyboard.press('End');}
 await page.keyboard.press('Escape');
 await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,350)));
 await capture('wide-panels');
 const crowded=await page.locator('.editing-toolbar,.timeline-meta').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className));
 checks.push({screen:'wide-panels',crowded});
 await page.getByRole('button',{name:'Tampilan workspace',exact:true}).click();
 const popover=await page.getByRole('dialog',{name:'Tampilan workspace',exact:true}).boundingBox();
 assert.ok(popover.x>=0&&popover.y>=0&&popover.x+popover.width<=1280&&popover.y+popover.height<=800,'workspace popover stays within the window');
 for(const label of ['Lebar Media','Lebar Properti']){await page.getByRole('slider',{name:label,exact:true}).focus();await page.keyboard.press('Home');}
 await page.keyboard.press('Escape');
 await page.getByRole('separator',{name:'Ubah lebar Media'}).dblclick();
 await page.getByRole('separator',{name:'Ubah lebar Properti'}).dblclick();
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('tab',{name:'Efek',exact:true}).click();
 for(const active of [false,true]) {
  if(active) {await page.getByRole('switch',{name:'Reverb',exact:true}).check();await page.getByRole('switch',{name:'Room',exact:true}).check();}
  for(const theme of ['dark','light']) {
   await appearance(theme);
   await capture(`effects-${active?'on':'off'}-${theme}`);
   const violations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;
   checks.push({theme,active,violations:violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))}))});
  }
 }
 await page.keyboard.press('Control+,');
 await page.getByRole('dialog',{name:'Pengaturan aplikasi',exact:true}).waitFor();
 await page.getByRole('radio',{name:'Terang',exact:true}).click();
 await capture('settings-light');
 const settingsViolations=(await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations;
 checks.push({screen:'settings',violations:settingsViolations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.html)}))});
 await fs.writeFile(`${folder}/report.json`,JSON.stringify({checks,errors},null,2));
 assert.equal(errors.length,0,'no application exceptions');
 if(stage==='after') {
  assert.ok(checks.every(c=>!c.crowded?.length),'toolbars fit at desktop widths');
  assert.ok(checks.every(c=>!c.violations?.length),'no automated accessibility violations');
 }
 console.log(`Saved ${stage} UI audit: ${checks.length} layout/accessibility cases.`);
} finally {await browser.close();await server.close();}

import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1100,height:900}});await page.goto('http://127.0.0.1:1422'); await page.getByRole('button', { name: 'Proyek baru', exact: true }).click();await page.getByRole('button',{name:'Buka sesi demo'}).click();
  const slider=await page.locator('.track-fader').first().evaluate(el=>el.outerHTML);
  await page.getByRole('button',{name:'Ekspor audio',exact:true}).click();const checkbox=await page.locator('.check-field').evaluate(el=>el.outerHTML);
  const css=await page.evaluate(()=>Array.from(document.styleSheets).flatMap(s=>Array.from(s.cssRules).map(r=>r.cssText)).join('\n'));
  await page.setContent('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>KurAudio controls</title><style>'+css+'\n.lab{max-width:56rem;margin:2rem auto;padding:1rem}.lab h1{font-size:1.25rem;margin-bottom:1.5rem}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.cell{padding:1rem;background:var(--surface-card);border:1px solid var(--border-default);border-radius:var(--radius-small)}.cell h2{font-size:.75rem;font-weight:500;margin-bottom:.75rem;color:var(--text-secondary)}.cell .check-field{margin:0}.cell .check-field small{display:none}.cell .track-fader{max-width:18rem}</style></head><body><main class="lab"><h1>KurAudio · control states</h1><div class="grid"></div></main></body></html>');
  await page.evaluate(({slider,checkbox})=>{
    const grid=document.querySelector('.grid');
    for(const [name,value,disabled] of [['Fader / 0 dB',0,false],['Fader / mute',-60,false],['Fader / +12 dB',12,false],['Fader / disabled',0,true],['Fader / hover',-12,false],['Fader / keyboard focus',-6,false]]){
      const cell=document.createElement('section');cell.className='cell';cell.innerHTML='<h2>'+name+'</h2>'+slider;const input=cell.querySelector('input');input.value=String(value);input.setAttribute('value',String(value));input.setAttribute('aria-label',name);input.setAttribute('aria-valuetext',value<=-60?'Mute':value+' dB');input.disabled=disabled;
      const fader=cell.querySelector('.track-fader');fader.style.setProperty('--fader-position',((value+60)/72*100)+'%');if(disabled)fader.classList.add('is-disabled');grid.append(cell);
    }
    for(const [name,checked,disabled] of [['Checkbox / off',false,false],['Checkbox / on',true,false],['Checkbox / disabled off',false,true],['Checkbox / disabled on',true,true]]){
      const cell=document.createElement('section');cell.className='cell';cell.innerHTML='<h2>'+name+'</h2>'+checkbox;const input=cell.querySelector('input');input.checked=checked;input.disabled=disabled;if(checked)input.setAttribute('checked','');else input.removeAttribute('checked');input.setAttribute('aria-label',name);grid.append(cell);
    }
  },{slider,checkbox});
  await fs.writeFile('test-results/controls/states.html',await page.content());
  await page.mouse.move(1090,1);await page.screenshot({path:'test-results/controls/states-default.png',fullPage:true});
  await page.getByRole('slider',{name:'Fader / keyboard focus',exact:true}).focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await page.getByRole('slider',{name:'Fader / hover',exact:true}).hover();
  await page.screenshot({path:'test-results/controls/states-focus-hover.png',fullPage:true});
  console.log('Control states captured at '+path.resolve('test-results/controls/states.html'));
}finally{await browser.close();}

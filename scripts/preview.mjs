import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const {version}=JSON.parse(await fs.readFile('package.json','utf8'));
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  await page.goto('http://127.0.0.1:1422');await page.getByRole('button',{name:'Proyek baru',exact:true}).click();await page.getByRole('heading',{name:'Timeline kosong'}).waitFor();await page.screenshot({path:`release/KurAudio-${version}-empty.png`});await page.getByRole('button',{name:'Buka sesi demo'}).click();
  await page.getByTestId('audio-clip').first().waitFor();await page.getByRole('button',{name:'Sesuaikan timeline (F)'}).click();
  await page.getByTestId('audio-clip').first().click({position:{x:60,y:50}});
  await page.getByRole('button',{name:'Sesuaikan timeline (F)'}).click();
  if(await page.getByRole('button',{name:'Tutup notifikasi'}).isVisible())await page.getByRole('button',{name:'Tutup notifikasi'}).click();
  await page.mouse.move(5,5);await page.screenshot({path:`release/KurAudio-${version}-preview.png`});
  await page.getByRole('tab',{name:'Efek',exact:true}).click();
  for(const [name,steps] of [['Denoise',2],['Reverb',3],['Room',4]]) {const slider=page.getByRole('slider',{name,exact:true});await slider.focus();for(let i=0;i<steps;i++)await slider.press('PageUp');}
  await page.mouse.move(5,5);await page.getByRole('tab',{name:'Efek',exact:true}).focus();await page.waitForTimeout(300);await page.screenshot({path:`release/KurAudio-${version}-effects.png`});
}finally{await browser.close();}

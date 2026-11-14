import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const {version}=JSON.parse(await fs.readFile('package.json','utf8'));
const folder=path.resolve('test-results/polish-native/release-smoke');
await fs.mkdir(folder,{recursive:true});
const exe=path.resolve(`release/KurAudio-${version}-windows/KurAudio.exe`);
const profile=path.join(folder,`profile-${Date.now()}`);
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const results=[],errors=[];
const check=(ok,name)=>{assert.ok(ok,name);results.push(name);console.log(`PASS ${name}`);};
const app=spawn(exe,[],{windowsHide:true,env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-allow-origins=*`}});
const exited=new Promise(resolve=>app.once('exit',code=>resolve(code)));
let browser;
try {
 for(let attempt=0;attempt<80;attempt++){
  if(app.exitCode!==null)throw Error('Release exited before its isolated WebView opened; another KurAudio instance may be running');
  try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{await new Promise(resolve=>setTimeout(resolve,200));}
 }
 assert.ok(browser,'release exposes its own isolated WebView');
 await fs.access(path.join(profile,'EBWebView'));
 const page=browser.contexts()[0].pages()[0];page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(String(error)));
 await page.getByRole('button',{name:'Proyek baru',exact:true}).waitFor();
 check((await page.locator('.home-footer').innerText()).trim()===version,'shipping executable displays the current version');
 check(await page.locator('.home-dropzone').isVisible(),'shipping executable includes the redesigned Home drop area');
 await page.getByRole('button',{name:'Proyek baru',exact:true}).click();
 await page.getByRole('button',{name:'Buka sesi demo',exact:true}).click();
 await page.getByTestId('audio-clip').first().click();
 check(await page.locator('.track-header').first().evaluate(el=>el.getBoundingClientRect().width===176),'shipping timeline uses the new track-header geometry');
 const tools=()=>page.locator('.tool-modes .icon-button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return [r.x,r.width];}));
 const before=await tools();await page.getByRole('button',{name:'Alat potong (C)',exact:true}).click();
 check(JSON.stringify(before)===JSON.stringify(await tools()),'shipping toolbar stays stable when changing tools');
 await page.keyboard.press('Space');await page.getByRole('button',{name:'Jeda (Space)',exact:true}).waitFor();
 await page.keyboard.press('Space');await page.getByRole('button',{name:'Putar (Space)',exact:true}).waitFor();
 check(true,'shipping Space shortcut plays and pauses after using a tool');
 await page.screenshot({path:path.join(folder,'KurAudio-release.png')});
 await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|close',{label:'main'}));
 await page.getByRole('dialog',{name:'Simpan perubahan?',exact:true}).waitFor();
 await page.getByRole('button',{name:'Lanjut tanpa simpan',exact:true}).click();
 let timer;const code=await Promise.race([exited,new Promise(resolve=>timer=setTimeout(()=>resolve(null),6000))]);clearTimeout(timer);
 check(code===0,'shipping executable closes normally after discarding the demo');
 check(errors.length===0,'shipping smoke test has no renderer errors');
 await fs.writeFile(path.join(folder,'results.json'),JSON.stringify({exe,version,profile,checks:results.length,results,errors},null,2));
} finally {if(browser)await browser.close().catch(()=>{});if(app.exitCode===null)app.kill();}

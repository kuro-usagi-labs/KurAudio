import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const native = process.argv.includes('--native'), picker = process.argv.includes('--picker');
const folder = path.resolve('test-results/home-screen'); await fs.mkdir(folder, { recursive: true });
const rate = 16000, samples = rate * 2, wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / 11) * 10000), 44 + i * 2);
const project = { id: 'home-test-project', name: 'Proyek Uji Beranda', sampleRate: 48000, tracks: [{ id: 'voice', name: 'Voice', color: 0, gain: 1, muted: false, solo: false }], assets: [{ id: 'voice-asset', name: 'voice.wav', duration: 2, sampleRate: rate, channels: 1 }], clips: [{ id: 'voice-clip', assetId: 'voice-asset', trackId: 'voice', name: 'Voice', start: 1.25, offset: 0.25, duration: 1.5, gain: 1, fadeIn: 0.1, fadeOut: 0.1 }] };
const content = JSON.stringify({ format: 'kuraudio', version: 1, project, media: [{ id: 'voice-asset', data: wav.toString('base64') }] });
const file = path.join(folder, 'beranda-test.kura'); await fs.writeFile(file, content);
const results = [], errors = []; let browser, app;
const check = (value, name) => { assert.ok(value, name); results.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const readRecovery = page => page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('KurAudio', 1); request.onsuccess = () => { const db = request.result, get = db.transaction('recovery').objectStore('recovery').get('session'); get.onsuccess = () => { resolve(get.result ?? null); db.close(); }; get.onerror = () => reject(get.error); }; request.onerror = () => reject(request.error); }));
try {
  if (native) {
    const profile = path.join(folder, `native-${Date.now()}`);
    app = spawn(path.resolve(process.env.KURAUDIO_TEST_EXE), [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9235 --remote-allow-origins=*' } });
    for (let i = 0; i < 70; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9235'); break; } catch { if (app.exitCode !== null) break; await delay(200); } }
    assert.ok(browser, 'isolated native home test starts'); await fs.access(path.join(profile, 'EBWebView'));
  } else browser = await chromium.launch();
  const context = native ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, acceptDownloads: true });
  const page = native ? context.pages()[0] : await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  if (!native) await page.goto('http://127.0.0.1:1422');
  const home = page.getByTestId('home-screen'), create = page.getByRole('button', { name: 'Proyek baru', exact: true });
  await create.waitFor(); await page.waitForFunction(() => !document.querySelector('.home-screen').inert);
  check(await home.isVisible() && await page.locator('.workspace,.timeline').count() === 0, 'startup shows project choices without mounting the timeline');
  await page.waitForTimeout(1100); check(await readRecovery(page) === null, 'waiting on Home does not create an empty autosave session');
  check(await create.evaluate(el => el === document.activeElement), 'startup keyboard focus goes to New project');
  await page.keyboard.press('Tab'); check(await page.getByRole('button', { name: 'Buka dari berkas', exact: true }).evaluate(el => el === document.activeElement), 'Tab reaches Open from file');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await fs.writeFile(path.join(folder, native ? 'native-axe.json' : 'axe.json'), JSON.stringify(axe.violations, null, 2)); check(axe.violations.length === 0, 'homescreen has no automated WCAG A/AA violations');
  await page.mouse.move(5, 5); await page.screenshot({ path: path.join(folder, native ? 'native-home.png' : 'desktop.png') });
  if (picker) {
    assert.ok(native);
    await page.getByRole('button', { name: 'Buka dari berkas', exact: true }).click();
    console.log(`READY_OPEN_PICKER ${file}`);
    await page.getByLabel('Nama proyek', { exact: true }).waitFor({ timeout: 180000 });
    check(await page.getByLabel('Nama proyek', { exact: true }).inputValue() === project.name && await page.getByTestId('audio-clip').count() === 1, 'actual Windows file picker opens the complete project from Home');
    await page.getByRole('button', { name: 'Beranda KurAudio', exact: true }).click(); await create.waitFor();
    await page.getByRole('button', { name: 'Buka dari berkas', exact: true }).click(); await page.locator('.busy-overlay').waitFor(); console.log('READY_CANCEL_PICKER');
    await page.waitForFunction(() => !document.querySelector('.busy-overlay'), { timeout: 180000 });
    check(await home.isVisible(), 'cancelling the actual Windows picker returns to Home');
  } else {
    if (!native) {
      for (const width of [320, 390, 900, 1280, 1440]) {
        await page.setViewportSize({ width, height: width < 640 ? 740 : 900 }); await page.screenshot({ path: path.join(folder, `home-${width}.png`) });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `homescreen fits ${width}px without horizontal overflow`);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await fs.writeFile(path.join(folder, 'harness.html'), await page.evaluate(() => {
        const body = document.body.cloneNode(true); body.querySelectorAll('script').forEach(el => el.remove()); const css = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('\n');
        return `<!doctype html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body.innerHTML}</body></html>`;
      }));
      const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Buka dari berkas', exact: true }).click(); await (await chooser).setFiles([]);
      check(await home.isVisible(), 'cancelling the browser file chooser keeps the homescreen');
      const shortcutChooser = page.waitForEvent('filechooser'); await page.keyboard.press('Control+o'); await (await shortcutChooser).setFiles([]); check(await home.isVisible(), 'Ctrl+O invokes the file chooser from Home');
    }
    await page.keyboard.press('Control+n'); await page.locator('.workspace').waitFor();
    check(await page.getByTestId('audio-clip').count() === 0 && await page.locator('.track-row').count() === 3, 'Ctrl+N creates a clean project with the standard tracks');
    check(await page.getByRole('heading', { name: 'Editor audio', exact: true }).evaluate(el => el === document.activeElement), 'entering the editor moves keyboard focus to its named heading');
    await page.getByRole('button', { name: 'Beranda KurAudio', exact: true }).click(); await create.waitFor();
    check(await home.isVisible() && await page.getByRole('dialog').count() === 0, 'a clean editor returns to Home without an unsaved prompt');
    await page.getByTestId('project-input').setInputFiles({ name: 'broken.kura', mimeType: 'application/json', buffer: Buffer.from('{broken') }); await page.getByRole('alert').waitFor();
    check(await home.isVisible() && await page.locator('.workspace').count() === 0, 'an invalid project reports its error and keeps Home usable');
    await page.getByRole('button', { name: 'Tutup notifikasi', exact: true }).click();
    if (native) await page.getByTestId('project-input').setInputFiles(file);
    else { const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Buka dari berkas', exact: true }).click(); await (await chooser).setFiles(file); }
    await page.getByTestId('audio-clip').waitFor();
    check(await page.getByLabel('Nama proyek', { exact: true }).inputValue() === project.name && await page.locator('.asset-item').count() === 1, 'loading a .kura restores project name and embedded audio');
    check(await page.getByTestId('audio-clip').evaluate(el => Math.abs(parseFloat(el.style.left) - 60) < 0.1 && Math.abs(parseFloat(el.style.width) - 72) < 0.1), 'opening preserves exact clip timing');
    await page.getByRole('button', { name: 'Putar (Space)', exact: true }).click(); await page.waitForTimeout(200); await page.getByRole('button', { name: 'Jeda (Space)', exact: true }).click();
    check(await page.getByLabel('Waktu playhead').textContent() !== '00:00.000', 'loaded project audio plays through the real audio clock');
    await page.getByLabel('Nama proyek', { exact: true }).fill('Perubahan belum disimpan');
    await page.getByRole('button', { name: 'Beranda KurAudio', exact: true }).click(); await page.getByRole('dialog', { name: 'Simpan perubahan?' }).waitFor();
    check(await page.locator('.workspace').isVisible(), 'returning Home with edits requires the existing save decision');
    await page.getByRole('button', { name: 'Batal', exact: true }).click(); await page.waitForTimeout(200);
    check(await page.getByLabel('Nama proyek', { exact: true }).inputValue() === 'Perubahan belum disimpan', 'Cancel keeps the complete current project');
    await page.getByRole('button', { name: 'Beranda KurAudio', exact: true }).click(); await page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click(); await create.waitFor();
    await page.waitForTimeout(1100); check(await readRecovery(page) === null, 'approved discard returns Home and clears only the owned recovery session');
    // Both .kura drop and a second new session use the same project-open path.
    await home.evaluate((el, content) => { const transfer = new DataTransfer(); transfer.items.add(new File([content], 'dropped.kura', { type: 'application/json' })); el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); }, content);
    await page.getByTestId('audio-clip').waitFor(); check(await page.getByLabel('Nama proyek', { exact: true }).inputValue() === project.name, 'dropping a .kura onto Home opens its project');
    await page.getByRole('button', { name: 'Beranda KurAudio', exact: true }).click(); await create.waitFor();
    if (!native) {
      await create.click(); await page.getByLabel('Nama proyek', { exact: true }).fill('Saved from Home flow');
      await page.getByRole('button', { name: 'Beranda KurAudio', exact: true }).click(); const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Simpan & lanjut', exact: true }).click(); const result = await download; await create.waitFor();
      const saved = JSON.parse(await fs.readFile(await result.path(), 'utf8')); check(saved.project.name === 'Saved from Home flow' && await home.isVisible(), 'Save and continue writes the project before returning Home');
      await page.reload(); await create.waitFor(); check(await home.isVisible() && await page.getByRole('dialog').count() === 0, 'relaunch after returning Home does not show spurious recovery');
      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); await create.waitFor();
      check(await page.locator('.home-main').evaluate(el => getComputedStyle(el).opacity === '1' && Number.parseFloat(getComputedStyle(el).animationDuration) < 0.001), 'Reduce Motion shows Home immediately without a lingering entrance');
    }
  }
  if (native) {
    const exited = new Promise(resolve => app.once('exit', code => resolve(code))); await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
    let timer; const code = await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), 4000); })]); clearTimeout(timer); check(code === 0, 'closing the homescreen terminates the real Windows process');
  }
  check(errors.length === 0, 'home navigation and project loading produce no renderer errors');
  await fs.writeFile(path.join(folder, picker ? 'picker-results.json' : native ? 'native-results.json' : 'results.json'), JSON.stringify({ checks: results.length, results, errors }, null, 2));
  console.log(`RESULT: ${results.length} homescreen checks passed`);
} finally { if (browser) await browser.close().catch(() => {}); if (app && app.exitCode === null) app.kill(); }

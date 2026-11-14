import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const native = process.argv.includes('--native'), baseline = process.argv.includes('--baseline');
const folder = path.resolve('test-results/timeline-scroll'); await fs.mkdir(folder, { recursive: true });
const wav = Buffer.alloc(44 + 16000 * 30 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 16000 * 30; i++) wav.writeInt16LE(Math.round(Math.sin(i / 13) * 9000 * (0.4 + 0.3 * Math.sin(i / 3000))), 44 + i * 2);
const wavPath = path.join(folder, 'scroll-test.wav'); await fs.writeFile(wavPath, wav);
let browser, app, results = [], failures = [];
const check = (value, name) => { assert.ok(value, name); results.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (native) {
    const profile = path.join(folder, `native-${Date.now()}`);
    app = spawn(path.resolve('src-tauri/target/release/kuraudio.exe'), [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9229 --remote-allow-origins=*' } });
    for (let i = 0; i < 60; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9229'); break; } catch { if (app.exitCode !== null) break; await delay(200); } }
    assert.ok(browser, 'isolated native instance starts'); await fs.access(path.join(profile, 'EBWebView'));
  } else browser = await chromium.launch();
  const variants = native ? [{ label: 'native' }] : baseline ? [{ label: 'baseline', width: 1440, height: 900, dpr: 1.25 }] : [{ label: 'desktop-125', width: 1440, height: 900, dpr: 1.25 }, { label: 'compact-200', width: 900, height: 620, dpr: 2 }];
  for (const variant of variants) {
    const context = native ? browser.contexts()[0] : await browser.newContext({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: variant.dpr });
    const page = native ? context.pages()[0] : await context.newPage(); page.on('pageerror', e => failures.push(String(e)));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (!native) await page.goto('http://127.0.0.1:1422'); await page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await page.locator('.workspace').waitFor();
    await page.getByTestId('audio-input').setInputFiles(wavPath); await page.locator('.asset-item').first().waitFor(); await page.locator('.asset-item').first().press('Enter'); await page.getByTestId('audio-clip').first().waitFor();
    // Close the inspector to exercise the full visible timeline width.
    if (await page.getByRole('button', { name: 'Tutup properti', exact: true }).isVisible()) await page.getByRole('button', { name: 'Tutup properti', exact: true }).click();
    await page.mouse.move(10, 10); await page.waitForTimeout(150);
    const scroll = page.getByTestId('timeline-scroll'), marker = page.getByTestId('playhead'), header = page.locator('.track-header').first();
    const geometry = () => page.evaluate(() => {
      const scroller = document.querySelector('.timeline-scroll'), header = document.querySelector('.track-header').getBoundingClientRect(), marker = document.querySelector('.playhead').getBoundingClientRect();
      const scale = Number(document.querySelector('.zoom-controls > span').textContent.replace('%', '')) / 100 * 48;
      return { scroll: scroller.scrollLeft, boundary: header.right, right: scroller.getBoundingClientRect().left + scroller.clientWidth, x: marker.left, y: marker.top, width: scroller.clientWidth - header.width, scale };
    });
    await scroll.evaluate(el => { el.scrollLeft = 80; }); await page.waitForTimeout(120);
    const before = await header.screenshot(); await marker.evaluate(el => { el.style.visibility = 'hidden'; }); const hidden = await header.screenshot(); await marker.evaluate(el => { el.style.visibility = ''; });
    await page.screenshot({ path: path.join(folder, `${variant.label}-scrolled.png`) });
    const unchangedHeader = before.equals(hidden);
    await page.getByRole('button', { name: 'Putar (Space)', exact: true }).click(); await page.waitForTimeout(200);
    const playing = await geometry();
    if (baseline) {
      const evidence = { playheadPaintsOverTrackHeader: !unchangedHeader, playbackScrollLeft: playing.scroll, playheadInsideTrackHeader: playing.x < playing.boundary, failures };
      assert.ok(evidence.playheadPaintsOverTrackHeader && evidence.playheadInsideTrackHeader && evidence.playbackScrollLeft > 0, 'original overlap and missing left follow reproduced');
      await fs.writeFile(path.join(folder, 'baseline.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); break;
    }
    check(unchangedHeader, `${variant.label}: a scrolled-off playhead paints no pixels over track controls`);
    check(playing.scroll === 0 && playing.x >= playing.boundary - 1, `${variant.label}: playback starting left of the viewport returns to the audio area`);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Perbesar timeline (+)', exact: true }).click();
    await scroll.evaluate(el => { el.scrollLeft = 2400; }); await page.waitForTimeout(100);
    const scrolled = await geometry(), ruler = await page.getByRole('slider', { name: 'Posisi playhead', exact: true }).boundingBox();
    await page.mouse.click(scrolled.boundary + 110, ruler.y + 10); await page.getByRole('button', { name: 'Putar (Space)', exact: true }).click(); await page.waitForTimeout(150);
    const followStart = await geometry();
    // Put the playing cursor near the visible right edge using the actual scrollbar.
    await scroll.evaluate((el, g) => { el.scrollLeft = (g.x - g.boundary + g.scroll) - g.width + 10; }, followStart); await page.waitForTimeout(180);
    const followed = await geometry();
    check(followed.scroll > followStart.scroll && followed.x >= followed.boundary && followed.x < followed.right - 20, `${variant.label}: playback scrolls forward before the cursor leaves the audio viewport`);
    await page.getByRole('button', { name: 'Jeda (Space)', exact: true }).click();
    const aligned = await page.evaluate(() => {
      const scroller = document.querySelector('.timeline-scroll'), lane = document.querySelector('.track-lane').getBoundingClientRect(), marker = document.querySelector('.playhead').getBoundingClientRect();
      const value = document.querySelector('.ruler-seek').getAttribute('aria-valuenow'), scale = parseFloat(document.querySelector('.audio-clip').style.width) / 30;
      return Math.abs(marker.left - (lane.left + Number(value) * scale)) < 1 && scroller.scrollLeft > 0;
    });
    check(aligned, `${variant.label}: paused playhead uses the same time origin as the waveform and ruler`);
    await page.getByRole('button', { name: 'Snapping (N)', exact: true }).focus(); await page.keyboard.press('Home');
    const home = await geometry(); check(home.scroll === 0 && Math.abs(home.x - home.boundary) < 1, `${variant.label}: Home returns the viewport and cursor to zero`);
    await page.keyboard.press('End'); const end = await geometry();
    check(end.scroll > 0 && end.x >= end.boundary && end.x <= end.right, `${variant.label}: End reveals the project end instead of leaving an offscreen cursor`);
    await page.getByRole('button', { name: 'Putar (Space)', exact: true }).click(); await page.waitForTimeout(160);
    check((await geometry()).scroll === 0, `${variant.label}: replay from the end returns the timeline to the start`);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Tambah track', exact: true }).click();
    await scroll.evaluate(el => { el.scrollTop = 400; }); await page.waitForTimeout(120);
    const cap = await page.locator('.playhead-cap').boundingBox(), rulerRow = await page.locator('.ruler-row').boundingBox();
    check(cap.y >= rulerRow.y && cap.y < rulerRow.y + rulerRow.height, `${variant.label}: vertical scrolling keeps the cursor cap in the sticky time ruler`);
    const box = await scroll.boundingBox(); await page.mouse.move(box.x + box.width - 100, box.y + 80); await page.keyboard.down('Control'); await page.mouse.wheel(0, 200); await page.keyboard.up('Control'); await page.waitForTimeout(100);
    const zoomed = await geometry();
    check(zoomed.scale < 240 && await page.getByTestId('audio-clip').count() === 1, `${variant.label}: scroll and zoom preserve the actual clip`);
    await page.screenshot({ path: path.join(folder, `${variant.label}-fixed.png`) });
    await scroll.evaluate(el => { el.scrollTop = 0; }); await page.getByRole('button', { name: 'Ke awal (Home)', exact: true }).click(); await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(folder, `${variant.label}-start.png`) });
    if (native) {
      const exit = new Promise(resolve => app.once('exit', code => resolve(code)));
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })); await page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click();
      let timer; const code = await Promise.race([exit, new Promise(resolve => { timer = setTimeout(() => resolve(null), 4000); })]); clearTimeout(timer); check(code === 0, 'native: the timeline fix retains normal close and discard');
    } else await context.close();
  }
  if (!baseline) { check(failures.length === 0, 'scrolling and playback produce no renderer errors'); await fs.writeFile(path.join(folder, native ? 'native-results.json' : 'results.json'), JSON.stringify({ checks: results.length, results, failures }, null, 2)); console.log(`RESULT: ${results.length} timeline checks passed`); }
} finally { if (browser) await browser.close().catch(() => {}); if (app && app.exitCode === null) app.kill(); }

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const native = process.argv.includes('--native'), folder = path.resolve('test-results/track-workflow');
await fs.mkdir(folder, { recursive: true });
const rate = 16000, frames = rate * 4, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i / 11) * 0.4 * 32767), 44 + i * 2);
const fixture = path.join(folder, 'workflow.wav'); await fs.writeFile(fixture, wav);
const results = [], errors = [];
const check = (value, name) => { assert.ok(value, name); results.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, app;
try {
  if (native) {
    const profile = path.join(folder, `native-${Date.now()}`);
    app = spawn(path.resolve(process.env.KURAUDIO_TEST_EXE), [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9234 --remote-allow-origins=*' } });
    for (let i = 0; i < 70; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9234'); break; } catch { if (app.exitCode !== null) break; await delay(200); } }
    assert.ok(browser, 'isolated native workflow test starts'); await fs.access(path.join(profile, 'EBWebView'));
  } else browser = await chromium.launch();
  const context = native ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.25 });
  const page = native ? context.pages()[0] : await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  if (!native) await page.goto('http://127.0.0.1:1422');
  await page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await page.locator('.workspace').waitFor();
  if (!native) await page.evaluate(() => { window.__kurModel = performance.getEntriesByType('resource').find(e => new URL(e.name).pathname === '/src/model.ts').name; });
  const state = () => page.evaluate(async () => (await import(window.__kurModel)).editor.get());
  const tracks = () => page.locator('.track-row').count();
  const clips = () => page.getByTestId('audio-clip').count();
  const bottom = page.getByTestId('new-track-drop'), clip = page.getByTestId('audio-clip').first();
  const undo = async () => { await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await page.waitForTimeout(100); };
  const redo = async () => { await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click(); await page.waitForTimeout(100); };
  const resetScroll = async () => { await page.getByTestId('timeline-scroll').evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; }); await page.waitForTimeout(70); };
  const dropMedia = async (target, position) => { await page.locator('.asset-item').first().dragTo(target, { targetPosition: position }); await page.waitForTimeout(350); };
  await page.getByTestId('audio-input').setInputFiles(fixture); await page.locator('.asset-item').first().waitFor(); await page.waitForTimeout(250);
  check(await tracks() === 3 && await clips() === 0, 'importing into Media still leaves the timeline empty');
  await dropMedia(bottom, { x: 248, y: 45 });
  check(await tracks() === 4 && await clips() === 1, 'dropping Media below the final track creates one track and one clip');
  check(await clip.evaluate(el => el.parentElement.dataset.trackId === document.querySelectorAll('.track-lane')[3].dataset.trackId && Math.abs(parseFloat(el.style.left) - 96) < 1), 'new-track drop uses the horizontal timeline position');
  await undo(); check(await tracks() === 3 && await clips() === 0 && await page.locator('.asset-item').count() === 1, 'one Undo removes the new track and placement while keeping imported Media');
  await redo(); check(await tracks() === 4 && await clips() === 1, 'Redo restores the complete new-track drop');
  await undo(); await resetScroll(); await dropMedia(page.getByTestId('lane-0'), { x: 96, y: 45 });
  check(await tracks() === 3 && await clips() === 1, 'dropping Media on an existing lane reuses that track');
  await page.getByRole('button', { name: 'Snapping (N)', exact: true }).click();
  let bounds = await clip.boundingBox(), below = await bottom.boundingBox();
  await page.mouse.move(bounds.x + 50, bounds.y + 55); await page.mouse.down(); await page.mouse.move(bounds.x + 74, below.y + 45, { steps: 12 });
  check(await bottom.evaluate(el => el.classList.contains('is-drop-target')) && await tracks() === 3, 'held clip drag previews a new track without modifying the project');
  await page.screenshot({ path: path.join(folder, native ? 'native-held.png' : 'held.png') });
  if (!native) await fs.writeFile(path.join(folder, 'held-harness.html'), await page.evaluate(() => {
    const body = document.body.cloneNode(true); body.querySelectorAll('script').forEach(el => el.remove());
    const css = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('\n');
    return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body.innerHTML}</body></html>`;
  }));
  await page.mouse.up(); await page.waitForTimeout(300);
  check(await tracks() === 4 && await clips() === 1 && await page.getByTestId('lane-3').locator('.audio-clip').count() === 1, 'dragging an existing clip below creates a track and moves the original clip');
  await undo(); check(await tracks() === 3 && await page.getByTestId('lane-0').locator('.audio-clip').count() === 1, 'one Undo restores the moved clip and removes its new track');
  await resetScroll(); bounds = await clip.boundingBox(); below = await bottom.boundingBox();
  await page.mouse.move(bounds.x + 50, bounds.y + 55); await page.mouse.down(); await page.mouse.move(bounds.x + 50, below.y + 45, { steps: 10 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  check(await tracks() === 3 && await page.getByTestId('lane-0').locator('.audio-clip').count() === 1 && !await bottom.evaluate(el => el.classList.contains('is-drop-target')), 'Escape cancels a new-track drag and clears its highlight');
  // An actual audio file dropped from outside creates the track only after decoding succeeds.
  await bottom.evaluate((el, bytes) => { const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(bytes)], 'outside.wav', { type: 'audio/wav' })); const lane = el.querySelector('.new-track-lane').getBoundingClientRect(); el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: lane.left + 144, clientY: lane.top + 40, dataTransfer: transfer })); }, [...wav]);
  await page.waitForFunction(() => document.querySelectorAll('.track-row').length === 4);
  check(await clips() === 2 && await page.getByTestId('lane-3').locator('.audio-clip').count() === 1, 'dropping an external audio file below creates a track and places its decoded audio');
  await undo(); check(await tracks() === 3 && await clips() === 1 && await page.locator('.asset-item').count() === 1, 'external import and new track undo together');
  await resetScroll();
  await bottom.evaluate(el => { const transfer = new DataTransfer(); transfer.items.add(new File(['invalid'], 'broken.wav', { type: 'audio/wav' })); el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); });
  await page.locator('.toast.error').waitFor();
  check(await tracks() === 3 && await clips() === 1, 'failed decoding never leaves an empty new track');
  await page.getByRole('button', { name: 'Tutup notifikasi', exact: true }).click();
  // Pause and split while the clip itself retains keyboard focus.
  await clip.click({ position: { x: 40, y: 55 } });
  await page.getByRole('slider', { name: 'Posisi playhead', exact: true }).click({ position: { x: 120, y: 15 } }); await clip.focus();
  await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Jeda (Space)', exact: true }).waitFor();
  await page.waitForTimeout(300); await page.keyboard.press('Space'); await page.getByRole('button', { name: 'Putar (Space)', exact: true }).waitFor();
  check(await clip.evaluate(el => el === document.activeElement), 'Space starts and pauses playback while a clip keeps keyboard focus');
  const playhead = await page.getByRole('slider', { name: 'Posisi playhead', exact: true }).getAttribute('aria-valuenow');
  const beforeSplit = !native ? (await state()).project.clips[0] : null;
  await page.keyboard.press('Control+b'); await page.waitForTimeout(100);
  check(await clips() === 2, 'Ctrl+B splits the selected clip at the paused playhead');
  const geometry = await page.getByTestId('audio-clip').evaluateAll(elements => elements.map(el => ({ left: parseFloat(el.style.left), width: parseFloat(el.style.width) })).sort((a, b) => a.left - b.left));
  check(Math.abs(geometry[1].left / 48 - Number(playhead)) < 0.002 && Math.abs(geometry[0].left + geometry[0].width - geometry[1].left) < 0.1, 'both split edges meet exactly at the playhead without shifting audio');
  if (!native) { const pieces = (await state()).project.clips; check(Math.abs(pieces[1].offset - pieces[0].offset - pieces[0].duration) < 1e-8 && pieces[0].assetId === beforeSplit.assetId && pieces[1].assetId === beforeSplit.assetId, 'cut retains exact source continuity and original media'); }
  await undo(); check(await clips() === 1, 'one Undo reverses the playhead cut');
  await clip.focus(); await page.keyboard.press('s'); check(await clips() === 2, 'the existing S shortcut remains available');
  await undo();
  const name = page.getByLabel('Nama track 1', { exact: true }); await name.focus(); await page.keyboard.press('Control+b'); check(await clips() === 1, 'Ctrl+B does not edit the timeline while typing a track name');
  await clip.focus(); await page.keyboard.press('Control+b'); await page.waitForTimeout(200);
  const right = page.getByTestId('audio-clip').nth(1); bounds = await right.boundingBox();
  await page.mouse.move(bounds.x + Math.min(25, bounds.width / 2), bounds.y + 55); await page.mouse.down(); await page.mouse.move(bounds.x + Math.min(25, bounds.width / 2) + 48, bounds.y + 55, { steps: 7 }); await page.mouse.up();
  check(await right.evaluate((el, originalLeft) => Math.abs(parseFloat(el.style.left) - originalLeft - 48) < 0.5, geometry[1].left), 'the right-hand piece can be moved immediately after cutting');
  await page.screenshot({ path: path.join(folder, native ? 'native-cut-and-move.png' : 'cut-and-move.png') });
  if (!native) {
    // No selection cuts every intersected clip, without touching clips outside the playhead.
    await page.evaluate(async () => { const { editor, makeClip, makeTrack } = await import(window.__kurModel); const p = structuredClone(editor.get().project); p.tracks = p.tracks.slice(0, 3); p.clips = [makeClip(p.assets[0], p.tracks[0].id, 1), makeClip(p.assets[0], p.tracks[1].id, 1), makeClip(p.assets[0], p.tracks[2].id, 10)]; editor.load(p); editor.select([]); });
    await resetScroll(); const ruler = page.getByRole('slider', { name: 'Posisi playhead', exact: true }); await ruler.click({ position: { x: 120, y: 15 } }); await page.keyboard.press('Control+b');
    check(await clips() === 5, 'with no selection Ctrl+B cuts every clip crossed by the playhead');
    await page.keyboard.press('Control+z');
    await page.evaluate(async () => { const { editor, makeTrack } = await import(window.__kurModel); const p = structuredClone(editor.get().project); while (p.tracks.length < 8) p.tracks.push(makeTrack(p.tracks.length)); editor.load(p); });
    await resetScroll();
    const scroller = page.getByTestId('timeline-scroll'), viewport = await scroller.boundingBox(); bounds = await clip.boundingBox();
    await page.mouse.move(bounds.x + 35, bounds.y + 55); await page.mouse.down(); await page.mouse.move(bounds.x + 35, viewport.y + viewport.height - 3, { steps: 10 });
    await page.waitForTimeout(400);
    check(await scroller.evaluate(el => el.scrollTop) > 40, 'holding a clip at the lower viewport edge scrolls toward later tracks');
    await page.keyboard.press('Escape'); await page.mouse.up();
    check(await scroller.evaluate(el => el.scrollTop) === 0 && await tracks() === 8, 'cancelling a vertically scrolling drag restores the viewport without creating a track');
    await resetScroll(); bounds = await clip.boundingBox();
    await page.mouse.move(bounds.x + 35, bounds.y + 55); await page.mouse.down(); await page.mouse.move(bounds.x + 35, viewport.y + viewport.height - 3, { steps: 10 });
    await page.waitForFunction(() => document.querySelector('.track-bottom').classList.contains('is-drop-target'), { timeout: 5000 });
    await page.mouse.up(); await page.waitForTimeout(100);
    check(await tracks() === 9 && await page.getByTestId('lane-8').locator('.audio-clip').count() === 1, 'vertical drag reaches the bottom and creates the destination track');
    await undo();
    // Existing limits are enforced for both library drops and pointer drags.
    await page.evaluate(async () => { const { editor, makeTrack } = await import(window.__kurModel); const p = structuredClone(editor.get().project); while (p.tracks.length < 128) p.tracks.push(makeTrack(p.tracks.length)); editor.load(p); });
    await bottom.evaluate(el => el.scrollIntoView({ block: 'end' }));
    await bottom.evaluate(el => { const transfer = new DataTransfer(); transfer.setData('application/kuraudio-asset', document.querySelector('.asset-item').dataset.assetId); el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })); });
    check(await tracks() === 128 && await clips() === 3 && await page.getByRole('button', { name: 'Tambah track', exact: true }).isDisabled(), 'new-track drops respect the 128-track limit');
    await page.evaluate(async () => { const { editor } = await import(window.__kurModel); const p = structuredClone(editor.get().project); p.tracks = p.tracks.slice(0, 3); editor.load(p); });
    await resetScroll();
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  await fs.writeFile(path.join(folder, native ? 'native-axe.json' : 'axe.json'), JSON.stringify(axe.violations, null, 2)); check(axe.violations.length === 0, 'workflow controls have no automated WCAG A/AA violations');
  if (native) {
    const exited = new Promise(resolve => app.once('exit', code => resolve(code)));
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })); await page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click();
    let timer; const code = await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), 4000); })]); clearTimeout(timer); check(code === 0, 'native workflow still closes normally after discard');
  }
  check(errors.length === 0, 'track creation and playhead cutting produce no renderer errors');
  await fs.writeFile(path.join(folder, native ? 'native-results.json' : 'results.json'), JSON.stringify({ checks: results.length, results, errors }, null, 2));
  console.log(`RESULT: ${results.length} workflow checks passed`);
} finally { if (browser) await browser.close().catch(() => {}); if (app && app.exitCode === null) app.kill(); }

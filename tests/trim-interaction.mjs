import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const baseline = process.argv.includes('--baseline'), native = process.argv.includes('--native');
const folder = path.resolve('test-results/trim-interaction'); await fs.mkdir(folder, { recursive: true });
const rate = 16000, frames = rate * 8, wav = Buffer.alloc(44 + frames * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
for (let i = 0; i < frames; i++) { const t = i / rate, amplitude = 0.03 + 0.8 * Math.exp(-Math.pow((t - 2.4) / 0.23, 2)) + 0.5 * Math.exp(-Math.pow((t - 4.9) / 0.47, 2)); wav.writeInt16LE(Math.round(Math.sin(i / 11) * amplitude * 32767), 44 + i * 2); }
const fixture = path.join(folder, 'landmarks.wav'); await fs.writeFile(fixture, wav);
const results = [], errors = []; let browser, app;
const check = (value, name) => { assert.ok(value, name); results.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  if (native) {
    const profile = path.join(folder, `native-${Date.now()}`);
    app = spawn(path.resolve(process.env.KURAUDIO_TEST_EXE || 'src-tauri/target/release/kuraudio.exe'), [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9230 --remote-allow-origins=*' } });
    for (let i = 0; i < 70; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9230'); break; } catch { if (app.exitCode !== null) break; await delay(200); } }
    assert.ok(browser, 'isolated native trim test starts'); await fs.access(path.join(profile, 'EBWebView'));
  } else browser = await chromium.launch();
  const variants = native ? [{ name: 'native' }] : baseline ? [{ name: 'baseline', dpr: 1.25 }] : [{ name: '125', dpr: 1.25 }, { name: '200', dpr: 2 }];
  for (const variant of variants) {
    const context = native ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: variant.dpr, recordVideo: { dir: folder, size: { width: 1440, height: 900 } } });
    const page = native ? context.pages()[0] : await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
    await page.emulateMedia({ reducedMotion: 'no-preference' }); if (!native) await page.goto(process.env.KURAUDIO_TEST_URL || 'http://127.0.0.1:1422'); await page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await page.locator('.workspace').waitFor();
    await page.getByTestId('audio-input').setInputFiles(fixture); await page.locator('.asset-item').first().waitFor(); await page.waitForTimeout(250);
    await page.locator('.asset-item').first().dragTo(page.getByTestId('lane-0'), { targetPosition: { x: 96, y: 45 } });
    const clip = page.getByTestId('audio-clip').first(); await clip.waitFor(); await page.waitForTimeout(400);
    const snapshot = () => clip.evaluate(el => {
      const canvas = el.querySelector('canvas'), source = canvas.parentElement.getBoundingClientRect(), bounds = el.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width, offset: Number(canvas.dataset.sourceOffset), duration: Number(canvas.dataset.sourceDuration), pixels: canvas.toDataURL(), sourceLeft: source.left, sourceWidth: source.width, scrollLeft: el.closest('.timeline-scroll').scrollLeft, trimming: el.classList.contains('trimming'), opacity: Number(getComputedStyle(el).opacity), entryRunning: el.getAnimations().some(a => a.animationName === 'clip-arrive' && a.playState === 'running') };
    });
    const before = await snapshot(), box = await clip.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 58); await page.mouse.down(); await page.mouse.move(box.x + 54, box.y + 58, { steps: 8 }); await page.waitForTimeout(80);
    const nearEdge = await snapshot(); await page.mouse.up(); const released = await snapshot();
    if (baseline) {
      const evidence = { nearEdgeMovedWholeClip: !nearEdge.trimming && Math.abs(nearEdge.width - before.width) < 1 && nearEdge.left > before.left + 20, releaseReplaysEntryAnimation: released.entryRunning || released.opacity < 0.7 };
      assert.ok(evidence.nearEdgeMovedWholeClip && evidence.releaseReplaysEntryAnimation); await fs.writeFile(path.join(folder, 'baseline.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); break;
    }
    check(nearEdge.trimming && nearEdge.offset > 0.5 && Math.abs(nearEdge.right - before.right) < 0.5, `${variant.name}: grabbing within ten pixels of the edge trims instead of moving the clip`);
    check(!released.entryRunning && released.opacity > 0.99, `${variant.name}: releasing a trim does not replay the clip entrance or flash`);
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await page.waitForTimeout(100);
    let original = await snapshot(), bounds = await clip.boundingBox(), live = [];
    await page.mouse.move(bounds.x + 3, bounds.y + 60); await page.mouse.down();
    for (const dx of [18, 31, 48, 67, 83, 101]) {
      await page.mouse.move(bounds.x + 3 + dx, bounds.y + 60, { steps: 3 }); await page.waitForTimeout(25); live.push(await snapshot());
    }
    check(live.every(frame => frame.offset > 0 && frame.duration < original.duration && Math.abs(frame.right - original.right) < 0.5), `${variant.name}: every held left-trim frame crops the range and retains the right edge`);
    check(live.every(frame => frame.pixels === original.pixels && Math.abs(frame.sourceLeft - original.sourceLeft) < 0.5 && Math.abs(frame.sourceWidth - original.sourceWidth) < 0.5), `${variant.name}: surviving waveform pixels remain fixed in timeline space throughout left trim`);
    check(await page.getByLabel('Offset sumber', { exact: true }).inputValue() === '0', `${variant.name}: a held trim previews without prematurely committing project history`);
    await page.screenshot({ path: path.join(folder, `${variant.name}-left-held.png`) }); await page.mouse.up();
    const after = await snapshot(); check(Math.abs(after.offset - live.at(-1).offset) < 0.0001 && after.pixels === original.pixels && Math.abs(after.sourceLeft - original.sourceLeft) < 0.5, `${variant.name}: commit retains the exact crop preview and stationary waveform`);
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
    check((await snapshot()).offset === original.offset && (await snapshot()).duration === original.duration, `${variant.name}: one Undo restores the complete multi-frame trim`);
    await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click(); check((await snapshot()).offset === after.offset, `${variant.name}: Redo restores the same source cut`);
    await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
    original = await snapshot(); bounds = await clip.boundingBox(); live = [];
    await page.mouse.move(bounds.x + bounds.width - 3, bounds.y + 60); await page.mouse.down();
    for (const dx of [19, 38, 59, 81]) { await page.mouse.move(bounds.x + bounds.width - 3 - dx, bounds.y + 60, { steps: 3 }); await page.waitForTimeout(25); live.push(await snapshot()); }
    check(live.every(frame => frame.duration < original.duration && Math.abs(frame.left - original.left) < 0.5 && frame.offset === original.offset), `${variant.name}: right trim crops immediately while keeping the left edge and source offset fixed`);
    check(live.every(frame => frame.pixels === original.pixels && Math.abs(frame.sourceLeft - original.sourceLeft) < 0.5), `${variant.name}: right trim never rescales or slides surviving waveform pixels`);
    await page.screenshot({ path: path.join(folder, `${variant.name}-right-held.png`) }); await page.keyboard.press('Escape'); await page.mouse.up();
    check((await snapshot()).duration === original.duration && (await snapshot()).left === original.left, `${variant.name}: Escape cancels the held trim without committing a cut`);
    bounds = await clip.boundingBox(); await page.mouse.move(bounds.x + 3, bounds.y + 60); await page.mouse.down(); await page.mouse.move(bounds.x + 91, bounds.y + 60, { steps: 6 }); await page.waitForTimeout(50);
    await clip.dispatchEvent('pointercancel', { pointerId: 1, clientX: bounds.x + 91, clientY: bounds.y + 60 }); await page.mouse.up();
    check((await snapshot()).offset === original.offset && (await snapshot()).duration === original.duration, `${variant.name}: interrupted pointer capture restores the original crop`);
    bounds = await clip.boundingBox(); await page.mouse.move(bounds.x + 3, bounds.y + 60); await page.mouse.down(); await page.mouse.move(bounds.x + 92, bounds.y + 60, { steps: 4 }); await page.mouse.up();
    const cut = await snapshot(); bounds = await clip.boundingBox(); await page.mouse.move(bounds.x + 3, bounds.y + 60); await page.mouse.down(); await page.mouse.move(bounds.x - 45, bounds.y + 60, { steps: 4 }); await page.waitForTimeout(50);
    check((await snapshot()).offset < cut.offset && (await snapshot()).pixels === original.pixels && Math.abs((await snapshot()).sourceLeft - original.sourceLeft) < 0.5, `${variant.name}: extending a previously trimmed edge reveals the original audio in place`);
    await page.mouse.up(); await page.waitForTimeout(40);
    check((await snapshot()).opacity > 0.99 && !(await snapshot()).entryRunning, `${variant.name}: repeated trims stay fully visible after release`);
    await page.getByRole('button', { name: 'Snapping (N)', exact: true }).focus(); await page.keyboard.press('Home');
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Perbesar timeline (+)', exact: true }).click();
    await page.waitForTimeout(100); const scroll = page.getByTestId('timeline-scroll');
    await scroll.evaluate(el => { el.scrollLeft = Math.max(0, parseFloat(el.querySelector('.audio-clip').style.left) - 100); }); await page.waitForTimeout(100);
    const scrollBox = await scroll.boundingBox();
    const initialScroll = await scroll.evaluate(el => el.scrollLeft), initialSource = await snapshot(); bounds = await clip.boundingBox();
    await page.mouse.move(bounds.x + 3, bounds.y + 60); await page.mouse.down(); await page.mouse.move(scrollBox.x + scrollBox.width + 30, bounds.y + 60, { steps: 8 });
    await page.waitForTimeout(320); const scrolledSource = await snapshot(), heldScroll = scrolledSource.scrollLeft;
    await fs.writeFile(path.join(folder, `${variant.name}-edge-metrics.json`), JSON.stringify({ initialScroll, heldScroll, sourceShift: scrolledSource.sourceLeft + heldScroll - initialSource.sourceLeft - initialScroll, trimming: scrolledSource.trimming, bounds, scrollBox }, null, 2));
    check(heldScroll > initialScroll + 20 && Math.abs(scrolledSource.sourceLeft + heldScroll - initialSource.sourceLeft - initialScroll) < 0.5, `${variant.name}: holding trim at the viewport edge scrolls smoothly while source time stays anchored`);
    await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(60);
    check((await snapshot()).offset === initialSource.offset && await scroll.evaluate(el => el.scrollLeft) === initialScroll, `${variant.name}: cancelling an edge-scrolling trim restores the crop and viewport`);
    const cancelledScroll = await scroll.evaluate(el => el.scrollLeft); await page.waitForTimeout(120);
    check(await scroll.evaluate(el => el.scrollLeft) === cancelledScroll, `${variant.name}: autoscroll stops after the gesture ends`);
    await page.screenshot({ path: path.join(folder, `${variant.name}-committed.png`) });
    if (native) {
      const exited = new Promise(resolve => app.once('exit', code => resolve(code)));
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })); await page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click();
      let timer; const code = await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(null), 4000); })]); clearTimeout(timer); check(code === 0, 'native: trimming still permits normal close and discard');
    } else await context.close();
  }
  if (!baseline) { check(errors.length === 0, 'trim gestures produce no renderer errors'); await fs.writeFile(path.join(folder, native ? 'native-results.json' : 'results.json'), JSON.stringify({ checks: results.length, results, errors }, null, 2)); console.log(`RESULT: ${results.length} trim checks passed`); }
} finally { if (browser) await browser.close().catch(() => {}); if (app && app.exitCode === null) app.kill(); }

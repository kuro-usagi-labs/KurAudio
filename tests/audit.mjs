import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

await fs.mkdir('test-results/audit', { recursive: true });
const browser = await chromium.launch(), results = [], errors = [];
const check = (value, name) => { assert.ok(value, name); results.push(name); console.log(`PASS ${name}`); };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:1422'); await page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await page.locator('.workspace').waitFor();
  await page.evaluate(() => { window.auditModules = Object.fromEntries(['model', 'audio', 'storage', 'effects'].map(key => [key, performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/' + key + '.ts').name])); });
  await page.getByRole('button', { name: 'Buka sesi demo', exact: true }).click();
  await page.getByTestId('audio-clip').first().waitFor();
  await page.getByRole('button', { name: 'Tambah track', exact: true }).click();
  await page.getByLabel('Nama track 4', { exact: true }).focus();
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await page.locator('.asset-item').first().press('Enter');
  check(await page.getByTestId('audio-clip').count() === 6 && await page.getByLabel('Nama track 4', { exact: true }).count() === 0, 'media placement after undoing its destination track falls back to an existing track');
  await page.getByTestId('audio-clip').first().focus(); await page.keyboard.press('Control+c');
  await page.getByRole('button', { name: 'Tambah track', exact: true }).click(); await page.getByLabel('Nama track 4', { exact: true }).focus();
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await page.keyboard.press('Control+v');
  check(await page.getByTestId('audio-clip').count() === 7, 'paste after undoing its destination track retains a valid track');

  const name = await page.getByLabel('Nama proyek', { exact: true }).inputValue();
  await page.getByTestId('project-input').setInputFiles({ name: 'invalid.kura', mimeType: 'application/json', buffer: Buffer.from('null') });
  await page.getByRole('alert').filter({ hasText: 'Gagal membuka' }).waitFor();
  check(await page.getByLabel('Nama proyek', { exact: true }).inputValue() === name && await page.getByTestId('audio-clip').count() === 7, 'invalid project input preserves the complete current project');
  await page.evaluate(() => {
    const file = new File(['{}'], 'unreadable.kura'); file.text = () => Promise.reject(Error('AUDIT_READ_FAILURE'));
    const transfer = new DataTransfer(); transfer.items.add(file); const input = document.querySelector('[data-testid="project-input"]'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.getByRole('alert').filter({ hasText: 'AUDIT_READ_FAILURE' }).waitFor();
  check(true, 'file-read rejection is reported without an unhandled promise rejection');
  const document = await page.evaluate(async () => { const { editor } = await import(window.auditModules.model); return (await import(window.auditModules.storage)).serializeProject(editor.get().project); });
  await page.getByTestId('project-input').setInputFiles({ name: 'valid.kura', mimeType: 'application/json', buffer: Buffer.from(document) });
  await page.getByRole('status').filter({ hasText: 'Proyek dibuka.' }).waitFor();
  check(await page.getByTestId('audio-clip').count() === 7, 'open operation recovers after invalid and unreadable files');
  const sizeCheck = await page.evaluate(async () => { const s = await import(window.auditModules.storage); let read = false; try { await s.readProjectFile({ size: s.MAX_PROJECT_BYTES + 1, text: async () => { read = true; return ''; } }); } catch (e) { return !read && String(e).includes('400 MB'); } return false; });
  check(sizeCheck, 'oversized project files are rejected before their full text is allocated');
  await page.waitForTimeout(1200);
  const storage = await page.evaluate(async () => {
    const { editor } = await import(window.auditModules.model), audio = await import(window.auditModules.audio), s = await import(window.auditModules.storage);
    const project = editor.get().project, original = new Map(audio.media);
    await s.clearRecovery(); const saving = s.autosave(project, true); audio.media.clear();
    let recovered; try { await saving; recovered = await s.readRecovery(); } finally { for (const [id, item] of original) audio.media.set(id, item); }
    const snapshot = recovered?.media.length === 3 && recovered.media.every(item => item.bytes.byteLength > 0) && recovered.project.clips.length === 7;
    await s.clearRecovery('different-owner'); const ownership = (await s.readRecovery())?.project.id === project.id;
    const a = s.autosave(project, true), b = s.clearRecovery(project.id); await Promise.all([a, b]);
    return { snapshot, ownership, ordered: await s.readRecovery() === null };
  });
  check(storage.snapshot, 'autosave retains embedded binaries when the live media map is replaced during its asynchronous write');
  check(storage.ownership, 'closing another project cannot erase recovery owned by the current project');
  check(storage.ordered, 'discard queued after autosave leaves no stale recoverable session');

  const denoise = await page.evaluate(async () => {
    const { audioContext } = await import(window.auditModules.audio), { preparedBuffer } = await import(window.auditModules.effects), ctx = audioContext();
    const first = ctx.createBuffer(1, 8000, 8000), second = ctx.createBuffer(1, 16000, 8000); first.getChannelData(0).fill(0.01); second.getChannelData(0).fill(0.02);
    const [a, b] = await Promise.all([preparedBuffer('same-asset-id', first, 50, ctx), preparedBuffer('same-asset-id', second, 50, ctx)]);
    return a.length === first.length && b.length === second.length && first.getChannelData(0).length === 8000 && second.getChannelData(0).length === 16000;
  });
  check(denoise, 'concurrent denoise for replaced sources uses each real buffer and leaves source PCM intact');

  await page.evaluate(async () => {
    const { editor, emptyProject, makeClip } = await import(window.auditModules.model), { media, audioContext, putMedia, encodeFloatWav } = await import(window.auditModules.audio);
    media.clear(); const p = emptyProject(), buffer = audioContext().createBuffer(1, 120 * 8000, 8000), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i / 11) * (0.05 + 0.5 * i / data.length);
    const asset = putMedia(buffer, encodeFloatWav(buffer), 'long.wav'); p.assets.push(asset); const c = makeClip(asset, p.tracks[0].id, 0); c.id = 'quote" ] .clip'; p.clips.push(c); editor.load(p);
  });
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Perbesar timeline (+)', exact: true }).click();
  await page.waitForTimeout(160);
  const canvasStats = async () => page.getByTestId('audio-clip').first().locator('canvas').evaluate(el => ({ width: el.width, visible: el.getBoundingClientRect().width, margin: parseFloat(el.style.marginLeft), pixels: el.toDataURL(), parentWidth: el.parentElement.clientWidth, viewport: el.closest('.timeline-scroll').clientWidth }));
  const initial = await canvasStats();
  check(initial.parentWidth > 28000 && initial.width < initial.viewport * 2.1 && initial.width > 100, 'two-minute waveform at maximum zoom allocates only its visible canvas at 200% display scaling');
  check(await page.locator('.tick').count() < 30, 'long timeline ruler renders only visible marks');
  await page.getByTestId('timeline-scroll').evaluate(el => { el.scrollLeft = 15000; }); await page.waitForTimeout(160);
  const scrolled = await canvasStats();
  check(scrolled.margin > 14000 && scrolled.pixels !== initial.pixels && scrolled.width < scrolled.viewport * 2.1, 'horizontal scrolling redraws the correct source region without expanding the canvas');
  await page.getByTestId('timeline-scroll').evaluate(el => { el.scrollLeft = 0; }); await page.waitForTimeout(100);
  const clip = page.getByTestId('audio-clip').first(), box = await clip.boundingBox();
  await page.mouse.move(Math.max(box.x + 50, 450), box.y + 40); await page.mouse.down(); await page.mouse.move(510, box.y + 40, { steps: 4 }); await page.mouse.up();
  check(await page.evaluate(async () => (await import(window.auditModules.model)).editor.get().project.clips[0].start > 0), 'dragging a valid clip ID containing CSS selector characters does not crash');
  await page.screenshot({ path: 'test-results/audit/long-waveform.png' });
  await page.evaluate(async () => {
    const { editor } = await import(window.auditModules.model); editor.edit('Far clip', p => { p.clips[0].start = 1000000; });
  });
  await page.waitForTimeout(100); check(await page.locator('.tick').count() < 30, 'a distant clip position cannot create millions of ruler DOM elements');
  const trackName = page.getByLabel('Nama track 1', { exact: true }); await trackName.fill('x'.repeat(600));
  check((await trackName.inputValue()).length === 160, 'pasting a long track name respects the model limit without throwing');
  await page.evaluate(async () => { const { editor, uid } = await import(window.auditModules.model); editor.edit('Track limit', p => { while (p.tracks.length < 128) p.tracks.push({ id: uid(), name: 'Track', color: 0, gain: 1, muted: false, solo: false }); }); });
  check(await page.getByRole('button', { name: 'Tambah track', exact: true }).isDisabled(), 'add-track control stops at the supported limit instead of throwing');

  await page.waitForTimeout(1200);
  const corruptHandled = await page.evaluate(async () => {
    const s = await import(window.auditModules.storage); await s.clearRecovery();
    await new Promise((resolve, reject) => { const request = indexedDB.open('KurAudio', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('recovery', 'readwrite'); tx.objectStore('recovery').put({ project: null, mediaIds: [], time: Date.now(), dirty: true }, 'session'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; }; request.onerror = reject; });
    try { await s.readRecovery(); return false; } catch (e) { return String(e).includes('Metadata pemulihan rusak'); }
  });
  check(corruptHandled, 'corrupt recovery metadata is rejected before displaying a recovery modal');
  await page.reload(); await page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await page.getByRole('heading', { name: 'Timeline kosong' }).waitFor();
  check(await page.getByRole('alert').filter({ hasText: 'Pemulihan otomatis tidak tersedia' }).isVisible(), 'corrupt recovery starts a usable workspace with an error instead of a blank screen');
  check(errors.length === 0, 'audited failure paths and long timeline interactions produce no renderer errors');
  await fs.writeFile('test-results/audit/results.json', JSON.stringify({ checks: results.length, results, errors }, null, 2));
  console.log(`RESULT: ${results.length} audit regression checks passed`);
} finally { await browser.close(); }

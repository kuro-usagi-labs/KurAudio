import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

// Only the QA binary is launched. The browser profile, files and CDP endpoint
// belong to this test; fake input flags prevent access to physical microphones.
const folder = path.resolve('test-results/studio7/native'), exe = path.resolve(process.env.KURAUDIO_TEST_EXE || 'test-results/studio7/qa/KurAudio.exe');
const profile = path.join(folder, `profile-${Date.now()}`), port = 9241;
const fixturePath = path.join(folder, 'fixture-v3.kura'), destination = path.join(folder, 'saved-v3.kura');
const results = [], errors = [], workers = [];
const check = (value, label) => { assert.ok(value, label); results.push(label); console.log(`PASS ${label}`); };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function within(promise, milliseconds) { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), milliseconds); })]).finally(() => clearTimeout(timer)); }
await fs.mkdir(folder, { recursive: true }); await fs.access(exe);
await new Promise((resolve, reject) => { const probe = net.createServer(); probe.once('error', reject); probe.listen(port, '127.0.0.1', () => probe.close(resolve)); });
const rate = 48000, source = Buffer.alloc(44 + rate * 2 * 2 * 2);
source.write('RIFF'); source.writeUInt32LE(source.length - 8, 4); source.write('WAVEfmt ', 8); source.writeUInt32LE(16, 16); source.writeUInt16LE(1, 20); source.writeUInt16LE(2, 22); source.writeUInt32LE(rate, 24); source.writeUInt32LE(rate * 4, 28); source.writeUInt16LE(4, 32); source.writeUInt16LE(16, 34); source.write('data', 36); source.writeUInt32LE(source.length - 44, 40);
for (let i = 0; i < rate * 2; i++) for (let channel = 0; channel < 2; channel++) source.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 1000 / rate) * 0.08 * 32767), 44 + (i * 2 + channel) * 2);
const project = {
  id: 'studio7-native', name: 'Studio7 native', sampleRate: rate,
  tracks: [{ id: 'voice', name: 'Voice', gain: 1, muted: false, solo: false, color: 0 }, { id: 'locked-track', name: 'Locked track', gain: 1, muted: false, solo: false, color: 1, locked: true }],
  assets: [{ id: 'tone', name: 'Tone.wav', duration: 2, sampleRate: rate, channels: 2 }],
  clips: [
    { id: 'lead', assetId: 'tone', trackId: 'voice', name: 'Lead', start: 0, offset: 0, duration: 2, gain: 1, fadeIn: 0, fadeOut: 0, groupId: 'pair', automation: [{ time: 0, gain: 1 }, { time: 1, gain: 0.6 }, { time: 2, gain: 1 }], curve: [{ time: 0, gain: 0.8 }, { time: 2, gain: 0.8 }], loudnessGain: 1.25, effects: { bypassed: false, denoise: 0, reverb: 10, decay: 0.3, room: 0, roomSize: 'studio', echo: 0, echoTime: 0.28, bass: 0, treble: 0, compression: 20 } },
    { id: 'double', assetId: 'tone', trackId: 'voice', name: 'Double', start: 3, offset: 0, duration: 2, gain: 1, fadeIn: 0, fadeOut: 0, groupId: 'pair' },
    { id: 'locked', assetId: 'tone', trackId: 'locked-track', name: 'Locked', start: 6, offset: 0, duration: 2, gain: 0.2, fadeIn: 0, fadeOut: 0, locked: true, loudnessGain: 2 },
  ],
};
const content = JSON.stringify({ format: 'kuraudio', version: 3, project, media: [{ id: 'tone', data: source.toString('base64') }] });
const workerFile = (await fs.readdir('dist/assets')).find(file => /^loudness\.worker-.*\.js$/.test(file)); assert.ok(workerFile, 'current bundled loudness worker exists');
async function launch() {
  const app = spawn(exe, [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-allow-origins=* --use-fake-device-for-media-stream --use-fake-ui-for-media-stream` } });
  let startupError; app.once('error', error => { startupError = error; });
  const exited = new Promise(resolve => app.once('exit', (code, signal) => resolve({ code, signal })));
  let browser;
  try {
    for (let i = 0; i < 100; i++) { try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; } catch { if (startupError || app.exitCode !== null) break; await delay(200); } }
    assert.ok(browser, `isolated QA instance starts: ${startupError || app.exitCode}`);
    await fs.access(path.join(profile, 'EBWebView'));
    const page = browser.contexts()[0].pages()[0]; page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(String(error))); page.on('worker', worker => workers.push(worker.url()));
    await page.getByRole('button', { name: 'Proyek baru', exact: true }).waitFor();
    return { app, exited, browser, page };
  } catch (error) { if (browser) await browser.close().catch(() => {}); if (app.pid && app.exitCode === null) app.kill(); throw error; }
}
async function cleanup(run) { await run.browser.close().catch(() => {}); if (run.app.exitCode === null) { run.app.kill(); await within(run.exited, 3000); } }
async function installObservability(page) {
  await page.evaluate(destination => {
    const nativeFetch = window.fetch.bind(window);
    window.__studio7Native = { nextPath: destination, dialogs: 0, writes: 0, exports: 0, writePaths: [] };
    // Tauri's invoke function is deliberately non-writable. Intercept only its
    // chooser request at the fetch transport and forward every real IPC command.
    window.fetch = async (input, options) => {
      const audit = window.__studio7Native;
      const url = new URL(typeof input === 'string' ? input : input.url, location.href), command = url.hostname === 'ipc.localhost' ? decodeURIComponent(url.pathname.slice(1)) : '';
      // Only the OS chooser is replaced. All file writes/reads and audio exports
      // continue through the packaged application's actual Rust commands.
      if (command === 'plugin:dialog|save') { audit.dialogs++; return new Response(JSON.stringify(audit.nextPath), { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } }); }
      const result = await nativeFetch(input, options);
      if (result.headers.get('Tauri-Response') === 'ok') {
        if (command === 'write_project') { audit.writes++; audit.writePaths.push(JSON.parse(options.body).path); }
        if (command === 'export_wav') audit.exports++;
      }
      return result;
    };
  }, destination);
}
async function readSession(page) {
  return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('KurAudio', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('recovery'), read = tx.objectStore('recovery').get('session'); read.onsuccess = () => resolve(read.result?.project); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close(); }; }));
}
async function sessionWhere(page, predicate) {
  for (let i = 0; i < 35; i++) { const state = await readSession(page); if (state && predicate(state)) return state; await delay(150); }
  throw Error('Expected project state was not persisted by recovery: ' + JSON.stringify(await readSession(page)));
}
async function readVersions(page) {
  return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('KurAudioCheckpoints', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; if (!db.objectStoreNames.contains('checkpoints')) { db.close(); resolve([]); return; } const tx = db.transaction('checkpoints'), read = tx.objectStore('checkpoints').getAll(); read.onsuccess = () => resolve(read.result.sort((a, b) => b.time - a.time)); read.onerror = () => reject(read.error); tx.oncomplete = () => db.close(); }; }));
}
async function saveCurrent(page) {
  const writes = await page.evaluate(() => window.__studio7Native.writes);
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await page.waitForFunction(before => window.__studio7Native.writes > before, writes);
  await page.waitForFunction(() => !document.querySelector('.busy-overlay'));
  return JSON.parse(await fs.readFile(destination, 'utf8'));
}
async function exportWav(page, filename, selected = false) {
  const target = path.join(folder, filename), count = await page.evaluate(() => window.__studio7Native.exports);
  await page.evaluate(target => { window.__studio7Native.nextPath = target; }, target);
  await page.getByRole('button', { name: 'Ekspor audio', exact: true }).click();
  if (selected) await page.getByRole('button', { name: 'Klip terpilih', exact: true }).click();
  const normalized = await page.getByRole('checkbox', { name: 'Normalisasi peak ke −1 dBFS', exact: true }).isChecked();
  await page.getByRole('button', { name: 'Ekspor WAV', exact: true }).click();
  await page.waitForFunction(before => window.__studio7Native.exports > before, count); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.evaluate(destination => { window.__studio7Native.nextPath = destination; }, destination);
  return { bytes: await fs.readFile(target), target, normalized };
}
async function measureNativeWav(page, target) {
  return page.evaluate(async ({ target, workerFile }) => {
    const bytes = await window.__TAURI_INTERNALS__.invoke('read_audio', { path: target }), ctx = new OfflineAudioContext(2, 1, 48000), decoded = await ctx.decodeAudioData(bytes);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, channel) => decoded.getChannelData(channel).slice());
    const worker = new Worker(new URL('/assets/' + workerFile, location.href), { type: 'module' });
    try { return await new Promise((resolve, reject) => { worker.onerror = event => reject(Error(event.message)); worker.onmessage = ({ data }) => data.error ? reject(Error(data.error)) : resolve({ ...data.measurement, decodedDuration: decoded.duration }); worker.postMessage({ id: 1, channels, sampleRate: decoded.sampleRate }, channels.map(channel => channel.buffer)); }); }
    finally { worker.terminate(); }
  }, { target, workerFile });
}
async function closeNative(run) { await run.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(error => { if (!/closed|destroyed/.test(String(error))) throw error; }); }
let run;
try {
  run = await launch(); const { page } = run;
  check(await page.evaluate(() => !!window.__TAURI_INTERNALS__ && window.isTauri === true), 'QA executable uses the real Tauri runtime and an isolated WebView profile');
  await page.evaluate(data => window.__TAURI_INTERNALS__.invoke('write_project', data), { path: fixturePath, content });
  check((await fs.readFile(fixturePath, 'utf8')) === content, 'Rust accepts a real v3 project and writes its embedded audio without changing metadata');
  await page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await page.getByTestId('project-input').setInputFiles(fixturePath); await page.getByTestId('audio-clip').nth(2).waitFor(); await installObservability(page);
  const opened = await sessionWhere(page, value => value.id === project.id && value.clips.length === 3);
  check(opened.clips[0].loudnessGain === 1.25 && opened.clips[0].automation[1].gain === 0.6 && opened.clips[0].groupId === 'pair' && opened.tracks[1].locked && opened.clips[2].locked, 'bundled UI opens v3 group, track/clip lock, automation and output gain with decoded media');
  const lead = page.locator('[data-clip-id="lead"]'), locked = page.locator('[data-clip-id="locked"]');
  await lead.click({ position: { x: 40, y: 55 } }); check(await page.locator('.audio-clip.is-selected').count() === 2 && await page.locator('.bulk-clips li').count() === 2, 'native group selection expands into one coherent bulk inspector');
  await lead.click({ button: 'right', position: { x: 40, y: 55 } }); await page.getByRole('menuitem', { name: 'Pisahkan grup', exact: true }).click(); await sessionWhere(page, value => !value.clips[0].groupId && !value.clips[1].groupId);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await sessionWhere(page, value => value.clips[0].groupId === 'pair' && value.clips[1].groupId === 'pair'); check(true, 'context ungroup is reversible with one native Undo');
  await lead.click({ position: { x: 40, y: 55 } }); await page.keyboard.press('Control+Shift+g'); await sessionWhere(page, value => !value.clips[0].groupId); await lead.click({ position: { x: 40, y: 55 } });
  await page.keyboard.press('Control+Shift+h'); const historyCount = await page.locator('.history-steps li').count(); await page.getByRole('button', { name: 'Volume automation (G)', exact: true }).click();
  const point = page.getByRole('slider', { name: 'Volume titik 2 Lead', exact: true }), box = await point.boundingBox(); assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 - 10, { steps: 8 });
  check(await page.locator('.history-steps li').count() === historyCount, 'native automation drag previews without adding edit history'); await page.mouse.up();
  const automated = await sessionWhere(page, value => value.clips[0].automation[1].gain > 0.6);
  check(await page.locator('.history-steps li').count() === historyCount + 1 && automated.clips[0].automation[1].time > 1 && JSON.stringify(automated.clips[0].curve) === JSON.stringify(project.clips[0].curve), 'native automation drag commits exactly one edit and preserves the baked curve');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click(); await sessionWhere(page, value => JSON.stringify(value.clips[0].automation) === JSON.stringify(project.clips[0].automation)); check(true, 'one Undo restores every automation point to its pre-drag value');
  await page.getByRole('button', { name: 'Pilih & geser (V)', exact: true }).click(); await locked.click({ position: { x: 40, y: 55 } });
  const lockedBefore = await locked.boundingBox(); await page.mouse.move(lockedBefore.x + 40, lockedBefore.y + 55); await page.mouse.down(); await page.mouse.move(lockedBefore.x + 90, lockedBefore.y + 55, { steps: 6 }); await page.mouse.up(); await page.keyboard.press('Delete');
  check(Math.abs((await locked.boundingBox()).x - lockedBefore.x) < 0.1 && await page.getByRole('button', { name: 'Hapus (Delete)', exact: true }).isDisabled(), 'locked native audio remains selectable while move and delete are prevented');
  await page.getByRole('tab', { name: 'Properti', exact: true }).click(); check(await page.getByLabel('Gain klip', { exact: true }).isDisabled(), 'native Inspector disables numeric audio edits for a locked track');
  await lead.click({ button: 'right', position: { x: 40, y: 55 } }); await page.getByRole('menuitem', { name: 'Edit presisi', exact: true }).click();
  const cursor = page.getByLabel('Posisi edit presisi', { exact: true }); await cursor.fill('1'); await cursor.press('Enter'); const canvas = page.getByRole('slider', { name: 'Titik edit presisi', exact: true }); await canvas.focus(); await page.keyboard.press('ArrowRight');
  check(Math.abs(Number(await canvas.getAttribute('aria-valuenow')) - (1 + 1 / 48000)) < 0.000001, 'packaged precision cursor advances by one decoded audio sample');
  await page.getByRole('checkbox', { name: 'Fade aman 3 ms saat cut', exact: true }).check(); await page.getByRole('button', { name: 'Potong di sini', exact: true }).click();
  const cut = await sessionWhere(page, value => value.clips.length === 4), right = cut.clips.find(clip => clip.name === 'Lead' && clip.id !== 'lead');
  const left = cut.clips.find(clip => clip.id === 'lead'), gainAt = (clip, time) => clip.curve.find(point => Math.abs(point.time - time) < 1e-7)?.gain;
  check(Math.abs(left.duration - (1 + 1 / 48000)) < 0.000001 && gainAt(left, left.duration) === 0 && Math.abs(gainAt(left, left.duration - 0.003) - 0.8) < 1e-7 && gainAt(right, 0) === 0 && Math.abs(gainAt(right, 0.003) - 0.8) < 1e-7 && right.loudnessGain === 1.25 && right.automation.length >= 2, 'native precision cut retains independent envelopes and output gain with real 3ms boundary fades');
  await page.locator(`[data-clip-id="${right.id}"]`).click({ position: { x: 25, y: 55 } }); await page.keyboard.down('Shift'); await page.locator('[data-clip-id="double"]').click({ position: { x: 40, y: 55 } }); await page.keyboard.up('Shift'); await page.keyboard.press('Control+g'); await sessionWhere(page, value => !!value.clips.find(clip => clip.id === right.id).groupId);
  await page.keyboard.press('Control+Shift+h'); await page.getByRole('tab', { name: /^Cadangan/ }).click(); await page.getByRole('button', { name: 'Buat cadangan', exact: true }).click();
  let versions; for (let i = 0; i < 40; i++) { versions = await readVersions(page); if (versions.some(row => row.projectId === project.id && row.project.clips.length === 4)) break; await delay(150); }
  const baselineVersion = versions.find(row => row.projectId === project.id && row.project.clips.length === 4); assert.ok(baselineVersion); const baseline = baselineVersion.project;
  check(baselineVersion.media.length === 1 && baselineVersion.media[0].hash.length === 64, 'native manual checkpoint commits source references to the separate version database');
  await lead.click({ position: { x: 35, y: 55 } }); await page.getByRole('tab', { name: 'Properti', exact: true }).click(); await page.getByLabel('Gain klip', { exact: true }).fill('-6'); await page.getByLabel('Gain klip', { exact: true }).press('Enter'); await sessionWhere(page, value => value.clips.find(clip => clip.id === 'lead').gain < 0.6);
  await page.getByRole('button', { name: `Pulihkan cadangan ${baselineVersion.id}`, exact: true }).click(); await page.getByRole('dialog', { name: 'Simpan perubahan?', exact: true }).waitFor(); await page.getByRole('button', { name: 'Simpan & lanjut', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]') && !document.querySelector('.busy-overlay'));
  await sessionWhere(page, value => value.clips.length === 4 && value.clips.find(clip => clip.id === 'lead').gain === baseline.clips.find(clip => clip.id === 'lead').gain);
  const dialogsBeforeSave = await page.evaluate(() => window.__studio7Native.dialogs), restored = await saveCurrent(page);
  check(dialogsBeforeSave === 1 && await page.evaluate(() => window.__studio7Native.dialogs) === dialogsBeforeSave && await page.getByLabel('Status berkas proyek', { exact: true }).innerText() === 'Berkas: tersimpan', 'restore after Save & continue keeps the new native file path, so Ctrl+S does not open a second picker');
  check(restored.version === 3 && JSON.stringify(restored.project) === JSON.stringify(baseline) && restored.media[0].data === source.toString('base64'), 'real Rust Save persists the restored v3 state, groups, locks, envelopes, output gain and original audio');
  await page.getByRole('button', { name: 'Putar (Space)', exact: true }).click(); await delay(250); const peak = await page.locator('.meter-heading span').last().innerText(); await page.getByRole('button', { name: 'Stop', exact: true }).click();
  check(Number.parseFloat(peak) > -70, 'restored checkpoint decodes and produces actual native playback analyser output');
  await lead.click({ position: { x: 35, y: 55 } }); await page.getByRole('button', { name: 'Alat audio', exact: true }).click(); await page.getByRole('tab', { name: 'Loudness', exact: true }).click(); await page.getByRole('button', { name: 'Ukur loudness', exact: true }).click(); await page.getByRole('button', { name: /Terapkan pencocokan/ }).click();
  check(await page.locator('[data-loudness-result]').count() === 0 || (await page.locator('.loudness-status').innerText()).includes('dicocokkan'), 'bundled loudness worker measures the selected decoded clip and applies matching');
  await page.getByRole('button', { name: 'Tutup dialog', exact: true }).click();
  const matched = await saveCurrent(page), changedGain = matched.project.clips.find(clip => clip.id === 'lead').loudnessGain;
  check(changedGain > 1.25 && matched.project.clips.find(clip => clip.id === 'lead').gain === 1 && matched.project.clips.find(clip => clip.id === 'locked').loudnessGain === 2, 'native matching persists a post-effect gain while preserving input gain and locked audio');
  const exported = await exportWav(page, 'matched-selected.wav', true); check(!exported.normalized, 'native export leaves peak normalization off after matching so it preserves the LUFS target');
  const measurement = await measureNativeWav(page, exported.target);
  check(Math.abs(measurement.integratedLufs + 16) < 0.1 && measurement.truePeakDbtp <= -1 + 0.0001 && measurement.decodedDuration > 1, 'Rust-exported selected WAV decodes and remeasures at -16LUFS within 0.1LU and the true-peak ceiling');
  const savedBytes = await fs.readFile(destination); await page.getByLabel('Nama proyek', { exact: true }).fill('Unsaved native edit'); await delay(1100); await closeNative(run); await page.getByRole('button', { name: 'Batal', exact: true }).click();
  check(run.app.exitCode === null && (await fs.readFile(destination)).equals(savedBytes) && await page.getByLabel('Nama proyek', { exact: true }).inputValue() === 'Unsaved native edit', 'native Close cancellation preserves unsaved editor state and the previously saved v3 file');
  await page.screenshot({ path: path.join(folder, 'native-studio7.png') }); await closeNative(run); await page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click(); check((await within(run.exited, 5000))?.code === 0 && (await fs.readFile(destination)).equals(savedBytes), 'native discard closes the actual process without overwriting the saved project'); await cleanup(run); run = null; await delay(250);
  run = await launch(); check(await run.page.getByRole('button', { name: 'Proyek baru', exact: true }).isVisible(), 'discarded native edits do not return as crash recovery in the same isolated profile');
  await run.page.getByRole('button', { name: 'Buka Studio7 native', exact: true }).click(); await run.page.getByTestId('audio-clip').nth(3).waitFor();
  check((await readVersions(run.page)).some(row => row.id === baselineVersion.id), 'native local checkpoints survive close and reopening the actual saved project');
  await closeNative(run); check((await within(run.exited, 5000))?.code === 0, 'reopened clean v3 project closes normally'); check(errors.length === 0, `native Studio7 workflows have no renderer errors: ${errors.join('; ')}`);
  await fs.writeFile(path.join(folder, 'results.json'), JSON.stringify({ checks: results.length, results, errors, workers, measurement, profile, exe }, null, 2)); console.log(`RESULT: ${results.length} native Studio7 checks passed`);
} catch (error) {
  if (run && !run.page.isClosed()) {
    const diagnostic = await run.page.evaluate(() => ({ text: document.body.innerText.slice(-2500), audit: window.__studio7Native, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.textContent), busy: [...document.querySelectorAll('.busy-overlay')].map(node => node.textContent) })).catch(() => null);
    await fs.writeFile(path.join(folder, 'failure.json'), JSON.stringify({ error: String(error), diagnostic }, null, 2)); console.error('NATIVE_DIAGNOSTIC', JSON.stringify(diagnostic));
    await run.page.screenshot({ path: path.join(folder, 'native-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (run) await cleanup(run);
  await fs.writeFile(path.join(folder, 'last-run.json'), JSON.stringify({ checks: results.length, results, errors, workers, profile, exe }, null, 2));
}

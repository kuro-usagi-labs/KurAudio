import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.KURAUDIO_TEST_LIFECYCLE_RESULTS || 'test-results/lifecycle'); await fs.mkdir(root, { recursive: true });
const exe = path.resolve(process.env.KURAUDIO_TEST_EXE || 'src-tauri/target/release/kuraudio.exe');
let count = 0; const results = [];
const check = (value, name) => { assert.ok(value, name); count++; results.push(name); console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function within(promise, ms) { let timer; return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(null), ms); })]).finally(() => clearTimeout(timer)); }
const profile = name => path.join(root, `${name}-${Date.now()}`);
async function start(folder) {
  const app = spawn(exe, [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: folder, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9228 --remote-allow-origins=*' } });
  const exited = new Promise(resolve => app.once('exit', (code, signal) => resolve({ code, signal })));
  let browser;
  try {
    for (let i = 0; i < 60; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9228'); break; } catch { if (app.exitCode !== null) break; await delay(200); } }
    assert.ok(browser, 'isolated native app exposes its WebView');
    const page = browser.contexts()[0].pages()[0], errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.waitForSelector('.home-screen'); await fs.access(path.join(folder, 'EBWebView')); await delay(250);
    return { app, exited, browser, page, errors };
  } catch (error) { if (browser) await browser.close().catch(() => {}); app.kill(); throw error; }
}
async function cleanup(run) { await run.browser.close().catch(() => {}); if (run.app.exitCode === null) { run.app.kill(); await run.exited; } await delay(200); }
async function requestClose(run) { await run.page.evaluate(() => window.__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(error => { if (!/closed|destroyed/.test(String(error))) throw error; }); }
async function closed(run, message) {
  const result = await within(run.exited, 4000);
  if (result?.code !== 0) console.error('CLOSE_DIAGNOSTIC', JSON.stringify({ message, result, pid: run.app.pid, exitCode: run.app.exitCode, errors: run.errors }));
  check(result?.code === 0, message);
  check(run.errors.length === 0, 'close path produces no renderer errors or rejected native commands');
}
async function demo(run) { await run.page.getByRole('button', { name: 'Proyek baru', exact: true }).click(); await run.page.getByRole('button', { name: 'Buka sesi demo' }).click(); await run.page.getByTestId('audio-clip').first().waitFor(); }

if (process.argv.includes('--save-dialog')) {
  const folder = profile('save'), run = await start(folder);
  const name = `Audit-save-${Date.now()}`, destination = path.join(root, `${name}.kura`);
  try {
    await demo(run); await run.page.getByLabel('Nama proyek', { exact: true }).fill(name);
    await requestClose(run); await run.page.getByRole('button', { name: 'Simpan & lanjut', exact: true }).click();
    await fs.writeFile(path.join(root, 'save-dialog.json'), JSON.stringify({ pid: run.app.pid, destination, name, profile: folder }, null, 2));
    console.log(`READY_SAVE_DIALOG ${destination}`);
    // The real Windows picker is completed using the Computer Use skill.
    const result = await within(run.exited, 600000);
    check(result?.code === 0, 'Save & continue closes the real native process after the Windows file picker');
    const document = JSON.parse(await fs.readFile(destination, 'utf8'));
    check(document.project.name === name && document.project.clips.length === 5 && document.media.length === 3, 'Save & continue writes a complete project and embedded media before exit');
    check(run.errors.length === 0, 'native save-and-close has no renderer errors');
    await cleanup(run);
    const reopened = await start(folder);
    try { check(await reopened.page.getByRole('button', { name: 'Proyek baru', exact: true }).isVisible(), 'successful save-and-close does not leave a spurious crash-recovery prompt'); await requestClose(reopened); await closed(reopened, 'application can close again after saved-session restart'); }
    finally { await cleanup(reopened); }
  } finally { await cleanup(run); }
} else {
  let run = await start(profile('clean'));
  try { await requestClose(run); await closed(run, 'clean Windows window actually terminates its process'); } finally { await cleanup(run); }
  const discarded = profile('discard'); run = await start(discarded);
  try {
    await demo(run); await delay(1200);
    const before = await run.page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
    check(!before, 'native desktop uses one close guard instead of also cancelling beforeunload');
    await requestClose(run); await run.page.getByRole('button', { name: 'Batal', exact: true }).click(); await delay(200);
    check(run.app.exitCode === null && await run.page.getByTestId('audio-clip').count() === 5, 'Cancel keeps the unsaved project and process intact');
    await requestClose(run); await requestClose(run);
    check(await run.page.getByRole('dialog', { name: 'Simpan perubahan?' }).count() === 1, 'repeated native close requests produce only one confirmation');
    await run.page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click();
    await closed(run, 'Continue without saving terminates the actual Windows process');
  } finally { await cleanup(run); }
  run = await start(discarded);
  try { check(await run.page.getByRole('button', { name: 'Proyek baru', exact: true }).isVisible(), 'explicit discard does not come back as crash recovery'); await requestClose(run); await closed(run, 'discarded-session restart closes normally'); } finally { await cleanup(run); }

  const crashed = profile('recovery'); run = await start(crashed);
  try { await demo(run); await delay(1400); run.app.kill(); await run.exited; } finally { await cleanup(run); }
  run = await start(crashed);
  try { await run.page.getByRole('button', { name: 'Pulihkan sesi', exact: true }).waitFor(); await requestClose(run); await closed(run, 'closing the recovery chooser exits without an extra unsaved prompt'); } finally { await cleanup(run); }
  run = await start(crashed);
  try {
    check(await run.page.getByRole('button', { name: 'Pulihkan sesi', exact: true }).isVisible(), 'closing the recovery chooser preserves the recoverable session');
    await run.page.getByRole('button', { name: 'Pulihkan sesi', exact: true }).click(); await run.page.getByTestId('audio-clip').first().waitFor();
    await run.page.getByRole('button', { name: 'Putar (Space)', exact: true }).click(); await run.page.getByRole('button', { name: 'Jeda (Space)', exact: true }).waitFor();
    await requestClose(run); await run.page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click(); await closed(run, 'discard while audio is playing stops playback and exits');
  } finally { await cleanup(run); }

  for (const mode of ['throw', 'stall']) {
    run = await start(profile(`storage-${mode}`));
    try {
      await demo(run); await delay(1300);
      await run.page.evaluate(mode => {
        const original = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (...args) {
          if (args[1] === 'readwrite') { if (mode === 'throw') throw Error('AUDIT_STORAGE_UNAVAILABLE'); return { objectStore: () => ({ get: () => ({}) }) }; }
          return original.apply(this, args);
        };
      }, mode);
      await requestClose(run); await run.page.getByRole('button', { name: 'Lanjut tanpa simpan', exact: true }).click();
      await closed(run, `${mode === 'throw' ? 'unavailable' : 'unresponsive'} recovery storage cannot trap an approved native close`);
    } finally { await cleanup(run); }
  }

  run = await start(profile('single'));
  try {
    const second = spawn(exe, [], { windowsHide: true, env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile('second') } });
    const secondExit = new Promise(resolve => second.once('exit', (code, signal) => resolve({ code, signal })));
    const result = await within(secondExit, 4000);
    if (!result) second.kill();
    check(result?.code === 0 && run.app.exitCode === null, 'second launch exits instead of opening a competing autosave writer');
    await requestClose(run); await closed(run, 'single-instance primary still closes normally');
  } finally { await cleanup(run); }
}
await fs.writeFile(path.join(root, process.argv.includes('--save-dialog') ? 'save-results.json' : 'results.json'), JSON.stringify({ checks: count, results }, null, 2));
console.log(`RESULT: ${count} native lifecycle checks passed`);

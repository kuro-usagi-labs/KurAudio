import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// All persistence lives in this disposable browser context. No user profile or files are opened.
const output = path.resolve('test-results/comfort/recents');
await fs.mkdir(output, { recursive: true });
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recent projects test</title></head><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { HomeScreen } from '/src/HomeScreen.tsx';
import '/src/theme.css'; import '/src/styles.css'; import '/src/motion.css';
const root = createRoot(document.getElementById('root'));
window.recentEvents = [];
window.renderRecentHome = (entries = [], disabled = false) => root.render(React.createElement(HomeScreen, { disabled, onNew() {}, onOpen() {}, onDropProject() {}, recentProjects: entries, onOpenRecent: entry => window.recentEvents.push(['open', entry.id]), onRemoveRecent: entry => window.recentEvents.push(['remove', entry.id]) }));
window.renderRecentHome(); window.harnessReady = true;
</script></body></html>`;
const server = await createServer({ server: { host: '127.0.0.1', port: 1435, strictPort: true }, plugins: [{ name: 'comfort-recents-harness', configureServer(server) { server.middlewares.use('/comfort-recents-test.html', async (req, res, next) => { try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(req.url, html)); } catch (error) { next(error); } }); } }] });
let browser;
const results = [], errors = [];
const check = (condition, name) => { assert.ok(condition, name); results.push(name); console.log(`PASS ${name}`); };
try {
  await server.listen();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:1435/comfort-recents-test.html');
  await page.waitForFunction(() => window.harnessReady);

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    const request = indexedDB.open('KurAudio', 1);
    await new Promise((resolve, reject) => { request.onupgradeneeded = () => request.result.createObjectStore('recovery'); request.onerror = () => reject(request.error); request.onsuccess = resolve; });
    const db = request.result, tx = db.transaction('recovery', 'readwrite'); tx.objectStore('recovery').put({ marker: 'recovery-owned-by-editor' }, 'session');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    return await recents.rememberRecentProject({ id: 'native-a', name: 'Wawancara', path: 'D:\\Audio\\Interview.kura' });
  }), 'an explicit native save can persist a recent path');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    await recents.rememberRecentProject({ id: 'native-b', name: 'Wawancara terbaru', path: 'd:/audio/INTERVIEW.kura' });
    const entries = await recents.listRecentProjects(), read = await recents.readRecentProject('native-b');
    return entries.length === 1 && entries[0].id === 'native-b' && read.entry.path === 'd:/audio/INTERVIEW.kura' && !('content' in read) && await recents.readRecentProject('native-a') === null;
  }), 'Windows native paths deduplicate across case and slash differences');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    const content = JSON.stringify({ format: 'kuraudio', project: { name: 'Lokal' }, media: [] });
    await recents.rememberRecentProject({ id: 'browser', name: 'Lokal', path: null, content });
    const result = await recents.readRecentProject('browser'), list = await recents.listRecentProjects();
    return result?.content === content && result.entry.path === null && list[0].id === 'browser' && !('content' in list[0]);
  }), 'browser entries reopen their saved snapshot while list metadata stays small');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    await recents.rememberRecentProject({ id: 'native-b', name: 'Updated', path: 'd:/audio/INTERVIEW.kura' });
    return (await recents.listRecentProjects()).map(entry => entry.id).join() === 'native-b,browser';
  }), 'remembering an entry updates its name and puts it first');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    for (let i = 0; i < 9; i++) await recents.rememberRecentProject({ id: `limit-${i}`, name: `Project ${i}`, path: null, content: `snapshot-${i}` });
    const entries = await recents.listRecentProjects();
    return entries.length === 8 && entries[0].id === 'limit-8' && entries[7].id === 'limit-1' && await recents.readRecentProject('limit-0') === null;
  }), 'only the eight most recent entries survive record eviction');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    for (const entry of await recents.listRecentProjects()) await recents.forgetRecentProject(entry.id);
    await recents.rememberRecentProject({ id: 'old-big', name: 'Older snapshot', path: null, content: 'x'.repeat(40 * 1024 * 1024) });
    await recents.rememberRecentProject({ id: 'new-big', name: 'Newer snapshot', path: null, content: 'y'.repeat(40 * 1024 * 1024) });
    const entries = await recents.listRecentProjects();
    return entries.length === 1 && entries[0].id === 'new-big' && await recents.readRecentProject('old-big') === null && (await recents.readRecentProject('new-big')).content.length === 40 * 1024 * 1024;
  }), 'snapshot byte budget evicts the oldest content before exceeding 64 MiB');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    await recents.forgetRecentProject('new-big');
    await recents.rememberRecentProject({ id: 'oversize', name: 'Old', path: null, content: '{}' });
    const saved = await recents.rememberRecentProject({ id: 'oversize', name: 'Too large', path: null, content: '界'.repeat(23 * 1024 * 1024) });
    const missing = await recents.rememberRecentProject({ id: 'missing', name: 'No snapshot', path: null });
    return saved === false && missing === false && (await recents.listRecentProjects()).length === 0 && await recents.readRecentProject('oversize') === null;
  }), 'oversized UTF-8 or missing snapshots cannot offer a stale browser reopen');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    await recents.rememberRecentProject({ id: 'failed', name: 'Earlier', path: null, content: '{}' });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('Full', 'QuotaExceededError'); };
    let result;
    try { result = await recents.rememberRecentProject({ id: 'failed', name: 'Failed update', path: null, content: '{"new":true}' }); }
    finally { IDBObjectStore.prototype.put = original; }
    return result === false && await recents.readRecentProject('failed') === null && (await recents.listRecentProjects()).length === 0;
  }), 'an aborted snapshot transaction returns false and hides the stale snapshot');

  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    await Promise.all(Array.from({ length: 12 }, (_, i) => recents.rememberRecentProject({ id: `parallel-${i}`, name: `Parallel ${i}`, path: `D:\\parallel-${i}.kura` })));
    const entries = await recents.listRecentProjects();
    return entries.length === 8 && entries[0].id === 'parallel-11' && entries[7].id === 'parallel-4';
  }), 'queued simultaneous updates keep a coherent bounded MRU list');

  check(await page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB');
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Denied', 'SecurityError'); } });
    const recents = await import('/src/recentProjects.ts');
    try { return (await recents.listRecentProjects()).length === 0 && await recents.readRecentProject('anything') === null && await recents.rememberRecentProject({ id: 'denied', name: 'Denied', path: null, content: '{}' }) === false && await recents.forgetRecentProject('anything') === undefined; }
    finally { if (descriptor) Object.defineProperty(window, 'indexedDB', descriptor); else delete window.indexedDB; }
  }), 'unavailable IndexedDB does not reject application open/save flows');

  check(await page.evaluate(async () => {
    const request = indexedDB.open('KurAudioRecents', 1);
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    const db = request.result, tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
    store.put({ id: 'corrupt-content', name: 'Corrupt snapshot', path: null, time: Date.now(), content: 12 });
    store.put({ id: 'corrupt-path', name: 'Empty path', path: '', time: Date.now() });
    store.put({ id: 'corrupt-time', name: 'Unusable future date', path: 'D:\\future.kura', time: 8.64e15 });
    store.put({ id: 123, name: 'Wrong ID', path: 'D:\\wrong.kura', time: Date.now() });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    const recents = await import('/src/recentProjects.ts');
    await recents.rememberRecentProject({ id: 'after-corruption', name: 'Still usable', path: 'D:\\good.kura' });
    const entries = await recents.listRecentProjects();
    return entries[0]?.id === 'after-corruption' && !entries.some(entry => entry.id.startsWith('corrupt-')) && await recents.readRecentProject('corrupt-content') === null;
  }), 'corrupt records cannot poison valid recent entries or their order');

  await page.reload();
  await page.waitForFunction(() => window.harnessReady);
  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    await recents.rememberRecentProject({ id: 'persistent-browser', name: 'Persists across launch', path: null, content: '{"snapshot":"saved"}' });
    await recents.forgetRecentProject('after-corruption');
    return await recents.readRecentProject('after-corruption') === null;
  }), 'forgetting removes only the selected recent record');
  await page.reload();
  await page.waitForFunction(() => window.harnessReady);
  check(await page.evaluate(async () => {
    const recents = await import('/src/recentProjects.ts');
    const result = await recents.readRecentProject('persistent-browser');
    return result?.content === '{"snapshot":"saved"}' && (await recents.listRecentProjects())[0]?.id === 'persistent-browser';
  }), 'browser snapshots remain reopenable after a fresh module launch');

  check(await page.evaluate(async () => {
    const request = indexedDB.open('KurAudio', 1);
    await new Promise((resolve, reject) => { request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    const db = request.result, get = db.transaction('recovery').objectStore('recovery').get('session');
    const value = await new Promise((resolve, reject) => { get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); }); db.close();
    return value.marker === 'recovery-owned-by-editor' && (await indexedDB.databases()).some(database => database.name === 'KurAudioRecents');
  }), 'recent projects use a separate database and never modify recovery');

  const entries = [{ id: 'native', name: 'Percakapan dengan nama proyek yang sangat panjang agar tetap muat', path: 'D:\\Rekaman\\Nama folder yang panjang\\percakapan.kura', time: Date.now() }, { id: 'browser', name: 'Catatan lokal', path: null, time: Date.now() - 86400000 }];
  await page.evaluate(entries => window.renderRecentHome(entries), entries);
  await page.getByRole('button', { name: `Buka ${entries[0].name}`, exact: true }).waitFor();
  check(await page.getByText('Lokal di browser', { exact: true }).isVisible() && await page.getByText(entries[0].path, { exact: true }).count() === 1 && await page.locator('button button').count() === 0, 'home shows honest native/browser locations with separate interactive controls');
  await page.getByRole('button', { name: 'Buka Catatan lokal', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Hapus Catatan lokal dari daftar terbaru', exact: true }).click();
  check(JSON.stringify(await page.evaluate(() => window.recentEvents)) === JSON.stringify([['open', 'browser'], ['remove', 'browser']]), 'keyboard opening and forgetting send the exact recent entry to their callbacks');
  for (const width of [320, 390, 900, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 740 : 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `recent projects fit ${width}px without horizontal overflow`);
    if (width === 320 || width === 1440) await page.screenshot({ path: path.join(output, `home-recents-${width}.png`), fullPage: true });
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  check(axe.violations.length === 0, 'home recent projects have no automated WCAG A/AA violations');
  await page.evaluate(() => window.renderRecentHome([]));
  await page.getByRole('button', { name: 'Proyek baru', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'Terakhir dibuka', exact: true }).count() === 0, 'an empty recent list shows no fabricated projects');
  check(errors.length === 0, 'recent-project storage and controls produce no renderer errors');
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ results, errors, axe: axe.violations }, null, 2));
  console.log(`RESULT: ${results.length} recent-project checks passed`);
} finally { if (browser) await browser.close(); await server.close(); }
